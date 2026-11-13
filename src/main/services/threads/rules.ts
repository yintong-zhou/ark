// Turn rules: a pure state machine that decides who speaks next in a thread, or that it waits for the user.
// The conductor applies the decision: it sets status, speaking and waitingOn from the step.
import { HANDOFF_AT, MANAGER, MEMBER_RELAYS, PLANNING_BUDGET, type Control, type Difficulty, type Level, type Roles, type Thread } from '@shared/thread';
import { mergeRoles } from '@shared/roles';
import { NOTES } from './protocol';
import { autonomous } from '@shared/permissions';

export type Step = { do: 'turn'; agent: string; note?: string; level?: Level } | { do: 'wait'; note?: string } | { do: 'idle' };
export type Decision = { thread: Thread; step: Step };

/** After a build the thread talks like it plans: the Head answers, routes, asks, or gets the next cycle's plan written. */
const talks = (t: Thread) => t.phase === 'planning' || t.phase === 'done';

/** Is this the manager's control acceptable in the thread's phase (team, planning or done)? */
function validForManager(t: Thread, control: Control | undefined): boolean {
  if (t.phase === 'team') return control?.kind === 'team' || control?.kind === 'ask';
  if (control?.kind === 'git') return t.phase === 'done' && !!t.build && !t.build.removed;
  if (t.phase === 'done' && !control) return true; // a plain answer to a follow-up
  if (control?.kind === 'next') return control.agent !== MANAGER && t.team.includes(control.agent);
  return control?.kind === 'ask' || control?.kind === 'plan' || control?.kind === 'roles';
}

export function afterReply(
  t: Thread, from: string, control: Control | undefined, error: string | undefined, interrupt?: { to?: string },
): Decision {
  // Replies only matter while the team forms, plans or follows up on a finished build; the build never loops here.
  if (t.phase !== 'team' && !talks(t)) return { thread: t, step: { do: 'idle' } };
  const isManager = from === MANAGER;
  const auto = autonomous(t);
  // 1. The budget summary: the manager's reply waits for the user, whatever it says.
  if (isManager && t.summarizing) return {
    thread: { ...t, summarizing: false },
    step: auto && (error || (control?.kind !== 'plan' && control?.kind !== 'ask'))
      ? { do: 'wait', note: 'The team reached its planning budget without a plan. Reply to resolve the remaining blocker.' }
      : { do: 'wait' },
  };

  // 2. One correction for a bad reply, then wait.
  const invalidHandoff = auto && !isManager && control?.kind === 'next'
    && (control.agent === from || !t.team.includes(control.agent));
  if (error || invalidHandoff || (isManager && !validForManager(t, control))) {
    // A user interrupt wins over the correction; the new speaker has not had its own yet.
    if (interrupt) return { thread: { ...t, agentTurns: 0, retried: false }, step: { do: 'turn', agent: interrupt.to ?? MANAGER } };
    if (!t.retried) {
      return { thread: { ...t, retried: true }, step: { do: 'turn', agent: from, note: NOTES.invalid(error ?? 'missing or not allowed here') } };
    }
    return { thread: { ...t, retried: false }, step: { do: 'wait', note: `${from} did not give Ark a valid instruction. Reply to continue.` } };
  }

  // 3. The step comes from the control. Only the manager steers: members' next/team are ignored.
  // The relay count restarts with every reply that is not a member handing the floor to another member.
  let thread: Thread = { ...t, retried: false, agentTurns: talks(t) ? t.agentTurns + 1 : t.agentTurns, ...(t.relay !== undefined && { relay: 0 }) };
  let step: Step;
  if (isManager && control?.kind === 'roles') { thread = { ...thread, roles: mergeRoles(thread.roles, control.roles) }; step = { do: 'turn', agent: MANAGER, note: NOTES.rolesChanged }; }
  else if (!isManager && auto && control?.kind === 'next') {
    // Members may pass the floor among themselves, a few times in a row; then the Head of Staff decides.
    const relay = (t.relay ?? 0) + 1;
    if (relay >= MEMBER_RELAYS) { thread = { ...thread, relay: 0 }; step = { do: 'turn', agent: MANAGER, note: NOTES.relayLimit }; }
    else { thread = { ...thread, relay }; step = { do: 'turn', agent: control.agent, note: NOTES.handedOff(from), ...(control.level ? { level: control.level } : {}) }; }
  }
  else if (isManager && control?.kind === 'next') step = { do: 'turn', agent: control.agent, ...(control.level ? { level: control.level } : {}) };
  else if (auto && !isManager && control?.kind === 'ask') step = { do: 'turn', agent: MANAGER, note: `Resolve this team question using the context or another specialist. Ask the user only for a sensitive decision, missing intent or a real blocker: ${control.question}` };
  else if (control?.kind === 'ask' || control?.kind === 'plan' || (isManager && control?.kind === 'team')) step = { do: 'wait' };
  else if (isManager) step = { do: 'wait' }; // only reachable when done: the Head answered
  else step = { do: 'turn', agent: MANAGER };
  // A plan written after a build opens the next cycle: the thread plans again, its build kept until the new one starts.
  if (thread.phase === 'done' && control?.kind === 'plan') thread = { ...thread, phase: 'planning' };

  // 4. A user interrupt redirects the next turn.
  if (interrupt && step.do === 'turn') {
    step = { do: 'turn', agent: interrupt.to ?? MANAGER };
    thread = { ...thread, agentTurns: 0, ...(thread.relay !== undefined && { relay: 0 }) };
  }

  // 5. The planning budget: the manager summarizes and asks the user.
  if (talks(thread) && step.do === 'turn' && thread.agentTurns >= PLANNING_BUDGET) {
    step = { do: 'turn', agent: MANAGER, note: auto ? NOTES.autoBudget : NOTES.budget };
    thread = { ...thread, summarizing: true };
  }
  return { thread, step };
}

