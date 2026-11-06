import { useState } from 'react';
import type { AgentId, UsageState } from '@shared/types';
import { AGENT_NAME } from '../agents';
import { AgentTag } from '../components/AgentTag';
import { Page } from '../components/Page';

const LOGIN: Record<AgentId, string> = { claude: 'claude', codex: 'codex login', opencode: 'opencode auth login' };
const METHOD = { subscription: 'Subscription', apiKey: 'API key', unknown: 'Unknown method' } as const;

/** Read-only: which account each agent is signed in with. Ark never signs in on your behalf. */
export function Accounts({ state }: { state: UsageState | null }) {
  const [copied, setCopied] = useState<AgentId | null>(null);
  const copy = async (id: AgentId) => {
    await navigator.clipboard.writeText(LOGIN[id]);
    setCopied(id);
  };
  return (
    <Page title="Accounts" meta={['Read-only: Ark never signs in for you']}>
      <ul className="flex flex-col">
        {(state?.agents ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-2 border-t border-divider py-2">
            <AgentTag id={a.id} />
            <span className="w-13 shrink-0 text-secondary">{AGENT_NAME[a.id]}</span>
            {!a.installed ? (
              <span className="text-muted">not installed</span>
            ) : !a.account ? (
              <span className="text-muted">Account unknown: Ark couldn&apos;t read it from {AGENT_NAME[a.id]}</span>
            ) : a.account.loggedIn ? (
              <span className="flex gap-3">
                <span>{a.account.email ?? 'Signed in'}</span>
                <span className="text-muted">{METHOD[a.account.method]}</span>
                {a.account.plan && <span className="text-muted">{a.account.plan}</span>}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="text-muted">Not signed in. Run</span>
                <code className="rounded-xs bg-raised px-[4px] font-mono text-secondary">{LOGIN[a.id]}</code>
                <button onClick={() => copy(a.id)} className="rounded-xs text-secondary underline-offset-4 hover:underline">
                  {copied === a.id ? 'Copied' : 'Copy'}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
