import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { ThreadActivity } from '@shared/activity';
import type { AgentDef } from '@shared/agent-file';
import type { Thread } from '@shared/thread';
import { ProgressRow } from '../../src/renderer/components/ProgressRow';

const agents = [{ id: 'dev', name: 'Dev' }] as AgentDef[];
const running = (over: Partial<Thread> = {}) =>
  ({ id: 't', phase: 'planning', status: 'running', speaking: 'dev', team: ['project-manager', 'dev'], ...over }) as unknown as Thread;
const html = (thread: Thread, activity?: ThreadActivity, now = 42_000) =>
  renderToStaticMarkup(createElement(ProgressRow, { thread, agents, activity, now }));

test('a working agent shows its name, action, task and elapsed time', () => {
  const out = html(running(), { agent: 'dev', action: 'editing', since: 0 });
  for (const text of ['Dev', 'Editing code', 'Planning', '0:42']) expect(out).toContain(text);
});

test('before the first activity event the row reads Thinking and starts at 0:00', () => {
  const out = html(running());
  expect(out).toContain('Thinking');
  expect(out).toContain('0:00');
});

test('an open approval card reads Waiting for approval, whatever the engine did last', () => {
  const out = html(running({ approvals: [3] }), { agent: 'dev', action: 'running', since: 0 });
  expect(out).toContain('Waiting for approval');
  expect(out).not.toContain('Running a command');
});

test('nothing is shown unless the thread is running with a speaker', () => {
  expect(html(running({ status: 'waiting' }))).toBe('');
  expect(html(running({ status: 'idle', speaking: undefined }))).toBe('');
  expect(html(running({ speaking: undefined }))).toBe('');
});

test('activity of another agent is not shown as the speaker\'s', () => {
  const out = html(running(), { agent: 'someone-else', action: 'editing', since: 0 });
  expect(out).toContain('Thinking');
  expect(out).not.toContain('Editing code');
});
