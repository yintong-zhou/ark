import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { Thread } from '@shared/thread';
import { PermissionSelect } from '../../src/renderer/components/PermissionSelect';
import { ThreadView } from '../../src/renderer/components/ThreadView';

const thread = (status: string) =>
  ({ id: 't1', title: 'T', status, phase: 'planning', team: [], approvals: [], permissionMode: 'auto' }) as unknown as Thread;
const view = (status: string) =>
  renderToStaticMarkup(createElement(ThreadView, { thread: thread(status), messages: [], agents: [], tags: [], onLink: () => {}, onTag: () => {} }));

test('the access selector sits in the composer row, beside attach and emoji, before the message field', () => {
  const html = view('idle');
  const surface = html.indexOf('composer-surface');
  const attach = html.indexOf('aria-label="Attach files or images"');
  const emoji = html.indexOf('aria-label="Add an emoji"');
  const select = html.indexOf('aria-label="Permissions: Approve for me"');
  const field = html.indexOf('aria-label="Message the thread"');
  expect(surface).toBeGreaterThan(-1);
  expect([surface, attach, emoji, select, field].every((at, i, all) => i === 0 || at > all[i - 1])).toBe(true);
  // a line icon, not a text glyph
  expect(html.slice(select, field)).toContain('<svg');
  expect(html).not.toContain('▾');
  // a narrow composer moves the text to its own line instead of squeezing it between the tools
  expect(html).toContain('@max-sm:flex-wrap');
  expect(html.slice(field)).toMatch(/^[^>]*@max-sm:order-first @max-sm:basis-full/);
});

test('while the team runs, the pause note travels with the selector instead of a row over the conversation', () => {
  const html = view('running');
  expect(html).toMatch(/title="[^"]*Changing permissions pauses the team[^"]*"/);
  expect(html).not.toMatch(/<span[^>]*>Changing permissions pauses the team<\/span>/);
});

test('the selector keeps its accessible name, menu semantics and disabled state', () => {
  const html = renderToStaticMarkup(createElement(PermissionSelect, { value: 'full', onChange: () => {}, disabled: true }));
  expect(html).toMatch(/^<button type="button"/);
  expect(html).toContain('aria-label="Permissions: Full access"');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('disabled=""');
  // the label stays readable where there is room; the accessible name covers narrow widths
  expect(html).toContain('Full access</span>');
});
