import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadSize, saveSize } from '../saved';
import { CloseIcon } from './Icons';

/** The pane that holds the work. Panes manage their own scrolling. */
export function Main({ children }: { children: ReactNode }) {
  return <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-content">{children}</main>;
}

const sidebarWidths: Record<string, number> = {};
const widthOf = (key: string) => (sidebarWidths[key] ??= loadSize(`ark-width-${key}`, 240));
const resizeSidebar = (width: number) => Math.max(180, Math.min(600, window.innerWidth - 320, width));

/** A resizable column with a 48px heading or tab bar, scrolling content and an optional footer. */
export function Sidebar({ title, label, children, footer, side = 'left', header, widthKey = side }: {
  title: string; label: string; children: ReactNode; footer?: ReactNode; side?: 'left' | 'right'; header?: ReactNode;
  widthKey?: string; // which saved width this column uses (default: its side)
}) {
  const [width, setWidth] = useState(widthOf(widthKey));
  const drag = useRef({ x: 0, width: 0 });
  const resize = (next: number) => setWidth(sidebarWidths[widthKey] = resizeSidebar(next));
  useEffect(() => saveSize(`ark-width-${widthKey}`, width), [widthKey, width]);
  const direction = side === 'left' ? 1 : -1;
  return (
    <nav aria-label={label} style={{ width }} className={`relative flex shrink-0 flex-col border-divider bg-sidebar ${side === 'left' ? 'border-r' : 'border-l'}`}>
      <header className={`drag flex h-6 shrink-0 items-center border-b border-divider ${header ? 'px-1' : 'px-2'}`}>
        {header ?? <h2 className="truncate text-body">{title}</h2>}
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto ${side === 'left' ? 'space-y-0.5 p-1' : ''}`}>{children}</div>
      {footer}
      <div
        role="separator"
        aria-label={side === 'left' ? 'Resize sidebar' : 'Resize workspace panel'}
        aria-orientation="vertical"
        aria-valuemin={180}
        aria-valuemax={600}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(drag.current.width + direction * (e.clientX - drag.current.x));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            resize(width + direction * (e.key === 'ArrowLeft' ? -10 : 10));
          }
        }}
        className={`absolute inset-y-0 z-10 w-[6px] cursor-col-resize touch-none hover:bg-divider focus-visible:bg-divider focus-visible:outline-hidden ${side === 'left' ? '-right-[3px]' : '-left-[3px]'}`}
      />
    </nav>
  );
}

/** A small muted header over a group of rows. */
export function SideLabel({ children }: { children: ReactNode }) {
  return <h3 className="section px-1 pb-0.5 pt-2 font-body font-normal text-muted">{children}</h3>;
}

/**
 * A 32px row: glyph or avatar, name, then a state on the right.
 * A row that waits for the user carries the Accent bar, flush with the column edge.
 */
export function SideRow({ selected = false, waiting = false, onClick, lead, trail, children, title, onRemove }: {
  selected?: boolean; waiting?: boolean; onClick: () => void; lead?: ReactNode; trail?: ReactNode; children: ReactNode; title?: string; onRemove?: () => void;
}) {
  return (
    <div className="relative">
      {waiting && <span aria-hidden className="absolute -left-1 inset-y-0 w-[2px] bg-accent" />}
      <button
        onClick={onClick}
        title={title}
        aria-current={selected ? 'page' : undefined}
        className={`group flex h-4 w-full items-center gap-1 rounded-sm px-1 text-left ${onRemove ? 'pr-4' : ''} ${
          selected ? 'control-raised bg-raised text-secondary' : `hover:bg-raised/50 hover:text-secondary ${waiting ? 'text-secondary' : 'text-muted'}`
        }`}
      >
        {lead && <span className="flex w-3 shrink-0 items-center justify-center">{lead}</span>}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {trail}
      </button>
      {onRemove && <button onClick={onRemove} aria-label={`Delete ${title ?? 'thread'}`} title="Delete thread" className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-sm text-muted hover:bg-raised hover:text-secondary [&_svg]:size-2"><CloseIcon /></button>}
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
