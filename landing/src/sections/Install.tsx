import { useState } from 'react';
import { BUILD_STEPS, REPO } from '../content';
import { Icon } from '../Icon';
import { Button, Section } from '../Section';

export function Install() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BUILD_STEPS.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the commands stay selectable on the page.
    }
  };
  return (
    <Section id="install">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
        <div className="min-w-0">
          <h2 className="max-w-[16ch] text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.015em]">Bring your agents together.</h2>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-7">
            Ark is free and open source. A packaged release is not published yet, so for now you build the Windows installer yourself.
          </p>
          <div className="mt-8">
            <Button href={REPO}>View on GitHub</Button>
          </div>
          <ul className="mt-8 grid gap-1 text-sm text-muted">
            <li>Windows, with Node.js 22 or newer.</li>
            <li>Runs Claude Code and Codex. OpenCode is detected; running it from Ark is on hold.</li>
            <li>MIT license.</li>
          </ul>
        </div>
        <div className="min-w-0 self-start rounded-frame bg-sidebar p-4 md:p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Build from source</p>
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-control px-3 text-sm text-body transition-colors hover:bg-raised hover:text-ink"
            >
              <Icon name={copied ? 'check' : 'copy'} className="text-current" />
              {copied ? 'Copied' : 'Copy commands'}
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-control bg-rail p-4 font-mono text-[13px] leading-6 text-body shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]">
            {BUILD_STEPS.join('\n')}
          </pre>
          <p className="mt-3 text-xs text-muted">The installer is written to the dist folder.</p>
        </div>
      </div>
    </Section>
  );
}
