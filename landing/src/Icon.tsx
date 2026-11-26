import type { ReactNode } from 'react';

// 20px line icons in the muted Light neutral. Drawn here so the page needs no icon package.
const PATHS: Record<string, ReactNode> = {
  user: <><circle cx="10" cy="7" r="3" /><path d="M4 16c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5" /></>,
  branch: <><circle cx="6" cy="4.5" r="1.8" /><circle cx="6" cy="15.5" r="1.8" /><circle cx="14" cy="8" r="1.8" /><path d="M6 6.3v7.4M14 9.8c0 2.6-2.2 3.4-8 4.2" /></>,
  check: <path d="M4.5 10.5 8 14l7.5-8" />,
  files: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H8l1.5 2h5A1.5 1.5 0 0 1 16 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5z" />,
  terminal: <><rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="m6.5 8.5 2.5 2-2.5 2M10.5 12.5h3" /></>,
  globe: <><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2.5 2.2 2.5 11.8 0 14M10 3c-2.5 2.2-2.5 11.8 0 14" /></>,
  lock: <><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" /><path d="M7 9V7a3 3 0 0 1 6 0v2" /></>,
  eye: <><path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z" /><circle cx="10" cy="10" r="2.2" /></>,
  copy: <><rect x="7" y="7" width="9" height="9" rx="1.5" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></>,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'text-muted' }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
