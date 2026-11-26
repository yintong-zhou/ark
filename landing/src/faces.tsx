import type { ReactNode } from 'react';

// The agents' faces: small robots drawn from a few parts (head, eyes, mouth, accessory), brand neutrals only.
// Eyes live in a `.blink` group (see index.css), so every face blinks now and then; ids stay face-01..face-24.
const dark = '#0E1013';
const light = '#DEE1E6';
const white = '#FAFAF9';

type Head = 'squircle' | 'round' | 'tall' | 'wide' | 'chamfer' | 'egg';
type Eyes = 'dots' | 'ovals' | 'wide' | 'cyclops' | 'visor' | 'sleepy';
type Mouth = 'smile' | 'flat' | 'o' | 'grille' | 'smirk' | 'none';
type Extra = 'none' | 'antenna' | 'ears' | 'phones' | 'tuft' | 'beanie' | 'glasses' | 'cat' | 'sprout' | 'band' | 'horns' | 'bolt';

const HEADS: Record<Head, { shape: ReactNode; y: number }> = {
  squircle: { shape: <rect x="7" y="9" width="26" height="26" rx="9" fill={light} />, y: 22 },
  round: { shape: <circle cx="20" cy="21" r="14" fill={light} />, y: 21 },
  tall: { shape: <rect x="9" y="6" width="22" height="30" rx="11" fill={light} />, y: 21 },
  wide: { shape: <rect x="5" y="12" width="30" height="23" rx="10" fill={light} />, y: 23 },
  chamfer: { shape: <path d="M14 7h12l9 9v11l-9 9H14l-9-9V16z" fill={light} />, y: 21 },
  egg: { shape: <ellipse cx="20" cy="22" rx="13" ry="15" fill={light} />, y: 22 },
};

const eyes = (kind: Eyes, y: number): ReactNode => {
  switch (kind) {
    case 'dots': return <g className="blink"><circle cx="14.5" cy={y} r="2.2" fill={dark} /><circle cx="25.5" cy={y} r="2.2" fill={dark} /></g>;
    case 'ovals': return <g className="blink"><ellipse cx="14.5" cy={y} rx="2" ry="3.3" fill={dark} /><ellipse cx="25.5" cy={y} rx="2" ry="3.3" fill={dark} /><circle cx="15.2" cy={y - 1.2} r="0.8" fill={white} /><circle cx="26.2" cy={y - 1.2} r="0.8" fill={white} /></g>;
    case 'wide': return <g className="blink"><ellipse cx="14" cy={y} rx="3" ry="2.4" fill={dark} /><ellipse cx="26" cy={y} rx="3" ry="2.4" fill={dark} /></g>;
    case 'cyclops': return <g className="blink"><ellipse cx="20" cy={y} rx="5" ry="4.6" fill={dark} /><circle cx="21.5" cy={y - 1.5} r="1.4" fill={white} /></g>;
    case 'visor': return <><rect x="9.5" y={y - 5.5} width="21" height="11" rx="5.5" fill={dark} /><g className="blink"><ellipse cx="15.5" cy={y} rx="2.2" ry="2.8" fill={white} /><ellipse cx="24.5" cy={y} rx="2.2" ry="2.8" fill={white} /></g></>;
    case 'sleepy': return <g className="blink"><path d={`M12 ${y}q2.5 -3 5 0M23 ${y}q2.5 -3 5 0`} fill="none" stroke={dark} strokeWidth="2" strokeLinecap="round" /></g>;
  }
};

const mouth = (kind: Mouth, y: number): ReactNode => {
  const m = y + 6.5;
  switch (kind) {
    case 'smile': return <path d={`M16.5 ${m}Q20 ${m + 3} 23.5 ${m}`} fill="none" stroke={dark} strokeWidth="1.6" strokeLinecap="round" />;
    case 'flat': return <path d={`M17 ${m + 1}h6`} stroke={dark} strokeWidth="1.8" strokeLinecap="round" />;
    case 'o': return <ellipse cx="20" cy={m + 1} rx="1.8" ry="2.2" fill={dark} />;
    case 'grille': return <path d={`M16.5 ${m}h7M16.5 ${m + 2.4}h7`} stroke={dark} strokeWidth="1.4" strokeLinecap="round" />;
    case 'smirk': return <path d={`M16 ${m + 1}Q21 ${m + 3.5} 25 ${m - 1}`} fill="none" stroke={dark} strokeWidth="1.6" strokeLinecap="round" />;
    case 'none': return null;
  }
};

