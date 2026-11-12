import { validateAgent, type AgentDef } from '@shared/agent-file';
import { HEAD_FACE } from '@shared/avatars';
import { MANAGER } from '@shared/thread';
import type { HeadSettings } from '@shared/types';

export const HEAD: AgentDef = {
  id: MANAGER, name: 'Head of Staff', description: 'Reads each request, judges how hard it is and puts the right agents and models on it.',
  engine: { kind: 'auto' }, tier: 'light', skills: [], permissions: 'read-only', avatar: HEAD_FACE,
  prompt: "You are the Head of Staff. The user is your boss; the agents in the catalog are the user's staff. You coordinate, you do not do the work yourself. Respond in the user's language.",
};

export function checkHeadSettings(v: unknown): HeadSettings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid Head of Staff settings');
  const { skills, engine, lock } = v as Record<string, unknown>;
  if (typeof lock !== 'boolean') throw new Error('lock: must be true or false');
  const checked = validateAgent({ ...HEAD, id: 'head-validation', avatar: undefined, skills, engine, lock });
  if (!checked.ok) throw new Error(checked.error);
  return { skills: checked.agent.skills, engine: checked.agent.engine, lock };
}

export function headWith(saved: unknown): AgentDef {
  try { return { ...HEAD, ...checkHeadSettings(saved) }; } catch { return HEAD; }
}
