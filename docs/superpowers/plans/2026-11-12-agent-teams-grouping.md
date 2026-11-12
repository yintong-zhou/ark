# Agent Teams Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Agents page groups the catalog agents by team; the user creates, renames and deletes teams and moves agents between them, so the list stays manageable as it grows.

**Architecture:** Membership is Ark's own data, not part of the agent file: one `agent-teams.json` in `%APPDATA%\ark` holds the teams and which team each agent belongs to (one team per agent, an agent without a team is "Ungrouped"). Pure logic (validate, create, rename, delete, assign, group) lives in `src/shared/agent-teams.ts`; main only reads, validates and atomically writes the whole document; the renderer edits it through the pure functions and saves it. The built-in "ready teams" (`services/teams.ts`) are unrelated templates; adding one also creates a matching team.

**Tech Stack:** Electron IPC, React + Tailwind (brand tokens), vitest.

**Spec:** none written; the requirements are the user's request of 2026-11-12: "in the Agents section, group agents by team, allow creating teams and adding agents into teams, otherwise it becomes endless scrolling as agents grow".

## Global Constraints

- Hyphen (-) in place of an em dash, in code, docs and replies.
- UI text is English; colors, radii and fonts come from the tokens in `src/renderer/index.css` (no raw hex).
- Every IPC payload is validated in main (`validateAgentTeams`); the renderer never writes files.
- Agent files (`~/AppData/Roaming/ark/agents/*.md`) and `AgentDef` do not change; engines never see teams.
- Naming: "team" in the UI; in code `AgentTeam`, never `Team`/`TeamInfo` (taken by the ready teams and the thread team panel).
- Before done: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then launch `npm run dev` and check the page.

## Review Focus

- `agent-teams.json` missing, corrupt JSON or wrong shape: the page shows every agent as Ungrouped, nothing crashes, the next save rewrites a valid file.
- An agent whose team was deleted, or whose id is not in the catalog any more: shown Ungrouped / ignored, never lost from the list.
- Team name blank, only spaces, over 40 characters, or equal (case-insensitive) to another team: refused with a message, no change.
- Deleting an agent removes its membership, so a new agent reusing the id does not join the old team.
- A team with no agents: still listed with an empty state and its Delete button; 100+ agents under one team stay usable (each group collapses by hand and the choice is remembered).

---

### Task 1: Pure team logic

**Files:**
- Create: `src/shared/agent-teams.ts`
- Test: `tests/shared/agent-teams.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AgentTeam = { id: string; name: string };
  export type AgentTeams = { teams: AgentTeam[]; members: Record<string, string> }; // agent id -> team id
  export const EMPTY_TEAMS: AgentTeams;
  export const MAX_TEAMS = 50; export const MAX_TEAM_NAME = 40;
  export function validateAgentTeams(raw: unknown): AgentTeams;           // never throws: bad input -> EMPTY_TEAMS; drops members of unknown teams and ids failing AGENT_ID_RE
  export function createTeam(t: AgentTeams, name: string, id: string): AgentTeams;   // throws Error with a user-facing message
  export function renameTeam(t: AgentTeams, id: string, name: string): AgentTeams;   // throws
  export function deleteTeam(t: AgentTeams, id: string): AgentTeams;                 // its members become Ungrouped
  export function assignAgent(t: AgentTeams, agentId: string, teamId: string | null): AgentTeams; // null = Ungrouped; throws on unknown team
  export function adoptReadyTeam(t: AgentTeams, ready: { id: string; name: string }, agentIds: string[]): AgentTeams; // uses team with that id, else the one with that name, else creates it; assigns only agents with no team yet
  export type TeamGroup = { team: AgentTeam | null; agents: AgentDef[] };
  export function groupAgents(agents: AgentDef[], t: AgentTeams): TeamGroup[];      // teams in saved order (empty ones included), then the Ungrouped group (team: null) last, omitted when empty; agents keep their input order
  ```
- Name rules (shared by create and rename): trimmed, 1 to `MAX_TEAM_NAME` chars, unique case-insensitively. Messages: `'Give the team a name'`, `'Team names are up to 40 characters'`, `'A team with that name already exists'`, `'Too many teams'`.

