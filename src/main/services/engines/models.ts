import type { Tier } from '@shared/agent-file';

export { resolveRun, type RunPlan } from '@shared/agent-problems';

export const CLAUDE_TIER_MODEL: Record<Tier, string> = { light: 'haiku', standard: 'sonnet', heavy: 'opus' };
export const CODEX_TIER_EFFORT: Record<Tier, 'low' | 'medium' | 'high'> = {
  light: 'low',
  standard: 'medium',
  heavy: 'high',
};

export type CodexModel = { id: string; hidden: boolean; isDefault: boolean };

export function visibleModels(models: CodexModel[]): string[] {
  const visible = models.filter((model) => !model.hidden);
  return [...visible.filter((model) => model.isDefault), ...visible.filter((model) => !model.isDefault)].map((model) => model.id);
}

/** Codex model for a tier, from the list Codex reports: override, then -luna/-terra/default naming, then fallbacks. */
export function codexTierModel(
  tier: Tier,
  models: CodexModel[],
  overrides?: Partial<Record<Tier, string>>,
): string | undefined {
  if (overrides?.[tier]) return overrides[tier];
  const visible = models.filter((m) => !m.hidden);
  const def = models.find((m) => m.isDefault)?.id;
  const suffix = tier === 'light' ? '-luna' : tier === 'standard' ? '-terra' : undefined;
  const byName = suffix ? visible.find((m) => m.id.endsWith(suffix))?.id : undefined;
  return (tier === 'heavy' ? def : byName) ?? def ?? visible[0]?.id;
}
