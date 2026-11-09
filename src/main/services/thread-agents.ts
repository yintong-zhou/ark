import type { AgentDef } from '@shared/agent-file';

/** The coordinator is installed by default. */
export const THREAD_AGENTS: AgentDef[] = [
  { id: 'project-manager', name: 'Alex - Project manager', description: 'Coordinates the thread and proposes its team.', engine: { kind: 'auto' }, tier: 'light', skills: [], permissions: 'read-only', prompt: 'You are Alex, the project manager. Lead the thread, propose a team from the catalog, coordinate its work and ask the user when a decision is needed. Respond in the user\'s language.' },
];
