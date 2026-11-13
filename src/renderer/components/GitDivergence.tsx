/** Commits ahead of and behind the upstream branch. */
export function GitDivergence({ ahead, behind }: { ahead: number; behind: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[6px] text-meta text-muted" title={`${ahead} commits ahead, ${behind} behind`} aria-label={`${ahead} commits ahead, ${behind} behind`}>
      {([['up', ahead], ['down', behind]] as const).map(([direction, count]) => (
        <span key={direction} className="inline-flex items-center gap-[2px]">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
            <path d={direction === 'up' ? 'M6 10V2M3 5l3-3 3 3' : 'M6 2v8M3 7l3 3 3-3'} />
          </svg>
          <span aria-hidden="true">{count}</span>
        </span>
      ))}
    </span>
  );
}
