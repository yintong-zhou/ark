import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { Intro, Section } from '../Section';
import { EASE } from '../motion';

// The line diagram of how a thread works. The line draws itself once, as it scrolls into view.
const STEPS = [
  { title: 'You describe the work', text: 'Say what you want in plain words. Attach files or images if it helps.', node: <Icon name="user" className="text-ink" /> },
  {
    title: 'The Head of Staff picks the team',
    text: 'It reads your request and proposes planners, builders and reviewers from your own catalog of agents.',
    node: <Avatar face="face-head" size={40} />,
  },
  {
    title: 'The team plans with you',
    text: 'One agent speaks at a time. When a decision is yours, the thread waits and tags you.',
    node: (
      <span className="flex -space-x-2">
        <Avatar face="face-04" size={28} />
        <Avatar face="face-02" size={28} />
      </span>
    ),
  },
  {
    title: 'Builders work in isolation',
    text: 'The build happens in a Git worktree on its own branch, ark/<title>-<id>. Your project folder is not touched.',
    node: <Icon name="branch" className="text-ink" />,
  },
  {
    title: 'Checks and reviews, then you merge',
    text: 'Typecheck, lint and tests run after each turn. A code reviewer and a security reviewer look at the result. You decide when to merge.',
    node: <Icon name="check" className="text-ink" />,
  },
];

export function Threads() {
  const ref = useRef<HTMLOListElement>(null);
  const go = useInView(ref, { once: true, amount: 0.3 });
  const draw = { duration: 1.2, ease: EASE };
  return (
    <Section id="threads" tone="content">
      <Intro title="A team plans, then builds.">
        A thread is one piece of work: a conversation between you and the agents you chose. It keeps its transcript on disk, so it survives closing
        Ark.
      </Intro>
      <ol ref={ref} className="relative mt-14 grid gap-10 md:grid-cols-5 md:gap-6">
        {/* The line behind the nodes: vertical on a phone, horizontal from md up. */}
        <motion.span
          aria-hidden
          className="absolute bottom-6 left-5 top-5 w-px origin-top bg-body/40 md:hidden"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: go ? 1 : 0 }}
          transition={draw}
        />
        <motion.span
          aria-hidden
          className="absolute left-[10%] right-[10%] top-5 hidden h-px origin-left bg-body/40 md:block"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: go ? 1 : 0 }}
          transition={draw}
        />
        {STEPS.map((s) => (
          <li key={s.title} className="relative flex gap-4 md:flex-col md:items-center">
            <span className="relative z-10 grid h-10 min-w-10 shrink-0 place-items-center rounded-full bg-raised px-1">{s.node}</span>
            <div className="md:mt-1 md:text-center">
              <h3 className="text-lg leading-6">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-6">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
