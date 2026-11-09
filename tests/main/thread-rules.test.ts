import { describe, expect, test } from 'vitest';
import { HANDOFF_AT, MANAGER, PLANNING_BUDGET, type Control, type Thread } from '@shared/thread';
import { NOTES } from '../../src/main/services/threads/protocol';
import { afterReply, afterUser, approveTeam, mentionOf, needsHandoff } from '../../src/main/services/threads/rules';

const base: Thread = {
  id: 't', projectId: 'p', title: 'T', createdAt: 0, phase: 'planning', status: 'running',
  team: [MANAGER, 'planner', 'seo'], agentTurns: 0, retried: false, summarizing: false, cursors: {}, handoffs: {},
};
const th = (o: Partial<Thread> = {}): Thread => ({ ...base, ...o });
const next = (agent: string): Control => ({ kind: 'next', agent });
const ask: Control = { kind: 'ask', question: 'Q?', choices: [] };
const plan: Control = { kind: 'plan' };
const team: Control = { kind: 'team', picks: [{ agent: 'seo', reason: 'r' }], leftOut: '' };

describe('afterReply', () => {
  test('rule 1: the budget summary waits and ignores control and error', () => {
    const d = afterReply(th({ summarizing: true, agentTurns: 20 }), MANAGER, next('seo'), 'boom');
    expect(d.step).toEqual({ do: 'wait' });
    expect(d.thread.summarizing).toBe(false);
  });

  test('rule 2: an error gets one correction to the same agent', () => {
    const d = afterReply(th(), 'planner', undefined, 'ark block: not valid JSON');
    expect(d.step).toEqual({ do: 'turn', agent: 'planner', note: NOTES.invalid('ark block: not valid JSON') });
    expect(d.thread.retried).toBe(true);
  });

  test('rule 2: the manager without a valid control for the phase gets a correction', () => {
    const d = afterReply(th(), MANAGER, undefined, undefined);
    expect(d.step).toEqual({ do: 'turn', agent: MANAGER, note: NOTES.invalid('missing or not allowed here') });
    expect(afterReply(th({ phase: 'team' }), MANAGER, next('planner'), undefined).step).toMatchObject({ do: 'turn', agent: MANAGER });
    expect(afterReply(th(), MANAGER, team, undefined).step).toMatchObject({ do: 'turn', agent: MANAGER });
  });

  test('next to an agent outside the team needs a correction', () => {
    expect(afterReply(th(), MANAGER, next('ghost'), undefined).step).toMatchObject({ do: 'turn', agent: MANAGER, note: expect.any(String) });
  });

  test('next to the manager itself needs a correction', () => {
    expect(afterReply(th(), MANAGER, next(MANAGER), undefined).thread.retried).toBe(true);
  });

  test('one correction, then wait', () => {
    const first = afterReply(th(), MANAGER, undefined, undefined);
    const second = afterReply(first.thread, MANAGER, undefined, undefined);
    expect(second.step).toEqual({ do: 'wait', note: `${MANAGER} did not give Ark a valid instruction. Reply to continue.` });
    expect(second.thread.retried).toBe(false);
  });

  test('rule 2 also applies to a member error', () => {
    const second = afterReply(th({ retried: true }), 'seo', undefined, 'bad');
    expect(second.step).toEqual({ do: 'wait', note: 'seo did not give Ark a valid instruction. Reply to continue.' });
  });

  test('rule 3: valid controls from the manager', () => {
    expect(afterReply(th({ phase: 'team', team: [] }), MANAGER, team, undefined).step).toEqual({ do: 'wait' });
    expect(afterReply(th({ phase: 'team', team: [] }), MANAGER, ask, undefined).step).toEqual({ do: 'wait' });
    expect(afterReply(th(), MANAGER, ask, undefined).step).toEqual({ do: 'wait' });
    expect(afterReply(th(), MANAGER, plan, undefined).step).toEqual({ do: 'wait' });
    const d = afterReply(th({ retried: true }), MANAGER, next('planner'), undefined);
    expect(d.step).toEqual({ do: 'turn', agent: 'planner' });
    expect(d.thread.retried).toBe(false);
    expect(d.thread.agentTurns).toBe(1);
  });

  test('rule 3: members cannot steer; ask and plan wait', () => {
    expect(afterReply(th(), 'planner', undefined, undefined).step).toEqual({ do: 'turn', agent: MANAGER });
    expect(afterReply(th(), 'planner', next('seo'), undefined).step).toEqual({ do: 'turn', agent: MANAGER });
    expect(afterReply(th(), 'planner', team, undefined).step).toEqual({ do: 'turn', agent: MANAGER });
    expect(afterReply(th(), 'planner', ask, undefined).step).toEqual({ do: 'wait' });
    expect(afterReply(th(), 'planner', plan, undefined).step).toEqual({ do: 'wait' });
  });

  test('rule 3: agentTurns counts only in planning', () => {
    expect(afterReply(th({ phase: 'team', team: [] }), MANAGER, team, undefined).thread.agentTurns).toBe(0);
    expect(afterReply(th({ agentTurns: 3 }), 'planner', undefined, undefined).thread.agentTurns).toBe(4);
  });

  test('rule 4: an interrupt redirects a turn and resets the counter', () => {
    const d = afterReply(th({ agentTurns: 5 }), MANAGER, next('planner'), undefined, { to: 'seo' });
    expect(d.step).toEqual({ do: 'turn', agent: 'seo' });
    expect(d.thread.agentTurns).toBe(0);
    expect(afterReply(th(), MANAGER, next('planner'), undefined, {}).step).toEqual({ do: 'turn', agent: MANAGER });
    expect(afterReply(th({ agentTurns: 5 }), MANAGER, ask, undefined, { to: 'seo' })).toMatchObject({ step: { do: 'wait' }, thread: { agentTurns: 6 } });
  });

  test('rule 4: an interrupt wins over a correction and the new speaker starts clean', () => {
    const d = afterReply(th({ agentTurns: 5, retried: true }), MANAGER, undefined, undefined, { to: 'seo' });
    expect(d.step).toEqual({ do: 'turn', agent: 'seo' });
    expect(d.thread).toMatchObject({ agentTurns: 0, retried: false });
    expect(afterReply(th(), 'planner', undefined, 'bad', {}).step).toEqual({ do: 'turn', agent: MANAGER });
  });

  test('build and done: a reply ends in idle, never a loop', () => {
    for (const phase of ['build', 'done'] as const) {
      const t = th({ phase });
      expect(afterReply(t, MANAGER, undefined, undefined)).toEqual({ thread: t, step: { do: 'idle' } });
    }
  });

  test('budget: the 20th planning turn hands the floor to the manager for a summary, whose reply waits', () => {
    const d = afterReply(th({ agentTurns: PLANNING_BUDGET - 1 }), MANAGER, next('planner'), undefined);
    expect(d.step).toEqual({ do: 'turn', agent: MANAGER, note: NOTES.budget });
    expect(d.thread.summarizing).toBe(true);
    const summary = afterReply(d.thread, MANAGER, undefined, undefined);
    expect(summary.step).toEqual({ do: 'wait' });
    expect(summary.thread.summarizing).toBe(false);
  });

  test('hard passes from the manager next to the step', () => {
    const d = afterReply(th(), MANAGER, { kind: 'next', agent: 'planner', hard: true }, undefined);
    expect(d.step).toEqual({ do: 'turn', agent: 'planner', hard: true });
  });

  test('an interrupt or the budget drops hard', () => {
    const hard: Control = { kind: 'next', agent: 'planner', hard: true };
    expect(afterReply(th(), MANAGER, hard, undefined, {}).step).toEqual({ do: 'turn', agent: MANAGER });
    expect(afterReply(th({ agentTurns: PLANNING_BUDGET - 1 }), MANAGER, hard, undefined).step).toEqual({ do: 'turn', agent: MANAGER, note: NOTES.budget });
  });

  test('budget does not fire on a wait', () => {
    expect(afterReply(th({ agentTurns: PLANNING_BUDGET - 1 }), 'planner', plan, undefined).thread.summarizing).toBe(false);
  });

  test('does not mutate the input or touch status, speaking, waitingOn', () => {
    const t = th({ waitingOn: 'seo', speaking: 'planner' });
    const copy = structuredClone(t);
    const d = afterReply(t, 'planner', undefined, undefined);
    expect(t).toEqual(copy);
    expect(d.thread).toMatchObject({ status: 'running', speaking: 'planner', waitingOn: 'seo' });
  });
});

