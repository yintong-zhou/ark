import { useState } from 'react';
import type { AgentStatus, UsageState, UsageWindow } from '@shared/types';
import { formatDuration, staleAge, windowView } from '@shared/usage-math';
import { Bar } from './Bar';
import { RefreshIcon } from './Icons';
import { EngineLogo } from './Logos';

/**
 * The always-visible bottom strip: "Used", then for each agent its mark, the 5-hour bar, and the
 * 5-hour and weekly readings (percent used, time to reset); a button on the right refreshes them.
 */
export function StatusBar({ state, now, refresh }: { state: UsageState | null; now: number; refresh: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false);
  const agents = state?.agents.filter((a) => a.installed) ?? [];
  const onRefresh = async () => {
    setRefreshing(true);
    await refresh().finally(() => setRefreshing(false));
  };
  return (
    <footer className="flex h-4 shrink-0 items-center gap-3 border-t border-divider bg-primary px-2 text-meta text-muted">
      <span>Used</span>
      {agents.map((a) => (
        <AgentUsage key={a.id} a={a} state={state} now={now} />
      ))}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh usage"
        title="Refresh usage"
        className="ml-auto flex size-3 items-center justify-center rounded-xs hover:text-secondary [&_svg]:size-2"
      >
        <span className={refreshing ? 'motion-safe:animate-spin' : ''}><RefreshIcon /></span>
      </button>
    </footer>
  );
}

function AgentUsage({ a, state, now }: { a: AgentStatus; state: UsageState | null; now: number }) {
  const five = windowView(a.fiveHour, now);
  const age = staleAge(a.updatedAt, now);
  const sessions = state?.sessions.filter((s) => s.agent === a.id) ?? [];
  return (
    <span className="flex items-center gap-1" title={a.id === 'claude' ? 'Claude Code' : a.id === 'codex' ? 'Codex' : 'OpenCode'}>
      <EngineLogo id={a.id} />
      {a.account?.method === 'apiKey' ? (
        <ApiKeyTotals tokens={sum(sessions.map((s) => s.tokens))} cost={sum(sessions.map((s) => s.costUsd))} />
      ) : (
        <>
          <Bar label="5 hours" wide pct={five.kind === 'live' ? five.pct : undefined} />
          <Reading title="5-hour window" w={a.fiveHour} now={now} />
          <span aria-hidden className="h-[12px] w-px bg-divider" />
          <Reading title="Weekly window" w={a.weekly} now={now} />
          {age && <span title={`Reading from ${age} ago`}>🕓 {age}</span>}
        </>
      )}
    </span>
  );
}

/** One window as "50% 3h 23m": how much is used, and how long until it resets. */
function Reading({ title, w, now }: { title: string; w?: UsageWindow; now: number }) {
  const v = windowView(w, now);
  return (
    <span title={title} className="flex gap-[4px]">
      {v.kind === 'live' ? (
        <>
          <span className="text-secondary">{Math.round(v.pct)}%</span>
          <span>{formatDuration(v.resetIn)}</span>
        </>
      ) : (
        <span>{v.kind === 'reset' ? 'reset' : '—'}</span>
      )}
    </span>
  );
}

const sum = (xs: (number | undefined)[]) => xs.reduce<number | undefined>((t, x) => (x === undefined ? t : (t ?? 0) + x), undefined);

export function ApiKeyTotals({ tokens, cost }: { tokens?: number; cost?: number }) {
  return (
    <span className="flex gap-1">
      {tokens !== undefined && <span>{tokens.toLocaleString('en-US')} tokens</span>}
      {cost !== undefined && <span>${cost.toFixed(2)}</span>}
      {tokens === undefined && cost === undefined && <span>API key</span>}
    </span>
  );
}
