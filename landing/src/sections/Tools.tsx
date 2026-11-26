import { useState, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { cn } from '../cn';
import { Icon, type IconName } from '../Icon';
import { Intro, Section } from '../Section';
import { ENTER, SLIDE } from '../motion';

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('font-mono text-[13px] leading-6', className)}>{children}</div>
);
const Letter = ({ c }: { c: string }) => <span className="ml-auto text-xs text-muted">{c}</span>;

// Small, static copies of each tool. They are drawn here, not captured, so they stay sharp at any size.
const FilesPane = () => (
  <div className="grid h-full gap-px md:grid-cols-[200px_1fr]">
    <div className="bg-sidebar p-3 text-sm">
      {[
        ['src', ''],
        ['  cart.ts', 'M'],
        ['  total.ts', 'M'],
        ['  total.test.ts', 'A'],
        ['dist', ''],
        ['package.json', ''],
      ].map(([n, l]) => (
        <p key={n} className={cn('flex h-8 items-center whitespace-pre rounded-control px-2', n === '  total.ts' ? 'bg-raised text-ink' : 'text-body', n === 'dist' && 'italic opacity-50')}>
          {n}
          <Letter c={l} />
        </p>
      ))}
    </div>
    <Mono className="bg-rail p-4 text-body">
      <p className="text-muted">total.ts</p>
      <p className="mt-2">export function total(lines: Line[]) {'{'}</p>
      <p>{'  '}const sum = lines.reduce((s, l) =&gt; s + l.price * l.qty, 0);</p>
      <p className="text-ink">{'  '}return Math.round(sum * (1 - discount));</p>
      <p>{'}'}</p>
    </Mono>
  </div>
);

const TerminalPane = () => (
  <Mono className="h-full bg-rail p-4 text-body">
    <p>
      <span className="text-muted">PS storefront&gt; </span>npm run typecheck
    </p>
    <p className="text-muted">No errors.</p>
    <p className="mt-2">
      <span className="text-muted">PS storefront&gt; </span>npm test
    </p>
    <p className="text-muted">3 files, 18 tests passed.</p>
    <p className="mt-2">
      <span className="text-muted">PS storefront&gt; </span>
      <span className="inline-block h-4 w-2 translate-y-0.5 bg-body/70" />
    </p>
  </Mono>
);

const GitPane = () => (
  <div className="h-full bg-sidebar p-4 text-sm">
    <p className="text-ink">ark/fix-cart-total-3f2a</p>
    <p className="mt-1 text-muted">2 commits left to merge into main</p>
    <p className="mt-5 text-xs tracking-[0.04em] text-muted">Changes - 3</p>
    <div className="mt-2 grid">
      {[
        ['src/cart.ts', 'M'],
        ['src/total.ts', 'M'],
        ['src/total.test.ts', 'A'],
      ].map(([n, l]) => (
        <p key={n} className="flex h-8 items-center rounded-control px-2 text-body">
          {n}
          <Letter c={l} />
        </p>
      ))}
    </div>
    <span className="mt-5 inline-flex h-9 items-center rounded-control bg-raised px-4 text-ink">Merge into main</span>
  </div>
);

const BrowserPane = () => (
  <div className="flex h-full flex-col bg-sidebar">
    <div className="flex items-center gap-3 border-b border-line p-3">
      <span className="flex-1 rounded-control bg-rail px-3 py-1.5 text-sm text-body">localhost:5173</span>
    </div>
    <div className="relative flex-1 bg-rail p-6">
      <p className="font-heading text-xl font-semibold text-ink">Your cart</p>
      <p className="mt-3 text-sm text-body">3 items</p>
      <div className="mt-4 w-56 rounded-card border border-dashed border-ink/60 p-3">
        <p className="text-sm text-body">Total 42.30</p>
      </div>
      <div className="mt-3 w-64 rounded-card bg-raised p-3 text-sm text-ink">
        Show the discount on its own line.
        <span className="mt-3 flex h-8 w-fit items-center rounded-control bg-accent px-3 text-sm font-medium text-rail">Send to thread</span>
      </div>
    </div>
  </div>
);

const TABS: { id: string; label: string; icon: IconName; text: string; pane: ReactNode }[] = [
  { id: 'files', label: 'Files and editor', icon: 'files', text: 'Browse the project or the thread\'s worktree and edit in Monaco, the editor of VS Code. A file the agents change reloads on its own, and a save never overwrites a newer version without your click.', pane: <FilesPane /> },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', text: 'Your own shell, in PowerShell, Command Prompt or Git Bash, in a panel under the thread. Chat and run commands side by side.', pane: <TerminalPane /> },
  { id: 'git', label: 'Git', icon: 'branch', text: 'Stage, commit, switch branches and merge a thread\'s branch from the same window. Ark runs Git without project hooks, and nothing runs without your click.', pane: <GitPane /> },
  { id: 'browser', label: 'Browser', icon: 'globe', text: 'Preview a local dev server next to the thread. Drag a rectangle over what is wrong, write what you want, and the comment goes to the thread with a picture of the area.', pane: <BrowserPane /> },
];

export function Tools() {
  const [id, setId] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === id)!;
  return (
    <Section id="tools" tone="content">
      <Intro title="Everything beside the thread.">
        Follow the work without leaving Ark: the files, a terminal, Git and a browser for the project's dev server.
      </Intro>
      <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[320px_1fr] lg:gap-12">
        <div className="min-w-0">
          <LayoutGroup id="tools">
            <div role="tablist" aria-label="Tools" className="flex gap-1 overflow-x-auto lg:flex-col">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  role="tab"
                  type="button"
                  aria-selected={t.id === id}
                  aria-controls="tool-pane"
                  onClick={() => setId(t.id)}
                  className={cn(
                    'relative flex h-11 shrink-0 cursor-pointer items-center gap-3 rounded-control px-3 text-[15px] transition-colors',
                    t.id === id ? 'text-ink' : 'text-body hover:text-ink',
                  )}
                >
                  {t.id === id && <motion.span aria-hidden layoutId="tool-hl" transition={SLIDE} className="absolute inset-0 rounded-control bg-raised" />}
                  <span className="relative"><Icon name={t.icon} className={t.id === id ? 'text-ink' : 'text-muted'} /></span>
                  <span className="relative">{t.label}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
          <p className="mt-6 hidden max-w-[40ch] text-[15px] leading-6 lg:block">{tab.text}</p>
        </div>
        <div className="min-w-0">
          <div id="tool-pane" role="tabpanel" aria-labelledby={`tab-${id}`} className="h-[340px] overflow-hidden rounded-frame border border-body/15 bg-rail">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={id} className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={ENTER}>
                {tab.pane}
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="mt-6 text-[15px] leading-6 lg:hidden">{tab.text}</p>
        </div>
      </div>
    </Section>
  );
}
