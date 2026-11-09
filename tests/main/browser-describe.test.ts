import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { describeScript } from '../../src/main/services/browser/describe';
import type { Rect } from '../../src/shared/browser';

type N = {
  tagName: string;
  id: string;
  classList: string[];
  innerText: string;
  parentElement: N | null;
  children: N[];
  getBoundingClientRect: () => { left: number; top: number; right: number; bottom: number };
};

const box = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h });
const BIG = box(0, 0, 1000, 800);

function el(tag: string, o: { id?: string; cls?: string[]; rect?: ReturnType<typeof box>; text?: string } = {}, kids: N[] = []): N {
  const n: N = {
    tagName: tag.toUpperCase(),
    id: o.id ?? '',
    classList: o.cls ?? [],
    innerText: o.text ?? '',
    parentElement: null,
    children: kids,
    getBoundingClientRect: () => o.rect ?? BIG,
  };
  for (const k of kids) k.parentElement = n;
  return n;
}

const run = (hit: N | null, body: N, r: Rect) =>
  vm.runInNewContext(describeScript(r), { document: { body, elementFromPoint: () => hit } });

describe('pageDescribe', () => {
  it('walks up to the first element that contains the whole rectangle', () => {
    const span = el('span', { rect: box(10, 10, 50, 20) });
    const card = el('div', { id: 'plan-pro', cls: ['card', 'x'], rect: box(0, 0, 200, 100), text: 'Pro plan' }, [span]);
    const grid = el('section', { cls: ['grid'] }, [card]);
    const body = el('body', {}, [el('main', {}, [grid])]);
    const out = run(span, body, { x: 5, y: 5, width: 150, height: 60 });
    expect(out).toMatchObject({ tag: 'div', id: 'plan-pro', classes: ['card', 'x'], path: 'main>section.grid>#plan-pro', text: 'Pro plan' });
  });

  it('uses :nth-of-type without an id', () => {
    const a = el('div', { rect: box(0, 0, 50, 50) });
    const b = el('div', { rect: box(60, 0, 50, 50) });
    const body = el('body', {}, [el('section', { cls: ['grid'] }, [a, b])]);
    const out = run(b, body, { x: 62, y: 2, width: 20, height: 20 }) as { path: string; id?: string };
    expect(out.path).toBe('section.grid>div:nth-of-type(2)');
    expect(out.id).toBeUndefined();
  });

  it('adds no :nth-of-type when the tag is unique among siblings', () => {
    const p = el('p', { rect: box(0, 0, 50, 50) });
    const body = el('body', {}, [el('section', {}, [p, el('div')])]);
    expect((run(p, body, { x: 1, y: 1, width: 10, height: 10 }) as { path: string }).path).toBe('section>p');
  });

  it('stops at an ancestor id', () => {
    const leaf = el('b', { rect: box(0, 0, 50, 50) });
    const body = el('body', {}, [el('div', {}, [el('div', { id: 'app' }, [el('ul', {}, [leaf])])])]);
    expect((run(leaf, body, { x: 1, y: 1, width: 10, height: 10 }) as { path: string }).path).toBe('#app>ul>b');
  });

  it('stops at 5 levels', () => {
    let node = el('i', { rect: box(0, 0, 50, 50) });
    const leaf = node;
    for (const t of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) node = el(t, {}, [node]);
    const body = el('body', {}, [node]);
    const path = (run(leaf, body, { x: 1, y: 1, width: 10, height: 10 }) as { path: string }).path;
    expect(path).toBe('d>c>b>a>i');
  });

  it('falls back to body', () => {
    const inner = el('div', { rect: box(0, 0, 10, 10) });
    const body = el('body', {}, [inner]);
    expect(run(inner, body, { x: 100, y: 100, width: 50, height: 50 })).toMatchObject({ tag: 'body', path: 'body' });
  });

  it('returns null when elementFromPoint finds nothing', () => {
    expect(run(null, el('body'), { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });
});
