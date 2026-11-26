import { REPO } from '../content';
import { Button } from '../Section';

const LINKS = [
  { href: '#usage', label: 'Usage' },
  { href: '#threads', label: 'Threads' },
  { href: '#control', label: 'Control' },
  { href: '#tools', label: 'Tools' },
];

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-rail/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-4 md:px-6">
        <a href="#top" className="flex items-center gap-3 font-heading text-lg font-semibold text-ink">
          <img src="/logo.png" alt="" width="28" height="28" className="size-7" />
          Ark
        </a>
        <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-[15px] text-body transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <Button href={REPO}>View on GitHub</Button>
      </div>
    </header>
  );
}
