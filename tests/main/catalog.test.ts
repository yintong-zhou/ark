import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { AGENT_ID_RE, serializeAgentFile, validateAgent, type AgentDef } from '@shared/agent-file';
import { Catalog, importAgent, importableAgents } from '../../src/main/services/catalog';
import { IT_SERVICES_AGENTS } from '../../src/main/services/it-services';

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
    expect(a.prompt).toContain('Code is written only during the build');
    expect(a).toMatchObject({ engine: { kind: 'auto' }, permissions: ['backend_dev', 'frontend_dev', 'mobile_dev'].includes(a.id) ? 'build' : 'read-only', skills: [] });
  }
  expect(IT_SERVICES_AGENTS.some((a) => a.id === 'head_of_engineering')).toBe(false);
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

test('list gives every agent a face without rewriting its file', () => {
  const catalog = new Catalog(dir);
  catalog.save(agent('one'));
  catalog.save(agent('two'));
  const before = readFileSync(join(dir, 'one.md'), 'utf8');
  expect(catalog.list().agents.map((a) => a.avatar).sort()).toEqual(['face-01', 'face-02']);
  expect(readFileSync(join(dir, 'one.md'), 'utf8')).toBe(before);
});

test('a file named head-of-staff.md is listed as invalid, never as an agent', () => {
  mkdirSync(dir, { recursive: true });
  const catalog = new Catalog(dir);
  writeFileSync(join(dir, 'head-of-staff.md'), serializeAgentFile(agent('x')));
  const { agents, invalid } = catalog.list();
  expect(agents.some((a) => a.id === 'head-of-staff')).toBe(false);
  expect(invalid).toEqual([{ file: 'head-of-staff.md', error: 'username: head-of-staff is reserved' }]);
});

test('teams lists the ready teams and how much of each is already here', () => {
  const catalog = new Catalog(dir);
  expect(catalog.teams()).toEqual([{ id: 'it-services', name: 'IT Services', description: expect.any(String), count: 14, present: 0 }]);
  catalog.save(agent('security')); // the user's own agent with a team username
  expect(catalog.teams()[0].present).toBe(1);
});

test('addTeam adds what is missing and keeps what is there, even a broken file', () => {
  const catalog = new Catalog(dir);
  catalog.save(agent('security', 'Mine'));
  writeFileSync(join(dir, 'tech_lead.md'), 'not an agent file');
  const r = catalog.addTeam('it-services');
  expect(r.added).toHaveLength(12);
  expect(r.skipped.sort()).toEqual(['security', 'tech_lead']);
  expect(catalog.get('security')!.name).toBe('Mine');
  expect(readFileSync(join(dir, 'tech_lead.md'), 'utf8')).toBe('not an agent file');
});

test('updateTeam rewrites every profile of the team and nothing else', () => {
  const catalog = new Catalog(dir);
  catalog.addTeam('it-services');
  catalog.save({ ...catalog.get('backend_dev')!, permissions: 'read-only', prompt: 'edited' });
  catalog.remove('qa_lead');
  writeFileSync(join(dir, 'tech_lead.md'), 'not an agent file');
  catalog.save(agent('mine'));
  expect(catalog.updateTeam('it-services').updated).toHaveLength(14);
  expect(catalog.get('backend_dev')).toMatchObject({ permissions: 'build', alias: 'Forge' });
  expect(catalog.get('qa_lead')).toBeDefined();
  expect(catalog.get('tech_lead')).toBeDefined();
  expect(catalog.get('mine')).toMatchObject({ id: 'mine' });
  expect(catalog.list().invalid).toEqual([]);
});

test('an unknown team is refused and nothing is written', () => {
  const catalog = new Catalog(dir);
  expect(() => catalog.addTeam('marketing')).toThrow('Unknown team');
  expect(() => catalog.updateTeam('../x')).toThrow('Unknown team');
  expect(catalog.list().agents).toEqual([]);
});
