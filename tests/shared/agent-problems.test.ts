import { expect, test } from 'vitest';
import type { AgentDef, Tier } from '@shared/agent-file';
import { agentProblems, claudeLimited, tierUp } from '@shared/agent-problems';
import type { EngineInfo } from '@shared/types';

const agent = (over: Partial<AgentDef> = {}): AgentDef => ({
  id: 'a', name: 'A', description: '', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions: 'read-only', prompt: 'x', ...over,
});
const both: EngineInfo[] = [
  { id: 'claude', installed: true, manual: false },
  { id: 'codex', installed: true, manual: false },
];
const none: EngineInfo[] = both.map((e) => ({ ...e, installed: false }));
const skills = new Set(['writing-plans']);

test('a clean agent has no problems', () => {
  expect(agentProblems(agent({ skills: ['writing-plans'] }), skills, both)).toEqual([]);
});

test('a fixed engine that is not installed', () => {
  const codexOnly = [{ ...both[0], installed: false }, both[1]];
  expect(agentProblems(agent({ engine: { kind: 'engine', engine: 'claude' } }), skills, codexOnly)).toEqual(['Claude Code is not installed']);
  expect(agentProblems(agent({ engine: { kind: 'model', engine: 'codex', model: 'gpt-5' } }), skills, [both[0], { ...both[1], installed: false }])).toEqual(['Codex is not installed']);
});

test('an engine missing from the status list counts as not installed', () => {
  expect(agentProblems(agent({ engine: { kind: 'engine', engine: 'codex' } }), skills, [])).toEqual(['Codex is not installed']);
});

test('auto with no engine installed', () => {
  expect(agentProblems(agent(), skills, none)).toEqual(['No engine installed']);
  expect(agentProblems(agent(), skills, [both[0], { ...both[1], installed: false }])).toEqual([]);
});

test('one entry per missing skill', () => {
  expect(agentProblems(agent({ skills: ['writing-plans', 'nope', 'gone'] }), skills, both)).toEqual([
    'Skill not installed: nope',
    'Skill not installed: gone',
  ]);
});

test('tierUp', () => {
  expect(['light', 'standard', 'heavy'].map((t) => tierUp(t as Tier))).toEqual(['standard', 'heavy', 'heavy']);
});
test('claudeLimited: 90% of either live window', () => {
  const now = 1_000_000;
  const w = (usedPct: number, resetsAt = now + 60) => ({ usedPct, resetsAt, minutes: 300 });
  expect(claudeLimited({ fiveHour: w(90) }, now)).toBe(true);
  expect(claudeLimited({ weekly: { ...w(95), minutes: 10080 } }, now)).toBe(true);
  expect(claudeLimited({ fiveHour: w(89) }, now)).toBe(false);
  expect(claudeLimited({ fiveHour: w(99, now - 1) }, now)).toBe(false); // expired: Review Focus 1
  expect(claudeLimited(undefined, now)).toBe(false);
});
