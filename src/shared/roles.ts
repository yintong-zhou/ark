import type { AgentDef } from './agent-file';
import { MANAGER, type Control, type ReviewKind, type Roles, type Thread } from './thread';

export type Lookup = (id: string) => AgentDef | undefined;
export function mergeRoles(now: Roles | undefined, change: Partial<Roles>): Roles {
  return { builders: [], ...now, ...change };
}

export function checkRoles(change: Partial<Roles>, now: Roles | undefined, team: string[], agent: Lookup): string | undefined {
  const roles = mergeRoles(now, change);
  const ids = [roles.planner, ...roles.builders, roles.codeReview, roles.securityReview].filter((id): id is string => !!id);
  for (const id of ids) if (!team.includes(id)) return `ark block: ${id} has a role but is not on the team`;
  for (const id of ids) if (!agent(id)) return `ark block: unknown agent: ${id}`;
  for (const id of roles.builders) if (agent(id)?.permissions !== 'build') return `ark block: ${id} cannot change files, so it cannot build`;
  for (const id of [roles.codeReview, roles.securityReview]) if (id && roles.builders.includes(id)) return `ark block: ${id} builds in this thread, so it cannot review it`;
  return undefined;
}

export function checkProposal(c: Extract<Control, { kind: 'team' }>, agent: Lookup): string | undefined {
  const team = c.picks.map((p) => p.agent);
  if (team.includes(MANAGER)) return 'ark block: the Head of Staff is already on the team';
  for (const id of team) if (!agent(id)) return `ark block: unknown agent: ${id}`;
  const error = checkRoles(c.roles ?? {}, undefined, team, agent);
  if (error) return error;
  if (c.difficulty === 'easy' && c.roles && !c.roles.builders.length) return 'ark block: an easy request needs a builder';
  if (c.difficulty !== 'easy' && c.roles?.builders.length && !c.roles.planner) return 'ark block: name the planner';
  return undefined;
}

export function roleLabels(roles: Roles | undefined, id: string): string[] {
  return [roles?.planner === id && 'Plans', roles?.builders.includes(id) && 'Builds', roles?.codeReview === id && 'Code review', roles?.securityReview === id && 'Security review'].filter((s): s is string => !!s);
}

export function rolesLine(roles: Roles, names: Record<string, string>): string {
  const name = (id: string) => names[id] ?? id;
  const builders = roles.builders.map(name);
  const joined = builders.length > 1 ? `${builders.slice(0, -1).join(', ')} and ${builders.at(-1)}` : builders[0];
  const parts = [roles.planner && `${name(roles.planner)} plans`, joined && `${joined} build`, roles.codeReview && `${name(roles.codeReview)} reviews code`, roles.securityReview && `${name(roles.securityReview)} reviews security`].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : '';
}

export function reviewer(t: Pick<Thread, 'roles'>, kind: ReviewKind): string | undefined {
  return kind === 'code' ? t.roles?.codeReview : t.roles?.securityReview;
}

export function buildProblem(t: Pick<Thread, 'roles'>, agent: Lookup): string | undefined {
  if (!t.roles?.builders.length) return 'No agent on this thread can build. Ask the Head of Staff to pick a builder, or create one in Agents.';
  for (const id of t.roles.builders) {
    const a = agent(id);
    if (!a) return `${id} is no longer in the catalog.`;
    if (a.permissions !== 'build') return `${id} can no longer change files.`;
  }
  for (const id of [t.roles.codeReview, t.roles.securityReview]) if (id && !agent(id)) return `${id} is no longer in the catalog.`;
  return undefined;
}

export function missingReviews(t: Pick<Thread, 'roles' | 'waived'>): ReviewKind[] {
  return (['code', 'security'] as const).filter((kind) => !reviewer(t, kind) && !t.waived?.includes(kind));
}