describe('afterUser', () => {
  test('team: the manager', () => {
    const d = afterUser(th({ phase: 'team', team: [], agentTurns: 4, retried: true }), 'seo');
    expect(d.step).toEqual({ do: 'turn', agent: MANAGER });
    expect(d.thread).toMatchObject({ agentTurns: 0, retried: false });
  });

  test('afterUser clears summarizing', () => {
    expect(afterUser(th({ summarizing: true }), undefined).thread.summarizing).toBe(false);
  });

  test('afterUser in planning prefers the mention, then the agent that asked', () => {
    expect(afterUser(th({ waitingOn: 'seo' }), 'planner').step).toEqual({ do: 'turn', agent: 'planner' });
    expect(afterUser(th({ waitingOn: 'seo' }), undefined).step).toEqual({ do: 'turn', agent: 'seo' });
    expect(afterUser(th(), undefined).step).toEqual({ do: 'turn', agent: MANAGER });
  });

  test('build and done: idle', () => {
    expect(afterUser(th({ phase: 'build' }), undefined).step).toEqual({ do: 'idle' });
    expect(afterUser(th({ phase: 'done' }), 'seo').step).toEqual({ do: 'idle' });
  });
});

test('approveTeam puts the manager first, dedupes, and starts planning', () => {
  const d = approveTeam(th({ phase: 'team', team: [], agentTurns: 3 }), ['seo', MANAGER, 'seo', 'planner'], { seo: 'SEO', [MANAGER]: 'PM' });
  expect(d.thread).toMatchObject({ phase: 'planning', team: [MANAGER, 'seo', 'planner'], agentTurns: 0 });
  expect(d.step).toEqual({ do: 'turn', agent: MANAGER, note: NOTES.teamApproved(['PM', 'SEO', 'planner']) });
});

test('mentionOf ignores ids outside the team and e-mail addresses', () => {
  const members = [MANAGER, 'planner', 'seo'];
  expect(mentionOf('hi @ghost and @seo, ok', members)).toBe('seo');
  expect(mentionOf('write to a@planner.com', members)).toBeUndefined();
  expect(mentionOf('@planner first', members)).toBe('planner');
  expect(mentionOf('@seo then @planner', members)).toBe('seo');
  expect(mentionOf('no mention', members)).toBeUndefined();
});

test('needsHandoff is false without a window and true at exactly 40%', () => {
  expect(needsHandoff(1_000_000, undefined)).toBe(false);
  expect(needsHandoff(39, 100)).toBe(false);
  expect(needsHandoff(59, 100, 0.6)).toBe(false);
  expect(needsHandoff(60, 100, 0.6)).toBe(true);
  expect(needsHandoff(HANDOFF_AT * 100, 100)).toBe(true);
});
