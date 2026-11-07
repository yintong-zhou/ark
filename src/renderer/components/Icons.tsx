// 20px line icons, drawn for Ark: they borrow the app's own marks (the usage bar, the team) instead of stock shapes.
const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** Three usage bars: the track, the fill and a different reading on each. */
export const UsageIcon = () => (
  <svg {...base}>
    <path d="M3 5h14M3 10h14M3 15h14" opacity="0.35" />
    <path d="M3 5h9M3 10h5M3 15h11" />
  </svg>
);

/** A prompt and a cursor in a window. */
export const TerminalIcon = () => (
  <svg {...base}>
    <rect x="2.5" y="4" width="15" height="12" rx="1.5" opacity="0.35" />
    <path d="m6 8 2.5 2L6 12M10.5 12.5H14" />
  </svg>
);

/** Three agents linked to each other. */
export const AgentsIcon = () => (
  <svg {...base}>
    <path d="M10 5.5 5 13.5M10 5.5l5 8M6.5 15.5h7" opacity="0.35" />
    <circle cx="10" cy="4.5" r="2" />
    <circle cx="4.5" cy="15" r="2" />
    <circle cx="15.5" cy="15" r="2" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const PaperclipIcon = () => (
  <svg {...base}>
    <path d="M16.5 9.5 10 16a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.3-6.3" />
  </svg>
);

export const SmileIcon = () => (
  <svg {...base}>
    <circle cx="10" cy="10" r="7" />
    <path d="M7 11.5a3.5 3.5 0 0 0 6 0" />
    <path d="M7.5 8h.01M12.5 8h.01" strokeWidth="2" />
  </svg>
);

/** Send: an arrow that leaves upward. */
export const SendIcon = () => (
  <svg {...base}>
    <path d="M10 16V4M5 9l5-5 5 5" />
  </svg>
);

export const PauseIcon = () => (
  <svg {...base}>
    <path d="M7 4.5v11M13 4.5v11" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base}>
    <path d="m5 5 10 10M15 5 5 15" />
  </svg>
);

/** Two arrows chasing each other: refresh. */
export const RefreshIcon = () => (
  <svg {...base}>
    <path d="M16 10a6 6 0 0 1-10.4 4M4 10a6 6 0 0 1 10.4-4" />
    <path d="M14.5 2.5V6H11M5.5 17.5V14H9" />
  </svg>
);
