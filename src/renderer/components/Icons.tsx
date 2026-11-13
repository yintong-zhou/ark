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

/** Back and forward in the page history. */
export const ArrowIcon = ({ dir }: { dir: 'back' | 'forward' }) => (
  <svg {...base}>
    <path d={dir === 'back' ? 'M16 10H4m5-5-5 5 5 5' : 'M4 10h12m-5-5 5 5-5 5'} />
  </svg>
);

/** Three usage bars: the track, the fill and a different reading on each. */
export const UsageIcon = () => (
  <svg {...base}>
    <path d="M3 5h14M3 10h14M3 15h14" opacity="0.35" />
    <path d="M3 5h9M3 10h5M3 15h11" />
  </svg>
);

/** Navigation symbols for the sidebar. */
export const NavIcon = ({ kind }: { kind: 'history' | 'accounts' | 'status' | 'catalog' }) => (
  <svg {...base}>
    {kind === 'history' && <><circle cx="10" cy="10" r="7" opacity="0.5" /><path d="M10 5.5v5l3 2" /></>}
    {kind === 'accounts' && <><circle cx="10" cy="6.5" r="3" /><path d="M4 16c.5-3 2.5-4.5 6-4.5s5.5 1.5 6 4.5" /></>}
    {kind === 'status' && <><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M5.5 12.5h9" /></>}
    {kind === 'catalog' && <><rect x="3.5" y="3.5" width="5" height="5" rx="1" /><rect x="11.5" y="3.5" width="5" height="5" rx="1" /><rect x="3.5" y="11.5" width="5" height="5" rx="1" /><rect x="11.5" y="11.5" width="5" height="5" rx="1" /></>}
  </svg>
);

/** A prompt and a cursor in a window. */
export const TerminalIcon = () => (
  <svg {...base}>
    <rect x="2.5" y="4" width="15" height="12" rx="1.5" opacity="0.35" />
    <path d="m6 8 2.5 2L6 12M10.5 12.5H14" />
  </svg>
);

/** A simple globe, readable at toolbar size. */
export const GlobeIcon = () => (
  <svg {...base}>
    <circle cx="10" cy="10" r="7" />
    <ellipse cx="10" cy="10" rx="3" ry="7" />
    <path d="M3 10h14" />
  </svg>
);

export const ThreadIcon = () => (
  <svg {...base}><path d="M3.5 4.5h13v9h-8l-4 3v-3h-1z" /><path d="M6.5 8h7M6.5 10.5h5" opacity="0.55" /></svg>
);

export const ExplorerIcon = () => (
  <svg {...base}><path d="M7 3h6l3 3v10H7zM13 3v3h3M4 6v11h9" /></svg>
);

export const GitBranchIcon = () => (
  <svg {...base}><circle cx="6" cy="4.5" r="1.5" /><circle cx="6" cy="15.5" r="1.5" /><circle cx="14" cy="4.5" r="1.5" /><path d="M6 6v8M14 6v1c0 2.5-2 3-4 3H6" /></svg>
);

/** Back and forward in the browser's history. */
export const BackIcon = () => (
  <svg {...base}>
    <path d="M16 10H4M9 5l-5 5 5 5" />
  </svg>
);
export const ForwardIcon = () => (
  <svg {...base}>
    <path d="M4 10h12M11 5l5 5-5 5" />
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

/** Sliders: the settings. */
export const SettingsIcon = () => (
  <svg {...base}>
    <path d="M3 6h14M3 14h14" opacity="0.35" />
    <circle cx="7" cy="6" r="2" />
    <circle cx="13" cy="14" r="2" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const NewFileIcon = () => (
  <svg {...base}>
    <path d="M11 3H5.5v14H12M11 3l3.5 3.5H11zM14.5 10v7M11 13.5h7" />
  </svg>
);

export const NewFolderIcon = () => (
  <svg {...base}>
    <path d="M11.5 16.5H3V5h5l1.5 1.5H17v3M15 11v6M12 14h6" />
  </svg>
);

/** Unstage: the plus without its upright. */
export const MinusIcon = () => (
  <svg {...base}>
    <path d="M4 10h12" />
  </svg>
);

/** Discard: an arrow turning back counter-clockwise. */
export const DiscardIcon = () => (
  <svg {...base}>
    <path d="M4.5 11a5.5 5.5 0 1 0 1.6-3.9L4 9.2" />
    <path d="M4 5v4.2h4.2" />
  </svg>
);

/** Open file: a page with a folded corner. */
export const FileIcon = () => (
  <svg {...base}>
    <path d="M11.5 3H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5V7z" />
    <path d="M11.5 3v4h4" opacity="0.35" />
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

export const TasksIcon = () => (
  <svg {...base}>
    <rect x="3" y="3.5" width="14" height="13" rx="2" opacity="0.45" />
    <path d="m6 8 1 1 2-2M11 8h3M6 12.5h3M11 12.5h3" />
  </svg>
);

export const EditIcon = () => (
  <svg {...base}><path d="m12.5 4 3.5 3.5M4 16l1-4L13.5 3.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L8 15z" /></svg>
);

export const TrashIcon = () => (
  <svg {...base}><path d="M3.5 5.5h13M7 5.5V3h6v2.5M5 5.5l1 11h8l1-11M8 9v4M12 9v4" /></svg>
);

/** Two arrows chasing each other: refresh. */
export const RefreshIcon = () => (
  <svg {...base}>
    <path d="M16 10a6 6 0 0 1-10.4 4M4 10a6 6 0 0 1 10.4-4" />
    <path d="M14.5 2.5V6H11M5.5 17.5V14H9" />
  </svg>
);

/** Fetch: an arrow down inside a faint ring, since it brings the remote's news without touching the branch. */
export const FetchIcon = () => (
  <svg {...base}>
    <circle cx="10" cy="10" r="7" opacity="0.35" />
    <path d="M10 6.5v6M7 10l3 3 3-3" />
  </svg>
);

/** Pull: an arrow down onto a line. */
export const PullIcon = () => (
  <svg {...base}>
    <path d="M10 3.5v9M6 8.5l4 4 4-4M4.5 16.5h11" />
  </svg>
);

/** Push: an arrow up off a line. */
export const PushIcon = () => (
  <svg {...base}>
    <path d="M10 12.5v-9M6 7.5l4-4 4 4M4.5 16.5h11" />
  </svg>
);

/** Token kinds, drawn small next to their counts: in to the model, read back from its cache, out of the model. */
export const TokenIcon = ({ kind }: { kind: 'input' | 'cached' | 'output' }) => (
  <svg {...base} width={12} height={12} strokeWidth={1.75}>
    {kind === 'input' && <><path d="M10 3v9m-3.5-3.5L10 12l3.5-3.5" /><path d="M4 13v3h12v-3" /></>}
    {kind === 'cached' && <><ellipse cx="10" cy="5" rx="6" ry="2.5" /><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></>}
    {kind === 'output' && <><path d="M10 12V3M6.5 6.5 10 3l3.5 3.5" /><path d="M4 13v3h12v-3" /></>}
  </svg>
);

/** The access mode: a shield that waits (ask), that checks for you (auto), or that lets everything through (full). */
export const AccessIcon = ({ mode }: { mode: 'ask' | 'auto' | 'full' }) => (
  <svg {...base}>
    <path d={mode === 'full' ? 'M10 3 4.5 5v4.5c0 3.2 2.3 5.8 5.5 7.5 3.2-1.7 5.5-4.3 5.5-7.5V5' : 'M10 3 4.5 5v4.5c0 3.2 2.3 5.8 5.5 7.5 3.2-1.7 5.5-4.3 5.5-7.5V5z'} />
    {mode === 'ask' && <path d="M10 7.5v3M10 13h.01" />}
    {mode === 'auto' && <path d="m7.5 10 1.8 1.8 3.2-3.3" />}
    {mode === 'full' && <path d="M10 6.5v6" opacity="0.55" />}
  </svg>
);

/** A small caret for a control that opens a menu. */
export const ChevronIcon = () => (
  <svg {...base} width={12} height={12} strokeWidth={1.75}>
    <path d="m5 8 5 5 5-5" />
  </svg>
);
