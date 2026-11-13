import { useState, type ReactNode } from 'react';
import type { AgentDef } from '@shared/agent-file';
import { MANAGER, type BuildPhase, type Control, type PhaseStep, type Roles, type ThreadMessage } from '@shared/thread';
import { parsePhases } from '@shared/plan';
import { roleLabels } from '@shared/roles';
import { AgentAvatar } from './Avatar';
import { Markdown } from './Markdown';
import { Select } from './Select';
import { BUTTON_INSET, CTA } from './ui';

/**
 * A card inside a message: a softly raised surface, 640px at most. A thin elbow joins it to the message
 * above, the way a thread reply is joined; it lands on the card's first line (22px line + 16px padding).
 */
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="surface-card relative ml-2 mt-1.5 max-w-[640px] rounded-md bg-raised p-2 before:absolute before:-left-2 before:-top-1.5 before:h-[39px] before:w-2 before:rounded-bl-sm before:border-b before:border-l before:border-neutral-light/20">
      {children}
    </div>
  );
}

/** The team and ask cards; only the one `actionable` returns has its controls. */
export function Cards({ control, name, agents, active, pending, send, approve }: {
  control: Control; name: (id: string) => string; agents: AgentDef[]; active: boolean; pending: boolean;
  send: (text: string) => void; approve: (ids: string[]) => void;
}) {
  if (control.kind === 'team') return <TeamCard control={control} name={name} agents={agents} active={active} pending={pending} approve={approve} />;
  if (control.kind !== 'ask') return null;
  return (
    <Card>
      <p className="whitespace-pre-wrap break-words leading-[22px] text-secondary"><span aria-hidden>❓ </span>{control.question}</p>
      {active && control.choices.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {control.choices.map((c) => (
            <button key={c} onClick={() => send(c)} disabled={pending} className={BUTTON_INSET}>{c}</button>
          ))}
        </div>
      )}
    </Card>
  );
}

function TeamCard({ control, name, agents, active, pending, approve }: {
  control: Extract<Control, { kind: 'team' }>; name: (id: string) => string; agents: AgentDef[]; active: boolean; pending: boolean;
  approve: (ids: string[]) => void;
}) {
  const [added, setAdded] = useState<string[]>([]);
  const picked = control.picks.map((p) => p.agent);
  const options = agents.filter((a) => a.id !== MANAGER && !picked.includes(a.id) && !added.includes(a.id));
  return (
    <Card>
      <p className="head leading-[22px]"><span aria-hidden>👥 </span>Proposed team</p>
      {control.difficulty && <p className="text-meta text-muted">{control.difficulty === 'easy' ? 'Easy request' : 'Hard request'}</p>}
      <ul className="mt-1 flex flex-col gap-1">
        {control.picks.map((p) => (
          <li key={p.agent} className="flex gap-1">
            <AgentAvatar agent={agents.find((a) => a.id === p.agent)} name={name(p.agent)} size={24} inset />
            <div className="flex min-w-0 flex-col">
              <span className="head leading-[24px]">{name(p.agent)}</span>
              <span className="flex flex-wrap gap-[4px]">{roleLabels(control.roles, p.agent).map((role) => <span key={role} className="rounded-full bg-primary px-1 text-meta text-muted">{role}</span>)}</span>
              <span className="text-muted">{p.reason}</span>
            </div>
          </li>
        ))}
        {added.map((id) => (
          <li key={id} className="flex items-center gap-1">
            <AgentAvatar agent={agents.find((a) => a.id === id)} name={name(id)} size={24} inset />
            <span className="head">{name(id)}</span>
          </li>
        ))}
      </ul>
      {control.leftOut && <p className="mt-1 whitespace-pre-wrap text-muted" title="Left out"><span aria-hidden>🚫 </span>{control.leftOut}</p>}
      {active && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Select inset label="Add an agent from the catalog" value="" placeholder="Add from catalog" onChange={(v) => setAdded([...added, v])} options={options.map((a) => ({ value: a.id, label: a.name }))} />
          {/* the manager leads every thread; main puts it first and drops a repeat */}
          <button onClick={() => approve([...picked, ...added])} disabled={pending} className={`${CTA} ml-auto`}>✅ Approve team</button>
        </div>
      )}
    </Card>
  );
}

