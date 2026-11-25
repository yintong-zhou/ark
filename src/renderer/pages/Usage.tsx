import { useEffect, useState, type ReactNode } from 'react';
import type { EngineId } from '@shared/agent-file';
import type { AgentStatus, Session, StatuslineStatus, UsageState, UsageWindow, ViewMode } from '@shared/types';
import { formatAge, formatDuration, sessionState, staleAge, windowView } from '@shared/usage-math';
import { AGENT_NAME, type Navigate } from '../agents';
import { AgentTag } from '../components/AgentTag';
import { RefreshIcon } from '../components/Icons';
import { Bar } from '../components/Bar';
import { Page } from '../components/Page';
import { ApiKeyTotals } from '../components/StatusBar';
import { CTA, ICON_BUTTON } from '../components/ui';
import { WindowCell } from '../components/WindowCell';
import { Tween } from '../motion';

type Props = { state: UsageState | null; now: number; refresh: () => Promise<void>; onNavigate: Navigate };

const TH = 'py-1 pr-2 text-left text-meta font-normal text-muted';

export function Usage({ state, now, refresh, onNavigate }: Props) {
  const [view, setView] = useState<ViewMode>('compact');
  const [statusline, setStatusline] = useState<StatuslineStatus>('connected');
  const [refreshing, setRefreshing] = useState(false);
  const [thresholds, setThresholds] = useState<Record<EngineId, number>>({ claude: 40, codex: 40 });
  useEffect(() => {
    window.ark.settings.getView().then(setView);
    window.ark.settings.getHandoffThresholds().then(setThresholds).catch(() => {});
    window.ark.statusline.status().then(setStatusline);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh().finally(() => setRefreshing(false));
  };

  const agents = state?.agents ?? [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const live = (state?.sessions ?? [])
    .filter((s) => ['active', 'idle'].includes(sessionState(s.lastSeen, now)))
    .sort((a, b) => b.lastSeen - a.lastSeen);
  const claudeInstalled = byId.get('claude')?.installed;

  return (
    <Page
      title="Usage"
      meta={['Context and limits of the agents on this machine']}
      actions={
        <>
          <button onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing' : 'Refresh'} title="Refresh" className={ICON_BUTTON}>
            <RefreshIcon />
          </button>
        </>
      }
    >
      {claudeInstalled && statusline !== 'connected' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-raised p-2">
          <span>Claude Code sessions aren&apos;t reported yet.</span>
          <button onClick={() => onNavigate({ name: 'settings' })} className={CTA}>Open settings</button>
        </div>
      )}

      {state === null ? (
        <p className="text-muted">Looking for agents on this machine.</p>
      ) : view === 'compact' ? (
        <>
          <AgentLimits agents={agents} now={now} onNavigate={onNavigate} compact />
          <section className="flex flex-col gap-1">
            <h2 className="font-body text-meta font-normal text-muted">Open sessions</h2>
            <CompactTable sessions={live} byId={byId} now={now} onNavigate={onNavigate} thresholds={thresholds} />
          </section>
        </>
      ) : (
        <Detailed agents={agents} sessions={live} now={now} onNavigate={onNavigate} thresholds={thresholds} />
      )}
    </Page>
  );
}

function AgentLink({ a, onNavigate }: { a: AgentStatus; onNavigate: Navigate }) {
  return (
    <button onClick={() => onNavigate({ name: 'agent', id: a.id })} className="rounded-xs text-left text-secondary underline-offset-4 hover:underline">
      {AGENT_NAME[a.id]}
    </button>
  );
}

/** A limit-free account, a missing engine, or a reading not received yet. */
function AgentSummary({ a }: { a: AgentStatus }) {
  if (!a.installed) return <span className="text-muted">not installed</span>;
  if (a.account?.method === 'apiKey') return <span className="text-muted">API key, no usage windows</span>;
  return <span className="text-muted">{a.id === 'claude' ? 'Waiting for a Claude Code response' : 'No usage data yet'}</span>;
}

function ContextCell({ s, thresholds }: { s: Session; thresholds: Record<EngineId, number> }) {
  if (s.contextPct === undefined) return <span className="text-muted">-</span>;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <Bar label="Context" wide pct={s.contextPct} ticks={s.agent === 'opencode' ? [] : [thresholds[s.agent]]} />
      <span className="w-5 text-right tabular-nums text-secondary"><Tween value={s.contextPct} />%</span>
    </span>
  );
}

function Updated({ s, now }: { s: Session; now: number }) {
  const age = formatAge(now - s.lastSeen);
  return sessionState(s.lastSeen, now) === 'idle' ? <span>idle {age}</span> : <span>{age} ago</span>;
}

