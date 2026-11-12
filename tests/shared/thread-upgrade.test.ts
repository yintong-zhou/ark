import { expect, test } from 'vitest';
import { LEGACY_MANAGER, MANAGER, type Thread } from '@shared/thread';
import { upgradeThread } from '@shared/thread-upgrade';

const old: Thread = {
  id: 't', projectId: 'p', title: 'T', createdAt: 0, phase: 'planning', status: 'waiting',
  team: [LEGACY_MANAGER, 'planner'], waitingOn: LEGACY_MANAGER, agentTurns: 0, retried: false, summarizing: false, cursors: {}, handoffs: {},
};

test('the old coordinator id becomes the Head of Staff', () => {
  expect(upgradeThread(old)).toMatchObject({ team: [MANAGER, 'planner'], waitingOn: MANAGER });
});

test('an old build has no builders until the Head of Staff picks them', () => {
  const t = upgradeThread({ ...old, phase: 'build', build: { worktree: 'w', branch: 'b', plan: 'p', phases: [], current: 0 } });
  expect(t.roles).toEqual({ builders: [] });
});

test('a thread of this version is left alone, even with an agent called project-manager', () => {
  const now: Thread = { ...old, team: [MANAGER, LEGACY_MANAGER], waitingOn: LEGACY_MANAGER, roles: { builders: [] } };
  expect(upgradeThread(now)).toBe(now);
  expect(upgradeThread(upgradeThread(old))).toEqual(upgradeThread(old));
});

test('a new discussion without roles keeps an ordinary project-manager agent', () => {
  const now: Thread = { ...old, team: [MANAGER, LEGACY_MANAGER], waitingOn: LEGACY_MANAGER, speaking: LEGACY_MANAGER };
  expect(upgradeThread(now)).toMatchObject({ team: [MANAGER, LEGACY_MANAGER], waitingOn: LEGACY_MANAGER, speaking: LEGACY_MANAGER });
});