- [ ] **Step 1: Write the failing tests** in `tests/shared/agent-teams.test.ts`, one `test` each:
  - `validateAgentTeams` returns `EMPTY_TEAMS` for `null`, `'x'`, `{}`, `{ teams: 3 }`; keeps `{ teams: [{ id: 'a', name: 'A' }], members: { x: 'a', y: 'gone', 'BAD ID': 'a' } }` as members `{ x: 'a' }`.
  - `createTeam` trims (`'  Dev '` -> name `'Dev'`), appends in order, and rejects `''`, `'   '`, a 41-char name, `'dev'` when `'Dev'` exists, and the 51st team.
  - `renameTeam` allows renaming to its own name in a different case, rejects another team's name.
  - `deleteTeam` removes the team and its members entries only; other teams' members stay.
  - `assignAgent(t, 'x', null)` removes the entry; moving `x` from team a to b leaves one entry; unknown team throws.
  - `adoptReadyTeam` creates `{ id: 'it-services', name: 'IT Services' }` with all agents; a second call with a new agent id adds only that one; an agent already in a user team stays there; when a user team already named `'it services'` exists it is reused and no second team appears.
  - `groupAgents`: 3 agents, 2 teams (one empty), one agent without team and one whose team id is unknown -> groups `[teamA, teamB(empty), null]`, the last holding both Ungrouped agents in input order; no Ungrouped group when every agent has a team.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/shared/agent-teams.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/shared/agent-teams.ts` with the signatures above. All functions are pure and return new objects. `validateAgentTeams` filters teams to well-formed `{ id: string, name: string }` with a valid name and no duplicate id, capped at `MAX_TEAMS`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/shared/agent-teams.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (message via file, see memory note on PowerShell 5.1)

```bash
git add src/shared/agent-teams.ts tests/shared/agent-teams.test.ts
git commit -F msg.txt   # "feat: pure logic for grouping agents into teams"
```

---

### Task 2: Storage, IPC and cleanup

**Files:**
- Create: `src/main/services/agent-teams.ts`
- Modify: `src/main/ipc/index.ts` (handlers near `catalog:*`, lines ~176-206; `Deps` at line ~40), `src/main/index.ts` (construct the store next to `new Catalog(...)`, line ~89, pass it to `registerIpc`), `src/preload/index.ts` (`catalog` block, line ~42), `src/shared/types.ts` (`catalog` API type, line ~97)
- Test: `tests/main/agent-teams.test.ts`

**Interfaces:**
- Consumes: Task 1's `AgentTeams`, `validateAgentTeams`, `assignAgent`, `adoptReadyTeam`; `writeAtomic` from `./files`.
- Produces:
  ```ts
  export class AgentTeamsStore { constructor(file: string);
    read(): AgentTeams;                 // missing or corrupt file -> EMPTY_TEAMS
    write(t: unknown): AgentTeams;      // validates, writes atomically (creates the folder), returns what was written
  }
  // preload / window.ark.catalog:
  agentTeams(): Promise<AgentTeams>;   // channel 'catalog:agent-teams'
  saveAgentTeams(t: AgentTeams): Promise<AgentTeams>;   // channel 'catalog:save-agent-teams'
  ```
  Handler side effects: `catalog:remove` also does `store.write(assignAgent(store.read(), safeId, null))`; `catalog:add-team` after `catalog.addTeam(id)` does `store.write(adoptReadyTeam(store.read(), { id, name }, present ids of that ready team))` where the present ids are the ready team's agent ids whose file exists (the same check `Catalog.teams()` uses; expose it as `Catalog.presentIds(teamId): string[]`).

- [ ] **Step 1: Write the failing tests** in `tests/main/agent-teams.test.ts` (temp dir like `catalog.test.ts`):
  - `read()` on a missing file and on a file containing `{not json` returns `EMPTY_TEAMS`.
  - `write({ teams: [{ id: 'a', name: 'A' }], members: { x: 'a' } })` then a new store's `read()` equals it; the folder is created.
  - `write('garbage')` writes and returns `EMPTY_TEAMS` (never throws, never writes junk).
  - `new Catalog(dir).presentIds('it-services')` is `[]` on an empty catalog and the saved ids after `addTeam('it-services')`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/main/agent-teams.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `AgentTeamsStore`, `Catalog.presentIds`, the two handlers (payload goes through `validateAgentTeams` via `store.write`), the `catalog:remove` and `catalog:add-team` side effects, the preload entries and the type entries. File path: `join(userData, 'agent-teams.json')`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/main/agent-teams.test.ts tests/main/catalog.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit** - `feat: store agent teams and keep them in step with the catalog`

---

### Task 3: Grouped Agents page

**Files:**
- Modify: `src/renderer/hooks/useCatalog.ts` (load `agentTeams()` in `fetchAll`, return `agentTeams` and `saveAgentTeams: (t: AgentTeams) => Promise<void>` that saves then updates state), `src/renderer/pages/Agents.tsx` (replace the flat `catalog?.agents.map(Row)` list)
- Create: `src/renderer/components/AgentTeamSection.tsx` (one team's header and rows, to keep `Agents.tsx` from growing)

**Interfaces:**
- Consumes: Task 1 functions and Task 2 `window.ark.catalog.agentTeams/saveAgentTeams`.
- Produces: `AgentTeamSection({ group: TeamGroup; teams: AgentTeam[]; open: boolean; onToggle(): void; onRename(name: string): Promise<void>; onDelete(): void; onMove(agentId: string, teamId: string | null): void; renderRow(a: AgentDef, move: ReactNode): ReactNode })`. `Row` gains an optional `move?: ReactNode` slot rendered before Chat/Edit.

Behavior (no unit tests: the repo has no React test setup; verified in Step 3):
- Head of Staff row stays at the top, outside any team.
- Header bar "New team": a button that opens an inline name field (Enter creates, Escape cancels); errors from Task 1 show under it with `role="alert"`; id from `crypto.randomUUID()`.
- Each group renders a header: chevron toggle, team name (`head`), count (`Team - 3` style per brand-guidelines), and for real teams Rename and Delete buttons. Delete asks `confirmAction` ("Delete team X? Its N agents move to Ungrouped. The agents themselves are kept."), no confirm needed when empty.
- Each agent row has a "Move to" `<select>` (`INPUT` style, `aria-label="Team of <name>"`) with Ungrouped plus every team; choosing calls `assignAgent` then save.
- Open/closed state per team id (and `ungrouped`) persists in `localStorage` key `ark-agent-teams-open`, wrapped in try/catch, default open.
- An empty team shows "No agents yet. Move agents here from their Team menu." The Ungrouped group is hidden when empty and there are teams; with no teams at all the page looks as it does today (a flat list, no group header).
- A failed save shows the error through the page's existing `problem` state and reloads.

- [ ] **Step 1: Implement** the hook change, `AgentTeamSection` and the page wiring as described.
- [ ] **Step 2: Run the checks**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 3: Verify in the app**

Run: `npm run dev`. In Agents: create a team, move two agents into it, reload the window (Ctrl+R): groups and collapsed state persist; delete the team: its agents return to Ungrouped; try a blank and a duplicate name; check dark and light themes (Settings > Appearance); delete an agent that was in a team, create one with the same id: it is Ungrouped. Add the ready team "IT Services" on a fresh catalog: an "IT Services" team appears holding its agents.

- [ ] **Step 4: Commit** - `feat: group agents by team on the Agents page`

---

### Task 4: Docs

**Files:**
- Modify: `README.md` (the agents section), `CLAUDE.md` (the "User data" line: add `agent-teams.json` next to the folders)

- [ ] **Step 1:** Add two sentences to the README agents section (teams group agents in the catalog, one team per agent, they have no effect on how the Head of Staff builds a thread) and add `agent-teams.json` to the user-data list in `CLAUDE.md`.
- [ ] **Step 2:** `git add README.md CLAUDE.md` and commit - `docs: agent teams`

---

## Self-review

- **Coverage:** group by team (Task 3), create teams (T1 `createTeam`, T3 UI), add agents into teams (T1 `assignAgent`, T3 Move to), rename/delete (T1, T3), persistence and agent-delete hygiene (T2), growth handling via collapse (T3). Not done on purpose: search/filter box, drag and drop, an agent in several teams, using teams to pre-select the Head of Staff's team. Say so if you want any of them.
- **Types:** `AgentTeam`/`AgentTeams`/`TeamGroup` are defined once in Task 1 and used unchanged in Tasks 2 and 3; IPC names `catalog:agent-teams` and `catalog:save-agent-teams` match preload and handler.
- **Open choice the plan makes for you:** one team per agent (a section per team needs no duplicates). Multi-membership would change `members` to `Record<string, string[]>` in Task 1 only.
