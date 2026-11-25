import type { Phase } from '@shared/thread';

// Line icons that stand in for the emoji that used to say a state: same 20px grid and 1.5 stroke as Icons.tsx.
const PATHS = {
  question: <><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.8M10 14.2h.01" /></>,
  team: <><circle cx="7" cy="7.5" r="2.5" /><path d="M2.5 16c.4-2.6 2-3.8 4.5-3.8s4.1 1.2 4.5 3.8" /><circle cx="14" cy="8" r="2" /><path d="M13 12.4c2.3-.2 3.8.9 4.2 3.4" /></>,
  blocked: <><circle cx="10" cy="10" r="7" /><path d="m5.2 14.8 9.6-9.6" /></>,
  check: <path d="m4 10.5 4 4L16 6" />,
  plan: <><rect x="4.5" y="3.5" width="11" height="13.5" rx="1.5" /><path d="M7.5 8.5h5M7.5 11.5h5M7.5 14h3" /></>,
  start: <path d="M7 4.5v11l8.5-5.5z" />,
  phase: <><path d="m10 3.5 7 3.5-7 3.5L3 7z" /><path d="m3 10.5 7 3.5 7-3.5M3 14l7 3.5 7-3.5" opacity="0.55" /></>,
  lock: <><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  working: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4.2l2.6 1.6" /></>,
  waiting: <><path d="M5 14V9a5 5 0 0 1 10 0v5l1 1.5H4z" /><path d="M8.5 17.5h3" /></>,
  warning: <><path d="M10 3.5 17.5 16.5h-15z" /><path d="M10 8.5v3.5M10 14.3h.01" /></>,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v4.5M10 6.5h.01" /></>,
  tag: <><path d="M3.5 4.5h6l7 7-5.5 5.5-7-7z" /><circle cx="7.2" cy="8.2" r="0.6" /></>,
  folder: <path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" />,
  idea: <><path d="M7.2 13.5C5.9 12.6 5 11.2 5 9.5a5 5 0 0 1 10 0c0 1.7-.9 3.1-2.2 4V15H7.2z" /><path d="M8 17.5h4" /></>,
  doc: <><path d="M5.5 2.5h6l3.5 3.5v11.5H5.5z" /><path d="M11.5 2.5V6H15" /></>,
} as const;

export type StateKind = keyof typeof PATHS;

/** A 16px line icon in the colour of its text. */
export const StateIcon = ({ kind, className = 'size-2' }: { kind: StateKind; className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
    {PATHS[kind]}
  </svg>
);

export const PHASE_ICON: Record<Phase, StateKind> = { team: 'team', planning: 'plan', build: 'phase', done: 'check' };

/** A disclosure chevron: points down when open, right when closed, and turns between them. */
export const Disclosure = ({ open = true, className = 'size-[14px]' }: { open?: boolean; className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    className={`shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? '' : '-rotate-90'} ${className}`}>
    <path d="m6 8 4 4 4-4" />
  </svg>
);
