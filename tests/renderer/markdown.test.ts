import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Markdown } from '../../src/renderer/components/Markdown';

const html = (text: string, leaf?: (s: string) => string) => renderToStaticMarkup(createElement(Markdown, { text, leaf }));

test('formats the Markdown agents write', () => {
  const out = html('## Plan\n**bold** and `a<b`\nnext line\n\n- one\n- [x] done\n\n1. first\n\n```ts\nx && y\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  expect(out).toContain('>Plan</h4>');
  expect(out).toContain('<strong class="font-semibold text-secondary">bold</strong>');
  expect(out).toContain('<br/>'); // a single newline stays a line break
  expect(out).toContain('>a&lt;b</code>'); // escaped once, not twice
  expect(out).toMatch(/<ul[^>]*><li>.*one.*<\/li><li class="list-none"><input type="checkbox" disabled=""[^>]*checked=""/);
  expect(out).toMatch(/<ol[^>]*><li>.*first/);
  expect(out).toContain('<code>x &amp;&amp; y</code>');
  expect(out).toContain('<td class="border border-divider px-1 py-[2px] text-left">2</td>');
});

test('never turns agent text into live HTML or links', () => {
  const out = html('<img src=x onerror=alert(1)> [site](https://evil.test) <script>x</script>');
  expect(out).not.toMatch(/<img|<script|<a /);
  expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(out).toContain('title="https://evil.test"');
});

test('plain runs go through leaf, for mentions and tags', () => {
  expect(html('hi @planner **@dev**', (s) => s.toUpperCase())).toContain('HI @PLANNER <strong class="font-semibold text-secondary">@DEV</strong>');
});

test('renders document links as buttons when opening is available', () => {
  const out = renderToStaticMarkup(createElement(Markdown, { text: 'Read [README](README.md)', onLink: () => {} }));
  expect(out).toMatch(/<button type="button" title="README\.md"[^>]*>README<\/button>/);
  expect(out).not.toContain('<a ');
});