function CompactTable({ sessions, byId, now, onNavigate, thresholds }: {
  sessions: Session[]; byId: Map<string, AgentStatus>; now: number; onNavigate: Navigate; thresholds: Record<EngineId, number>;
}) {
  if (sessions.length === 0) {
    return <p className="max-w-[60ch] text-muted">No open sessions. Start Claude Code or Codex in a terminal and they show up here.</p>;
  }
  return (
    <div className="min-w-0 overflow-x-auto">
    <table className="w-full min-w-[640px] border-collapse">
      <thead>
        <tr>
          <th className={`${TH} w-[40%]`}>Session</th>
          <th className={TH}>Context</th>
          <th className={TH}>5 hours</th>
          <th className={TH}>Week</th>
          <th className={`${TH} pr-0`}>Updated</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const a = byId.get(s.agent);
          const idle = sessionState(s.lastSeen, now) === 'idle';
          return (
            <tr key={`${s.agent}:${s.id}`} className={`border-t border-divider ${idle ? 'opacity-50' : ''}`}>
              <td className="py-1 pr-2">
                <div className="flex items-center gap-1">
                  <AgentTag id={s.agent} />
                  <div className="flex flex-col">
                    <span className="text-secondary">{s.project || 'unknown project'}</span>
                    <button
                      onClick={() => onNavigate({ name: 'agent', id: s.agent })}
                      className="rounded-xs text-left text-meta text-muted underline-offset-4 hover:underline"
                    >
                      <Meta parts={[AGENT_NAME[s.agent], s.model]} />
                    </button>
                  </div>
                </div>
              </td>
              <td className="py-1 pr-2"><ContextCell s={s} thresholds={thresholds} /></td>
              {a?.account?.method === 'apiKey' ? (
                <td className="py-1 pr-2" colSpan={2}><ApiKeyTotals tokens={s.tokens} cost={s.costUsd} /></td>
              ) : (
                <>
                  <td className="py-1 pr-2"><WindowCell label="5 hours" w={a?.fiveHour} now={now} updatedAt={a?.updatedAt} /></td>
                  <td className="py-1 pr-2"><WindowCell label="Week" w={a?.weekly} now={now} updatedAt={a?.updatedAt} /></td>
                </>
              )}
              <td className="whitespace-nowrap py-1 text-muted"><Updated s={s} now={now} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function Detailed({ agents, sessions, now, onNavigate, thresholds }: {
  agents: AgentStatus[]; sessions: Session[]; now: number; onNavigate: Navigate; thresholds: Record<EngineId, number>;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
      <AgentLimits agents={agents} now={now} onNavigate={onNavigate} />
      <section className="flex flex-col">
        <h2 className="pb-1 font-body text-meta font-normal text-muted">Open sessions</h2>
        {sessions.length === 0 && <p className="border-t border-divider py-2 text-muted">No open sessions.</p>}
        {sessions.map((s) => (
          <div key={`${s.agent}:${s.id}`} className={`flex flex-col gap-1 border-t border-divider py-2 ${sessionState(s.lastSeen, now) === 'idle' ? 'opacity-50' : ''}`}>
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-secondary">{s.project || 'unknown project'}</span>
              <span className="shrink-0 text-meta text-muted"><Updated s={s} now={now} /></span>
            </div>
            <span className="text-meta text-muted">
              <Meta parts={[AGENT_NAME[s.agent], s.model, s.contextSize ? `${Math.round(s.contextSize / 1000)}k context` : undefined]} />
            </span>
            <Row label="Context"><ContextCell s={s} thresholds={thresholds} /></Row>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Limits lead the overview; sessions keep their compact or detailed presentation. */
function AgentLimits({ agents, now, onNavigate, compact = false }: {
  agents: AgentStatus[]; now: number; onNavigate: Navigate; compact?: boolean;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h2 className="text-title">Agents</h2>
      <div className={compact ? 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-x-3' : 'flex flex-col'}>
        {agents.map((a) => (
          <div key={a.id} className="flex min-w-0 flex-col gap-2 border-t border-divider py-2">
            <div className="flex flex-wrap items-center gap-1">
              <AgentTag id={a.id} />
              <span className="head"><AgentLink a={a} onNavigate={onNavigate} /></span>
              {a.account?.plan && <span className="text-meta text-muted">{a.account.plan}</span>}
            </div>
            {a.installed && a.account?.method !== 'apiKey' && (a.fiveHour || a.weekly) ? (
              <div className="grid grid-cols-2 gap-2">
                <Gauge label="5 hours" w={a.fiveHour} now={now} updatedAt={a.updatedAt} />
                <Gauge label="Week" w={a.weekly} now={now} updatedAt={a.updatedAt} />
              </div>
            ) : <AgentSummary a={a} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function Gauge({ label, w, now, updatedAt }: { label: string; w?: UsageWindow; now: number; updatedAt?: number }) {
  const v = windowView(w, now);
  const age = staleAge(updatedAt, now);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-1">
        <span className="text-muted">{label}</span>
        <span className="head text-[32px] leading-5 tabular-nums">
          {v.kind === 'live' ? <><Tween value={v.pct} /><span className="text-title text-muted">%</span></> : '-'}
        </span>
      </div>
      <div className="[&_[role=meter]]:w-full">
        <Bar label={label} wide pct={v.kind === 'live' ? v.pct : undefined} ticks={v.kind === 'live' && v.pace !== undefined ? [v.pace] : []} />
      </div>
      <span className="text-meta text-muted">
        {v.kind === 'live' ? `Resets in ${formatDuration(v.resetIn)}` : v.kind === 'reset' ? 'Reset, awaiting data' : 'No reading yet'}
        {v.kind === 'live' && age && <span className="block">As of {age} ago</span>}
      </span>
    </div>
  );
}

/** Secondary facts kept apart by space, not by separators. */
function Meta({ parts }: { parts: (string | undefined)[] }) {
  return (
    <span className="flex gap-1">
      {parts.filter(Boolean).map((p) => (
        <span key={p}>{p}</span>
      ))}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-8 shrink-0 text-muted">{label}</span>
      {children}
    </div>
  );
}
