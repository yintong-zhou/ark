/** Approval policy is independent of an agent's read-only/build capability. */
export const PERMISSION_MODES = ['ask', 'auto', 'full'] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];
export function permissionMode(value: unknown): PermissionMode {
  if (!PERMISSION_MODES.includes(value as PermissionMode)) throw new Error('Invalid permission mode');
  return value as PermissionMode;
}
export const modeOf = (session: { permissionMode?: PermissionMode }): PermissionMode =>
  session.permissionMode === 'auto' || session.permissionMode === 'full' ? session.permissionMode : 'ask';
export const autonomous = (session: { permissionMode?: PermissionMode }): boolean => modeOf(session) !== 'ask';
export const PERMISSION_LABEL: Record<PermissionMode, string> = { ask: 'Ask for approval', auto: 'Approve for me', full: 'Full access' };
export const PERMISSION_DETAIL: Record<PermissionMode, string> = {
  ask: 'Ask before actions outside the allowed scope. You approve the team and plan.',
  auto: 'Let the team decide and allow routine work. Ask you for sensitive or unknown actions.',
  full: "Builders' tools run without approval prompts, including writes outside the worktree and network access.",
};
/** Main-process metadata, never reconstructed from a user-facing description. */
export type ApprovalRequest = { engine: 'claude' | 'codex'; tool: string; input: Record<string, unknown>; cwd: string };
