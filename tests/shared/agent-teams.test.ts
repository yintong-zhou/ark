import { describe, expect, test } from 'vitest';
import type { AgentDef } from '../../src/shared/agent-file';
import { EMPTY_TEAMS, adoptReadyTeam, assignAgent, createTeam, deleteTeam, groupAgents, renameTeam, validateAgentTeams, type AgentTeams } from '../../src/shared/agent-teams';

const T: AgentTeams = { teams: [{ id: 'a', name: 'Dev' }, { id: 'b', name: 'Ops' }], members: { x: 'a', y: 'b' } };
const ag = (id: string) => ({ id }) as AgentDef;

describe('agent teams', () => {
  test('validate: bad input is empty', () => {
    for (const bad of [null, 'x', {}, { teams: 3 }]) expect(validateAgentTeams(bad)).toEqual(EMPTY_TEAMS);
  });
  test('validate: drops members of unknown teams and bad ids', () => {
    const r = validateAgentTeams({ teams: [{ id: 'a', name: 'A' }], members: { x: 'a', y: 'gone', 'BAD ID': 'a' } });
    expect(r.members).toEqual({ x: 'a' });
  });
  test('createTeam trims, appends and refuses bad names', () => {
    expect(createTeam(T, '  QA ', 'c').teams.map((t) => t.name)).toEqual(['Dev', 'Ops', 'QA']);
    for (const bad of ['', '   ', 'x'.repeat(41), 'dev']) expect(() => createTeam(T, bad, 'c')).toThrow();
    let big = EMPTY_TEAMS;
    for (let i = 0; i < 50; i++) big = createTeam(big, `t${i}`, `i${i}`);
    expect(() => createTeam(big, 'one more', 'z')).toThrow('Too many teams');
  });
  test('renameTeam', () => {
    expect(renameTeam(T, 'a', 'DEV').teams[0].name).toBe('DEV');
    expect(() => renameTeam(T, 'a', 'ops')).toThrow('already exists');
  });
  test('deleteTeam only drops its own members', () => {
    expect(deleteTeam(T, 'a')).toEqual({ teams: [T.teams[1]], members: { y: 'b' } });
  });
  test('assignAgent', () => {
    expect(assignAgent(T, 'x', null).members).toEqual({ y: 'b' });
    expect(assignAgent(T, 'x', 'b').members).toEqual({ x: 'b', y: 'b' });
    expect(() => assignAgent(T, 'x', 'nope')).toThrow();
  });
  test('adoptReadyTeam', () => {
    const ready = { id: 'it-services', name: 'IT Services' };
    const one = adoptReadyTeam(EMPTY_TEAMS, ready, ['p', 'q']);
    expect(one.teams).toEqual([ready]);
    expect(Object.keys(one.members)).toEqual(['p', 'q']);
    expect(Object.keys(adoptReadyTeam(one, ready, ['p', 'q', 'r']).members)).toHaveLength(3);
    expect(adoptReadyTeam(T, ready, ['x', 'z']).members.x).toBe('a');
    const named = adoptReadyTeam({ teams: [{ id: 'u', name: 'it services' }], members: {} }, ready, ['p']);
    expect(named.teams).toHaveLength(1);
    expect(named.members.p).toBe('u');
  });
  test('groupAgents', () => {
    const t: AgentTeams = { teams: [...T.teams], members: { x: 'a', z: 'gone' } };
    const g = groupAgents([ag('x'), ag('w'), ag('z')], t);
    expect(g.map((x) => x.team?.id ?? null)).toEqual(['a', 'b', null]);
    expect(g[1].agents).toEqual([]);
    expect(g[2].agents.map((a) => a.id)).toEqual(['w', 'z']);
    expect(groupAgents([ag('x')], T).some((x) => x.team === null)).toBe(false);
  });
});
