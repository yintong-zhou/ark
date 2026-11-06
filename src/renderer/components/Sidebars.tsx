import { useEffect, useState } from 'react';
import type { AgentDef } from '@shared/agent-file';
import type { UsageState } from '@shared/types';
import { AGENT_NAME, type Navigate, type Screen } from '../agents';
import { AgentTag } from './AgentTag';
import { Avatar, initials } from './Avatar';
import { Sidebar, SideLabel, SideRow } from './Shell';

/** The usage screens, and each agent's own page. */
export function UsageNav({ screen, state, onNavigate }: { screen: Screen; state: UsageState | null; onNavigate: Navigate }) {
  const go = (name: 'usage' | 'history' | 'accounts' | 'statusline') => () => onNavigate({ name });
  return (
    <Sidebar title="Usage" label="Usage">
      <SideRow selected={screen.name === 'usage'} onClick={go('usage')}>Overview</SideRow>
      <SideRow selected={screen.name === 'history'} onClick={go('history')}>History</SideRow>
      <SideRow selected={screen.name === 'accounts'} onClick={go('accounts')}>Accounts</SideRow>
      <SideRow selected={screen.name === 'statusline'} onClick={go('statusline')}>Status line</SideRow>
      <SideLabel>Agents</SideLabel>
      {(state?.agents ?? []).map((a) => (
        <SideRow
          key={a.id}
          lead={<AgentTag id={a.id} />}
          selected={screen.name === 'agent' && screen.id === a.id}
          trail={<span className="shrink-0 text-meta">{a.installed ? a.account?.plan : 'not installed'}</span>}
          onClick={() => onNavigate({ name: 'agent', id: a.id })}
        >
          {AGENT_NAME[a.id]}
        </SideRow>
      ))}
    </Sidebar>
  );
}

/** The agent catalog, and a direct chat with each agent in it. */
export function AgentsNav({ screen, onNavigate }: { screen: Screen; onNavigate: Navigate }) {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  // the catalog changes on Save and Delete, and both come back through a screen change
  useEffect(() => {
    let live = true;
    window.ark.catalog.list().then((c) => live && setAgents(c.agents), () => {});
    return () => {
      live = false;
    };
  }, [screen]);
  return (
    <Sidebar title="Agents" label="Agents">
      <SideRow selected={screen.name === 'agents' || screen.name === 'agent-form'} onClick={() => onNavigate({ name: 'agents' })}>Catalog</SideRow>
      <SideLabel>Chat</SideLabel>
      {agents.map((a) => (
        <SideRow
          key={a.id}
          lead={<Avatar text={initials(a.name)} size={24} />}
          selected={screen.name === 'chat' && screen.agentId === a.id}
          onClick={() => onNavigate({ name: 'chat', agentId: a.id })}
        >
          {a.name}
        </SideRow>
      ))}
    </Sidebar>
  );
}
