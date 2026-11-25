import { motion, useReducedMotion } from 'motion/react';
import { SLOW } from '../motion';

/** Usage bar: Raised track, Light neutral fill, and optional ticks (handoff threshold, weekly pace). */
export function Bar({ pct, ticks = [], wide = false, label }: { pct?: number; ticks?: number[]; wide?: boolean; label: string }) {
  const reduced = useReducedMotion(); // clip-path is not covered by MotionConfig's reduced-motion policy
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`relative h-1 shrink-0 rounded-xs bg-raised ${wide ? 'w-13' : 'w-8'}`}
    >
      {pct !== undefined && (
        // a full-width fill, uncovered from the left: animates a clip, not the width
        <motion.div
          className="h-full rounded-xs bg-neutral-light"
          initial={reduced ? false : { clipPath: 'inset(0 100% 0 0 round 4px)' }}
          animate={{ clipPath: `inset(0 ${100 - Math.min(100, Math.max(0, pct))}% 0 0 round 4px)` }}
          transition={reduced ? { duration: 0 } : SLOW}
        />
      )}
      {ticks.map((t) => (
        <span key={t} className="absolute -top-[4px] -bottom-[4px] w-[2px] bg-secondary" style={{ left: `calc(${t}% - 1px)` }} />
      ))}
    </div>
  );
}
