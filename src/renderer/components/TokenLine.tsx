import type { TokenCount } from '@shared/types';

const nf = new Intl.NumberFormat('en-US');

/** How a token count reads under a message and in the team panel: three emoji and their numbers. */
export function TokenLine({ tokens }: { tokens: TokenCount }) {
  return (
    <span className="flex flex-wrap gap-x-1 text-meta text-muted">
      <span title="Input tokens">📥 {nf.format(tokens.input)}</span>
      <span title="Cached tokens">💾 {nf.format(tokens.cached)}</span>
      <span title="Output tokens">📤 {nf.format(tokens.output)}</span>
    </span>
  );
}
