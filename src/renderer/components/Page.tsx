import type { ReactNode } from 'react';

/** The 48px bar over a pane: its title in Outfit, then muted facts kept apart by space, and the pane's actions. */
export function PaneHeader({ title, meta = [], actions }: { title: string; meta?: string[]; actions?: ReactNode }) {
  return (
    <header className="drag flex h-6 shrink-0 items-center gap-2 border-b border-divider px-3">
      {/* the title gives way first: what the thread is doing matters more than the rest of its name */}
      <h1 className="min-w-0 truncate text-title">{title}</h1>
      <div className="flex max-w-[60%] shrink-0 gap-2 text-muted">
        {meta.map((m, i) => (
          <span key={m} className={i === meta.length - 1 ? 'truncate' : 'shrink-0'}>{m}</span>
        ))}
      </div>
      {actions && <div className="no-drag ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/** A screen that is not a conversation: the header, then content that scrolls. */
export function Page({ title, meta, actions, children, narrow = false }: {
  title: string; meta?: string[]; actions?: ReactNode; children: ReactNode; narrow?: boolean;
}) {
  return (
    <>
      <PaneHeader title={title} meta={meta} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`flex flex-col gap-3 px-3 py-3 ${narrow ? 'max-w-[640px]' : 'max-w-[960px]'}`}>{children}</div>
      </div>
    </>
  );
}

/** Label and value pairs. */
export function Facts({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[160px_1fr] gap-x-2 gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value ?? <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What a pane says when there is nothing to show yet, and the one thing to do about it. */
export function Empty({ glyph, title, children, action }: { glyph?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-5">
      {glyph && <span aria-hidden className="text-[32px] leading-none">{glyph}</span>}
      <h2 className="text-title">{title}</h2>
      {children && <p className="max-w-[60ch] text-muted">{children}</p>}
      {action}
    </div>
  );
}
