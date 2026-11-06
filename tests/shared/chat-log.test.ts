import { expect, test } from 'vitest';
import { chatReducer, EMPTY_CHAT, type ChatState } from '@shared/chat-log';
import type { ChatEvent } from '@shared/types';

const run = (events: Parameters<typeof chatReducer>[1][]): ChatState => events.reduce(chatReducer, EMPTY_CHAT);
const ev = (event: ChatEvent) => ({ type: 'event' as const, event });
const turn = ev({ type: 'turn', model: 'sonnet', tokens: { input: 24240, cached: 17329, output: 5 } });

test('busy until the turn ends', () => {
  const sent = run([{ type: 'sent', text: 'hi' }]);
  expect(sent.busy).toBe(true);
  expect(sent.entries).toEqual([{ role: 'user', text: 'hi' }]);
  const answered = chatReducer(sent, ev({ type: 'message', text: 'hello' }));
  expect(answered.busy).toBe(true);
  expect(chatReducer(answered, turn).busy).toBe(false);
});

test('turn attaches tokens to the last agent entry', () => {
  const s = run([{ type: 'sent', text: 'hi' }, ev({ type: 'message', text: 'hello' }), turn]);
  expect(s.entries).toHaveLength(2);
  expect(s.entries[1]).toEqual({ role: 'agent', text: 'hello', model: 'sonnet', tokens: { input: 24240, cached: 17329, output: 5 } });
  // no agent entry yet: an empty one carries the counts
  const bare = run([{ type: 'sent', text: 'hi' }, turn]);
  expect(bare.entries[1]).toMatchObject({ role: 'agent', text: '', model: 'sonnet' });
});

test('isolation error ends the chat with the stop text', () => {
  const s = run([{ type: 'sent', text: 'hi' }, ev({ type: 'error', kind: 'isolation', detail: 'saw X' })]);
  expect(s.entries[1]).toEqual({ role: 'error', text: 'Stopped: this agent could see things it was not given.\nsaw X' });
  expect(s.ended).toBe(true);
  expect(s.busy).toBe(false);
});

test('exit error ends the chat', () => {
  const s = run([{ type: 'sent', text: 'hi' }, ev({ type: 'error', kind: 'exit', detail: 'code 1' })]);
  expect(s.entries[1].text).toBe('The engine stopped.\ncode 1');
  expect(s.ended).toBe(true);
  expect(s.busy).toBe(false);
});

test('engine error keeps the chat open', () => {
  const s = run([{ type: 'sent', text: 'hi' }, ev({ type: 'error', kind: 'engine', detail: 'rate limited' })]);
  expect(s.entries[1]).toEqual({ role: 'error', text: 'rate limited' });
  expect(s.ended).toBe(false);
  expect(s.busy).toBe(false);
});
