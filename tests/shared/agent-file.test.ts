import { expect, test } from 'vitest';
import {
  agentId,
  isLocked,
  modelOptions,
  formatEngineSetting,
  parseAgentFile,
  parseEngineSetting,
  serializeAgentFile,
  validateAgent,
  type AgentDef,
} from '@shared/agent-file';

const EXAMPLE = `---
name: Planner
description: Turns the team's decisions into a phased plan.
engine: auto            # or claude, codex, claude:sonnet, codex:<model>, ...
tier: standard          # light | standard | heavy; ignored when engine names an exact model
skills: [writing-plans]
permissions: read-only  # read-only | build (§6.4)
---
You are the planner of a small team working in Ark. Keep plans short.
`;

test('parses the documented example', () => {
  const r = parseAgentFile(EXAMPLE, 'planner');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.agent).toMatchObject({
    id: 'planner',
    name: 'Planner',
    engine: { kind: 'auto' },
    tier: 'standard',
    skills: ['writing-plans'],
    permissions: 'read-only',
  });
  expect(r.agent.prompt.startsWith('You are the planner')).toBe(true);
});

test('defaults missing fields', () => {
  const r = parseAgentFile('---\nname: X\n---\nHi', 'x');
  expect(r).toEqual({
    ok: true,
    agent: {
      id: 'x',
      name: 'X',
      description: '',
      engine: { kind: 'auto' },
      tier: 'standard',
      skills: [],
      permissions: 'read-only',
      prompt: 'Hi',
    },
  });
});

const AGENT: AgentDef = {
  id: 'builder',
  name: 'Builder: "fast" #1',
  description: 'Builds things.\nSecond line.',
  engine: { kind: 'model', engine: 'codex', model: 'gpt-6-luna' },
  tier: 'heavy',
  skills: ['superpowers:writing-plans'],
  permissions: 'build',
  prompt: 'You build.\n\n- one\n- two',
};

test('round-trips', () => {
  expect(parseAgentFile(serializeAgentFile(AGENT), AGENT.id)).toEqual({ ok: true, agent: AGENT });
});

test('serializes keys in order, then separator, prompt and trailing newline', () => {
  const text = serializeAgentFile({ ...AGENT, name: 'B', description: '' });
  const keys = text.split('\n---\n')[0].split('\n').filter((l) => /^\w+:/.test(l)).map((l) => l.split(':')[0]);
  expect(keys).toEqual(['name', 'description', 'engine', 'tier', 'skills', 'permissions']);
  expect(text).toContain('engine: codex:gpt-6-luna');
  expect(text.endsWith('\n---\nYou build.\n\n- one\n- two\n')).toBe(true);
});

test('imports a Claude agent', () => {
  const r = parseAgentFile(
    '---\nname: code-reviewer\ndescription: Senior code reviewer\nmodel: sonnet\ntools: Read, Grep\ncolor: red\n---\nReview code.',
    'code-reviewer',
  );
  expect(r.ok && r.agent.engine).toEqual({ kind: 'model', engine: 'claude', model: 'sonnet' });
});

test('explicit engine wins over an imported model', () => {
  const r = parseAgentFile('---\nname: X\nengine: codex\nmodel: opus\n---\nHi', 'x');
  expect(r.ok && r.agent.engine).toEqual({ kind: 'engine', engine: 'codex' });
});

test('rejects bad files', () => {
  const cases: [string, RegExp][] = [
    ['---\ndescription: d\n---\nHi', /name/],
    ['---\nname: X\n---\n  \n', /prompt/],
    ['---\nname: X\ntier: huge\n---\nHi', /tier/],
    ['---\nname: X\nengine: claude:gpt\n---\nHi', /engine/],
    ['---\nname: X\nskills: [../x]\n---\nHi', /skills/],
    ['---\nname: X\nskills: x\n---\nHi', /skills/],
    ['---\nname: X\npermissions: root\n---\nHi', /permissions/],
    ['Just text', /frontmatter/],
    ['---\nname: [unclosed\n---\nHi', /frontmatter/],
    [`---\nname: ${'n'.repeat(81)}\n---\nHi`, /name/],
  ];
  for (const [text, re] of cases) {
    const r = parseAgentFile(text, 'x');
    expect(r.ok, text).toBe(false);
    if (!r.ok) expect(r.error, text).toMatch(re);
  }
});

test('invalid YAML shows the parser reason', () => {
  const r = parseAgentFile('---\nname: [unclosed\n---\nHi', 'x');
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/^frontmatter: invalid YAML: /);
  expect(r.error).toContain('end with a ]');
  expect(r.error).not.toContain('\n');
  expect(parseAgentFile('no header', 'x')).toEqual({ ok: false, error: expect.stringContaining('missing') });
});

test('accepts CRLF files', () => {
  const r = parseAgentFile('---\r\nname: X\r\n---\r\nHi', 'x');
  expect(r.ok && r.agent.prompt).toBe('Hi');
});

