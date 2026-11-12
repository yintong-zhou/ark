import type { ReactNode } from 'react';

const head = <rect x="7" y="8" width="26" height="27" rx="12" fill="#DEE1E6" />;
const eyes = <><circle cx="15" cy="21" r="2" fill="#0E1013" /><circle cx="25" cy="21" r="2" fill="#0E1013" /></>;
const smile = <path d="M16 27 Q20 30 24 27" fill="none" stroke="#0E1013" strokeWidth="1.5" strokeLinecap="round" />;
const base = <>{head}{eyes}{smile}</>;
const dark = '#0E1013';
const light = '#DEE1E6';
const white = '#FAFAF9';

export const FACE: Record<string, ReactNode> = {
  'face-01': <>{base}<path d="M8 16 Q8 7 20 7 Q30 7 32 16 L27 13 22 15 18 12 13 15Z" fill={dark} /></>,
  'face-02': <>{base}<path d="M10 12 Q4 9 8 4 L15 10 M30 12 Q36 9 32 4 L25 10" fill={light} stroke={dark} /></>,
  'face-03': <>{head}<rect x="10" y="17" width="20" height="9" rx="4" fill={dark} /><path d="M14 19h4 M22 19h4" stroke={white} strokeWidth="2" />{smile}</>,
  'face-04': <>{base}<path d="M9 16 Q9 6 20 6 Q31 6 31 16 Q25 10 20 15 Q15 10 9 16Z" fill={dark} /><circle cx="20" cy="7" r="3" fill={white} /></>,
  'face-05': <>{head}<circle cx="20" cy="21" r="6" fill={dark} /><circle cx="20" cy="21" r="2" fill={white} />{smile}</>,
  'face-06': <>{base}<path d="M7 20h4 M29 20h4" stroke={dark} strokeWidth="2" /><circle cx="15" cy="21" r="5" fill="none" stroke={dark} strokeWidth="1.5" /><circle cx="25" cy="21" r="5" fill="none" stroke={dark} strokeWidth="1.5" /><path d="M20 21h0" stroke={dark} strokeWidth="2" /></>,
  'face-07': <>{base}<path d="M13 9 15 3 20 7 25 3 27 9" fill={light} stroke={dark} strokeWidth="1.5" /></>,
  'face-08': <>{base}<path d="M20 8V3 M17 3h6" stroke={light} strokeWidth="2" strokeLinecap="round" /></>,
  'face-09': <>{base}<path d="M8 14 Q12 4 18 10 Q25 4 32 14 L28 17 13 17Z" fill={dark} /><path d="M12 13h16" stroke={white} /></>,
  'face-10': <>{head}<path d="M11 20h7 M22 20h7" stroke={dark} strokeWidth="3" strokeLinecap="round" /><path d="M17 28h6" stroke={dark} strokeWidth="2" strokeLinecap="round" /></>,
  'face-11': <>{base}<path d="M8 19 Q3 19 4 24 Q4 28 8 28 M32 19 Q37 19 36 24 Q36 28 32 28" fill={light} stroke={dark} /></>,
  'face-12': <>{base}<path d="M9 15 L13 8 17 13 21 6 25 13 30 9 32 16Z" fill={dark} /></>,
  'face-13': <>{base}<path d="M11 9 Q20 2 29 9 L30 14 H10Z" fill={dark} /><path d="M16 9h8" stroke={white} /></>,
  'face-14': <>{head}<path d="M11 20l7 3m11-3-7 3" stroke={dark} strokeWidth="2" strokeLinecap="round" /><circle cx="20" cy="28" r="2" fill={dark} /></>,
  'face-15': <>{base}<path d="M8 15 Q4 4 15 7 M32 15 Q36 4 25 7" fill="none" stroke={light} strokeWidth="3" /></>,
  'face-16': <>{head}{eyes}<path d="M14 28 Q20 23 26 28" fill="none" stroke={dark} strokeWidth="2" /><path d="M11 15l6 1m6 0 6-1" stroke={dark} strokeWidth="2" /></>,
  'face-17': <>{base}<path d="M8 15 Q4 7 11 5 L17 10 M32 15 Q36 7 29 5 L23 10" fill={light} stroke={dark} /><path d="M11 8l3 4m15-4-3 4" stroke={dark} /></>,
  'face-18': <>{head}<rect x="11" y="17" width="18" height="8" rx="2" fill={dark} /><circle cx="15" cy="21" r="1.5" fill={white} /><circle cx="25" cy="21" r="1.5" fill={white} />{smile}<path d="M14 10h12" stroke={white} strokeWidth="2" /></>,
  'face-19': <>{base}<path d="M10 13 Q20 1 30 13 L26 14 Q20 8 14 14Z" fill={dark} /><path d="M20 3v6" stroke={white} /></>,
  'face-20': <>{head}<circle cx="14" cy="21" r="2" fill={dark} /><path d="M23 21h5" stroke={dark} strokeWidth="2" strokeLinecap="round" />{smile}<path d="M9 14 Q18 5 31 14" fill="none" stroke={dark} strokeWidth="4" /></>,
  'face-21': <>{base}<path d="M8 14 Q6 6 13 6 Q17 4 20 9 Q23 4 27 6 Q34 6 32 14" fill={dark} /><circle cx="12" cy="9" r="1" fill={white} /><circle cx="28" cy="9" r="1" fill={white} /></>,
  'face-22': <>{head}{eyes}<path d="M14 27 Q17 24 20 27 Q23 24 26 27 Q23 32 20 28 Q17 32 14 27" fill={dark} /></>,
  'face-23': <>{base}<path d="M8 13 Q20 5 32 13 L30 17 Q20 11 10 17Z" fill={dark} /><circle cx="20" cy="12" r="2" fill={white} /></>,
  'face-24': <>{head}<circle cx="15" cy="21" r="3" fill={dark} /><circle cx="25" cy="21" r="3" fill={dark} /><circle cx="16" cy="20" r="1" fill={white} /><circle cx="26" cy="20" r="1" fill={white} />{smile}<path d="M10 11 Q20 4 30 11" stroke={dark} strokeWidth="3" fill="none" /></>,
  'face-head': <><path d="M20 3 24 8 31 7 32 14 36 19 32 24 31 32 24 32 20 37 16 32 9 32 8 24 4 19 8 14 9 7 16 8Z" fill={white} /><circle cx="20" cy="20" r="11" fill={dark} /><path d="M14 20h12 M20 14v12" stroke={light} strokeWidth="2" /><circle cx="20" cy="20" r="3" fill={white} /></>,
};
