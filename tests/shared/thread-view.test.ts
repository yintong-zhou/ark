import { expect, test } from 'vitest';
import type { Reaction, Thread, ThreadMessage } from '@shared/thread';
import { actionable, cyclePhases, cycleReviews, decisionsOf, needsYou, GROUP_WINDOW_MS, lastModel, mergeMessages, reactionsOf, startsGroup, tokensBy, tokensByAgent, windowLines } from '@shared/thread-view';

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't', projectId: 'p', title: 'T', createdAt: 0, phase: 'team', status: 'waiting', team: [],
  agentTurns: 0, retried: false, summarizing: false, cursors: {}, handoffs: {}, ...over,
});
const zero = { input: 0, cached: 0, output: 0 };
const say = (seq: number, agent: string, extra: Partial<Extract<ThreadMessage, { kind: 'agent' }>> = {}): ThreadMessage =>
  ({ seq, at: seq, kind: 'agent', agent, text: 'hi', model: 'haiku', tokens: zero, ...extra });
const react = (seq: number, target: number, emoji: Reaction): ThreadMessage => ({ seq, at: seq, kind: 'reaction', target, emoji });

test('actionable only for the last message while waiting', () => {
  const picks = { kind: 'team' as const, picks: [{ agent: 'planner', reason: 'writes the plan' }], leftOut: '' };
  const ask = { kind: 'ask' as const, question: 'One page?', choices: ['one', 'many'] };
  const msgs = [say(1, 'project-manager', { control: picks }), say(2, 'project-manager', { control: ask })];
  expect(actionable(thread(), msgs)).toEqual({ kind: 'ask', seq: 2 });
  // a reaction or a note after the card does not move it
  expect(actionable(thread(), [...msgs, react(3, 2, '👍')])).toEqual({ kind: 'ask', seq: 2 });
  // not waiting for the user: nothing to act on
  expect(actionable(thread({ status: 'running' }), msgs)).toBeUndefined();
  expect(actionable(thread({ status: 'idle' }), msgs)).toBeUndefined();
  // last agent message without a control, or a control that is not a card
  expect(actionable(thread(), [...msgs, say(3, 'planner')])).toBeUndefined();
  expect(actionable(thread(), [say(1, 'planner', { control: { kind: 'next', agent: 'seo' } })])).toBeUndefined();
  expect(actionable(thread(), [])).toBeUndefined();
  expect(actionable(thread(), [{ seq: 1, at: 1, kind: 'user', text: 'x' }])).toBeUndefined();
  expect(actionable(thread(), [say(1, 'project-manager', { control: picks })])).toEqual({ kind: 'team', seq: 1 });
});

test('a plan card is not actionable after the phase moved to build', () => {
  const msgs = [say(1, 'planner', { control: { kind: 'plan' } })];
  expect(actionable(thread({ phase: 'planning' }), msgs)).toEqual({ kind: 'plan', seq: 1 });
  expect(actionable(thread({ phase: 'build', status: 'idle' }), msgs)).toBeUndefined();
  expect(actionable(thread({ phase: 'build' }), msgs)).toBeUndefined();
  expect(actionable(thread({ phase: 'team' }), msgs)).toBeUndefined();
});

test('last reaction wins', () => {
  const r = reactionsOf([say(1, 'a'), say(2, 'b'), react(3, 1, '👍'), react(4, 2, '👍'), react(5, 1, '👎')]);
  expect(r.get(1)).toBe('👎');
  expect(r.get(2)).toBe('👍');
  expect(r.has(3)).toBe(false);
  expect(reactionsOf([]).size).toBe(0);
});

test('tokens sum per agent', () => {
  const t = tokensByAgent([
    say(1, 'a', { tokens: { input: 10, cached: 4, output: 1 } }),
    say(2, 'b', { tokens: { input: 7, cached: 0, output: 2 } }),
    { seq: 3, at: 3, kind: 'user', text: 'x' },
    say(4, 'a', { tokens: { input: 5, cached: 5, output: 3 } }),
  ]);
  expect(t).toEqual({ a: { input: 15, cached: 9, output: 4 }, b: { input: 7, cached: 0, output: 2 } });
  expect(tokensByAgent([])).toEqual({});
});

test('lastModel is the latest model the agent answered with', () => {
  const msgs = [say(1, 'a', { model: 'haiku' }), say(2, 'b', { model: 'opus' }), say(3, 'a', { model: 'sonnet' })];
  expect(lastModel(msgs, 'a')).toBe('sonnet');
  expect(lastModel(msgs, 'b')).toBe('opus');
  expect(lastModel(msgs, 'c')).toBeUndefined();
});

