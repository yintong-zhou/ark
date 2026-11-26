import type { ReactNode } from 'react';
import { cn } from './cn';

/** One band of the page. Bands are separated by surface tone and a 1px divider, never by shadows. */
export function Section({ id, tone = 'rail', children }: { id?: string; tone?: 'rail' | 'content'; children: ReactNode }) {
  return (
    <section id={id} className={cn('scroll-mt-14 border-t border-line py-16 md:py-[104px]', tone === 'rail' ? 'bg-rail' : 'bg-content')}>
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6">{children}</div>
    </section>
  );
}

/** Heading and one paragraph, left aligned. The paragraph stays under ~65 characters per line. */
export function Intro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-[60ch]">
      <h2 className="text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.015em]">{title}</h2>
      <p className="mt-4 text-[17px] leading-7">{children}</p>
    </div>
  );
}

const base =
  'inline-flex h-11 items-center justify-center gap-2 rounded-control px-5 text-[15px] font-medium transition-colors duration-150 shadow-[inset_0_1px_0_rgb(222_225_230/0.12),0_1px_2px_rgb(0_0_0/0.3)]';

/** The accent is for calls to action: one primary button per view. */
export function Button({ href, kind = 'primary', children }: { href: string; kind?: 'primary' | 'ghost'; children: ReactNode }) {
  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noreferrer' : undefined}
      className={cn(base, kind === 'primary' ? 'bg-accent text-rail hover:brightness-110' : 'bg-raised text-ink hover:bg-raised/70')}
    >
      {children}
    </a>
  );
}
