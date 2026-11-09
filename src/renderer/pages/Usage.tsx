import { useEffect, useState, type ReactNode } from 'react';
import type { EngineId } from '@shared/agent-file';
import type { AgentStatus, Session, StatuslineStatus, UsageState, ViewMode } from '@shared/types';
import { formatAge, sessionState } from '@shared/usage-math';
import { AGENT_NAME, type Navigate } from '../agents';
import { AgentTag } from '../components/AgentTag';
import { Bar } from '../components/Bar';
import { Page } from '../components/Page';
import { ApiKeyTotals } from '../components/StatusBar';
import { BUTTON, CTA } from '../components/ui';
import { WindowCell } from '../components/WindowCell';

type Props = { state: UsageState | null; now: number; refresh: () => Promise<void>; onNavigate: Navigate };

const TH = 'py-1 pr-2 text-left text-meta font-normal text-muted';

export function Usage({ state, now, refresh, onNavigate }: Props) {
  const [view, setView] = useState<ViewMode>('compact');
  const [statusline, setStatusline] = useState<StatuslineStatus>('connected');
  const [refreshing, setRefreshing] = useState(false);
  const [thresholds, setThresholds] = useState<Record<EngineId, number>>({ claude: 40, codex: 40 });
  const [thresholdError, setThresholdError] = useState('');
  useEffect(() => {
    window.ark.settings.getView().then(setView);
    window.ark.settings.getHandoffThresholds().then(setThresholds).catch(() => setThresholdError('Could not load handoff settings.'));
    window.ark.statusline.status().then(setStatusline);
  }, []);

  const changeView = (v: ViewMode) => {
    setView(v);
    window.ark.settings.setView(v);
  };
  const onRefresh = async () => {
    setRefreshing(true);
    await refresh().finally(() => setRefreshing(false));
  };

  const agents = state?.agents ?? [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const live = (state?.sessions ?? [])
    .filter((s) => ['active', 'idle'].includes(sessionState(s.lastSeen, now)))
    .sort((a, b) => b.lastSeen - a.lastSeen);
  const withoutSessions = agents.filter((a) => !live.some((s) => s.agent === a.id));
  const claudeInstalled = byId.get('claude')?.installed;

  return (
    <Page
      title="Usage"
      meta={['Context and limits of the agents on this machine']}
      actions={
        <>
          <div role="group" aria-label="View" className="flex h-4 items-center rounded-sm bg-primary p-[2px]">
            {(['compact', 'detailed'] as const).map((v) => (
              <button
                key={v}
                onClick={() => changeView(v)}
                aria-pressed={view === v}
                className={`h-full rounded-xs px-1 capitalize ${view === v ? 'bg-raised text-secondary' : 'text-muted hover:text-secondary'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button onClick={onRefresh} disabled={refreshing} className={BUTTON}>
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </>
      }
    >
      <section className="flex flex-col gap-1 border-b border-divider pb-2">
        <h2 className="text-body">Handoff settings</h2>
        <p className="text-muted">Context used at the end of a thread turn. Applies to Claude and Codex planning sessions.</p>
        <div className="flex gap-3">
          {(['claude', 'codex'] as const).map((engine) => (
            <label key={engine} className="flex items-center gap-1">
              {AGENT_NAME[engine]}
              <input aria-label={AGENT_NAME[engine] + ' handoff threshold'} type="number" min={1} max={100} step={1}
                defaultValue={thresholds[engine]} key={engine + ':' + thresholds[engine]} className="w-6 rounded-sm bg-raised px-1 text-secondary"
                onBlur={(e) => {
                  const percent = Number(e.currentTarget.value);
                  if (!Number.isInteger(percent) || percent < 1 || percent > 100) { e.currentTarget.value = String(thresholds[engine]); setThresholdError('Enter a whole number from 1 to 100.'); return; }
                  void window.ark.settings.setHandoffThreshold(engine, percent).then(() => { setThresholds((old) => ({ ...old, [engine]: percent })); setThresholdError(''); }).catch(() => setThresholdError('Could not save handoff settings.'));
                }} />%
            </label>
          ))}
        </div>
        {thresholdError && <p role="alert">{thresholdError}</p>}
      </section>
      {claudeInstalled && statusline !== 'connected' && (
        <div className="flex items-center justify-between gap-2 rounded-sm bg-raised p-2">
          <span>Claude Code sessions aren&apos;t reported yet.</span>
          <button onClick={() => onNavigate({ name: 'statusline' })} className={CTA}>Connect status line</button>
        </div>
      )}

      {state === null ? (
        <p className="text-muted">Looking for agents on this machine.</p>
      ) : view === 'compact' ? (
        <CompactTable sessions={live} byId={byId} now={now} onNavigate={onNavigate} thresholds={thresholds} />
      ) : (
        <Detailed agents={agents} sessions={live} now={now} onNavigate={onNavigate} thresholds={thresholds} />
      )}

      {view === 'compact' && withoutSessions.length > 0 && (
        <ul className="flex flex-col">
          {withoutSessions.map((a) => (
            <li key={a.id} className="flex items-center gap-2 border-t border-divider py-1">
              <AgentTag id={a.id} />
              <span className="w-13 shrink-0"><AgentLink a={a} onNavigate={onNavigate} /></span>
              <AgentSummary a={a} now={now} />
            </li>
          ))}
        </ul>
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

/** What an agent without a live session shows: not installed, waiting, or its windows. */
function AgentSummary({ a, now }: { a: AgentStatus; now: number }) {
  if (!a.installed) return <span className="text-muted">not installed</span>;
  if (a.account?.method === 'apiKey') return <span className="text-muted">API key, no usage windows</span>;
  if (!a.fiveHour && !a.weekly) {
    return <span className="text-muted">{a.id === 'claude' ? 'Waiting for a Claude Code response' : 'No usage data yet'}</span>;
  }
  return (
    <span className="flex gap-3">
      <WindowCell label="5 hours" w={a.fiveHour} now={now} updatedAt={a.updatedAt} />
      <WindowCell label="Week" w={a.weekly} now={now} updatedAt={a.updatedAt} />
    </span>
  );
}

function ContextCell({ s, thresholds }: { s: Session; thresholds: Record<EngineId, number> }) {
  if (s.contextPct === undefined) return <span className="text-muted">-</span>;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <Bar label="Context" wide pct={s.contextPct} ticks={s.agent === 'opencode' ? [] : [thresholds[s.agent]]} />
      <span className="w-5 text-right text-secondary">{Math.round(s.contextPct)}%</span>
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
    <table className="w-full border-collapse">
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
  );
}

function Detailed({ agents, sessions, now, onNavigate, thresholds }: {
  agents: AgentStatus[]; sessions: Session[]; now: number; onNavigate: Navigate; thresholds: Record<EngineId, number>;
}) {
  return (
    <div className="grid grid-cols-2 gap-5">
      <section className="flex flex-col">
        <h2 className="pb-1 text-body">Agents</h2>
        {agents.map((a) => (
          <div key={a.id} className={`flex flex-col gap-1 border-t border-divider py-2 ${a.installed ? '' : 'opacity-50'}`}>
            <div className="flex items-center gap-1">
              <AgentTag id={a.id} />
              <AgentLink a={a} onNavigate={onNavigate} />
              {a.account?.plan && <span className="text-muted">{a.account.plan}</span>}
            </div>
            {a.installed && a.account?.method !== 'apiKey' && (a.fiveHour || a.weekly) ? (
              <>
                <Row label="5 hours"><WindowCell label="5 hours" w={a.fiveHour} now={now} updatedAt={a.updatedAt} /></Row>
                <Row label="Week"><WindowCell label="Week" w={a.weekly} now={now} updatedAt={a.updatedAt} /></Row>
              </>
            ) : (
              <AgentSummary a={a} now={now} />
            )}
          </div>
        ))}
      </section>
      <section className="flex flex-col">
        <h2 className="pb-1 text-body">Open sessions</h2>
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
