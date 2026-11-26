import { REPO } from '../content';

export function Footer() {
  return (
    <footer className="border-t border-line bg-rail py-10">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 md:px-6">
        <a href="#top" className="flex items-center gap-3 font-heading text-lg font-semibold text-ink">
          <img src="/logo.png" alt="" width="28" height="28" className="size-7" />
          Ark
        </a>
        <p className="text-sm text-muted">Where coding agents work together.</p>
        <a href={REPO} target="_blank" rel="noreferrer" className="text-sm text-body transition-colors hover:text-ink">
          GitHub
        </a>
      </div>
    </footer>
  );
}
