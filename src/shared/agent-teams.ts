import { AGENT_ID_RE, type AgentDef } from './agent-file';

/** A user-made group of catalog agents. Ark's own data: never part of an agent file, never seen by an engine. */
export type AgentTeam = { id: string; name: string };
export type AgentTeams = { teams: AgentTeam[]; members: Record<string, string> }; // agent id -> team id
export const EMPTY_TEAMS: AgentTeams = { teams: [], members: {} };
export const MAX_TEAMS = 50;
export const MAX_TEAM_NAME = 40;

const nameError = (teams: AgentTeam[], name: string, except?: string): string | undefined => {
  if (!name) return 'Give the team a name';
  if (name.length > MAX_TEAM_NAME) return `Team names are up to ${MAX_TEAM_NAME} characters`;
  const low = name.toLowerCase();
  if (teams.some((t) => t.id !== except && t.name.toLowerCase() === low)) return 'A team with that name already exists';
  return undefined;
};

/** Never throws: anything malformed becomes an empty (or trimmed-down) document. */
export function validateAgentTeams(raw: unknown): AgentTeams {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as AgentTeams).teams)) return EMPTY_TEAMS;
  const teams: AgentTeam[] = [];
  for (const t of (raw as AgentTeams).teams) {
    if (teams.length >= MAX_TEAMS) break;
    if (typeof t?.id !== 'string' || !t.id || typeof t.name !== 'string') continue;
    const name = t.name.trim();
    if (teams.some((x) => x.id === t.id) || nameError(teams, name)) continue;
    teams.push({ id: t.id, name });
  }
  const members: Record<string, string> = {};
  const given = (raw as AgentTeams).members;
  if (typeof given === 'object' && given !== null) {
    for (const [agent, team] of Object.entries(given)) {
      if (AGENT_ID_RE.test(agent) && typeof team === 'string' && teams.some((t) => t.id === team)) members[agent] = team;
    }
  }
  return { teams, members };
}

export function createTeam(t: AgentTeams, name: string, id: string): AgentTeams {
  const n = name.trim();
  const err = nameError(t.teams, n);
  if (err) throw new Error(err);
  if (t.teams.length >= MAX_TEAMS) throw new Error('Too many teams');
  return { ...t, teams: [...t.teams, { id, name: n }] };
}

export function renameTeam(t: AgentTeams, id: string, name: string): AgentTeams {
  const n = name.trim();
  const err = nameError(t.teams, n, id);
  if (err) throw new Error(err);
  return { ...t, teams: t.teams.map((x) => (x.id === id ? { ...x, name: n } : x)) };
}

export function deleteTeam(t: AgentTeams, id: string): AgentTeams {
  return {
    teams: t.teams.filter((x) => x.id !== id),
    members: Object.fromEntries(Object.entries(t.members).filter(([, team]) => team !== id)),
  };
}

/** `teamId` null = Ungrouped. */
export function assignAgent(t: AgentTeams, agentId: string, teamId: string | null): AgentTeams {
  const members = { ...t.members };
  if (teamId === null) delete members[agentId];
  else {
    if (!t.teams.some((x) => x.id === teamId)) throw new Error('Unknown team');
    members[agentId] = teamId;
  }
  return { ...t, members };
}

/** Mirrors a ready team: reuses the team with that id, else the one with that name, else creates it. Only agents with no team yet join. */
export function adoptReadyTeam(t: AgentTeams, ready: { id: string; name: string }, agentIds: string[]): AgentTeams {
  const low = ready.name.toLowerCase();
  let next = t;
  let team = t.teams.find((x) => x.id === ready.id) ?? t.teams.find((x) => x.name.toLowerCase() === low);
  if (!team) {
    next = createTeam(t, ready.name, ready.id);
    team = next.teams[next.teams.length - 1];
  }
  const members = { ...next.members };
  for (const id of agentIds) if (!members[id]) members[id] = team.id;
  return { ...next, members };
}

export type TeamGroup = { team: AgentTeam | null; agents: AgentDef[] };

/** Teams in saved order (empty ones too), then Ungrouped (team: null) when it has agents. */
export function groupAgents(agents: AgentDef[], t: AgentTeams): TeamGroup[] {
  const known = new Set(t.teams.map((x) => x.id));
  const groups: TeamGroup[] = t.teams.map((team) => ({ team, agents: agents.filter((a) => t.members[a.id] === team.id) }));
  const rest = agents.filter((a) => !known.has(t.members[a.id]));
  return rest.length ? [...groups, { team: null, agents: rest }] : groups;
}
