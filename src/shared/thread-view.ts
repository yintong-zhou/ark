import type { Build, BuildPhase, Reaction, Thread, ThreadMessage, ThreadWindows } from './thread';
import type { TokenCount } from './types';

type AgentMessage = Extract<ThreadMessage, { kind: 'agent' }>;
const lastAgentMessage = (messages: ThreadMessage[]) =>
  messages.findLast((m): m is AgentMessage => m.kind === 'agent');

/** The phases of build cycle `cycle` (absent = 1), current or earlier; undefined when the build has no such cycle. */
export function cyclePhases(b: Build | undefined, cycle = 1): BuildPhase[] | undefined {
  if (!b) return undefined;
  return cycle === (b.cycle ?? 1) ? b.phases : b.previous?.[cycle - 1]?.phases;
}

/** Missing legacy review context is unknown, never inferred from another cycle. */
export function cycleReviews(b: Build | undefined, cycle = 1): { code: boolean | undefined; security: boolean | undefined } {
  const context = cycle === (b?.cycle ?? 1) ? b?.reviewContext : b?.previous?.[cycle - 1]?.reviewContext;
  return { code: context ? !!context.roles.codeReview : undefined, security: context ? !!context.roles.securityReview : undefined };
}

/** The card the user can act on: the last agent message, while the thread waits for the user. */
export function actionable(t: Thread, messages: ThreadMessage[]): { kind: 'team' | 'ask' | 'plan' | 'git'; seq: number } | undefined {
  if (t.status !== 'waiting') return undefined;
  const m = lastAgentMessage(messages);
  const kind = m?.control?.kind;
  if (!m || !(kind === 'team' || kind === 'ask' || (kind === 'plan' && t.phase === 'planning') || (kind === 'git' && t.phase === 'done' && m.agent === 'head-of-staff'))) return undefined;
  return { kind, seq: m.seq };
}

/** The reaction each message carries; the last one given wins. */
export function reactionsOf(messages: ThreadMessage[]): Map<number, Reaction> {
  const out = new Map<number, Reaction>();
  for (const m of messages) if (m.kind === 'reaction') out.set(m.target, m.emoji);
  return out;
}

/** Tokens the thread has used, summed over the agent messages that share a key. */
export function tokensBy(messages: ThreadMessage[], key: (m: AgentMessage) => string): Record<string, TokenCount> {
  const out: Record<string, TokenCount> = {};
  for (const m of messages) {
    if (m.kind !== 'agent') continue;
    const t = (out[key(m)] ??= { input: 0, cached: 0, output: 0 });
    t.input += m.tokens.input;
    t.cached += m.tokens.cached;
    t.output += m.tokens.output;
  }
  return out;
}

/** Tokens each agent has used in the thread. */
export const tokensByAgent = (messages: ThreadMessage[]) => tokensBy(messages, (m) => m.agent);

/** How the account's usage windows moved while the thread ran: one line per window, Claude first, 5-hour before weekly. */
export function windowLines(w: ThreadWindows | undefined): string[] {
  const out: string[] = [];
  for (const [engine, name] of [['claude', 'Claude'], ['codex', 'Codex']] as const)
    for (const [k, label] of [['fiveHour', '5h'], ['weekly', 'weekly']] as const) {
      const m = w?.[engine]?.[k];
      if (m) out.push(`${name} ${label} ${m.from}% → ${m.to}%`);
    }
  return out;
}

/** The model the agent answered with last. */
export function lastModel(messages: ThreadMessage[], agent: string): string | undefined {
  return messages.findLast((m): m is AgentMessage => m.kind === 'agent' && m.agent === agent)?.model || undefined;
}

/** A message from the same author within this long of the previous one joins its group. */
export const GROUP_WINDOW_MS = 5 * 60_000;

/**
 * True when `m` opens a new group of messages (avatar and name shown): a note, a different author,
 * or five minutes or more after `prev`. `prev` is the message shown just above, never a reaction.
 */
export function startsGroup(prev: ThreadMessage | undefined, m: ThreadMessage): boolean {
  if (!prev || m.kind === 'note' || m.kind === 'reaction' || m.kind === 'phase' || m.kind === 'approval' || m.kind === 'decision' || prev.kind !== m.kind) return true;
  if (m.kind === 'agent' && prev.kind === 'agent' && m.agent !== prev.agent) return true;
  return m.at - prev.at >= GROUP_WINDOW_MS;
}

/** Adds the messages whose seq is not known yet, in seq order. Returns `have` itself when nothing is new. */
export function mergeMessages(have: ThreadMessage[], added: ThreadMessage[]): ThreadMessage[] {
  const seen = new Set(have.map((m) => m.seq));
  const fresh = added.filter((m) => !seen.has(m.seq));
  return fresh.length === 0 ? have : [...have, ...fresh].sort((a, b) => a.seq - b.seq);
}

/** The thread needs the user: it waits for a message, or an approval card is still open. */
export const needsYou = (t: Thread): boolean => t.status === 'waiting' || (t.approvals?.length ?? 0) > 0;

/** The answer each approval got (by its seq); the last one wins. */
export function decisionsOf(messages: ThreadMessage[]): Map<number, boolean> {
  const out = new Map<number, boolean>();
  for (const m of messages) if (m.kind === 'decision') out.set(m.target, m.allow);
  return out;
}