test('validateAgent accepts a good agent and never throws on junk', () => {
  expect(validateAgent(AGENT)).toEqual({ ok: true, agent: AGENT });
  for (const junk of [null, undefined, 42, 'str', [], {}, { ...AGENT, tier: 'huge' }, { ...AGENT, skills: 'x' }, { ...AGENT, prompt: 7 }, { ...AGENT, engine: null }, { ...AGENT, id: 3 }]) {
    expect(validateAgent(junk).ok, JSON.stringify(junk)).toBe(false);
  }
});

test('parseEngineSetting and formatEngineSetting', () => {
  expect(parseEngineSetting('auto')).toEqual({ kind: 'auto' });
  expect(parseEngineSetting('claude')).toEqual({ kind: 'engine', engine: 'claude' });
  expect(parseEngineSetting('claude:opus')).toEqual({ kind: 'model', engine: 'claude', model: 'opus' });
  expect(parseEngineSetting('codex:gpt-6-luna')).toEqual({ kind: 'model', engine: 'codex', model: 'gpt-6-luna' });
  expect(parseEngineSetting('claude:gpt')).toBeUndefined();
  expect(parseEngineSetting('codex:')).toBeUndefined();
  expect(parseEngineSetting('gemini')).toBeUndefined();
  expect(formatEngineSetting({ kind: 'auto' })).toBe('Auto');
  expect(formatEngineSetting({ kind: 'engine', engine: 'claude' })).toBe('Claude Code');
  expect(formatEngineSetting({ kind: 'engine', engine: 'codex' })).toBe('Codex');
  expect(formatEngineSetting({ kind: 'model', engine: 'claude', model: 'opus' })).toBe('Claude Opus');
  expect(formatEngineSetting({ kind: 'model', engine: 'codex', model: 'gpt-6-luna' })).toBe('Codex gpt-6-luna');
});

test('agentId slugs', () => {
  expect(agentId('Città Planner!')).toBe('citta-planner');
  expect(agentId('***')).toBe('agent');
  expect(agentId('a'.repeat(100))).toHaveLength(64);
  expect(agentId('a'.repeat(63) + ' b')).toBe('a'.repeat(63));
});


const base: AgentDef = { id: 'backend_dev', name: 'Forge - Backend dev', description: 'd', engine: { kind: 'model', engine: 'claude', model: 'sonnet' }, tier: 'standard', skills: [], permissions: 'build', prompt: 'p' };

test('the profile fields round-trip through the file', () => {
  const a = { ...base, alias: 'Forge', role: 'Backend dev', avatar: 'face-03', lock: false };
  expect(parseAgentFile(serializeAgentFile(a), a.id)).toEqual({ ok: true, agent: a });
});

test('a file without the profile fields loads unchanged and an exact model counts as locked', () => {
  const r = parseAgentFile(serializeAgentFile(base), base.id);
  expect(r).toEqual({ ok: true, agent: base });
  expect(serializeAgentFile(base)).not.toMatch(/alias|role|avatar|lock/);
  expect(isLocked(base)).toBe(true);
  expect(isLocked({ ...base, lock: false })).toBe(false);
  expect(isLocked({ engine: { kind: 'auto' }, lock: true })).toBe(false); // nothing to lock
});

test.each([
  [{ avatar: 'face-25' }, 'avatar: must be a gallery face or custom'],
  [{ avatar: '../x' }, 'avatar: must be a gallery face or custom'],
  [{ alias: 'x'.repeat(41) }, 'alias: must be text of at most 40 characters'],
  [{ role: 'x'.repeat(61) }, 'role: must be text of at most 60 characters'],
  [{ lock: 'yes' }, 'lock: must be true or false'],
])('rejects %j', (extra, error) => {
  expect(validateAgent({ ...base, ...extra })).toEqual({ ok: false, error });
});

test('head-of-staff is a reserved username', () => {
  const error = 'username: head-of-staff is reserved';
  expect(parseAgentFile(serializeAgentFile(base), 'head-of-staff')).toEqual({ ok: false, error });
  expect(validateAgent({ ...base, id: 'head-of-staff' })).toEqual({ ok: false, error });
});

test('modelOptions lists only the engines found on this PC', () => {
  const values = (o: { value: string }[]) => o.map((x) => x.value);
  expect(values(modelOptions({ claude: true, codex: true }, ['gpt-x', 'gpt-x-luna'], { kind: 'auto' })))
    .toEqual(['auto', 'claude:haiku', 'claude:sonnet', 'claude:opus', 'codex:gpt-x', 'codex:gpt-x-luna']);
  expect(values(modelOptions({ claude: true, codex: false }, [], { kind: 'auto' }))).toEqual(['auto', 'claude:haiku', 'claude:sonnet', 'claude:opus']);
});

test('modelOptions keeps a setting it would not offer', () => {
  const legacy = modelOptions({ claude: true, codex: false }, [], { kind: 'engine', engine: 'codex' });
  expect(legacy.at(-1)).toEqual({ value: 'codex', label: 'Codex' });
  const gone = modelOptions({ claude: true, codex: true }, ['gpt-x'], { kind: 'model', engine: 'codex', model: 'gpt-old' });
  expect(gone.at(-1)).toEqual({ value: 'codex:gpt-old', label: 'Codex gpt-old' });
});

test('thread role context is never written to agent files', () => {
  expect(serializeAgentFile({ ...AGENT, threadRole: 'reviewer' })).not.toContain('threadRole');
});
