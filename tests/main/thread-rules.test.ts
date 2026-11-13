import { describe, expect, test } from 'vitest';
import { HANDOFF_AT, MANAGER, MEMBER_RELAYS, PLANNING_BUDGET, type Control, type Thread } from '@shared/thread';
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

test('autonomous members ask the manager instead of stopping for the user', () => {
  const d = afterReply(th({ permissionMode: 'auto' }), 'seo', ask, undefined);
  expect(d.step).toMatchObject({ do: 'turn', agent: MANAGER, note: expect.stringContaining('Q?') });
});

test('autonomous members can hand off within their team, never to themselves or outsiders', () => {
  expect(afterReply(th({ permissionMode: 'auto' }), 'seo', next('planner'), undefined).step).toEqual({ do: 'turn', agent: 'planner', note: NOTES.handedOff('seo') });
  for (const target of ['seo', 'ghost']) {
    expect(afterReply(th({ permissionMode: 'auto' }), 'seo', next(target), undefined).thread.retried).toBe(true);
  }
});

test('autonomous planning budget accepts a manager plan but cannot silently restart discussion', () => {
  const t = th({ permissionMode: 'auto', summarizing: true, agentTurns: PLANNING_BUDGET });
  expect(afterReply(t, MANAGER, plan, undefined).step).toEqual({ do: 'wait' });
  expect(afterReply(t, MANAGER, next('seo'), undefined).step).toMatchObject({ do: 'wait', note: expect.any(String) });
});

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

  test('build: a reply ends in idle, never a loop', () => {
    const t = th({ phase: 'build' });
    expect(afterReply(t, MANAGER, undefined, undefined)).toEqual({ thread: t, step: { do: 'idle' } });
  });

  test('done: the Head answers a follow-up and waits; a member hands the floor back; the turns are budgeted', () => {
    const t = th({ phase: 'done', agentTurns: 2 });
    expect(afterReply(t, MANAGER, undefined, undefined)).toMatchObject({ thread: { phase: 'done', agentTurns: 3 }, step: { do: 'wait' } });
    expect(afterReply(t, MANAGER, next('seo'), undefined).step).toEqual({ do: 'turn', agent: 'seo' });
    expect(afterReply(t, 'seo', undefined, undefined).step).toEqual({ do: 'turn', agent: MANAGER });
    expect(afterReply(t, MANAGER, ask, undefined).step).toEqual({ do: 'wait' });
    expect(afterReply(t, MANAGER, team, undefined).thread.retried).toBe(true);
    expect(afterReply(th({ phase: 'done', agentTurns: PLANNING_BUDGET - 1 }), 'seo', undefined, undefined).thread.summarizing).toBe(true);
  });

  test('done: a new plan opens the next planning cycle and waits on its card, the build kept', () => {
    const build = { worktree: 'w', branch: 'b', plan: 'p', phases: [], current: 0 };
    for (const from of [MANAGER, 'planner']) {
      const d = afterReply(th({ phase: 'done', build }), from, plan, undefined);
      expect(d.step).toEqual({ do: 'wait' });
      expect(d.thread).toMatchObject({ phase: 'planning', build });
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

  test('level passes from the manager next to the step', () => {
    const d = afterReply(th(), MANAGER, { kind: 'next', agent: 'planner', level: 'heavy' }, undefined);
    expect(d.step).toEqual({ do: 'turn', agent: 'planner', level: 'heavy' });
  });

  test('an interrupt or the budget drops level', () => {
    const hard: Control = { kind: 'next', agent: 'planner', level: 'heavy' };
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

  test('build: idle', () => {
    expect(afterUser(th({ phase: 'build' }), undefined).step).toEqual({ do: 'idle' });
  });

  test('done: a follow-up goes to the Head of Staff, or to the member it mentions', () => {
    expect(afterUser(th({ phase: 'done', agentTurns: 4 }), undefined)).toMatchObject({ thread: { phase: 'done', agentTurns: 0 }, step: { do: 'turn', agent: MANAGER, note: NOTES.followUp } });
    expect(afterUser(th({ phase: 'done' }), 'seo').step).toEqual({ do: 'turn', agent: 'seo' });
    expect(afterUser(th({ phase: 'done', waitingOn: MANAGER }), undefined).step).toMatchObject({ do: 'turn', agent: MANAGER });
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

const names = { planner: 'Planner', dev: 'Dev', seo: 'SEO' };

test('an easy team goes straight to its builder for a short plan', () => {
  const d = approveTeam(th({ phase: 'team', team: [] }), ['dev', 'seo'], names, { difficulty: 'easy', roles: { builders: ['dev'], codeReview: 'seo' } });
  expect(d.thread).toMatchObject({ phase: 'planning', team: [MANAGER, 'dev', 'seo'], difficulty: 'easy', roles: { planner: 'dev', builders: ['dev'], codeReview: 'seo' } });
  expect(d.step).toEqual({ do: 'turn', agent: 'dev', note: NOTES.easyPlan, level: 'standard' });
});

test('a hard team, or one with nobody to build, goes to the Head of Staff as before', () => {
  const hard = approveTeam(th({ phase: 'team', team: [] }), ['planner', 'dev'], names, { difficulty: 'hard', roles: { planner: 'planner', builders: ['dev'] } });
  expect(hard.step).toMatchObject({ do: 'turn', agent: MANAGER });
  expect(hard.thread.roles).toEqual({ planner: 'planner', builders: ['dev'] });
  expect(approveTeam(th({ phase: 'team', team: [] }), ['seo'], names).step).toMatchObject({ do: 'turn', agent: MANAGER });
});

test('roles held by someone the user left off the team are dropped', () => {
  const d = approveTeam(th({ phase: 'team', team: [] }), ['dev'], names, { difficulty: 'hard', roles: { planner: 'planner', builders: ['dev'], codeReview: 'seo' } });
  expect(d.thread.roles).toEqual({ builders: ['dev'] });
});

test('a roles block from the Head of Staff updates the roles and gives it the floor again', () => {
  const d = afterReply(th({ roles: { planner: 'planner', builders: [] } }), MANAGER, { kind: 'roles', roles: { builders: ['dev'] } }, undefined);
  expect(d.thread.roles).toEqual({ planner: 'planner', builders: ['dev'] });
  expect(d.step).toEqual({ do: 'turn', agent: MANAGER, note: NOTES.rolesChanged });
});

test('a roles block is not valid in the team phase, and a member cannot send one', () => {
  expect(afterReply(th({ phase: 'team' }), MANAGER, { kind: 'roles', roles: { builders: ['dev'] } }, undefined).thread.retried).toBe(true);
  const d = afterReply(th({ roles: { builders: [] } }), 'planner', { kind: 'roles', roles: { builders: ['dev'] } }, undefined);
  expect(d.thread.roles).toEqual({ builders: [] });
  expect(d.step).toEqual({ do: 'turn', agent: MANAGER });
});

describe('member routing is bounded', () => {
  const auto = (o: Partial<Thread> = {}) => th({ permissionMode: 'auto', ...o });
  test('consecutive member handoffs are counted, and the floor goes back to the Head of Staff at the limit', () => {
    let t = auto();
    for (let i = 1; i < MEMBER_RELAYS; i++) {
      const d = afterReply(t, i % 2 ? 'seo' : 'planner', next(i % 2 ? 'planner' : 'seo'), undefined);
      expect(d.step).toMatchObject({ do: 'turn', agent: i % 2 ? 'planner' : 'seo' });
      expect(d.thread.relay).toBe(i);
      t = d.thread;
    }
    const d = afterReply(t, 'seo', next('planner'), undefined);
    expect(d.step).toEqual({ do: 'turn', agent: MANAGER, note: NOTES.relayLimit });
    expect(d.thread.relay).toBe(0);
  });
  test('the Head of Staff and the user reset the count', () => {
    expect(afterReply(auto({ relay: 2 }), MANAGER, next('seo'), undefined).thread.relay).toBe(0);
    expect(afterReply(auto({ relay: 2 }), 'seo', undefined, undefined).thread.relay).toBe(0);
    expect(afterUser(auto({ relay: 2 }), undefined).thread.relay).toBe(0);
  });
  test('the planning budget still applies on top', () => {
    const d = afterReply(auto({ agentTurns: PLANNING_BUDGET - 1 }), 'seo', next('planner'), undefined);
    expect(d.step).toMatchObject({ do: 'turn', agent: MANAGER, note: NOTES.autoBudget });
  });
});

test('git proposal is accepted only from the manager after a build', () => {
  const control = { kind: 'git', action: 'merge' } as unknown as Control;
  expect(afterReply(th({ phase: 'done', build: { worktree: 'w', branch: 'b', plan: 'p', phases: [], current: 0 } }), MANAGER, control, undefined).step).toEqual({ do: 'wait' });
  expect(afterReply(th(), MANAGER, control, undefined).thread.retried).toBe(true);
  expect(afterReply(th({ phase: 'done' }), MANAGER, control, undefined).thread.retried).toBe(true);
});
