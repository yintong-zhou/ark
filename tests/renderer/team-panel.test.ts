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
