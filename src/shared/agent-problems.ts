import type { AgentDef, EngineId, Tier } from './agent-file';
import type { EngineInfo, UsageWindow } from './types';

export type RunPlan = { engine: EngineId; tier: Tier; model?: string; rerouted?: true };

const ENGINE_NAME: Record<EngineId, string> = { claude: 'Claude Code', codex: 'Codex' };

/** Auto moves light and standard work off Claude once one of its windows is this full (percent). */
export const SWITCH_AT = 90;

export const tierUp = (t: Tier): Tier => (t === 'light' ? 'standard' : 'heavy');

/** True when a live (not yet reset) Claude window is at or past SWITCH_AT. */
export function claudeLimited(st: { fiveHour?: UsageWindow; weekly?: UsageWindow } | undefined, nowSec: number): boolean {
  return [st?.fiveHour, st?.weekly].some((w) => !!w && w.resetsAt > nowSec && w.usedPct >= SWITCH_AT);
}

/** The agent's engine setting picks the engine; auto prefers Claude, unless Claude is limited and Codex can take the work. */
export function resolveRun(agent: AgentDef, installed: Record<EngineId, boolean>, claudeLimited = false): RunPlan | { error: string } {
  const e = agent.engine;
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
