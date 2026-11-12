import type { AgentDef } from '@shared/agent-file';
import type { AgentId } from '@shared/types';

export const AGENT_NAME: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
export const AGENT_TAG: Record<AgentId, string> = { claude: 'CC', codex: 'CX', opencode: 'OC' };

export type Screen =
  | { name: 'usage' }
  | { name: 'agent'; id: AgentId }
  | { name: 'history' }
  | { name: 'accounts' }
  | { name: 'statusline' }
  | { name: 'agents' }
  | { name: 'agent-form'; id?: string; draft?: AgentDef }
  | { name: 'head-form' }
  | { name: 'chat'; agentId: string }
  | { name: 'threads' };
export type Navigate = (s: Screen) => void;

/** The three places the rail leads to: the projects with their threads, the usage screens, the agent catalog. */
export type Area = 'threads' | 'usage' | 'agents';
export const areaOf = (s: Screen): Area =>
  s.name === 'threads' ? 'threads' : s.name === 'agents' || s.name === 'agent-form' || s.name === 'head-form' || s.name === 'chat' ? 'agents' : 'usage';
