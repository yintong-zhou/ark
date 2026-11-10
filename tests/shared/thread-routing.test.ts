import { expect, test } from 'vitest';
import { chooseThreadEngine, resolveRun } from '../../src/shared/agent-problems';
import type { AgentDef } from '../../src/shared/agent-file';

const agent: AgentDef = { id: 'planner', name: 'Planner', description: '', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions: 'read-only', prompt: '' };
const now = 100;
const window = (usedPct: number, resetsAt = 200) => ({ fiveHour: { usedPct, resetsAt, minutes: 300 } });

test('balances Auto roles across actual thread assignments', () => {
  expect(chooseThreadEngine('project-manager', {}, {}, 'auto', now)).toBe('claude');
  expect(chooseThreadEngine('planner', { 'project-manager': { engine: 'claude', model: 'haiku' } }, {}, 'auto', now)).toBe('codex');
  expect(chooseThreadEngine('researcher', { pm: { engine: 'claude', model: 'haiku' }, planner: { engine: 'codex', model: 'gpt' } }, {}, 'auto', now)).toBe('claude');
});

test('capacity preferences apply to either provider, expired windows do not count', () => {
  expect(chooseThreadEngine('project-manager', {}, { claude: window(95) }, 'auto', now)).toBe('codex');
  expect(chooseThreadEngine('code-reviewer', {}, { codex: window(95) }, 'ask', now)).toBe('claude');
  expect(chooseThreadEngine('project-manager', {}, { claude: window(95, 90) }, 'auto', now)).toBe('claude');
});

test('Auto developer uses the engine with a complete gate; other modes favor Codex', () => {
  expect(chooseThreadEngine('developer', {}, {}, 'auto', now)).toBe('claude');
  expect(chooseThreadEngine('developer', {}, {}, 'ask', now)).toBe('codex');
  expect(chooseThreadEngine('developer', {}, {}, 'full', now)).toBe('codex');
});

test('runner honors preference only for Auto and falls back to the installed engine', () => {
  expect(resolveRun(agent, { claude: true, codex: true }, false, 'codex')).toMatchObject({ engine: 'codex' });
  expect(resolveRun(agent, { claude: true, codex: false }, false, 'codex')).toMatchObject({ engine: 'claude' });
  expect(resolveRun({ ...agent, engine: { kind: 'model', engine: 'claude', model: 'opus' } }, { claude: true, codex: true }, false, 'codex')).toMatchObject({ engine: 'claude', model: 'opus' });
});
