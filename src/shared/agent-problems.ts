import { isLocked, type AgentDef, type EngineId, type Tier } from './agent-file';
import type { Level } from './thread';
import type { EngineInfo, UsageWindow } from './types';
import type { PermissionMode } from './permissions';

export type EngineAssignment = { engine: EngineId; model: string };
type Windows = { fiveHour?: UsageWindow; weekly?: UsageWindow };

/** A preference for a new Auto session, never a reason to restart a running one. */
export type ThreadJob = 'builder' | 'reviewer' | 'other';
export function chooseThreadEngine(
  role: string, job: ThreadJob, assignments: Record<string, EngineAssignment>, windows: Partial<Record<EngineId, Windows | undefined>>,
  mode: PermissionMode, nowSec: number,
): EngineId {
  // Codex's on-request policy cannot implement Ark's complete Auto gate for a writable session.
  if (job === 'builder' && mode === 'auto') return 'claude';
  const limited = (engine: EngineId) => claudeLimited(windows[engine], nowSec);
  if (limited('claude') !== limited('codex')) return limited('claude') ? 'codex' : 'claude';
  const others = Object.entries(assignments).filter(([id]) => id !== role).map(([, a]) => a.engine);
  const count = (engine: EngineId) => others.filter((e) => e === engine).length;
  if (count('claude') !== count('codex')) return count('claude') < count('codex') ? 'claude' : 'codex';
  return assignments[role]?.engine ?? (job === 'other' ? 'claude' : 'codex');
}

export type RunPlan = { engine: EngineId; tier: Tier; model?: string; rerouted?: true };

const ENGINE_NAME: Record<EngineId, string> = { claude: 'Claude Code', codex: 'Codex' };

/** Auto moves light and standard work off Claude once one of its windows is this full (percent). */
export const SWITCH_AT = 90;

export function ownLevel(a: AgentDef): Level {
  const e = a.engine;
  if (e.kind !== 'model') return a.tier;
  if (e.engine === 'claude') return e.model === 'haiku' ? 'light' : e.model === 'sonnet' ? 'standard' : 'heavy';
  return e.model.endsWith('-luna') ? 'light' : e.model.endsWith('-terra') ? 'standard' : 'heavy';
}

export function atLevel(a: AgentDef, level: Level | undefined): AgentDef {
  if (!level || isLocked(a) || level === ownLevel(a)) return a;
  return { ...a, tier: level, engine: a.engine.kind === 'model' ? { kind: 'engine', engine: a.engine.engine } : a.engine };
}

/** True when a live (not yet reset) Claude window is at or past SWITCH_AT. */
export function claudeLimited(st: { fiveHour?: UsageWindow; weekly?: UsageWindow } | undefined, nowSec: number): boolean {
  return [st?.fiveHour, st?.weekly].some((w) => !!w && w.resetsAt > nowSec && w.usedPct >= SWITCH_AT);
}

/** The agent's engine setting picks the engine; auto prefers Claude, unless Claude is limited and Codex can take the work. */
export function resolveRun(agent: AgentDef, installed: Record<EngineId, boolean>, claudeLimited = false, preferredEngine?: EngineId): RunPlan | { error: string } {
  const e = agent.engine;
  if (e.kind === 'auto' && preferredEngine) {
    const engine = installed[preferredEngine] ? preferredEngine : installed.claude ? 'claude' : installed.codex ? 'codex' : undefined;
    return engine ? { engine, tier: agent.tier } : { error: 'No engine installed' };
  }
  if (e.kind === 'auto' && claudeLimited && agent.tier !== 'heavy' && installed.codex) {
    return { engine: 'codex', tier: agent.tier, rerouted: true };
  }
  const engine: EngineId | undefined =
    e.kind === 'auto' ? (installed.claude ? 'claude' : installed.codex ? 'codex' : undefined) : e.engine;
  if (!engine) return { error: 'No engine installed' };
  if (!installed[engine]) return { error: `${ENGINE_NAME[engine]} is not installed` };
  return e.kind === 'model' ? { engine, tier: agent.tier, model: e.model } : { engine, tier: agent.tier };
}

/** What stops an agent from running on this machine, as short messages for its card. Empty when it is fine. */
export function agentProblems(a: AgentDef, skills: ReadonlySet<string>, engines: EngineInfo[]): string[] {
  const installed = (id: EngineId) => engines.some((e) => e.id === id && e.installed);
  const problems: string[] = [];
  const plan = resolveRun(a, { claude: installed('claude'), codex: installed('codex') });
  if ('error' in plan) problems.push(plan.error);
  for (const s of a.skills) if (!skills.has(s)) problems.push(`Skill not installed: ${s}`);
  return problems;
}
