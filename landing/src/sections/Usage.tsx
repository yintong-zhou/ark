import { useEffect, useRef } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { Intro, Section } from '../Section';
import { SLOW } from '../motion';

// Usage gauges: fill and count up once, when they scroll into view.
type Gauge = { label: string; value: number; reset?: string; tick?: { at: number; label: string } };
type Agent = { name: string; account: string; gauges: Gauge[] } | { name: string; note: string };

const AGENTS: Agent[] = [
  {
    name: 'Claude Code',
    account: 'Max plan',
    gauges: [
      { label: 'Context', value: 34, tick: { at: 40, label: 'Handoff' } },
      { label: '5-hour window', value: 41, reset: 'resets in 2h 10m' },
      { label: 'Weekly window', value: 62, reset: 'resets in 3d 4h', tick: { at: 57, label: 'Even pace' } },
    ],
  },
  {
    name: 'Codex',
    account: 'Plus plan',
    gauges: [
      { label: '5-hour window', value: 18, reset: 'resets in 4h 20m' },
      { label: 'Weekly window', value: 35, reset: 'resets in 3d 4h', tick: { at: 57, label: 'Even pace' } },
    ],
  },
  { name: 'OpenCode', note: 'Detected. Usage is not tracked yet.' },
];

function Bar({ g, go }: { g: Gauge; go: boolean }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (n) => `${Math.round(n)}%`);
  useEffect(() => {
    if (!go) return;
    if (reduced) {
      mv.set(g.value);
      return;
    }
    const c = animate(mv, g.value, SLOW);
    return () => c.stop();
  }, [go, reduced, g.value, mv]);

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-body">{g.label}</span>
        <span className="text-muted">
          {g.reset && <span className="mr-3">{g.reset}</span>}
          <motion.span className="font-heading text-base font-semibold text-ink">{text}</motion.span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={g.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={g.value}
        className="relative mt-2 h-2 rounded-full bg-raised"
      >
        <motion.div className="h-full rounded-full bg-body" style={{ width: `${g.value}%`, originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: go ? 1 : 0 }} transition={SLOW} />
        {g.tick && (
          <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `${g.tick.at}%` }} title={g.tick.label} />
        )}
      </div>
      {g.tick && <p className="mt-1.5 text-xs text-muted">Tick: {g.tick.label.toLowerCase()}</p>}
    </div>
  );
}

export function Usage() {
  const ref = useRef<HTMLDivElement>(null);
  const go = useInView(ref, { once: true, amount: 0.3 });
  return (
    <Section id="usage">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[3fr_5fr] lg:gap-16">
        <Intro title="See what each agent has left.">
          Context, the 5-hour window and the weekly window, with time to reset. A tick on the weekly bar marks where you would be if you spread the
          week evenly, and a tick on context marks your handoff threshold. Ark only reads. It never runs the agents for this and never sends anything
          anywhere.
        </Intro>
        <div ref={ref} className="rounded-frame bg-sidebar p-4 md:p-6">
          <ul className="divide-y divide-line">
            {AGENTS.map((a) => (
              <li key={a.name} className="py-6 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-lg">{a.name}</h3>
                  <span className="text-sm text-muted">{'account' in a ? a.account : ''}</span>
                </div>
                {'gauges' in a ? (
                  <div className="mt-4 grid gap-5">
                    {a.gauges.map((g) => (
                      <Bar key={g.label} g={g} go={go} />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">{a.note}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-muted">Example figures.</p>
        </div>
      </div>
    </Section>
  );
}
