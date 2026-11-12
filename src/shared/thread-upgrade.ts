import { LEGACY_MANAGER, MANAGER, type Thread } from './thread';

/** True for a thread whose coordinator is still the old `project-manager` (not yet upgraded). */
export const hasLegacyManager = (t: Thread): boolean => t.roles === undefined && t.team[0] === LEGACY_MANAGER;

const rekey = <V>(r: Record<string, V> | undefined): Record<string, V> | undefined => {
  if (!r || !(LEGACY_MANAGER in r)) return r;
  const { [LEGACY_MANAGER]: moved, ...rest } = r;
  return { ...rest, [MANAGER]: moved };
};

export function upgradeThread(t: Thread): Thread {
  if (t.roles !== undefined || t.team[0] === MANAGER) return t;
  const legacy = hasLegacyManager(t);
  return {
    ...t,
    ...(legacy && { cursors: rekey(t.cursors)!, handoffs: rekey(t.handoffs)!, ...(t.assignments && { assignments: rekey(t.assignments) }) }),
    team: legacy ? [MANAGER, ...t.team.slice(1)] : t.team,
    ...(t.speaking === LEGACY_MANAGER && { speaking: MANAGER }),
    ...(t.waitingOn === LEGACY_MANAGER && { waitingOn: MANAGER }),
    ...(t.build && { roles: { builders: [] } }),
  };
}
