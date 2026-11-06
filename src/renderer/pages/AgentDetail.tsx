import type { AgentId, UsageState } from '@shared/types';
import { formatAge, sessionState } from '@shared/usage-math';
import { AGENT_NAME } from '../agents';
import { Facts, Page } from '../components/Page';
import { WindowCell } from '../components/WindowCell';

const METHOD = { subscription: 'Subscription', apiKey: 'API key', unknown: 'Unknown' } as const;
const TH = 'py-1 pr-2 text-left text-meta font-normal text-muted';

export function AgentDetail({ id, state, now }: { id: AgentId; state: UsageState | null; now: number }) {
  const a = state?.agents.find((x) => x.id === id);
  const sessions = (state?.sessions ?? []).filter((s) => s.agent === id).sort((x, y) => y.lastSeen - x.lastSeen);
  return (
    <Page title={AGENT_NAME[id]} meta={a?.installed ? [a.account?.plan ?? '', a.version ?? ''].filter(Boolean) : []}>
      {!a?.installed ? (
        <p className="text-muted">{AGENT_NAME[id]} isn&apos;t installed on this machine.</p>
      ) : (
        <>
          <Facts
            rows={[
              ['Version', a.version],
              ['Path', a.path],
              ['Account', a.account ? (a.account.loggedIn ? METHOD[a.account.method] : 'Not signed in') : undefined],
              ['Email', a.account?.email],
              ['Plan', a.account?.plan],
              ['5 hours', <WindowCell key="5h" label="5 hours" w={a.fiveHour} now={now} updatedAt={a.updatedAt} />],
              ['Week', <WindowCell key="wk" label="Week" w={a.weekly} now={now} updatedAt={a.updatedAt} />],
            ]}
          />
          <h2 className="text-body">Sessions in the last 7 days</h2>
          {sessions.length === 0 ? (
            <p className="text-muted">No sessions yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Project</th>
                  <th className={TH}>Model</th>
                  <th className={`${TH} text-right`}>Context</th>
                  <th className={`${TH} text-right`}>Tokens</th>
                  <th className={`${TH} text-right`}>Cost</th>
                  <th className={`${TH} pr-0`}>Last update</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const st = sessionState(s.lastSeen, now);
                  return (
                    <tr key={s.id} className={`border-t border-divider ${st === 'active' ? '' : 'text-muted'}`}>
                      <td className="py-1 pr-2">{s.project || 'unknown project'}</td>
                      <td className="py-1 pr-2">{s.model ?? '—'}</td>
                      <td className="py-1 pr-2 text-right">{s.contextPct !== undefined ? `${Math.round(s.contextPct)}%` : '—'}</td>
                      <td className="py-1 pr-2 text-right">{s.tokens?.toLocaleString('en-US') ?? '—'}</td>
                      <td className="py-1 pr-2 text-right">{s.costUsd !== undefined ? `$${s.costUsd.toFixed(2)}` : '—'}</td>
                      <td className="py-1">{formatAge(now - s.lastSeen)} ago</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Page>
  );
}
