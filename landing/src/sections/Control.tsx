import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from '../Avatar';
import { Icon, type IconName } from '../Icon';
import { Intro, Section } from '../Section';
import { ENTER } from '../motion';

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'eye', title: 'Read-only by default', text: 'Agents read your project and talk. Only a thread\'s builders write files, and only inside the worktree.' },
  { icon: 'lock', title: 'Risky actions ask first', text: 'Installing packages, network commands and anything outside the worktree show an approval card. Full access is a setting you choose per thread.' },
  { icon: 'files', title: 'Each agent sees only its own skills', text: 'Your personal memory, plugins and MCP servers stay out of agent sessions.' },
  { icon: 'user', title: 'Nothing leaves your computer', text: 'No server and no account. Ark uses the Claude Code and Codex subscriptions you already have.' },
];

// A working approval card: the visitor answers it, and it shows what changed.
function ApprovalCard() {
  const [answer, setAnswer] = useState<'allow' | 'deny' | null>(null);
  return (
    <div className="rounded-card bg-raised p-4 shadow-[0_8px_24px_rgb(0_0_0/0.35)] md:p-6">
      <div className="flex items-center gap-3">
        <Avatar face="face-02" size={32} />
        <p className="text-[15px] text-ink">Jarvis wants to run a command</p>
      </div>
      <p className="mt-4 text-xs text-muted">Install packages</p>
      <pre className="mt-1 overflow-x-auto rounded-control bg-rail p-3 font-mono text-sm text-body shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]">npm install zod</pre>
      <div className="mt-4 min-h-11">
        <AnimatePresence mode="wait" initial={false}>
          {answer === null ? (
            <motion.div key="ask" className="flex gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button
                type="button"
                onClick={() => setAnswer('allow')}
                className="h-11 cursor-pointer rounded-control bg-accent px-5 text-[15px] font-medium text-rail transition-[filter] hover:brightness-110"
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() => setAnswer('deny')}
                className="h-11 cursor-pointer rounded-control bg-sidebar px-5 text-[15px] font-medium text-ink transition-colors hover:bg-rail"
              >
                Deny
              </button>
            </motion.div>
          ) : (
            <motion.div key="done" className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={ENTER}>
              <span className="flex items-center gap-2 text-[15px] text-ink">
                <Icon name="check" className="text-ink" />
                {answer === 'allow' ? 'Allowed. Jarvis continues.' : 'Denied. Jarvis was told.'}
              </span>
              <button type="button" onClick={() => setAnswer(null)} className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-ink">
                Ask again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Control() {
  return (
    <Section id="control">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[5fr_4fr] lg:gap-16">
        <div>
          <Intro title="You decide what runs.">Agents work for you, inside limits you can read at a glance.</Intro>
          <ul className="mt-10 divide-y divide-line border-y border-line">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4 py-5">
                <Icon name={p.icon} />
                <div>
                  <h3 className="text-lg leading-6">{p.title}</h3>
                  <p className="mt-1 max-w-[60ch] text-[15px] leading-6">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:pt-24">
          <ApprovalCard />
        </div>
      </div>
    </Section>
  );
}
