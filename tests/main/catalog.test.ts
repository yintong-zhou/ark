import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { validateAgent, type AgentDef } from '@shared/agent-file';
import { Catalog, SEED_AGENTS, importAgent, importableAgents } from '../../src/main/services/catalog';

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ark-catalog-'));
  dir = join(root, 'agents');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const agent = (id: string, name = id): AgentDef => ({
  id,
  name,
  description: 'd',
  engine: { kind: 'auto' },
  tier: 'light',
  skills: [],
  permissions: 'read-only',
  prompt: 'You are a test agent.',
});

test('saves, lists, gets and removes', () => {
  const c = new Catalog(dir);
  expect(c.list()).toEqual({ agents: [], invalid: [] }); // a missing dir is an empty catalog
  c.save(agent('zeta', 'Zeta'));
  c.save(agent('alpha', 'Alpha'));
  expect(c.list().agents.map((a) => a.name)).toEqual(['Alpha', 'Zeta']);
  expect(c.get('alpha')).toEqual(agent('alpha', 'Alpha'));
  expect(c.get('nope')).toBeUndefined();
  c.remove('alpha');
  expect(c.get('alpha')).toBeUndefined();
  expect(c.list().agents.map((a) => a.id)).toEqual(['zeta']);
});

test('lists invalid files without failing', () => {
  const c = new Catalog(dir);
  c.save(agent('good'));
  writeFileSync(join(dir, 'x.md'), 'no header here');
  const { agents, invalid } = c.list();
  expect(agents.map((a) => a.id)).toEqual(['good']);
  expect(invalid).toHaveLength(1);
  expect(invalid[0].file).toBe('x.md');
  expect(invalid[0].error).toContain('frontmatter');
});

test('seeds once', () => {
  const c = new Catalog(dir);
  c.seedIfEmpty();
  expect(readdirSync(dir).filter((f) => f.endsWith('.md'))).toHaveLength(7);
  c.remove('seo');
  c.seedIfEmpty();
  expect(readdirSync(dir).filter((f) => f.endsWith('.md'))).toHaveLength(6);
});

test('every seed is a valid agent with a safe id', () => {
  expect(SEED_AGENTS.map((a) => a.id)).toEqual([
    'project-manager', 'planner', 'developer', 'code-reviewer', 'security-reviewer', 'marketing', 'seo',
  ]);
  for (const a of SEED_AGENTS) {
    expect(validateAgent(a)).toEqual({ ok: true, agent: a });
    expect(a.prompt).toContain(`You are ${a.name}, a member of a small team working in Ark.`);
  }
});

test('refuses unsafe ids', () => {
  const c = new Catalog(dir);
  expect(() => c.save(agent('../x'))).toThrow();
  expect(() => c.save(agent('A'))).toThrow();
  expect(() => c.remove('../x')).toThrow();
  expect(c.get('../x')).toBeUndefined();
});

function fixtureClaude(): string {
  const cfg = join(root, 'claude');
  const install = join(root, 'plugin-install');
  mkdirSync(join(cfg, 'agents'), { recursive: true });
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  mkdirSync(join(install, 'agents'), { recursive: true });
  writeFileSync(join(cfg, 'agents', 'mine.md'), '---\nname: mine\ndescription: m\n---\nbody\n');
  writeFileSync(join(install, 'agents', 'code-reviewer.md'), '---\nname: code-reviewer\ndescription: r\n---\nbody\n');
  writeFileSync(
    join(cfg, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'agent-skills@official': [{ scope: 'user', installPath: install }] } }),
  );
  return cfg;
}

test('finds plugin agents through installed_plugins.json', () => {
  const found = importableAgents(fixtureClaude());
  expect(found.map(({ name, source }) => ({ name, source }))).toEqual([
    { name: 'mine', source: 'Claude Code' },
    { name: 'code-reviewer', source: 'agent-skills' },
  ]);
  expect(importableAgents(join(root, 'nowhere'))).toEqual([]);
});

test('imports a Claude agent', () => {
  const file = join(root, 'sec.md');
  writeFileSync(file, '---\nname: Security Auditor\ndescription: audits\nmodel: sonnet\ntools: Read, Grep\n---\nYou audit.\n');
  expect(importAgent(file)).toEqual({
    id: 'security-auditor',
    name: 'Security Auditor',
    description: 'audits',
    engine: { kind: 'model', engine: 'claude', model: 'sonnet' },
    tier: 'standard',
    skills: [],
    permissions: 'read-only',
    prompt: 'You audit.',
  });
  writeFileSync(file, 'broken');
  expect(() => importAgent(file)).toThrow(/frontmatter/);
});
