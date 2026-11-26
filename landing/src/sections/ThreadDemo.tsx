import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { Avatar } from '../Avatar';
import { cn } from '../cn';
import { ENTER, EASE } from '../motion';

// The hero: a faithful, scripted copy of an Ark thread (rail, threads, conversation, team). It plays once
// when it scrolls into view and then stops; the quick replies are the visitor's to press.

type Who = 'you' | 'hos' | 'nova' | 'jarvis' | 'killua';
const WHO: Record<Who, { name: string; face?: string; model?: string }> = {
  you: { name: 'You' },
  hos: { name: 'Head of Staff', face: 'face-head' },
  nova: { name: 'Nova', face: 'face-04', model: 'Claude Opus' },
  jarvis: { name: 'Jarvis', face: 'face-02', model: 'Claude Sonnet' },
  killua: { name: 'Killua', face: 'face-06', model: 'Codex' },
};
const TEAM: Who[] = ['hos', 'nova', 'jarvis', 'killua'];

type Msg = { who: Who; time: string; body: ReactNode; ask?: boolean; team?: boolean };

const Mention = ({ children }: { children: ReactNode }) => (
  <span className="rounded-detail bg-raised px-1 text-ink">{children}</span>
);

const SCRIPT: Msg[] = [
  { who: 'you', time: '10:41', body: 'The checkout total is off by a cent when a discount applies. Can you fix it and add a test?' },
  { who: 'hos', time: '10:41', body: 'Understood. Nova plans, Jarvis builds, Killua reviews.', team: true },
  { who: 'nova', time: '10:42', body: 'The discount is applied before rounding, so every line loses a fraction. Round once, after the sum.' },
  { who: 'killua', time: '10:42', body: 'I expect a test with three discounted lines. Jarvis, start with that.' },
  {
    who: 'jarvis',
    time: '10:43',
    ask: true,
    body: (
      <>
        <Mention>@you</Mention> The invoice PDF rounds the same way. Change it too?
      </>
    ),
  },
];
const REPLIES = ['Yes, both', 'Checkout only'];
const ROLES: Partial<Record<Who, string>> = { nova: 'plans', jarvis: 'builds', killua: 'reviews' };

