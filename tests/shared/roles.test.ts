import { expect, test } from 'vitest';
import type { AgentDef } from '@shared/agent-file';
import { MANAGER, type Control } from '@shared/thread';
import { buildProblem, missingReviews, checkProposal, checkRoles, mergeRoles, reviewer, roleLabels, rolesLine } from '@shared/roles';

const def = (id: string, permissions: AgentDef['permissions'] = 'read-only'): AgentDef =>
  ({ id, name: id, description: '', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions, prompt: 'p' });
const catalog = [def('pm'), def('dev', 'build'), def('ui', 'build'), def('rev'), def('sec')];
const get = (id: string) => catalog.find((a) => a.id === id);
const team = (o: Partial<Extract<Control, { kind: 'team' }>> = {}, ids = ['pm', 'dev', 'rev']): Extract<Control, { kind: 'team' }> =>
  ({ kind: 'team', picks: ids.map((agent) => ({ agent, reason: 'r' })), leftOut: '', ...o });

test('a complete proposal passes, and so does one with no roles at all', () => {
  expect(checkProposal(team({ difficulty: 'hard', roles: { planner: 'pm', builders: ['dev'], codeReview: 'rev' } }), get)).toBeUndefined();
  expect(checkProposal(team({ difficulty: 'hard' }), get)).toBeUndefined(); // a question: nobody builds
});

test.each([
  [team({}, ['pm', 'ghost']), 'ark block: unknown agent: ghost'],
  [team({}, ['pm', MANAGER]), 'ark block: the Head of Staff is already on the team'],
  [team({ roles: { planner: 'pm', builders: ['ui'] } }), 'ark block: ui has a role but is not on the team'],
  [team({ roles: { planner: 'pm', builders: ['rev'] } }), 'ark block: rev cannot change files, so it cannot build'],
  [team({ roles: { planner: 'pm', builders: ['dev'], codeReview: 'dev' } }), 'ark block: dev builds in this thread, so it cannot review it'],
  [team({ difficulty: 'easy', roles: { builders: [] } }), 'ark block: an easy request needs a builder'],
  [team({ difficulty: 'hard', roles: { builders: ['dev'] } }), 'ark block: name the planner'],
])('rejects a bad proposal %#', (c, error) => {
  expect(checkProposal(c, get)).toBe(error);
});

test('an easy proposal needs no planner', () => {
  expect(checkProposal(team({ difficulty: 'easy', roles: { builders: ['dev'], codeReview: 'rev' } }), get)).toBeUndefined();
});

test('an easy request that changes no files needs no builder', () => {
  expect(checkProposal(team({ difficulty: 'easy' }), get)).toBeUndefined();
});

test('a change of roles is checked against the team and the roles already set', () => {
  const now = { planner: 'pm', builders: ['dev'] };
  expect(checkRoles({ codeReview: 'rev' }, now, ['pm', 'dev', 'rev'], get)).toBeUndefined();
  expect(checkRoles({ codeReview: 'dev' }, now, ['pm', 'dev', 'rev'], get)).toBe('ark block: dev builds in this thread, so it cannot review it');
  expect(checkRoles({ builders: ['ui'] }, now, ['pm', 'dev', 'rev'], get)).toBe('ark block: ui has a role but is not on the team');
  expect(mergeRoles(now, { builders: ['dev', 'ui'], codeReview: 'rev' })).toEqual({ planner: 'pm', builders: ['dev', 'ui'], codeReview: 'rev' });
  expect(mergeRoles(undefined, { codeReview: 'rev' })).toEqual({ builders: [], codeReview: 'rev' });
});

test('labels and the roles line', () => {
  const roles = { planner: 'pm', builders: ['dev', 'ui'], codeReview: 'rev', securityReview: 'rev' };
  expect(roleLabels(roles, 'rev')).toEqual(['Code review', 'Security review']);
  expect(roleLabels(roles, 'dev')).toEqual(['Builds']);
  expect(roleLabels(undefined, 'dev')).toEqual([]);
  expect(rolesLine(roles, { pm: 'Jarvis', dev: 'Forge', ui: 'Gon', rev: 'Orion' })).toBe('Jarvis plans; Forge and Gon build; Orion reviews code; Orion reviews security.');
  expect(reviewer({ roles }, 'security')).toBe('rev');
  expect(reviewer({}, 'code')).toBeUndefined();
});

test('buildProblem says why a build cannot start', () => {
  expect(buildProblem({}, get)).toBe('No agent on this thread can build. Ask the Head of Staff to pick a builder, or create one in Agents.');
  expect(buildProblem({ roles: { builders: [] } }, get)).toContain('No agent on this thread can build');
  expect(buildProblem({ roles: { builders: ['gone'] } }, get)).toBe('gone is no longer in the catalog.');
  expect(buildProblem({ roles: { builders: ['rev'] } }, get)).toBe('rev can no longer change files.');
  expect(buildProblem({ roles: { builders: ['dev'], codeReview: 'gone' } }, get)).toBe('gone is no longer in the catalog.');
  expect(buildProblem({ roles: { builders: ['dev'], codeReview: 'rev' } }, get)).toBeUndefined();
});

test('missingReviews lists the empty slots the user has not waived', () => {
  expect(missingReviews({ roles: { builders: ['dev'] } })).toEqual(['code', 'security']);
  expect(missingReviews({ roles: { builders: ['dev'], codeReview: 'rev' }, waived: ['security'] })).toEqual([]);
});
