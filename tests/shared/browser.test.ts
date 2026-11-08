import { describe, expect, it } from 'vitest';
import { certVerdict, isLocalUrl, navVerdict, toAddress } from '@shared/browser';

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
