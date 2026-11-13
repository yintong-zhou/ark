import { describe, expect, test } from 'vitest';
import { REVIEW_ROUNDS, type BuildPhase, type Control, type Thread, type ThreadMessage } from '@shared/thread';
import { NOTES } from '../../src/main/services/threads/protocol';
import {
  afterBuildUser, afterChecks, afterManager, afterReview, openPoints, startBuild,
} from '../../src/main/services/threads/build-rules';

const results = (ok: boolean) => [{ script: 'test', ok, tail: ok ? '' : 'boom' }];
const pass: Control = { kind: 'review', pass: true, findings: [] };
const changes: Control = { kind: 'review', pass: false, findings: ['a', 'b'] };
const phase = (o: Partial<BuildPhase> = {}): BuildPhase => ({ title: 'P', text: 'T', step: 'develop', rounds: 0, notes: 0, open: 0, ...o });
const thread = (phases: BuildPhase[], o: Partial<Thread> = {}): Thread => ({
  id: 't', projectId: 'p', title: 'T', createdAt: 0, phase: 'build', status: 'running',
  team: [], roles: { builders: ['dev'], codeReview: 'rev', securityReview: 'sec' }, agentTurns: 0, retried: false, summarizing: false, cursors: {}, handoffs: {},
  build: { worktree: 'w', branch: 'b', plan: 'p', phases, current: 0 }, ...o,
});
const one = (o: Partial<BuildPhase> = {}, t: Partial<Thread> = {}) => thread([phase(o)], t);
const first = (d: { thread: Thread }) => d.thread.build!.phases[0];

describe('startBuild', () => {
  test('opens phase 1 in develop', () => {
    const t = thread([]);
    const d = startBuild({ ...t, phase: 'planning', retried: true, build: undefined }, {
      worktree: 'w', branch: 'b', plan: 'p', phases: [{ title: 'A', text: 'a' }, { title: 'B', text: 'b' }],
    });
    expect(d.step).toEqual({ do: 'develop' });
    expect(d.thread.phase).toBe('build');
    expect(d.thread.retried).toBe(false);
    expect(d.thread.build!.current).toBe(0);
    expect(d.thread.build!.phases[1]).toEqual({ title: 'B', text: 'b', builder: 'dev', step: 'develop', rounds: 0, notes: 0, open: 0 });
  });
  test('a later cycle starts fresh phases and keeps the earlier cycles and the worktree', () => {
    const earlier = [phase({ title: 'Old', step: 'done', notes: 3, commit: 'c1' })];
    const t = thread(earlier, { phase: 'planning', waived: ['code'] });
    const previous = [{ plan: 'p', phases: earlier }];
    const d = startBuild(t, { worktree: 'w', branch: 'b', plan: 'p-2', cycle: 2, previous, phases: [{ title: 'New', text: 'n' }] });
    expect(d.step).toEqual({ do: 'develop' });
    expect(d.thread.build).toEqual({ worktree: 'w', branch: 'b', plan: 'p-2', cycle: 2, previous, current: 0, phases: [phase({ title: 'New', text: 'n', builder: 'dev' })] });
    expect(t.build!.phases).toBe(earlier); // input untouched
  });
});

describe('afterChecks', () => {
  test('green checks go to the code review, red checks back to the developer', () => {
    const t = one();
    const g = afterChecks(t, results(true));
    expect(g.step).toEqual({ do: 'review', who: 'code' });
    expect(first(g)).toMatchObject({ step: 'review', checks: ['test'] });
    const d = afterChecks(t, results(false));
    expect(d.step).toEqual({ do: 'fix', why: 'checks', results: results(false) });
    expect(first(d).rounds).toBe(1);
    expect(t.build!.phases[0].rounds).toBe(0); // input untouched
  });
  test('no checks counts as green', () => {
    const d = afterChecks(one(), []);
    expect(d.step).toEqual({ do: 'review', who: 'code' });
    expect(first(d).checks).toEqual([]);
  });
});

describe('afterReview', () => {
  test('both reviews run before the developer gets findings', () => {
    let d = afterReview(one({ step: 'review' }), 'code', changes);
    expect(d.step).toEqual({ do: 'review', who: 'security' });
    expect(first(d)).toMatchObject({ step: 'security', open: 2, notes: 2 });
    d = afterReview(d.thread, 'security', pass);
    expect(d.step).toEqual({ do: 'fix', why: 'review' });
    expect(first(d)).toMatchObject({ notes: 2, rounds: 1, step: 'develop' });
  });
  test('two passes finish the phase and open the next one in develop', () => {
    const t = thread([phase({ step: 'security' }), phase()]);
    const d = afterReview(t, 'security', pass);
    expect(d.step).toEqual({ do: 'develop' });
    expect(d.thread.build!.current).toBe(1);
    expect(first(d).step).toBe('done');
  });
  test('the last phase passing asks for the summary', () => {
    const d = afterReview(one({ step: 'security' }), 'security', pass);
    expect(d.step).toEqual({ do: 'summary' });
    expect(first(d).step).toBe('done');
  });
  test('a user message the developer has not read keeps the phase open for one user turn, rounds untouched', () => {
    for (const t of [thread([phase({ step: 'security' }), phase()]), one({ step: 'security', rounds: 1 })]) {
      const d = afterReview(t, 'security', pass, undefined, true);
      expect(d.step).toEqual({ do: 'fix', why: 'user' });
      expect(d.thread.build!.current).toBe(0);
      expect(first(d)).toMatchObject({ step: 'develop', rounds: t.build!.phases[0].rounds });
    }
    expect(afterReview(one({ step: 'review' }), 'code', pass, undefined, true).step).toEqual({ do: 'review', who: 'security' });
    expect(afterReview(one({ step: 'security', open: 1 }), 'security', pass, undefined, true).step).toEqual({ do: 'fix', why: 'review' });
  });
  test('a third failure after two rounds blocks the phase and escalates', () => {
    const d = afterReview(one({ rounds: REVIEW_ROUNDS, step: 'security', open: 1 }), 'security', pass);
    expect(d.step).toEqual({ do: 'escalate' });
    expect(first(d).step).toBe('blocked');
    expect(first(d).rounds).toBe(REVIEW_ROUNDS);
  });
  test('a bad review block gets one correction, then the thread waits', () => {
    let d = afterReview(one({ step: 'review' }), 'code', undefined, 'ark block: nope');
    expect(d.step).toEqual({ do: 'review', who: 'code', retry: NOTES.invalid('ark block: nope') });
    expect(d.thread.retried).toBe(true);
    d = afterReview(d.thread, 'code', { kind: 'plan' });
    expect(d.step).toEqual({ do: 'wait', note: 'Code reviewer did not give a valid review. Reply to continue: your message goes to the developer, then the checks and both reviews run again.' });
    expect(d.thread.retried).toBe(false);
    expect(afterReview(thread([phase()]), 'security', undefined).step)
      .toEqual({ do: 'review', who: 'security', retry: NOTES.invalid('missing review block') });
  });
  test('a valid review clears retried', () => {
    expect(afterReview(one({ step: 'review' }, { retried: true }), 'code', pass).thread.retried).toBe(false);
  });
});