export function afterUser(t: Thread, mention: string | undefined): Decision {
  const thread: Thread = { ...t, agentTurns: 0, retried: false, summarizing: false, ...(t.relay !== undefined && { relay: 0 }) };
  if (t.phase === 'team') return { thread, step: { do: 'turn', agent: MANAGER } };
  if (t.phase === 'planning') return { thread, step: { do: 'turn', agent: mention ?? t.waitingOn ?? MANAGER } };
  if (t.phase === 'done') {
    const agent = mention ?? t.waitingOn ?? MANAGER;
    return { thread, step: { do: 'turn', agent, ...(agent === MANAGER && { note: NOTES.followUp }) } };
  }
  return { thread, step: { do: 'idle' } };
}

export function approveTeam(t: Thread, picks: string[], names: Record<string, string>, proposal?: { difficulty?: Difficulty; roles?: Roles }): Decision {
  const team = [MANAGER, ...new Set(picks.filter((id) => id !== MANAGER))];
  const r = proposal?.roles;
  const roles = r ? { builders: r.builders.filter((id) => team.includes(id)), ...(r.planner && team.includes(r.planner) && { planner: r.planner }), ...(r.codeReview && team.includes(r.codeReview) && { codeReview: r.codeReview }), ...(r.securityReview && team.includes(r.securityReview) && { securityReview: r.securityReview }) } : undefined;
  if (roles && proposal?.difficulty === 'easy' && roles.builders.length) roles.planner = roles.builders[0];
  if (proposal?.difficulty === 'easy' && roles?.builders.length) return { thread: { ...t, team, phase: 'planning', agentTurns: 0, difficulty: proposal.difficulty, roles }, step: { do: 'turn', agent: roles.builders[0], note: NOTES.easyPlan, level: 'standard' } };
  return {
    thread: { ...t, team, phase: 'planning', agentTurns: 0, ...(proposal?.difficulty && { difficulty: proposal.difficulty }), ...(roles && { roles }) },
    step: { do: 'turn', agent: MANAGER, note: NOTES.teamApproved(team.map((id) => names[id] ?? id)) },
  };
}

/** The first `@<id>` in the text whose id is on the team. `@` must start the text or follow whitespace (not an e-mail). */
export function mentionOf(text: string, team: string[]): string | undefined {
  for (const m of text.matchAll(/(?:^|\s)@([\w-]+)/g)) if (team.includes(m[1])) return m[1];
  return undefined;
}

/** True when the context has filled at least HANDOFF_AT of the window. Unknown window: never. */
export function needsHandoff(used: number, contextWindow: number | undefined, threshold = HANDOFF_AT): boolean {
  return !!contextWindow && used / contextWindow >= threshold;
}
