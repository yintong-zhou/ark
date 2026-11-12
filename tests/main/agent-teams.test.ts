import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { EMPTY_TEAMS } from '@shared/agent-teams';
import { AgentTeamsStore } from '../../src/main/services/agent-teams';
import { Catalog } from '../../src/main/services/catalog';
import { IT_SERVICES_AGENTS } from '../../src/main/services/it-services';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ark-teams-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('read: missing or corrupt file is empty', () => {
  const file = join(root, 'agent-teams.json');
  expect(new AgentTeamsStore(file).read()).toEqual(EMPTY_TEAMS);
  writeFileSync(file, '{not json');
  expect(new AgentTeamsStore(file).read()).toEqual(EMPTY_TEAMS);
});

test('write then read round-trips and creates the folder', () => {
  const file = join(root, 'sub', 'agent-teams.json');
  const doc = { teams: [{ id: 'a', name: 'A' }], members: { x: 'a' } };
  new AgentTeamsStore(file).write(doc);
  expect(existsSync(file)).toBe(true);
  expect(new AgentTeamsStore(file).read()).toEqual(doc);
});

test('write of garbage writes an empty document', () => {
  const file = join(root, 'agent-teams.json');
  const s = new AgentTeamsStore(file);
  expect(s.write('garbage')).toEqual(EMPTY_TEAMS);
  expect(s.read()).toEqual(EMPTY_TEAMS);
});

test('presentIds lists the ready team agents that exist', () => {
  const c = new Catalog(join(root, 'agents'));
  expect(c.presentIds('it-services')).toEqual([]);
  c.addTeam('it-services');
  expect(c.presentIds('it-services')).toEqual(IT_SERVICES_AGENTS.map((a) => a.id));
});
