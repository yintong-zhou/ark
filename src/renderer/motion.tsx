import { useEffect, type ReactNode } from 'react';
import { animate, LayoutGroup, motion, MotionConfig, useMotionValue, useReducedMotion, useTransform, type Transition } from 'motion/react';

/**
 * Ark's motion: one easing curve and three durations. Motion only explains something - where a
 * selection went, what just arrived, how a figure changed - and never loops (except presence).
 * `reducedMotion="user"` turns transforms off for people who asked the system for less.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const FAST: Transition = { duration: 0.12, ease: EASE }; // feedback
export const ENTER: Transition = { duration: 0.2, ease: EASE }; // things that appear
export const SLOW: Transition = { duration: 0.6, ease: EASE }; // figures and gauges
/** The sliding highlight behind a selection (rail, sidebar rows, tabs). */
export const SLIDE: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 };

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={ENTER}>{children}</MotionConfig>;
}

/** Content that arrives: a short fade and a few pixels of rise. */
export function Reveal({ children, className, delay = 0, y = 6 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTER, delay }}>
      {children}
    </motion.div>
  );
}

/** A list whose children arrive one after another (at most ~12 steps, so long lists do not crawl). */
export function Stagger({ children, className, step = 0.03 }: { children: ReactNode; className?: string; step?: number }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: step } } }}>
      {children}
    </motion.div>
  );
}
export const staggerItem = {
  variants: { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: ENTER } },
};

/** The highlight that glides between the selected items of one group; render it inside the selected item. */
export function Highlight({ group, className }: { group: string; className: string }) {
  return <motion.span aria-hidden layoutId={`hl-${group}`} transition={SLIDE} className={className} />;
}
export { LayoutGroup };

/** A figure that counts from its previous value to the new one; it just changes under reduced motion. */
export function Tween({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);
  useEffect(() => {
    if (reduced) { mv.set(value); return; }
    const controls = animate(mv, value, SLOW);
    return () => controls.stop();
  }, [mv, value, reduced]);
  return <motion.span>{text}</motion.span>;
}
