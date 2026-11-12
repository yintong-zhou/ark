import { expect, test } from 'vitest';
import type { AgentDef } from '@shared/agent-file';
import { type CodexModel, codexTierModel, resolveRun, visibleModels } from '../../src/main/services/engines/models';

// Observed model/list output, newest first.
const models: CodexModel[] = [
  ['gpt-6.1-sol', true],
  ['gpt-6.1-terra', false],
  ['gpt-6-astra', false],
  ['gpt-6-sol', false],
  ['gpt-6-luna', false],
  ['gpt-5.6-sol', false],
  ['gpt-5.6-terra', false],
  ['gpt-5.6-luna', false],
].map(([id, isDefault]) => ({ id: id as string, hidden: false, isDefault: isDefault as boolean }));

test('codexTierModel picks from the observed list', () => {
  expect(codexTierModel('light', models)).toBe('gpt-6-luna');
  expect(codexTierModel('standard', models)).toBe('gpt-6.1-terra');
  expect(codexTierModel('heavy', models)).toBe('gpt-6.1-sol');
  expect(codexTierModel('light', models, { light: 'gpt-5.6-luna' })).toBe('gpt-5.6-luna');
  expect(codexTierModel('heavy', [])).toBeUndefined();
});

test('codexTierModel skips hidden models and falls back', () => {
  const hiddenLuna = { id: 'gpt-7-luna', hidden: true, isDefault: false };
  expect(codexTierModel('light', [hiddenLuna, models[0]])).toBe('gpt-6.1-sol');
  expect(codexTierModel('standard', [models[0]])).toBe('gpt-6.1-sol');
  expect(codexTierModel('standard', [{ id: 'x', hidden: false, isDefault: false }])).toBe('x');
});

const agent = (engine: AgentDef['engine'], tier: AgentDef['tier'] = 'light'): AgentDef => ({
  id: 'a',
  name: 'A',
  description: '',
  engine,
  tier,
  skills: [],
  permissions: 'read-only',
  prompt: '',
});

test('resolveRun', () => {
  const both = { claude: true, codex: true };
  expect(resolveRun(agent({ kind: 'auto' }), both)).toEqual({ engine: 'claude', tier: 'light' });
  expect(resolveRun(agent({ kind: 'auto' }), { claude: false, codex: true })).toEqual({ engine: 'codex', tier: 'light' });
  expect(resolveRun(agent({ kind: 'model', engine: 'claude', model: 'opus' }, 'heavy'), both)).toEqual({
    engine: 'claude',
    tier: 'heavy',
    model: 'opus',
  });
  expect(resolveRun(agent({ kind: 'engine', engine: 'codex' }), { claude: true, codex: false })).toEqual({
    error: 'Codex is not installed',
  });
  expect(resolveRun(agent({ kind: 'engine', engine: 'claude' }), { claude: false, codex: true })).toEqual({
    error: 'Claude Code is not installed',
  });
  expect(resolveRun(agent({ kind: 'auto' }), { claude: false, codex: false })).toEqual({
    error: 'No engine installed',
  });
  expect(resolveRun(agent({ kind: 'auto' }), both, true)).toEqual({ engine: 'codex', tier: 'light', rerouted: true });
  expect(resolveRun(agent({ kind: 'auto' }, 'heavy'), both, true)).toEqual({ engine: 'claude', tier: 'heavy' });
  expect(resolveRun(agent({ kind: 'auto' }), { claude: true, codex: false }, true)).toEqual({ engine: 'claude', tier: 'light' });
  expect(resolveRun(agent({ kind: 'engine', engine: 'claude' }), both, true)).toEqual({ engine: 'claude', tier: 'light' });
  expect(resolveRun(agent({ kind: 'model', engine: 'claude', model: 'opus' }, 'standard'), both, true)).toEqual({ engine: 'claude', tier: 'standard', model: 'opus' });
});

test('visibleModels drops hidden models and puts the default first', () => {
  const models = [
    { id: 'gpt-x-luna', hidden: false, isDefault: false },
    { id: 'gpt-internal', hidden: true, isDefault: false },
    { id: 'gpt-x', hidden: false, isDefault: true },
  ];
  expect(visibleModels(models)).toEqual(['gpt-x', 'gpt-x-luna']);
  expect(visibleModels([])).toEqual([]);
});
