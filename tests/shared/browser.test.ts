import { describe, expect, it } from 'vitest';
import { areaName, browserMessage, certVerdict, cleanBounds, cleanElement, cleanRect, imageBox, isLocalUrl, navVerdict, toAddress, viewBounds } from '@shared/browser';

describe('isLocalUrl', () => {
  it.each([
    'http://localhost:5173/', 'https://localhost/', 'http://app.localhost:3000/x',
    'http://127.0.0.1:8080/', 'http://127.5.6.7/', 'http://[::1]:3000/', 'http://127.1/',
  ])('accepts %s', (u) => expect(isLocalUrl(u)).toBe(true));
  it.each([
    'http://localhost.evil.com/', 'http://127.0.0.1.nip.io/', 'http://localhost@evil.com/',
    'http://192.168.1.10:5173/', 'http://0.0.0.0:3000/', 'http://10.0.0.1/', 'file:///C:/x.html',
    'javascript:alert(1)', 'ftp://localhost/', 'not a url', 'http://[::2]/',
  ])('refuses %s', (u) => expect(isLocalUrl(u)).toBe(false));
});
describe('toAddress', () => {
  it('adds http:// and normalises', () => expect(toAddress(' localhost:3000 ')).toBe('http://localhost:3000/'));
  it('keeps https', () => expect(toAddress('https://localhost:8443/a')).toBe('https://localhost:8443/a'));
  it('refuses non-local', () => expect(toAddress('example.com')).toBeUndefined());
  it('refuses empty', () => expect(toAddress('  ')).toBeUndefined());
});
describe('navVerdict', () => {
  it('allows local', () => expect(navVerdict('http://localhost:5173/a', false)).toBe('allow'));
  it('opens a clicked non-local link outside', () => expect(navVerdict('https://github.com/', true)).toBe('external'));
  it('blocks a non-local navigation nobody started', () => expect(navVerdict('https://auth.example.com/', false)).toBe('blocked'));
  it.each(['file:///C:/x', 'javascript:void 0', 'mailto:a@b.c', 'about:blank'])('ignores %s', (u) =>
    expect(navVerdict(u, true)).toBe('ignore'));
});
describe('certVerdict', () => {
  it('trusts local hosts', () => expect(certVerdict('localhost')).toBe(0));
  it('trusts 127.x', () => expect(certVerdict('127.0.0.1')).toBe(0));
  it('leaves others to Chromium', () => expect(certVerdict('example.com')).toBe(-3));
});

describe('browser message and crop maths', () => {
  it('formats the message', () => {
    const el = { tag: 'div', id: 'plan-pro', classes: ['card', 'pricing-card'], path: 'main>section.grid>div:nth-of-type(2)', text: 'Pro plan €12/month' };
    expect(browserMessage('  misaligned  ', 'http://localhost:5173/pricing', el)).toBe(
      'misaligned\n\nFrom the browser: http://localhost:5173/pricing\nElement: div#plan-pro.card.pricing-card · main>section.grid>div:nth-of-type(2) · "Pro plan €12/month"');
  });
  it('leaves out the Element line without an element, and the quote without text', () => {
    expect(browserMessage('x', 'http://localhost/')).toBe('x\n\nFrom the browser: http://localhost/');
    expect(browserMessage('x', 'http://localhost/', { tag: 'img', classes: [], path: 'body>img', text: '' }))
      .toBe('x\n\nFrom the browser: http://localhost/\nElement: img · body>img');
  });
  it('caps page strings', () => {
    const e = cleanElement({ tag: 'div'.repeat(20), id: 'i'.repeat(100), classes: ['a', 'b', 'c', 'd', 'e', 'x'.repeat(99)], path: 'p'.repeat(500), text: 't'.repeat(500) })!;
    expect([e.tag.length, e.id!.length, e.classes.length, e.path.length, e.text.length]).toEqual([32, 64, 4, 300, 120]);
  });
  it('keeps at most 5 path levels', () =>
    expect(cleanElement({ tag: 'i', classes: [], path: 'a>b>c>d>e>f>g', text: '' })!.path).toBe('c>d>e>f>g'));
  it('refuses a bad shape', () => {
    expect(cleanElement(null)).toBeUndefined();
    expect(cleanElement({ tag: 1, classes: [], path: '', text: '' })).toBeUndefined();
    expect(cleanElement({ tag: 'div', classes: 'a', path: '', text: '' })).toBeUndefined();
  });
  it('collapses whitespace in text', () => expect(cleanElement({ tag: 'p', classes: [], path: 'p', text: ' a \n\t b ' })!.text).toBe('a b'));
  it('validates a selection rect', () => {
    const view = { width: 800, height: 600 };
    expect(cleanRect({ x: 10, y: 10, width: 100, height: 50 }, view)).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(cleanRect({ x: 10, y: 10, width: 7, height: 50 }, view)).toBeUndefined();   // under MIN_SELECTION
    expect(cleanRect({ x: 750, y: 10, width: 100, height: 50 }, view)).toBeUndefined(); // past the view
    expect(cleanRect({ x: NaN, y: 0, width: 10, height: 10 }, view)).toBeUndefined();
  });
  it('validates bounds', () => {
    expect(cleanBounds(null)).toBeNull();
    expect(cleanBounds({ x: 0, y: 64, width: 900, height: 500 })).toEqual({ x: 0, y: 64, width: 900, height: 500 });
    expect(cleanBounds({ x: -1, y: 0, width: 10, height: 10 })).toBeUndefined();
    expect(cleanBounds({ x: 0, y: 0, width: 20000, height: 10 })).toBeUndefined();
  });
  it('maps a selection to image pixels at 150%', () =>
    expect(imageBox({ x: 10, y: 20, width: 100, height: 40 }, { width: 800, height: 600 }, { width: 1200, height: 900 }))
      .toEqual({ x: 15, y: 30, width: 150, height: 60 }));
  it('clamps to the image', () =>
    expect(imageBox({ x: 790, y: 590, width: 10, height: 10 }, { width: 800, height: 600 }, { width: 799, height: 599 }))
      .toEqual({ x: 789, y: 589, width: 10, height: 10 }));
  it('names the area', () => expect(areaName(new Date(2026, 10, 8, 9, 5, 7))).toBe('area-20261108-090507.png'));
});

describe('viewBounds', () => {
  it('keeps CSS bounds unrounded and rounds only the DIP rectangle', () => {
    const v = viewBounds({ x: 10.2, y: 20.6, width: 800.4, height: 500.5 }, { width: 1200, height: 760 }, 1);
    expect(v.css).toEqual({ x: 10.2, y: 20.6, width: 800.4, height: 500.5 });
    expect(v.dip).toEqual({ x: 10, y: 21, width: 800, height: 501 });
  });
  it('clamps to the content size divided by the zoom', () => {
    const v = viewBounds({ x: 100, y: 50, width: 2000, height: 2000 }, { width: 1200, height: 760 }, 1.25);
    expect(v.css).toEqual({ x: 100, y: 50, width: 860, height: 558 });
    expect(v.dip).toEqual({ x: 125, y: 63, width: 1075, height: 697 }); // rounding never spills past the window
  });
  it('lets a selection reach the fractional edge', () => {
    const { css } = viewBounds({ x: 0, y: 40, width: 800.4, height: 600.3 }, { width: 1200, height: 760 }, 1);
    expect(cleanRect({ x: 0, y: 0, width: 800.4, height: 50 }, css)).toBeDefined();
  });
});
