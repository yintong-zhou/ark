import type { AgentDef } from '@shared/agent-file';

/** Roles required by the thread conductor. Users can edit these after adding them. */
export const THREAD_AGENTS: AgentDef[] = [
  { id: 'project-manager', name: 'Project manager', description: 'Coordinates the thread and proposes its team.', engine: { kind: 'auto' }, tier: 'light', skills: [], permissions: 'read-only', prompt: 'Lead the thread, propose a team from the catalog, coordinate its work and ask the user when a decision is needed. Respond in the user\'s language.' },
  { id: 'developer', name: 'Developer', description: 'Implements the approved plan in the thread worktree.', engine: { kind: 'auto' }, tier: 'heavy', skills: [], permissions: 'build', prompt: 'Implement the approved plan in the thread worktree, run appropriate checks and address review findings. Respond in the user\'s language.' },
  { id: 'code-reviewer', name: 'Code reviewer', description: 'Reviews changes for correctness and maintainability.', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions: 'read-only', prompt: 'Review the changes for correctness, maintainability and fit with the plan. Report actionable findings. Respond in the user\'s language.' },
  { id: 'security-reviewer', name: 'Security reviewer', description: 'Reviews changes for security issues.', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions: 'read-only', prompt: 'Review the changes for security vulnerabilities and report actionable findings. Respond in the user\'s language.' },
];
