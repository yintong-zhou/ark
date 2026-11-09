import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { AGENT_ID_RE, validateAgent, type AgentDef } from '@shared/agent-file';
import { Catalog, importAgent, importableAgents } from '../../src/main/services/catalog';
import { IT_SERVICES_AGENTS } from '../../src/main/services/it-services';
import { THREAD_AGENTS } from '../../src/main/services/thread-agents';

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

test('IT Services profiles match the source directory, with the human outside the catalog', () => {
  const doc = readFileSync('docs/agents/it-services.md', 'utf8');
  const directory = [...doc.matchAll(/^\| (\w+) \| `@(\w+)` \| ([^|]+) \| `@(\w+)` \|\r?$/gm)];
  expect(directory).toHaveLength(14);
  expect(IT_SERVICES_AGENTS.map((a) => a.id)).toEqual(directory.map((m) => m[2]));
  expect(new Set(IT_SERVICES_AGENTS.map((a) => a.id)).size).toBe(IT_SERVICES_AGENTS.length);
  for (const a of IT_SERVICES_AGENTS) {
    expect(validateAgent(a)).toEqual({ ok: true, agent: a });
    expect(a.id).toMatch(AGENT_ID_RE);
  }
  for (const [, alias, id, role, manager] of directory) {
    const a = IT_SERVICES_AGENTS.find((x) => x.id === id)!;
    expect(a.name).toBe(`${alias} - ${role.trim()}`);
    expect(a.prompt).toContain(`Your username is @${id}`);
    expect(a.prompt).toContain(`You report to @${manager}`);
    expect(a.prompt).toContain('L3: propose and wait for explicit human approval');
    expect(a.prompt).toContain('Written handoffs include objective, materials, acceptance criteria and deadline');
    expect(a.prompt).toContain('Only Ark\'s developer implements an approved plan');
    expect(a).toMatchObject({ engine: { kind: 'auto' }, permissions: 'read-only', skills: [] });
  }
  expect(IT_SERVICES_AGENTS.some((a) => a.id === 'head_of_engineering')).toBe(false);
});

test('adding IT Services preserves customized, unrelated and broken profiles; repeated adds are safe', () => {
  const c = new Catalog(dir);
  c.save(agent('product_manager', 'Custom Nova'));
  c.save(agent('project-manager', 'Existing coordinator'));
  writeFileSync(join(dir, 'security.md'), 'broken profile to fix manually');
  const result = c.addItServices();
  expect(result.added).toHaveLength(12);
  expect(result.skipped).toEqual(['product_manager', 'security']);
  expect(c.get('product_manager')?.name).toBe('Custom Nova');
  expect(c.get('project-manager')?.name).toBe('Existing coordinator');
  expect(readFileSync(join(dir, 'security.md'), 'utf8')).toBe('broken profile to fix manually');
  expect(c.list().invalid).toEqual([{ file: 'security.md', error: expect.any(String) }]);
  expect(c.addItServices()).toEqual({ added: [], skipped: IT_SERVICES_AGENTS.map((a) => a.id) });
  c.remove('frontend_dev');
  expect(c.get('frontend_dev')).toBeUndefined();
  expect(c.addItServices().added).toEqual(['frontend_dev']); // explicit request restores it
});

test('adding thread roles preserves existing profiles and supplies valid required roles', () => {
  const c = new Catalog(dir);
  c.save(agent('project-manager', 'Custom coordinator'));
  writeFileSync(join(dir, 'code-reviewer.md'), 'broken profile');
  expect(c.addThreadAgents()).toEqual({ added: [], skipped: ['project-manager'] });
  expect(c.get('project-manager')?.name).toBe('Custom coordinator');
  expect(readFileSync(join(dir, 'code-reviewer.md'), 'utf8')).toBe('broken profile');
  expect(c.get('developer')).toBeUndefined();
  expect(c.get('security-reviewer')).toBeUndefined();
  for (const role of THREAD_AGENTS) expect(validateAgent(role).ok).toBe(true);
  expect(c.addThreadAgents().added).toEqual([]);
});

test('the default catalog adds only the project manager and preserves existing profiles', () => {
  const c = new Catalog(dir);
  expect(c.addDefaultAgent()).toEqual({ added: ['project-manager'], skipped: [] });
  expect(c.list().agents.map((a) => a.id)).toEqual(['project-manager']);
  expect(c.get('project-manager')?.name).toBe('Alex - Project manager');
  c.save(agent('project-manager', 'Custom coordinator'));
  expect(c.addDefaultAgent()).toEqual({ added: [], skipped: ['project-manager'] });
  expect(c.get('project-manager')?.name).toBe('Custom coordinator');
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
