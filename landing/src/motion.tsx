import type { ReactNode } from 'react';
import { MotionConfig, type Transition } from 'motion/react';

/**
 * The same motion language as the app: one easing curve and three durations. Motion only explains
 * something (what arrived, where a selection went, how a figure changed) and never loops, except
 * the speaking dot and the agents' blinking. `reducedMotion="user"` turns transforms off.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const FAST: Transition = { duration: 0.12, ease: EASE };
export const ENTER: Transition = { duration: 0.2, ease: EASE };
export const SLOW: Transition = { duration: 0.6, ease: EASE };
/** The sliding highlight behind a selection. */
export const SLIDE: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 };

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={ENTER}>
      {children}
    </MotionConfig>
  );
}
