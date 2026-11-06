// Turn rules: a pure state machine that decides who speaks next in a thread, or that it waits for the user.
// The conductor applies the decision: it sets status, speaking and waitingOn from the step.
import { HANDOFF_AT, MANAGER, PLANNING_BUDGET, type Control, type Thread } from '@shared/thread';
import { NOTES } from './protocol';

export type Step = { do: 'turn'; agent: string; note?: string; hard?: true } | { do: 'wait'; note?: string } | { do: 'idle' };
export type Decision = { thread: Thread; step: Step };

/** Is this the manager's control acceptable in the thread's phase (team or planning)? */
function validForManager(t: Thread, control: Control | undefined): boolean {
  if (t.phase === 'team') return control?.kind === 'team' || control?.kind === 'ask';
  if (control?.kind === 'next') return control.agent !== MANAGER && t.team.includes(control.agent);
  return control?.kind === 'ask' || control?.kind === 'plan';
}

export function afterReply(
  t: Thread, from: string, control: Control | undefined, error: string | undefined, interrupt?: { to?: string },
): Decision {
  // Replies only matter while the team forms or plans; later phases never loop.
  if (t.phase !== 'team' && t.phase !== 'planning') return { thread: t, step: { do: 'idle' } };
  const isManager = from === MANAGER;
  // 1. The budget summary: the manager's reply waits for the user, whatever it says.
  if (isManager && t.summarizing) return { thread: { ...t, summarizing: false }, step: { do: 'wait' } };

  // 2. One correction for a bad reply, then wait.
  if (error || (isManager && !validForManager(t, control))) {
    // A user interrupt wins over the correction; the new speaker has not had its own yet.
    if (interrupt) return { thread: { ...t, agentTurns: 0, retried: false }, step: { do: 'turn', agent: interrupt.to ?? MANAGER } };
    if (!t.retried) {
      return { thread: { ...t, retried: true }, step: { do: 'turn', agent: from, note: NOTES.invalid(error ?? 'missing or not allowed here') } };
    }
    return { thread: { ...t, retried: false }, step: { do: 'wait', note: `${from} did not give Ark a valid instruction. Reply to continue.` } };
  }

  // 3. The step comes from the control. Only the manager steers: members' next/team are ignored.
  let thread: Thread = { ...t, retried: false, agentTurns: t.phase === 'planning' ? t.agentTurns + 1 : t.agentTurns };
  let step: Step;
  if (isManager && control?.kind === 'next') step = { do: 'turn', agent: control.agent, ...(control.hard ? { hard: true as const } : {}) };
  else if (control?.kind === 'ask' || control?.kind === 'plan' || (isManager && control?.kind === 'team')) step = { do: 'wait' };
  else step = { do: 'turn', agent: MANAGER };

  // 4. A user interrupt redirects the next turn.
  if (interrupt && step.do === 'turn') {
    step = { do: 'turn', agent: interrupt.to ?? MANAGER };
    thread = { ...thread, agentTurns: 0 };
  }

  // 5. The planning budget: the manager summarizes and asks the user.
  if (thread.phase === 'planning' && step.do === 'turn' && thread.agentTurns >= PLANNING_BUDGET) {
    step = { do: 'turn', agent: MANAGER, note: NOTES.budget };
    thread = { ...thread, summarizing: true };
  }
  return { thread, step };
}

export function afterUser(t: Thread, mention: string | undefined): Decision {
  const thread: Thread = { ...t, agentTurns: 0, retried: false, summarizing: false };
  if (t.phase === 'team') return { thread, step: { do: 'turn', agent: MANAGER } };
  if (t.phase === 'planning') return { thread, step: { do: 'turn', agent: mention ?? t.waitingOn ?? MANAGER } };
  return { thread, step: { do: 'idle' } };
}

export function approveTeam(t: Thread, picks: string[], names: Record<string, string>): Decision {
  const team = [MANAGER, ...new Set(picks.filter((id) => id !== MANAGER))];
  return {
    thread: { ...t, team, phase: 'planning', agentTurns: 0 },
    step: { do: 'turn', agent: MANAGER, note: NOTES.teamApproved(team.map((id) => names[id] ?? id)) },
  };
}

/** The first `@<id>` in the text whose id is on the team. `@` must start the text or follow whitespace (not an e-mail). */
export function mentionOf(text: string, team: string[]): string | undefined {
  for (const m of text.matchAll(/(?:^|\s)@([\w-]+)/g)) if (team.includes(m[1])) return m[1];
  return undefined;
}

/** True when the context has filled at least HANDOFF_AT of the window. Unknown window: never. */
export function needsHandoff(used: number, contextWindow: number | undefined): boolean {
  return !!contextWindow && used / contextWindow >= HANDOFF_AT;
}