/** Accessories: `back` is drawn behind the head, `front` over it. */
const extras = (kind: Extra, y: number): { back?: ReactNode; front?: ReactNode } => {
  switch (kind) {
    case 'none': return {};
    case 'antenna': return { back: <><path d="M20 9V3.5" stroke={light} strokeWidth="2" strokeLinecap="round" /><circle cx="20" cy="3.5" r="2.2" fill={white} /></> };
    case 'ears': return { back: <><rect x="2.5" y={y - 4} width="6" height="9" rx="3" fill={light} /><rect x="31.5" y={y - 4} width="6" height="9" rx="3" fill={light} /></> };
    case 'phones': return {
      back: <path d="M7.5 19Q7.5 4 20 4Q32.5 4 32.5 19" fill="none" stroke={light} strokeWidth="2.5" />,
      front: <><rect x="3.5" y="17" width="6" height="10" rx="3" fill={dark} stroke={light} /><rect x="30.5" y="17" width="6" height="10" rx="3" fill={dark} stroke={light} /></>,
    };
    case 'tuft': return { front: <path d="M20 9Q16 2 12 4M20 9Q24 1 29 3" fill="none" stroke={light} strokeWidth="2.2" strokeLinecap="round" /> };
    case 'beanie': return { front: <><path d="M8 16Q8 6 20 6Q32 6 32 16Z" fill={dark} /><path d="M9 14h22" stroke={light} strokeWidth="1.5" opacity="0.5" /><circle cx="20" cy="5" r="2.6" fill={white} /></> };
    case 'glasses': return { front: <><circle cx="14.5" cy={y} r="5.2" fill="none" stroke={dark} strokeWidth="1.5" /><circle cx="25.5" cy={y} r="5.2" fill="none" stroke={dark} strokeWidth="1.5" /><path d={`M19.7 ${y}h0.6M9.3 ${y - 1}L7 ${y - 2}M30.7 ${y - 1}L33 ${y - 2}`} stroke={dark} strokeWidth="1.5" /></> };
    case 'cat': return { back: <><path d="M8 15L9 3l9 6Z" fill={light} /><path d="M32 15L31 3l-9 6Z" fill={light} /></> };
    case 'sprout': return { back: <><path d="M20 9V5" stroke={light} strokeWidth="1.8" strokeLinecap="round" /><path d="M20 5Q20 1 25 1.5Q25 6 20 5ZM20 6Q20 2.5 15 3Q15 7 20 6Z" fill={white} /></> };
    case 'band': return { front: <path d="M7.5 15.5Q20 11 32.5 15.5" fill="none" stroke={dark} strokeWidth="3" /> };
    case 'horns': return { back: <><path d="M10 12L7 3l8 5Z" fill={white} /><path d="M30 12l3-9-8 5Z" fill={white} /></> };
    case 'bolt': return { front: <path d="M21.5 4L16 12h4l-1.5 6 6-8h-4Z" fill={white} /> };
  }
};

const face = (head: Head, eyeKind: Eyes, mouthKind: Mouth, extra: Extra): ReactNode => {
  const { shape, y } = HEADS[head];
  const { back, front } = extras(extra, y);
  return <>{back}{shape}{eyes(eyeKind, y)}{mouth(mouthKind, y)}{front}</>;
};

const ROSTER: [Head, Eyes, Mouth, Extra][] = [
  ['squircle', 'dots', 'smile', 'antenna'],
  ['round', 'ovals', 'smile', 'cat'],
  ['wide', 'visor', 'none', 'ears'],
  ['tall', 'dots', 'smirk', 'beanie'],
  ['round', 'cyclops', 'smile', 'none'],
  ['squircle', 'ovals', 'flat', 'glasses'],
  ['egg', 'wide', 'smile', 'sprout'],
  ['chamfer', 'dots', 'grille', 'antenna'],
  ['squircle', 'sleepy', 'smile', 'band'],
  ['wide', 'ovals', 'o', 'phones'],
  ['egg', 'dots', 'smile', 'ears'],
  ['chamfer', 'visor', 'none', 'horns'],
  ['tall', 'wide', 'flat', 'tuft'],
  ['round', 'dots', 'o', 'bolt'],
  ['squircle', 'cyclops', 'grille', 'cat'],
  ['wide', 'dots', 'smirk', 'beanie'],
  ['tall', 'ovals', 'smile', 'phones'],
  ['chamfer', 'sleepy', 'flat', 'none'],
  ['egg', 'visor', 'none', 'antenna'],
  ['round', 'wide', 'smirk', 'band'],
  ['squircle', 'dots', 'smile', 'sprout'],
  ['tall', 'cyclops', 'o', 'ears'],
  ['wide', 'sleepy', 'smile', 'tuft'],
  ['chamfer', 'ovals', 'smirk', 'glasses'],
];

export const FACE: Record<string, ReactNode> = {
  ...Object.fromEntries(ROSTER.map((parts, i) => [`face-${String(i + 1).padStart(2, '0')}`, face(...parts)])),
  // The Head of Staff is an emblem, not a face: a compass whose centre blinks like the others' eyes.
  'face-head': <><path d="M20 3 24 8 31 7 32 14 36 19 32 24 31 32 24 32 20 37 16 32 9 32 8 24 4 19 8 14 9 7 16 8Z" fill={white} /><circle cx="20" cy="20" r="11" fill={dark} /><path d="M14 20h12 M20 14v12" stroke={light} strokeWidth="2" /><g className="blink"><circle cx="20" cy="20" r="3" fill={white} /></g></>,
};