export function PlanCard({ text, active, pending, start, roles, name, onLink }: { text: string; active: boolean; pending: boolean; start: () => void; roles?: Roles; name: (id: string) => string; onLink?: (href: string) => void }) {
  const phases = parsePhases(text);
  const builds = phases.map((phase, i) => {
    const id = phase.builder && roles?.builders.includes(phase.builder) ? phase.builder : roles?.builders[0];
    return `Phase ${i + 1} - ${id ? name(id) : 'none'}`;
  }).join(', ');
  return (
    <Card>
      <details open={active}>
        <summary className="head cursor-pointer leading-[22px] marker:text-muted"><span aria-hidden>📋 </span>Plan</summary>
        <Markdown text={text} className="mt-1 text-neutral-light" onLink={onLink} />
      </details>
      <div className="mt-1 text-meta text-muted">
        <p>{`Builds: ${builds || 'none'}`}</p>
        <p>{`Code review: ${roles?.codeReview ? name(roles.codeReview) : 'none'}`}</p>
        <p>{`Security review: ${roles?.securityReview ? name(roles.securityReview) : 'none'}`}</p>
      </div>
      {active && (
        <div className="mt-2">
          <button onClick={start} disabled={pending} className={CTA}>🚀 Start build</button>
        </div>
      )}
    </Card>
  );
}

const STATE: Record<PhaseStep, string> = { develop: 'In progress', review: 'In review', security: 'In review', blocked: 'Blocked', done: 'Done' };
const ORDER: PhaseStep[] = ['develop', 'review', 'security', 'done'];

/** One build phase: where it stands, and what each step of it has done. Reads the live phase, so it updates in place. */
export function PhaseCard({ phase, index, total, builder, reviews }: { phase: BuildPhase; index: number; total: number; builder?: string; reviews: { code: boolean | undefined; security: boolean | undefined } }) {
  // a blocked phase stopped in the step it was sent back from; show it as the current development one
  const at = phase.step === 'blocked' ? 0 : ORDER.indexOf(phase.step);
  const mark = (i: number) => (i < at || phase.step === 'done' ? '✓' : i === at ? '…' : '·');
  const checks = phase.checks === undefined ? '' : phase.checks.length === 0 ? 'no checks' : `checks: ${phase.checks.join(', ')}`;
  const lines = [
    [`development${builder ? ` - ${builder}` : ''}`, mark(0)],
    [reviews.code === undefined ? 'review - unknown' : reviews.code ? `review (${phase.notes} notes)` : 'review - skipped', reviews.code ? mark(1) : '·'],
    [reviews.security === undefined ? 'security - unknown' : reviews.security ? 'security' : 'security - skipped', reviews.security ? mark(2) : '·'],
    [checks || 'checks', phase.checks !== undefined ? '✓' : at === 0 ? '…' : '·'],
  ];
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="head leading-[22px]"><span aria-hidden>🧱 </span>Phase {index + 1}/{total} · {phase.title}</p>
        <span className="text-meta text-muted">{STATE[phase.step]}</span>
      </div>
      <ul className="mt-1 text-secondary">
        {lines.map(([label, m]) => (
          <li key={label} className="flex gap-1 leading-[22px]">
            <span aria-hidden className="w-2 text-center text-muted">{m}</span>
            {label}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A tool the agent wants to use. Allow and Deny only while pending; after that the card says what was decided. */
export function ApprovalCard({ m, name, pending, decision, busy, answer }: {
  m: Extract<ThreadMessage, { kind: 'approval' }>; name: string; pending: boolean; decision: boolean | undefined; busy: boolean;
  answer: (allow: boolean) => void;
}) {
  return (
    <Card>
      <p className="head leading-[22px]"><span aria-hidden>🔐 </span>{name} wants to use {m.tool}</p>
      {m.detail && <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded-xs bg-primary p-1 font-mono text-meta text-neutral-light">{m.detail}</pre>}
      <div className="mt-2 flex items-center gap-1">
        {pending ? (
          <>
            <button onClick={() => answer(true)} disabled={busy} className={CTA}>Allow</button>
            <button onClick={() => answer(false)} disabled={busy} className={BUTTON_INSET}>Deny</button>
          </>
        ) : (
          <span className="text-muted">{decision === true ? '✅ Allowed' : decision === false ? '🚫 Denied' : 'Expired'}</span>
        )}
      </div>
    </Card>
  );
}
