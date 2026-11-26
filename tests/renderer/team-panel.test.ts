import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { Thread, ThreadMessage } from '@shared/thread';
import { TeamPanel } from '../../src/renderer/components/TeamPanel';

const turn = (seq: number, model: string, tokens: { input: number; cached: number; output: number }) =>
  ({ kind: 'agent', seq, at: 0, agent: 'a', text: '', model, tokens }) as unknown as ThreadMessage;

test('Thread cost labels a list-price estimate as an estimate and says when one is unavailable', () => {
  const thread = { phase: 'build', team: [], status: 'running' } as unknown as Thread;
  const messages = [
    // gpt-6.1-terra: 0.5M plain x $1 + 1.5M cached x $0.05 + 40k out x $5 = $0.775
    turn(1, 'gpt-6.1-terra', { input: 2_000_000, cached: 1_500_000, output: 40_000 }),
    turn(2, 'claude-haiku-5-5', { input: 10, cached: 0, output: 1 }),
  ];
  const html = renderToStaticMarkup(createElement(TeamPanel, { thread, messages, agents: [] }));
  expect(html).toContain('About $0.78 at standard API list prices (estimate)');
  expect(html).toContain('API estimate unavailable');
  expect(html).toContain('Estimated at standard public API list prices as of');
  expect(html).not.toMatch(/at least|lower bound|no public api price/i);
});

// One row of the panel, by the agent's id shown as its name.
const rowOf = (html: string, id: string) => html.split('<li ').find((r) => r.includes(`>${id}<`)) ?? '';
const spoke = (seq: number, agent: string) => ({ seq, at: seq, kind: 'agent', agent, text: 'ok', model: '', tokens: { input: 0, cached: 0, output: 0 } }) as unknown as ThreadMessage;
const said = (seq: number) => ({ seq, at: seq, kind: 'user', text: 'go' }) as ThreadMessage;
const team = (over: Partial<Thread> = {}) =>
  ({ id: 't', phase: 'planning', status: 'running', team: ['project-manager', 'seo', 'cr', 'sec'], ...over }) as unknown as Thread;

test('every team member shows working, your turn, done or standby', () => {
  const thread = team({ speaking: 'seo', waitingOn: 'cr' });
  const html = renderToStaticMarkup(createElement(TeamPanel, { thread, messages: [said(1), spoke(2, 'project-manager')], agents: [], activity: { agent: 'seo', action: 'reading', since: 0 } }));
  expect(rowOf(html, 'project-manager')).toContain('done');
  expect(rowOf(html, 'seo')).toContain('working');
  expect(rowOf(html, 'cr')).toContain('your turn');
  expect(rowOf(html, 'sec')).toContain('standby');
});

test('a working agent shows its action and task under its name, the others do not', () => {
  const thread = team({ speaking: 'seo' });
  const html = renderToStaticMarkup(createElement(TeamPanel, { thread, messages: [], agents: [], activity: { agent: 'seo', action: 'reading', since: 0 } }));
  expect(rowOf(html, 'seo')).toContain('Reading files');
  expect(rowOf(html, 'seo')).toContain('Planning');
  expect(rowOf(html, 'cr')).not.toContain('Reading files');
});
