import type { ReactNode } from 'react';

/** The pane that holds the work. Panes manage their own scrolling. */
export function Main({ children }: { children: ReactNode }) {
  return <main className="flex min-w-0 flex-1 flex-col bg-content">{children}</main>;
}

/** The 240px column next to the rail: a 48px title, then rows that scroll, then an optional footer. */
export function Sidebar({ title, label, children, footer }: { title: string; label: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <nav aria-label={label} className="flex w-30 shrink-0 flex-col border-r border-divider bg-sidebar">
      <header className="drag flex h-6 shrink-0 items-center border-b border-divider px-2">
        <h2 className="truncate text-body">{title}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">{children}</div>
      {footer}
    </nav>
  );
}

/** A small muted header over a group of rows. */
export function SideLabel({ children }: { children: ReactNode }) {
  return <h3 className="section px-1 pb-[4px] pt-2 font-body font-normal text-muted">{children}</h3>;
}

/**
 * A 32px row: glyph or avatar, name, then a state on the right.
 * A row that waits for the user carries the Accent bar, flush with the column edge.
 */
export function SideRow({ selected = false, waiting = false, onClick, lead, trail, children, title }: {
  selected?: boolean; waiting?: boolean; onClick: () => void; lead?: ReactNode; trail?: ReactNode; children: ReactNode; title?: string;
}) {
  return (
    <div className="relative">
      {waiting && <span aria-hidden className="absolute -left-1 inset-y-0 w-[2px] bg-accent" />}
      <button
        onClick={onClick}
        title={title}
        aria-current={selected ? 'page' : undefined}
        className={`group flex h-4 w-full items-center gap-1 rounded-sm px-1 text-left ${
          selected ? 'bg-raised text-secondary' : `hover:bg-raised/50 hover:text-secondary ${waiting ? 'text-secondary' : 'text-muted'}`
        }`}
      >
        {lead && <span className="flex w-3 shrink-0 items-center justify-center">{lead}</span>}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {trail}
      </button>
    </div>
  );
}

/** A small pill, Secondary on Raised (on Primary when its row is already Raised); `label` says it in words. Never a coloured badge. */
export function Pill({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label} className="shrink-0 rounded-full bg-raised px-1 text-meta text-secondary group-aria-[current=page]:bg-primary">
      <span aria-hidden>{children}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Who is speaking breathes, who waits for the user is Accent, the rest is quiet. */
export function Presence({ state }: { state: 'speaking' | 'waiting' | 'idle' }) {
  const label = { speaking: 'speaking', waiting: 'your turn', idle: 'idle' }[state];
  const look = { speaking: 'bg-secondary breathe', waiting: 'bg-accent', idle: 'bg-neutral-light/40' }[state];
  return (
    <span title={label} className={`size-1 shrink-0 rounded-full ${look}`}>
      <span className="sr-only">{label}</span>
    </span>
  );
}
