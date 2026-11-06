// Build rules: a pure state machine for the build loop (developer -> checks -> code review -> security review).
// The conductor applies the decision: it runs the step, and sets status, speaking and waitingOn.
// Nothing here mutates its input or touches status; `finish` only moves the thread phase to 'done'.
import { REVIEW_ROUNDS, type Build, type BuildPhase, type Control, type Thread, type ThreadMessage } from '@shared/thread';
import { NOTES } from './protocol';
import type { CheckResult } from './workspace';

export type BuildStep =
  | { do: 'develop' }
  | { do: 'fix'; why: 'checks' | 'review' | 'user'; results?: CheckResult[] }
  | { do: 'review'; who: 'code' | 'security'; retry?: string }
  | { do: 'escalate' }
  | { do: 'summary' }
  | { do: 'wait'; note?: string }
  | { do: 'finish' };
export type BuildDecision = { thread: Thread; step: BuildStep };

const WHO = { code: 'Code', security: 'Security' } as const;

/** A copy of the thread whose current phase is `edit`ed in place; `t.build` must exist. */
export function withPhase(t: Thread, edit: (p: BuildPhase) => void, extra: Partial<Thread> = {}): { thread: Thread; p: BuildPhase; build: Build } {
  const b = t.build!;
  const phases = b.phases.map((p, i) => (i === b.current ? { ...p } : p));
  const p = phases[b.current];
  edit(p);
  const build = { ...b, phases };
  return { thread: { ...t, ...extra, build }, p, build };
}

/** A failure sends the developer back, or blocks the phase once the rounds are spent. */
function fail(t: Thread, why: 'checks' | 'review', results?: CheckResult[], extra: Partial<Thread> = {}): BuildDecision {
  const blocked = t.build!.phases[t.build!.current].rounds >= REVIEW_ROUNDS;
  const { thread } = withPhase(t, (p) => {
    if (blocked) p.step = 'blocked';
    else { p.rounds += 1; p.step = 'develop'; }
  }, extra);
  return { thread, step: blocked ? { do: 'escalate' } : { do: 'fix', why, ...(results && { results }) } };
}

export function startBuild(
  t: Thread, build: Omit<Build, 'current' | 'phases'> & { phases: { title: string; text: string }[] },
): BuildDecision {
  const phases = build.phases.map((p): BuildPhase => ({ title: p.title, text: p.text, step: 'develop', rounds: 0, notes: 0, open: 0 }));
  return { thread: { ...t, phase: 'build', retried: false, build: { ...build, phases, current: 0 } }, step: { do: 'develop' } };
}

export function afterChecks(t: Thread, results: CheckResult[]): BuildDecision {
  if (!results.every((r) => r.ok)) return fail(t, 'checks', results);
  const { thread } = withPhase(t, (p) => { p.checks = results.map((r) => r.script); p.step = 'review'; });
  return { thread, step: { do: 'review', who: 'code' } };
}

/** `unread`: the user wrote something the developer has not read yet; the phase cannot end before it does. */
export function afterReview(t: Thread, who: 'code' | 'security', control: Control | undefined, error?: string, unread = false): BuildDecision {
  if (error || control?.kind !== 'review') {
    if (!t.retried) return { thread: { ...t, retried: true }, step: { do: 'review', who, retry: NOTES.invalid(error ?? 'missing review block') } };
    return { thread: { ...t, retried: false }, step: { do: 'wait', note: `${WHO[who]} reviewer did not give a valid review. Reply to continue: your message goes to the developer, then the checks and both reviews run again.` } };
  }
  const n = control.findings.length;
  const keep = { retried: false };
  if (who === 'code') {
    const { thread } = withPhase(t, (p) => { p.open = n; p.notes += n; p.step = 'security'; }, keep);
    return { thread, step: { do: 'review', who: 'security' } };
  }
  const { thread, p, build } = withPhase(t, (q) => { q.open += n; q.notes += n; }, keep);
  if (p.open > 0) return fail(thread, 'review');
  if (unread) {
    p.step = 'develop';
    return { thread, step: { do: 'fix', why: 'user' } };
  }
  p.step = 'done';
  if (build.current + 1 >= build.phases.length) return { thread, step: { do: 'summary' } };
  return { thread: { ...thread, build: { ...build, current: build.current + 1 } }, step: { do: 'develop' } };
}

export function afterBuildUser(t: Thread): BuildDecision {
  if (!t.build) return { thread: t, step: { do: 'wait' } };
  const { step } = t.build.phases[t.build.current];
  if (step === 'blocked') {
    return { thread: withPhase(t, (p) => { p.rounds = 0; p.step = 'develop'; }).thread, step: { do: 'fix', why: 'user' } };
  }
  if (step === 'develop') return { thread: t, step: { do: 'fix', why: 'user' } };
  // A reviewer starts fresh and never reads the user: the developer does, then the checks and both reviews run again.
  if (step === 'review' || step === 'security') return { thread: withPhase(t, (p) => { p.step = 'develop'; }).thread, step: { do: 'fix', why: 'user' } };
  return { thread: t, step: t.phase === 'done' ? { do: 'wait' } : { do: 'summary' } };
}

export function afterManager(t: Thread): BuildDecision {
  const b = t.build;
  if (b && b.phases[b.current].step !== 'blocked' && b.phases.every((p) => p.step === 'done')) {
    return { thread: { ...t, phase: 'done' }, step: { do: 'finish' } };
  }
  return { thread: t, step: { do: 'wait' } };
}

/** The findings of every review that asked for changes in messages after `since`, in order. */
export function openPoints(messages: ThreadMessage[], since: number): string[] {
  return messages.flatMap((m) =>
    m.kind === 'agent' && m.seq > since && m.control?.kind === 'review' && !m.control.pass ? m.control.findings : []);
}
