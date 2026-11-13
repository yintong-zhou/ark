import type { TokenCount } from '@shared/types';
import { TokenIcon } from './Icons';

const nf = new Intl.NumberFormat('en-US');
const KINDS = [
  ['input', 'Input tokens, cached included'],
  ['cached', 'Cached tokens'],
  ['output', 'Output tokens'],
] as const;

/** How a token count reads under a message and in the team panel: a line icon per kind and its number. */
export function TokenLine({ tokens }: { tokens: TokenCount }) {
  return (
    <span className="flex flex-wrap gap-x-[8px] text-meta text-muted">
      {KINDS.map(([kind, label]) => (
        <span key={kind} title={label} className="inline-flex items-center gap-[2px]">
          <TokenIcon kind={kind} />
          <span className="sr-only">{label}:</span>
          {nf.format(tokens[kind])}
        </span>
      ))}
    </span>
  );
}