function TeamCard() {
  return (
    <div className="mt-2 max-w-[640px] rounded-card bg-raised p-4">
      <p className="text-xs tracking-[0.04em] text-muted">Team</p>
      <ul className="mt-3 grid gap-3">
        {(['nova', 'jarvis', 'killua'] as const).map((w) => (
          <li key={w} className="flex items-center gap-3">
            <Avatar face={WHO[w].face!} size={28} />
            <span className="text-[15px] text-ink">{WHO[w].name}</span>
            <span className="ml-auto text-xs text-muted">{ROLES[w]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Message({ m, answered, onReply }: { m: Msg; answered: boolean; onReply: (r: string) => void }) {
  const w = WHO[m.who];
  const waiting = m.ask && !answered;
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex gap-3 pl-3"
    >
      <AnimatePresence>
        {waiting && (
          <motion.span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-0.5 origin-top rounded-full bg-accent"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>
      {w.face ? (
        <Avatar face={w.face} />
      ) : (
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-body font-heading font-semibold text-rail">
          Y
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-heading text-[15px] font-semibold text-ink">{w.name}</span>
          {w.model && <span className="rounded-full bg-raised px-2 text-xs leading-5 text-muted">{w.model}</span>}
          <span className="text-xs text-muted">{m.time}</span>
        </p>
        <p className="mt-0.5 max-w-[640px] text-[15px] leading-6 text-body">{m.body}</p>
        {m.team && <TeamCard />}
        {waiting && (
          <div className="mt-3 flex flex-wrap gap-2">
            {REPLIES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onReply(r)}
                className="h-8 cursor-pointer rounded-full border border-body/30 px-4 text-sm text-ink transition-colors hover:bg-raised"
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Dot({ state }: { state: 'speaking' | 'waiting' | 'idle' }) {
  const color = state === 'speaking' ? 'bg-ink' : state === 'waiting' ? 'bg-accent' : 'bg-body/40';
  return (
    <motion.span
      aria-hidden
      className={cn('block size-2 rounded-full transition-colors duration-200', color)}
      animate={state === 'speaking' ? { scale: [1, 1.5, 1] } : { scale: 1 }}
      transition={state === 'speaking' ? { duration: 1.2, repeat: Infinity, ease: EASE } : ENTER}
    />
  );
}

export function ThreadDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [reply, setReply] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setStep(SCRIPT.length);
      return;
    }
    const timers = [0, 1000, 2100, 3300, 4500].map((ms, i) => window.setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(window.clearTimeout);
  }, [inView, reduced]);

  // Jarvis answers a moment after the visitor's reply.
  useEffect(() => {
    if (!reply) return;
    const t = window.setTimeout(() => setDone(true), 900);
    return () => window.clearTimeout(t);
  }, [reply]);
  const both = reply === REPLIES[0];

  const shown = SCRIPT.slice(0, step);
  const last = shown[shown.length - 1];
  const waiting = !!last?.ask && !reply;
  const presence = (w: Who) => (!last || last.who !== w ? 'idle' : waiting ? 'waiting' : 'speaking');
  const phase = reply ? 'Building' : 'Planning';

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Preview of an Ark thread"
      className="mt-12 grid h-[560px] grid-cols-1 overflow-hidden rounded-frame border border-body/15 bg-content text-left shadow-[0_24px_64px_rgb(0_0_0/0.45)] md:mt-16 md:h-[620px] md:grid-cols-[64px_240px_1fr] lg:grid-cols-[64px_240px_1fr_240px]"
    >
      {/* Project rail */}
      <div className="hidden flex-col items-center gap-3 bg-rail py-4 md:flex">
        <img src="/logo.png" alt="" width="32" height="32" className="mb-2 size-8" />
        {['St', 'Ap', 'Ar'].map((t, i) => (
          <span
            key={t}
            aria-hidden
            className={cn('grid size-10 place-items-center rounded-card font-heading text-sm font-semibold', i === 0 ? 'bg-raised text-ink' : 'text-muted')}
          >
            {t}
          </span>
        ))}
      </div>

      {/* Threads */}
      <div className="hidden flex-col gap-1 border-r border-line bg-sidebar p-3 md:flex">
        <p className="px-2 pb-1 pt-2 text-xs tracking-[0.04em] text-muted">Projects</p>
        <p className="px-2 pb-2 font-heading text-[15px] font-semibold text-ink">storefront</p>
        {[
          ['fix-cart-total', true],
          ['dark-mode-settings', false],
          ['upgrade-vite', false],
          ['flaky-login-test', false],
        ].map(([name, selected]) => (
          <div
            key={name as string}
            className={cn('flex h-8 items-center gap-2 rounded-control px-2 text-sm', selected ? 'bg-raised text-ink' : 'text-muted')}
          >
            <span aria-hidden>#</span>
            <span className="truncate">{name as string}</span>
            {selected && waiting && <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-sidebar px-2 text-xs text-ink">Your turn</span>}
          </div>
        ))}
      </div>

      {/* Conversation */}
      <div className="flex min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-4 md:px-6">
          <p className="shrink-0 font-heading text-base font-semibold text-ink">fix-cart-total</p>
          <span className="shrink-0 text-sm text-muted">{phase}</span>
          <span className="hidden truncate text-sm text-muted sm:block">Round totals once, after the discount</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden px-3 pb-4 pt-6 [mask-image:linear-gradient(to_bottom,transparent,black_56px)] md:px-5">
          {shown.map((m, i) => (
            <Message key={i} m={m} answered={!!reply} onReply={setReply} />
          ))}
          {reply && <Message m={{ who: 'you', time: '10:44', body: `${reply}.` }} answered onReply={setReply} />}
          {done && (
            <Message
              m={{
                who: 'jarvis',
                time: '10:44',
                body: both
                  ? 'On it. Changing both, building in ark/fix-cart-total-3f2a.'
                  : 'Checkout only. Building in ark/fix-cart-total-3f2a.',
              }}
              answered
              onReply={setReply}
            />
          )}
        </div>
        <div className="shrink-0 px-3 pb-3 md:px-5 md:pb-4">
          <div className="flex items-center gap-2 rounded-frame bg-sidebar p-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)]">
            <span className="flex-1 px-2 text-sm text-muted">Message the team, @ to mention an agent</span>
            <span className="inline-flex h-8 items-center rounded-control bg-accent px-4 text-sm font-medium text-rail">Send</span>
          </div>
        </div>
      </div>

      {/* Workspace panel */}
      <div className="hidden flex-col border-l border-line bg-sidebar lg:flex">
        <div className="flex h-12 items-center gap-5 border-b border-line px-4 text-sm">
          <span className="text-ink">Team</span>
          <span className="text-muted">Files</span>
          <span className="text-muted">Git</span>
        </div>
        <p className="px-4 pb-2 pt-4 text-xs tracking-[0.04em] text-muted">Team - {TEAM.length}</p>
        <ul className="grid gap-1 px-2">
          {TEAM.map((w) => (
            <li key={w} className="flex h-12 items-center gap-3 rounded-control px-2">
              <Avatar face={WHO[w].face!} size={32} />
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{WHO[w].name}</p>
                <p className="truncate text-xs text-muted">{WHO[w].model ?? 'Built in'}</p>
              </div>
              <span className="ml-auto">
                <Dot state={presence(w)} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