test('mergeMessages skips known seqs and keeps the order', () => {
  const have = [say(1, 'a'), say(3, 'a')];
  expect(mergeMessages(have, [say(3, 'a'), say(2, 'b'), say(4, 'a')]).map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  expect(mergeMessages(have, [])).toBe(have);
});

test('messages group by author within five minutes', () => {
  const at = (m: ThreadMessage, t: number): ThreadMessage => ({ ...m, at: t });
  const a = at(say(1, 'planner'), 0);
  const user = (t: number): ThreadMessage => ({ seq: 9, at: t, kind: 'user', text: 'x' });
  expect(startsGroup(undefined, a)).toBe(true);
  expect(startsGroup(a, at(say(2, 'planner'), GROUP_WINDOW_MS - 1))).toBe(false);
  expect(startsGroup(a, at(say(2, 'planner'), GROUP_WINDOW_MS))).toBe(true);
  expect(startsGroup(a, at(say(2, 'seo'), 1))).toBe(true); // another agent
  expect(startsGroup(a, user(1))).toBe(true); // the user after an agent
  expect(startsGroup(user(0), user(1))).toBe(false);
  expect(startsGroup(a, { seq: 3, at: 1, kind: 'note', text: 'n' })).toBe(true); // a note never joins
});

test('needsYou: waiting, or approvals pending', () => {
  expect(needsYou(thread({ status: 'waiting' }))).toBe(true);
  expect(needsYou(thread({ status: 'running', approvals: [4] }))).toBe(true);
  expect(needsYou(thread({ status: 'running' }))).toBe(false);
  expect(needsYou(thread({ status: 'running', approvals: [] }))).toBe(false);
});

test('decisionsOf maps an approval to its answer, the last one wins', () => {
  const d = (seq: number, target: number, allow: boolean): ThreadMessage => ({ seq, at: seq, kind: 'decision', target, allow });
  const m = decisionsOf([d(5, 2, false), d(6, 3, true), d(7, 2, true), say(8, 'developer')]);
  expect([...m]).toEqual([[2, true], [3, true]]);
});

test('tokensBy model', () => {
  const t = tokensBy([
    say(1, 'a', { model: 'claude-haiku-4-5', tokens: { input: 10, cached: 0, output: 2 } }),
    say(2, 'b', { model: 'gpt-5.5', tokens: { input: 3, cached: 1, output: 1 } }),
    say(3, 'a', { model: 'claude-haiku-4-5', tokens: { input: 10, cached: 0, output: 2 } }),
  ], (m) => m.model);
  expect(t).toEqual({ 'claude-haiku-4-5': { input: 20, cached: 0, output: 4 }, 'gpt-5.5': { input: 3, cached: 1, output: 1 } });
});

test('windowLines', () => {
  expect(windowLines({ codex: { weekly: { from: 10, to: 12, resetsAt: 1 } }, claude: { fiveHour: { from: 41, to: 44, resetsAt: 1 } } }))
    .toEqual(['Claude 5h 41% → 44%', 'Codex weekly 10% → 12%']);
  expect(windowLines(undefined)).toEqual([]);
});

test('a phase card shows the phases of its own build cycle', () => {
  const phase = (title: string) => ({ title, text: '', step: 'done' as const, rounds: 0, notes: 0, open: 0 });
  const build = { worktree: 'w', branch: 'b', plan: 'p2', phases: [phase('New')], current: 0, cycle: 2, previous: [{ plan: 'p1', phases: [phase('Old'), phase('Old 2')] }] };
  expect(cyclePhases(build, undefined)?.map((p) => p.title)).toEqual(['Old', 'Old 2']); // cards written before cycles existed
  expect(cyclePhases(build, 2)?.map((p) => p.title)).toEqual(['New']);
  expect(cyclePhases({ ...build, cycle: undefined, previous: undefined }, undefined)?.map((p) => p.title)).toEqual(['New']);
  expect(cyclePhases(build, 3)).toBeUndefined();
  expect(cyclePhases(undefined, 1)).toBeUndefined();
});

test('review history uses the roles and waivers saved with each cycle', () => {
  const p = { title: 'A', text: '', step: 'done' as const, rounds: 0, notes: 0, open: 0 };
  const b = { worktree: 'w', branch: 'b', plan: 'p2', phases: [p], current: 0, cycle: 2,
    reviewContext: { roles: { builders: ['b'] }, waived: ['code' as const, 'security' as const] },
    previous: [{ plan: 'p1', phases: [p], reviewContext: { roles: { builders: ['b'], codeReview: 'r' }, waived: ['security' as const] } }] };
  expect(cycleReviews(b, 1)).toEqual({ code: true, security: false });
  expect(cycleReviews(b, 2)).toEqual({ code: false, security: false });
  expect(cycleReviews({ ...b, previous: [{ plan: 'p1', phases: [p] }] }, 1)).toEqual({ code: undefined, security: undefined });
});

test('only the latest Head Git proposal is actionable while waiting in done', () => {
  const control = { kind: 'git' as const, action: 'push' as const };
  expect(actionable(thread({ phase: 'done' }), [say(1, 'head-of-staff', { control })])).toEqual({ kind: 'git', seq: 1 });
  expect(actionable(thread({ phase: 'done' }), [say(1, 'planner', { control })])).toBeUndefined();
  expect(actionable(thread({ phase: 'planning' }), [say(1, 'head-of-staff', { control })])).toBeUndefined();
});
