import type { UsageWindow } from '@shared/types';
import { formatDuration, staleAge, windowView } from '@shared/usage-math';
import { Bar } from './Bar';

/**
 * One 5-hour or weekly window: bar, percentage, time to reset. Never shows a stale percentage,
 * and says how old the reading is once it's older than 15 minutes.
 */
export function WindowCell({ w, now, label, updatedAt }: { w?: UsageWindow; now: number; label: string; updatedAt?: number }) {
  const v = windowView(w, now);
  if (v.kind === 'none') return <span className="text-muted">—</span>;
  if (v.kind === 'reset') return <span className="text-muted">reset, awaiting data</span>;
  const age = staleAge(updatedAt, now);
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <Bar label={label} pct={v.pct} ticks={v.pace !== undefined ? [v.pace] : []} />
      <span className="w-5 text-right text-secondary">{Math.round(v.pct)}%</span>
      <span className="text-muted">{formatDuration(v.resetIn)}</span>
      {age && <span className="text-muted">as of {age} ago</span>}
    </span>
  );
}
