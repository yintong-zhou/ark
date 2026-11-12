import { LEGACY_MANAGER, MANAGER, type Thread } from './thread';

export function upgradeThread(t: Thread): Thread {
  if (t.roles !== undefined || t.team[0] === MANAGER) return t;
  return {
    ...t,
    team: t.team[0] === LEGACY_MANAGER ? [MANAGER, ...t.team.slice(1)] : t.team,
    ...(t.speaking === LEGACY_MANAGER && { speaking: MANAGER }),
    ...(t.waitingOn === LEGACY_MANAGER && { waitingOn: MANAGER }),
    ...(t.build && { roles: { builders: [] } }),
  };
}