describe('afterBuildUser', () => {
  test('the user unblocks a phase with rounds reset', () => {
    const d = afterBuildUser(one({ step: 'blocked', rounds: 2 }));
    expect(d.step).toEqual({ do: 'fix', why: 'user' });
    expect(first(d)).toMatchObject({ rounds: 0, step: 'develop' });
  });
  test('a message during a review goes to the developer, who reads it before both reviews run again', () => {
    for (const step of ['review', 'security'] as const) {
      const d = afterBuildUser(one({ step, rounds: 1 }));
      expect(d.step).toEqual({ do: 'fix', why: 'user' });
      expect(first(d)).toMatchObject({ step: 'develop', rounds: 1 });
    }
  });
  test('resumes the step the phase was in', () => {
    expect(afterBuildUser(one({ step: 'develop' })).step).toEqual({ do: 'fix', why: 'user' });
    expect(afterBuildUser(one({ step: 'done' })).step).toEqual({ do: 'summary' });
    expect(afterBuildUser(one({ step: 'done' }, { phase: 'done' })).step).toEqual({ do: 'wait' });
    expect(afterBuildUser({ ...one(), build: undefined }).step).toEqual({ do: 'wait' });
  });
});

describe('afterManager', () => {
  test('finishes the thread only when every phase is done', () => {
    expect(afterManager(one({ step: 'blocked' })).step).toEqual({ do: 'wait' });
    const t = thread([phase({ step: 'done' }), phase({ step: 'develop' })]);
    expect(afterManager(t).step).toEqual({ do: 'wait' });
    const d = afterManager(one({ step: 'done' }));
    expect(d.step).toEqual({ do: 'finish' });
    expect(d.thread.phase).toBe('done');
  });
});

describe('openPoints', () => {
  test('lists the findings of reviews after a seq', () => {
    const agent = (seq: number, control?: Control) =>
      ({ seq, at: 0, kind: 'agent', agent: 'x', text: '', model: 'm', tokens: {}, control }) as unknown as ThreadMessage;
    const note = { seq: 5, at: 0, kind: 'note', text: 'n' } as ThreadMessage;
    const msgs = [agent(1, changes), agent(2, { kind: 'review', pass: false, findings: ['c'] }), agent(3, pass), agent(4), note];
    expect(openPoints(msgs, 1)).toEqual(['c']);
    expect(openPoints(msgs, 0)).toEqual(['a', 'b', 'c']);
  });
});

test('startBuild gives each phase its builder, falling back to the first', () => {
  const t = { ...thread([]), phase: 'planning' as const, build: undefined, roles: { builders: ['dev', 'ui'] } };
  const d = startBuild(t, { worktree: 'w', branch: 'b', plan: 'p', phases: [{ title: 'A', text: 'a', builder: 'ui' }, { title: 'B', text: 'b', builder: 'ghost' }, { title: 'C', text: 'c' }] });
  expect(d.thread.build!.phases.map((p) => p.builder)).toEqual(['ui', 'dev', 'dev']);
});

test('with no code reviewer the checks lead to the security review', () => {
  expect(afterChecks(one({}, { roles: { builders: ['dev'], securityReview: 'sec' } }), results(true)).step).toEqual({ do: 'review', who: 'security' });
});

test('with no reviewer at all, passing checks end the phase', () => {
  const none = { roles: { builders: ['dev'] } };
  const d = afterChecks(one({}, none), results(true));
  expect(first(d).step).toBe('done');
  expect(d.step).toEqual({ do: 'summary' });
  expect(afterChecks(one({}, none), results(true), true).step).toEqual({ do: 'fix', why: 'user' }); // an unread user message first
});

test('with no security reviewer the code review settles the phase', () => {
  const t = one({ step: 'review' }, { roles: { builders: ['dev'], codeReview: 'rev' } });
  expect(afterReview(t, 'code', pass).step).toEqual({ do: 'summary' });
  expect(afterReview(t, 'code', changes).step).toEqual({ do: 'fix', why: 'review' });
});
