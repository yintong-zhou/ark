import { REPO } from '../content';
import { Button } from '../Section';
import { ThreadDemo } from './ThreadDemo';

export function Hero() {
  return (
    <section id="top" className="bg-rail pb-16 pt-16 md:pb-[104px] md:pt-[104px]">
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6">
        <h1 className="max-w-[14ch] text-[clamp(2.75rem,8vw,6rem)] leading-[1] tracking-[-0.025em]">Where coding agents work together.</h1>
        <p className="mt-6 max-w-[56ch] text-lg leading-7">
          Ark brings Claude Code and Codex into one desktop app. A team of agents plans with you, then builds in an isolated Git worktree. It runs
          on your own subscriptions, on your own machine.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button href={REPO}>View on GitHub</Button>
          <Button href="#install" kind="ghost">
            Build from source
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted">Windows. Open source, MIT license.</p>
        <ThreadDemo />
      </div>
    </section>
  );
}
