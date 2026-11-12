# Head of Staff Implementation Plan (part 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Ark's built-in project manager, developer and reviewers with a built-in Head of Staff that routes each request, by difficulty, to the user's own planners, builders and reviewers.

**Architecture:** The thread keeps its phases (team, planning, build, done) and its two pure state machines (`rules.ts`, `build-rules.ts`). What changes is where roles come from: the Head of Staff names them in its team proposal, Ark checks them deterministically, and the thread stores them. The build loop reads the phase's builder and the review slots from the thread instead of fixed agent ids. The Head of Staff is an `AgentDef` built in code plus three user settings, never a catalog file.

**Tech Stack:** Electron main (Node 22), React 19 + Tailwind renderer, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-head-of-staff-design.md`, section 2. Requires part 1 (`2026-11-12-hos-1-agent-profile.md`) merged: this plan uses `isLocked`, `HEAD_FACE`, `AgentAvatar`, `ModelField`, `SkillsField` and `RESERVED_IDS` from it.

## Global Constraints

- UI text is English. Use a hyphen (-) in place of an em dash, in code, copy, prompts and commit messages.
- Do not weaken `engines/isolation.ts`. The Head of Staff is isolated like any agent.
- Writing happens only in the build phase, only by the current phase's builder, only inside the thread's worktree. An agent that can change files is read-only while the thread plans.
- `Full access` (`src/shared/permissions.ts`) stays the only approval bypass. A review is skipped only after the user allowed it on a card, in every permission mode.
- No engine call when the catalog has no agent.
- Existing threads, their history and their worktrees survive the upgrade.
- The thread's structure does not change: messages, `@` mentions, team card, question cards, plan card, phase cards, approval cards.
- Do not run `npm run test:live` (it spends the user's tokens). Keep `tests/live` compiling.
- Every task ends green on `npm run typecheck`, `npm run lint` and `npm test`. Tasks 1 to 5 keep the old ids working; Task 6 switches to the Head of Staff.

## Review Focus

1. The Head of Staff names a builder that cannot change files, a reviewer who is also a builder, or an id that is not in the catalog: one correction, then the thread waits; nothing starts. (Tasks 2 and 3)
2. The user deletes or edits the builder in Agents between team approval and Start: the build refuses to start with a message naming the agent; no worktree is created. (Tasks 4 and 5)
3. A plan phase names a builder who is not one of the thread's builders, or no one: the first builder builds it. (Task 4)
4. The user denies the "build without a review" card, or pauses while it is open: the plan stays waiting, no worktree, and Start can be pressed again. (Task 5)
5. A thread saved by the old version, in each phase (team, planning, mid-build, done), is opened after the upgrade: it loads, shows its history, and the next message is handled without an exception. (Task 7)

---

### Task 1: Levels replace the hard flag

**Files:**
- Modify: `src/shared/thread.ts`, `src/shared/agent-problems.ts`, `src/main/services/threads/protocol.ts`, `src/main/services/threads/rules.ts`, `src/main/services/threads/conductor.ts`
- Test: `tests/shared/agent-problems.test.ts`, `tests/main/thread-protocol.test.ts`, `tests/main/thread-rules.test.ts`, `tests/main/conductor.test.ts`

**Interfaces:**
- Consumes: `isLocked` (part 1).
- Produces:
  ```ts
  // src/shared/thread.ts
  export type Level = Tier; // 'light' | 'standard' | 'heavy'
  // Control: { kind: 'next'; agent: string; level?: Level }   (hard is gone)
  // src/shared/agent-problems.ts
  /** The level an agent runs at by itself: an exact Claude model maps haiku/sonnet/opus to light/standard/heavy; an exact Codex model ending -luna is light, -terra standard, anything else heavy; otherwise its tier. */
  export function ownLevel(a: AgentDef): Level;
  /** The agent as it runs one turn at `level`. Returns `a` itself (same reference) when there is no level, the model is locked, or it is already the agent's own level. Otherwise the tier becomes `level` and an exact model becomes its engine ({ kind: 'engine' }), so the engine's model for that level is used. */
  export function atLevel(a: AgentDef, level: Level | undefined): AgentDef;
  // src/main/services/threads/rules.ts
  export type Step = { do: 'turn'; agent: string; note?: string; level?: Level } | { do: 'wait'; note?: string } | { do: 'idle' };
  ```
- `tierUp` is deleted once nothing uses it.

- [ ] **Step 1: Write the failing tests**

`tests/shared/agent-problems.test.ts`:

```ts
const agent = (engine: AgentDef['engine'], extra: Partial<AgentDef> = {}): AgentDef =>
  ({ id: 'a', name: 'A', description: '', engine, tier: 'standard', skills: [], permissions: 'read-only', prompt: 'p', ...extra });
const sonnet = { kind: 'model', engine: 'claude', model: 'sonnet' } as const;

test('ownLevel reads the level off an exact model, else the tier', () => {
  expect(ownLevel(agent(sonnet))).toBe('standard');
  expect(ownLevel(agent({ kind: 'model', engine: 'claude', model: 'opus' }))).toBe('heavy');
  expect(ownLevel(agent({ kind: 'model', engine: 'codex', model: 'gpt-x-luna' }))).toBe('light');
  expect(ownLevel(agent({ kind: 'model', engine: 'codex', model: 'gpt-x' }))).toBe('heavy');
  expect(ownLevel(agent({ kind: 'auto' }, { tier: 'light' }))).toBe('light');
});

test('atLevel moves an unlocked agent and leaves a locked one alone', () => {
  const auto = agent({ kind: 'auto' });
  expect(atLevel(auto, undefined)).toBe(auto);
  expect(atLevel(auto, 'standard')).toBe(auto); // already its level
  expect(atLevel(auto, 'heavy')).toEqual({ ...auto, tier: 'heavy' });
  const locked = agent(sonnet); // an exact model with no lock field counts as locked
  expect(atLevel(locked, 'heavy')).toBe(locked);
  const free = agent(sonnet, { lock: false });
  expect(atLevel(free, 'heavy')).toEqual({ ...free, tier: 'heavy', engine: { kind: 'engine', engine: 'claude' } });
});
```

`tests/main/thread-protocol.test.ts`:

```ts
test('next carries a level, and a bad level is an error', () => {
  expect(parseReply(block({ next: 'planner', level: 'heavy' })).control).toEqual({ kind: 'next', agent: 'planner', level: 'heavy' });
  expect(parseReply(block({ next: 'planner' })).control).toEqual({ kind: 'next', agent: 'planner' });
  expect(parseReply(block({ next: 'planner', level: 'max' })).error).toBe('ark block: level must be light, standard or heavy');
});
```

(`block` is the file's helper that wraps JSON in an `ark` fence; add it if the file names it differently.)

`tests/main/thread-rules.test.ts`: replace the existing "hard" case with

```ts
test('the level of a next goes on the step', () => {
  expect(afterReply(th(), MANAGER, { kind: 'next', agent: 'planner', level: 'heavy' }, undefined).step).toEqual({ do: 'turn', agent: 'planner', level: 'heavy' });
});
```

`tests/main/conductor.test.ts`: rewrite the existing hard-turn tests to send `{ next: 'planner', level: 'heavy' }` and keep their assertions (a fresh session whose started `AgentDef` has tier `heavy`, dropped after the turn). Add:

```ts
test('a level is ignored for an agent whose model is locked', async () => {
  const t = await planning();
  runner.reply('project-manager', ark({ next: 'developer', level: 'light' })); // the fixture's developer is claude:opus with no lock field
  await turns(3);
  const started = runner.started.at(-1)!;
  expect([started.id, started.tier, started.engine]).toEqual(['developer', 'heavy', { kind: 'model', engine: 'claude', model: 'opus' }]);
});
```

(`developer` must be on the team for this: approve it in the test's own team block.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/shared/agent-problems.test.ts tests/main/thread-protocol.test.ts tests/main/thread-rules.test.ts tests/main/conductor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `protocol.ts` `toControl`: `next` reads an optional `level`; `hard` is no longer read. In `MANAGER_PROTOCOL` replace the sentence about `"hard":true` with: `Add "level":"light"|"standard"|"heavy" to run that one turn on a lighter or stronger model than the agent's own.`
- `rules.ts`: the step carries `level` where it carried `hard`.
- `conductor.ts`: `Speak.hard` becomes `Speak.level?: Level`. In `run()`, `const leveled = def ? atLevel(def, step.level) : undefined; const fresh = !!def && leveled !== def;` then drop the session before and after the turn when `fresh`, as the hard turn does today. `speak()` starts the session from `atLevel(def, o.level)`.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: a turn runs at a level, unless the agent's model is locked"
```

---

### Task 2: Roles and difficulty in the proposal (pure)

**Files:**
- Create: `src/shared/roles.ts`
- Modify: `src/shared/thread.ts`, `src/main/services/threads/protocol.ts`, `src/main/services/threads/rules.ts`
- Test: `tests/shared/roles.test.ts`, `tests/main/thread-protocol.test.ts`, `tests/main/thread-rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/thread.ts
  export type Difficulty = 'easy' | 'hard';
  export type ReviewKind = 'code' | 'security';
  export type Roles = { planner?: string; builders: string[]; codeReview?: string; securityReview?: string };
  // Control gains:
  //   { kind: 'team'; picks: TeamPick[]; leftOut: string; difficulty?: Difficulty; roles?: Roles }
  //   { kind: 'roles'; roles: Partial<Roles> }
  // Thread gains: roles?: Roles; difficulty?: Difficulty; waived?: ReviewKind[];

  // src/shared/roles.ts
  export type Lookup = (id: string) => AgentDef | undefined;
  /** Why a team proposal cannot be used, as the text of a bad-block error; undefined when it is fine. */
  export function checkProposal(c: Extract<Control, { kind: 'team' }>, agent: Lookup): string | undefined;
  /** The same rules for a change of roles on an approved team. */
  export function checkRoles(change: Partial<Roles>, now: Roles | undefined, team: string[], agent: Lookup): string | undefined;
  export function mergeRoles(now: Roles | undefined, change: Partial<Roles>): Roles;
  /** 'Plans', 'Builds', 'Code review', 'Security review', in that order, for the roles `id` holds. */
  export function roleLabels(roles: Roles | undefined, id: string): string[];
  /** One line for a note: "Jarvis plans; Forge and Gon build; Orion reviews code; Cipher reviews security." Empty slots are left out. */
  export function rolesLine(roles: Roles, names: Record<string, string>): string;
  export function reviewer(t: Pick<Thread, 'roles'>, kind: ReviewKind): string | undefined;

  // src/main/services/threads/rules.ts
  export function approveTeam(t: Thread, picks: string[], names: Record<string, string>, proposal?: { difficulty?: Difficulty; roles?: Roles }): Decision;
  ```
- Block JSON (the keys sit next to `team`): `"difficulty":"easy"|"hard"`, `"planner":"<id>"`, `"builders":["<id>"]`, `"codeReview":"<id>"`, `"securityReview":"<id>"`. `roles` on the control is present only when at least one of the four role keys is. The standalone block is `{"roles":{ ...the same four keys, at least one... }}`.
- Error texts (each prefixed `ark block: `):
  - `the Head of Staff is already on the team`  (a pick is `MANAGER`)
  - `unknown agent: <id>`
  - `<id> has a role but is not on the team`
  - `<id> cannot change files, so it cannot build`
  - `<id> builds in this thread, so it cannot review it`
  - `an easy request needs a builder`
  - `name the planner`  (builders are named, the difficulty is not `easy`, and there is no planner)
  - parser: `difficulty must be easy or hard`, `builders must be a list of agent ids`, `roles needs planner, builders, codeReview or securityReview`, and the kinds error becomes `use exactly one of team, next, ask, plan, review, roles`.
- New notes in `NOTES`:
  - `easyPlan`: `This is an easy request: no discussion. Write the short plan now: one phase, or one phase per builder when more than one must change files. End with {"plan":true}.`
  - `rolesChanged`: `Roles updated. Go on.`

- [ ] **Step 1: Write the failing tests**

`tests/shared/roles.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { AgentDef } from '@shared/agent-file';
import { MANAGER, type Control } from '@shared/thread';
import { checkProposal, checkRoles, mergeRoles, reviewer, roleLabels, rolesLine } from '@shared/roles';

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
```

`tests/main/thread-protocol.test.ts`:

```ts
test('a team block carries the difficulty and the roles', () => {
  const c = parseReply(block({ team: [{ agent: 'dev', reason: 'r' }], difficulty: 'easy', builders: ['dev'], codeReview: 'rev' })).control;
  expect(c).toEqual({ kind: 'team', picks: [{ agent: 'dev', reason: 'r' }], leftOut: '', difficulty: 'easy', roles: { builders: ['dev'], codeReview: 'rev' } });
  expect(parseReply(block({ team: [{ agent: 'dev', reason: 'r' }] })).control).toEqual({ kind: 'team', picks: [{ agent: 'dev', reason: 'r' }], leftOut: '' });
  expect(parseReply(block({ team: [{ agent: 'dev', reason: 'r' }], difficulty: 'medium' })).error).toBe('ark block: difficulty must be easy or hard');
  expect(parseReply(block({ team: [{ agent: 'dev', reason: 'r' }], builders: 'dev' })).error).toBe('ark block: builders must be a list of agent ids');
});

test('a roles block changes roles', () => {
  expect(parseReply(block({ roles: { builders: ['dev', 'ui'] } })).control).toEqual({ kind: 'roles', roles: { builders: ['dev', 'ui'] } });
  expect(parseReply(block({ roles: {} })).error).toBe('ark block: roles needs planner, builders, codeReview or securityReview');
  expect(parseReply(block({ roles: { builders: ['dev'] }, next: 'dev' })).error).toBe('ark block: use exactly one of team, next, ask, plan, review, roles');
});
```

`tests/main/thread-rules.test.ts`:

```ts
const names = { planner: 'Planner', dev: 'Dev', seo: 'SEO' };

test('an easy team goes straight to its builder for a short plan', () => {
  const d = approveTeam(th({ phase: 'team', team: [] }), ['dev', 'seo'], names, { difficulty: 'easy', roles: { builders: ['dev'], codeReview: 'seo' } });
  expect(d.thread).toMatchObject({ phase: 'planning', team: [MANAGER, 'dev', 'seo'], difficulty: 'easy', roles: { planner: 'dev', builders: ['dev'], codeReview: 'seo' } });
  expect(d.step).toEqual({ do: 'turn', agent: 'dev', note: NOTES.easyPlan, level: 'standard' });
});

test('a hard team, or one with nobody to build, goes to the Head of Staff as before', () => {
  const hard = approveTeam(th({ phase: 'team', team: [] }), ['planner', 'dev'], names, { difficulty: 'hard', roles: { planner: 'planner', builders: ['dev'] } });
  expect(hard.step).toMatchObject({ do: 'turn', agent: MANAGER });
  expect(hard.thread.roles).toEqual({ planner: 'planner', builders: ['dev'] });
  expect(approveTeam(th({ phase: 'team', team: [] }), ['seo'], names).step).toMatchObject({ do: 'turn', agent: MANAGER });
});

test('roles held by someone the user left off the team are dropped', () => {
  const d = approveTeam(th({ phase: 'team', team: [] }), ['dev'], names, { difficulty: 'hard', roles: { planner: 'planner', builders: ['dev'], codeReview: 'seo' } });
  expect(d.thread.roles).toEqual({ builders: ['dev'] });
});

test('a roles block from the Head of Staff updates the roles and gives it the floor again', () => {
  const d = afterReply(th({ roles: { planner: 'planner', builders: [] } }), MANAGER, { kind: 'roles', roles: { builders: ['dev'] } }, undefined);
  expect(d.thread.roles).toEqual({ planner: 'planner', builders: ['dev'] });
  expect(d.step).toEqual({ do: 'turn', agent: MANAGER, note: NOTES.rolesChanged });
});

test('a roles block is not valid in the team phase, and a member cannot send one', () => {
  expect(afterReply(th({ phase: 'team' }), MANAGER, { kind: 'roles', roles: { builders: ['dev'] } }, undefined).thread.retried).toBe(true);
  const d = afterReply(th({ roles: { builders: [] } }), 'planner', { kind: 'roles', roles: { builders: ['dev'] } }, undefined);
  expect(d.thread.roles).toEqual({ builders: [] });
  expect(d.step).toEqual({ do: 'turn', agent: MANAGER });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/shared/roles.test.ts tests/main/thread-protocol.test.ts tests/main/thread-rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the types, `src/shared/roles.ts`, the parser and the rules**

`checkProposal` runs its checks in the order of the error list above and returns the first failure. In `approveTeam`, an easy proposal with at least one builder left on the team sets `roles.planner` to the first builder when no planner is named.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS (the conductor still calls `approveTeam` with three arguments).

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: roles and difficulty in the team proposal"
```

---

### Task 3: The conductor uses the proposal

**Files:**
- Modify: `src/main/services/threads/conductor.ts`, `src/main/services/threads/protocol.ts`
- Test: `tests/main/conductor.test.ts`, `tests/fixtures/catalog-agents.ts`

**Interfaces:**
- Consumes: `checkProposal`, `checkRoles`, `rolesLine` (Task 2); `approveTeam(..., proposal)`.
- Produces in `NOTES`: `teamStart(project: string, dir: string)` (the first line only: `The user started a thread in project <name> (<dir>). Propose the team.`) and `catalog(agents: AgentDef[])`:
  ```
  Catalog:
  - <id>: <name>. <description> [can change files]
  ```
  The `[can change files]` tag is there only for agents whose permissions are `build`. The coordinator itself is left out of the list.
- Behaviour:
  - Every coordinator turn in the team phase gets `NOTES.catalog(...)`, not only the first, so an agent created after a question is seen. `NOTES.teamStart` stays on the fresh session only.
  - The `check` in `run()` uses `checkProposal(control, (id) => catalog.get(id))` for a team block and `checkRoles(control.roles, t.roles, t.team, ...)` for a roles block; these replace the two inline team checks.
  - `Conductor.approveTeam` and the automatic approval read `difficulty` and `roles` from the thread's last team control and pass them to `approveTeam`.
  - After a roles block is applied, Ark appends the note `Roles updated: ` + `rolesLine(...)`.
- Fixture: add `seed('frontend', 'Frontend', 'Writes the interface code.', { kind: 'auto' }, 'standard', [], 'build', 'You implement the interface.')` to `SEED_AGENTS`.

- [ ] **Step 1: Write the failing tests** (in `tests/main/conductor.test.ts`; the file's `catalog` now reads from `agents`, an array set to `[...SEED_AGENTS]` in `beforeEach`, so a test can add or remove an agent)

```ts
const EASY = ark({ team: [{ agent: 'developer', reason: 'fixes it' }, { agent: 'code-reviewer', reason: 'reviews' }], difficulty: 'easy', builders: ['developer'], codeReview: 'code-reviewer' });

test('an easy request goes straight to the builder, who plans read-only', async () => {
  runner.reply('project-manager', EASY);
  const t = create(projectId, 'Fix the crash on save');
  await idle();
  c.approveTeam(t.id, ['developer', 'code-reviewer']);
  await turns(2);
  expect(runner.turns[1].agent).toBe('developer');
  expect(runner.turns[1].text).toContain(NOTES.easyPlan);
  expect(runner.starts.at(-1)).toMatchObject({ id: 'developer', permissions: 'read-only' });
  expect(thread(t.id)).toMatchObject({ difficulty: 'easy', roles: { planner: 'developer', builders: ['developer'], codeReview: 'code-reviewer' } });
});

test('a builder that cannot change files is sent back once, then the thread waits', async () => {
  const bad = ark({ team: [{ agent: 'planner', reason: 'r' }], difficulty: 'easy', builders: ['planner'] });
  runner.reply('project-manager', bad, bad);
  const t = create(projectId, 'Fix it');
  await idle();
  expect(runner.turns[1].text).toContain('planner cannot change files, so it cannot build');
  expect(thread(t.id)).toMatchObject({ phase: 'team', status: 'waiting', team: [] });
});

test('the coordinator sees an agent created after its first turn', async () => {
  runner.reply('project-manager', ark({ ask: 'Nobody can build. Create an agent that can.' }));
  const t = create(projectId, 'Fix it');
  await idle();
  expect(runner.turns[0].text).toContain('- developer: Developer. Writes the code, following the plan. [can change files]');
  agents.push({ ...agents.find((a) => a.id === 'developer')!, id: 'newbie', name: 'Newbie' });
  c.send(t.id, 'done');
  await turns(2);
  expect(runner.turns[1].text).toContain('- newbie: Newbie.');
});

test('a roles block during planning is checked, applied and noted', async () => {
  const t = await planning(); // team: planner, seo; no roles
  runner.reply('project-manager', ark({ roles: { builders: ['seo'] } }), ark({ ask: 'ok?' }));
  await idle();
  expect(runner.turns.at(-1)!.text).toContain('seo cannot change files, so it cannot build');
  expect(thread(t.id).roles).toBeUndefined();
});
```

Add one more in the same style for the passing case: a team of `planner`, `developer`, `frontend` with roles `{ planner: 'planner', builders: ['developer'] }`, then the coordinator replies `{ roles: { builders: ['developer', 'frontend'] } }`; assert `thread(t.id).roles.builders` equals `['developer', 'frontend']` and that a note `Roles updated: Planner plans; Developer and Frontend build.` was appended.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/conductor.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the behaviour listed under Interfaces**

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: the conductor checks and stores the proposed roles"
```

---

### Task 4: Build rules for the thread's own builders and reviewers (pure)

**Files:**
- Create: `src/shared/plan.ts` (receives `parsePhases`, moved from `protocol.ts`, which re-exports it)
- Modify: `src/shared/thread.ts`, `src/shared/roles.ts`, `src/shared/agent-problems.ts`, `src/main/services/threads/build-rules.ts`, `src/main/services/threads/protocol.ts`, `src/main/services/threads/conductor.ts` (call sites only)
- Test: `tests/main/build-rules.test.ts`, `tests/main/thread-protocol.test.ts`, `tests/shared/roles.test.ts`, `tests/shared/thread-routing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/thread.ts: BuildPhase gains `builder?: string` (absent only on threads saved by the old version)
  // src/shared/plan.ts
  /** As today, plus the builder a heading names by ending with "(@username)"; the title is returned without it. */
  export function parsePhases(markdown: string): { title: string; text: string; builder?: string }[];
  // src/shared/roles.ts
  /** Why the build cannot start, in words for the user; undefined when it can. */
  export function buildProblem(t: Pick<Thread, 'roles'>, agent: Lookup): string | undefined;
  /** The review slots that are empty and that the user has not allowed to skip. */
  export function missingReviews(t: Pick<Thread, 'roles' | 'waived'>): ReviewKind[];
  // src/shared/agent-problems.ts
  export type ThreadJob = 'builder' | 'reviewer' | 'other';
  export function chooseThreadEngine(agent: string, job: ThreadJob, assignments: Record<string, EngineAssignment>, windows: Partial<Record<EngineId, Windows | undefined>>, mode: PermissionMode, nowSec: number): EngineId;
  // src/main/services/threads/build-rules.ts
  export function startBuild(t: Thread, build: Omit<Build, 'current' | 'phases'> & { phases: { title: string; text: string; builder?: string }[] }): BuildDecision;
  export function afterChecks(t: Thread, results: CheckResult[], unread?: boolean): BuildDecision;
  ```
- `buildProblem` texts: `No agent on this thread can build. Ask the Head of Staff to pick a builder, or create one in Agents.`; `<id> is no longer in the catalog.`; `<id> can no longer change files.` (the last two for any builder, and the first of them for a reviewer).
- `chooseThreadEngine`: `job === 'builder' && mode === 'auto'` returns `'claude'` (today's rule for `developer`); the final default is `'codex'` for `builder` and `reviewer`, `'claude'` for `other`. In this task the conductor passes `'builder'` for `DEVELOPER`, `'reviewer'` for the two reviewer ids, `'other'` otherwise.
- Build rules:
  - `startBuild` sets each phase's `builder`: the one its heading names when that id is in `t.roles.builders`, otherwise `t.roles.builders[0]`.
  - After passing checks the phase goes to the code review when `reviewer(t, 'code')` is set, else to the security review when that is set, else it passes exactly as a clean security review does today (honouring `unread`, then next phase or summary).
  - After the code review the phase goes to the security review when it is set; otherwise it settles with the code review's findings (sent back when there are findings, passed when there are none).

- [ ] **Step 1: Write the failing tests**

`tests/main/thread-protocol.test.ts`:

```ts
test('a phase heading may name its builder', () => {
  const phases = parsePhases('## Phase 1: API (@backend_dev)\na\n## Phase 2: UI\nb');
  expect(phases).toEqual([
    { title: 'API', text: '## Phase 1: API (@backend_dev)\na', builder: 'backend_dev' },
    { title: 'UI', text: '## Phase 2: UI\nb' },
  ]);
});
```

`tests/main/build-rules.test.ts` (the existing tests get `roles: { builders: ['dev'], codeReview: 'rev', securityReview: 'sec' }` in the `thread` helper's defaults so they keep their meaning):

```ts
test('startBuild gives each phase its builder, falling back to the first', () => {
  const t = { ...thread([]), phase: 'planning' as const, build: undefined, roles: { builders: ['dev', 'ui'] } };
  const d = startBuild(t, { worktree: 'w', branch: 'b', plan: 'p', phases: [{ title: 'A', text: 'a', builder: 'ui' }, { title: 'B', text: 'b', builder: 'ghost' }, { title: 'C', text: 'c' }] });
  expect(d.thread.build!.phases.map((p) => p.builder)).toEqual(['ui', 'dev', 'dev']);
});

test('with no code reviewer the checks lead to the security review', () => {
  expect(afterChecks(one({}, { roles: { builders: ['dev'], securityReview: 'sec' } }), results(true)).step).toEqual({ do: 'review', who: 'security' });
});

test('with no reviewer at all, passing checks end the phase', () => {
  const none = { roles: { builders: ['dev'] } };
  const d = afterChecks(one({}, none), results(true));
  expect(first(d).step).toBe('done');
  expect(d.step).toEqual({ do: 'summary' });
  expect(afterChecks(one({}, none), results(true), true).step).toEqual({ do: 'fix', why: 'user' }); // an unread user message first
});

test('with no security reviewer the code review settles the phase', () => {
  const t = one({ step: 'review' }, { roles: { builders: ['dev'], codeReview: 'rev' } });
  expect(afterReview(t, 'code', pass).step).toEqual({ do: 'summary' });
  expect(afterReview(t, 'code', changes).step).toEqual({ do: 'fix', why: 'review' });
});
```

`tests/shared/roles.test.ts`:

```ts
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
```

`tests/shared/thread-routing.test.ts`: update the calls to the new signature and keep the assertions; add

```ts
test('a builder in Approve for me always runs on Claude', () => {
  expect(chooseThreadEngine('forge', 'builder', {}, {}, 'auto', 0)).toBe('claude');
  expect(chooseThreadEngine('forge', 'builder', {}, {}, 'ask', 0)).toBe('codex');
  expect(chooseThreadEngine('pm', 'other', {}, {}, 'ask', 0)).toBe('claude');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/build-rules.test.ts tests/main/thread-protocol.test.ts tests/shared/roles.test.ts tests/shared/thread-routing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Move `parsePhases` to `src/shared/plan.ts` unchanged, then add the builder. Factor the "phase passed" tail of `afterReview` into one private function used by all three places that can end a phase.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. (The conductor's build still runs with the fixed ids; threads there have no `roles`, so in this task only, `startBuild` and the review steps fall back to today's behaviour when `t.roles` is undefined. Task 5 removes the fallback.)

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: build rules for per-phase builders and optional reviews"
```

---

### Task 5: The build is done by the thread's agents

**Files:**
- Modify: `src/main/services/threads/conductor.ts`, `src/main/services/threads/protocol.ts`, `src/main/services/threads/build-rules.ts` (remove the Task 4 fallback), `src/main/services/thread-agents.ts` (delete `BUILD_AGENTS`), `src/shared/thread.ts` (delete `BUILD_ROLES`, `DEVELOPER`, `CODE_REVIEWER`, `SECURITY_REVIEWER`), `src/shared/permissions.ts` (copy)
- Test: `tests/main/conductor.test.ts`, `tests/main/thread-protocol.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces:
  ```ts
  // protocol.ts
  export type ThreadRole = 'head' | 'member' | 'builder' | 'reviewer';
  export const withProtocol: (agent: AgentDef, as?: ThreadRole, mode?: PermissionMode) => AgentDef; // default 'member'
  export const BUILDER_PROTOCOL: string;  // today's DEVELOPER_PROTOCOL, opening with "You are the builder of this phase."
  // NOTES
  waiveTool: (kind: ReviewKind) => string; // 'a build without a code review' | 'a build without a security review'
  waive: (kind: ReviewKind) => string;     // `No agent on this thread is set to do the ${kind} review. Allow builds this thread without it. Deny keeps the plan waiting: create a reviewer in Agents, then ask the Head of Staff to pick it.`
  ```
- Conductor behaviour:
  - `startDeveloper` (name kept; the IPC channel does not change):
    1. throws `buildProblem(t, ...)` when it returns a text, before anything is created;
    2. for each kind in `missingReviews(t)`, in order, shows an approval card (`agent: MANAGER`, `tool: NOTES.waiveTool(kind)`, `detail: NOTES.waive(kind)`) and waits. Allow adds the kind to `thread.waived`. Deny, or the card being dropped (pause, permission change, quit), throws `The build did not start: there is no <kind> review. Ask the Head of Staff to pick a reviewer, or allow the build without it.` This happens in every permission mode, including Full access;
    3. the note that opens the build no longer says "Added to the team"; it ends with ` No code review in this build.` and/or ` No security review in this build.` for waived slots;
    4. every builder's cursor starts at the plan.
  - The project-code consent card and the new card share one mechanism: the pending entry carries how to save the answer on the thread. `save()` keeps `waived` from disk the way it keeps `projectCode`.
  - `runBuild` uses `phase.builder` wherever it used `DEVELOPER`, and `reviewer(t, who)` wherever it used the reviewer ids. A builder turn moves the cursor of every builder of the thread, so a second builder does not get user messages the first already handled.
  - Sessions get `withProtocol(def, 'builder' | 'reviewer' | 'head' | 'member', mode)` by the job they are doing in that turn, never by id. `chooseThreadEngine` gets the job the same way.
  - Builder and reviewer turns of the build run at the standard level: their sessions start from `atLevel(def, 'standard')`, so a locked model is left alone.
  - Build-mode approval policy (`decideApproval`, Full access) applies only to the chat of the current phase's builder.
  - `def()` and `names()` no longer fall back to `BUILD_AGENTS`.
- `PERMISSION_DETAIL.full` becomes `Builders' tools run without approval prompts, including writes outside the worktree and network access.`

- [ ] **Step 1: Update the existing build tests' setup**

The fixture already has `developer`, `code-reviewer`, `security-reviewer` and `frontend` as ordinary agents. Build tests now approve a team that includes them, with roles in the team block:

```ts
const BUILD_TEAM = ark({
  team: ['planner', 'developer', 'frontend', 'code-reviewer', 'security-reviewer'].map((agent) => ({ agent, reason: 'r' })),
  difficulty: 'hard', planner: 'planner', builders: ['developer', 'frontend'], codeReview: 'code-reviewer', securityReview: 'security-reviewer',
});
```

Give the file's "thread with a plan ready" helper a parameter for the team block, defaulting to `BUILD_TEAM`. Every existing build test keeps its assertions, except any that expected the note `Added to the team`.

- [ ] **Step 2: Write the new failing tests**

```ts
test('each phase is built by the builder its heading names', async () => {
  const t = await planned('## Phase 1: API (@developer)\na\n## Phase 2: UI (@frontend)\nb'); // the helper: team approved, plan written
  await c.startDeveloper(t.id);
  runner.reply('developer', 'done'); runner.reply('code-reviewer', PASS); runner.reply('security-reviewer', PASS);
  runner.reply('frontend', 'done'); runner.reply('code-reviewer', PASS); runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'summary');
  await idle();
  const builds = runner.starts.filter((s) => s.permissions === 'build');
  expect(builds.map((s) => s.id)).toEqual(['developer', 'frontend']);
  expect(builds.every((s) => s.dir === thread(t.id).build!.worktree)).toBe(true);
  expect(runner.started.find((a) => a.id === 'frontend' && a.prompt.includes('You are the builder of this phase.'))).toBeDefined();
  expect(thread(t.id).phase).toBe('done');
});

test('a build with no reviewer asks the user first, even in Full access', async () => {
  const t = await planned('## Phase 1: Fix\na', ark({ team: [{ agent: 'developer', reason: 'r' }], difficulty: 'easy', builders: ['developer'] }));
  await c.setPermissionMode(t.id, 'full');
  const starting = c.startDeveloper(t.id);
  await tick();
  const card = last(t.id);
  expect(card).toMatchObject({ kind: 'approval', tool: 'a build without a code review' });
  expect(ws.calls.some(([name]) => name === 'addWorktree')).toBe(false);
  c.answer(t.id, card.seq, true);
  await tick();
  c.answer(t.id, last(t.id).seq, true); // the security card
  await starting;
  expect(thread(t.id).waived).toEqual(['code', 'security']);
  expect(store.messages(t.id).some((m) => m.kind === 'note' && m.text.includes('No code review in this build. No security review in this build.'))).toBe(true);
  runner.reply('developer', 'done'); runner.reply('project-manager', 'summary');
  await idle();
  expect(runner.turns.some((x) => x.agent === 'code-reviewer')).toBe(false);
  expect(thread(t.id).phase).toBe('done');
});

test('denying the card leaves the plan waiting and creates nothing', async () => {
  const t = await planned('## Phase 1: Fix\na', ark({ team: [{ agent: 'developer', reason: 'r' }], difficulty: 'easy', builders: ['developer'] }));
  const starting = c.startDeveloper(t.id);
  await tick();
  c.answer(t.id, last(t.id).seq, false);
  await expect(starting).rejects.toThrow('The build did not start: there is no code review.');
  expect(thread(t.id)).toMatchObject({ phase: 'planning' });
  expect(thread(t.id).build).toBeUndefined();
  expect(ws.calls.some(([name]) => name === 'addWorktree')).toBe(false);
  const again = c.startDeveloper(t.id); // Start can be pressed again: it asks again
  await tick();
  expect(last(t.id)).toMatchObject({ kind: 'approval', tool: 'a build without a code review' });
  await c.pause(t.id); // a pause drops the card
  await expect(again).rejects.toThrow('The build did not start');
  expect(thread(t.id).build).toBeUndefined();
});

test('a build cannot start once its builder is gone or read-only', async () => {
  const t = await planned('## Phase 1: Fix\na');
  agents.splice(agents.findIndex((a) => a.id === 'developer'), 1);
  await expect(c.startDeveloper(t.id)).rejects.toThrow('developer is no longer in the catalog.');
  expect(ws.calls.some(([name]) => name === 'addWorktree')).toBe(false);
});

test('a thread with no builder cannot start a build', async () => {
  const t = await planned('## Phase 1: Fix\na', TEAM); // TEAM has no roles
  await expect(c.startDeveloper(t.id)).rejects.toThrow('No agent on this thread can build.');
});

test('the second builder is not handed a user message the first one already read', async () => {
  const t = await planned('## Phase 1: API (@developer)\na\n## Phase 2: UI (@frontend)\nb');
  await c.startDeveloper(t.id);
  c.send(t.id, 'use tabs');
  runner.reply('developer', 'done'); runner.reply('code-reviewer', PASS); runner.reply('security-reviewer', PASS);
  runner.reply('frontend', 'done');
  await turns(runner.turns.length + 4);
  const second = runner.turns.find((x) => x.agent === 'frontend')!;
  expect(second.text).not.toContain(NOTES.userFix);
});
```

```ts
test('build turns run at the standard level unless the model is locked', async () => {
  agents.push({ ...agents.find((a) => a.id === 'frontend')!, id: 'big', name: 'Big', engine: { kind: 'model', engine: 'claude', model: 'opus' }, lock: false });
  const block = ark({ team: ['developer', 'big'].map((agent) => ({ agent, reason: 'r' })), difficulty: 'easy', builders: ['developer', 'big'] });
  const t = await planned('## Phase 1: A (@developer)\na\n## Phase 2: B (@big)\nb', block);
  thread(t.id); store.save({ ...thread(t.id), waived: ['code', 'security'] });
  await c.startDeveloper(t.id);
  runner.reply('developer', 'done'); runner.reply('big', 'done'); runner.reply('project-manager', 'summary');
  await idle();
  const built = (id: string) => runner.started.findLast((a) => a.id === id)!;
  expect(built('developer').engine).toEqual({ kind: 'model', engine: 'claude', model: 'opus' }); // no lock field: locked
  expect([built('big').tier, built('big').engine]).toEqual(['standard', { kind: 'engine', engine: 'claude' }]);
});
```

`planned(planText, teamBlock = BUILD_TEAM)` is the "plan ready" helper from Step 1: the coordinator proposes `teamBlock`, the user approves it, and the block's planner (its first builder when it names none) replies with `planText` and a plan block. `PASS` is the file's passing review block. Use the names the file already has for them.

`tests/main/thread-protocol.test.ts`:

```ts
test('the protocol follows the job, not the id', () => {
  const a = { id: 'forge', name: 'Forge', description: '', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions: 'build', prompt: 'ROLE' } as const;
  expect(withProtocol(a, 'builder').prompt).toContain(BUILDER_PROTOCOL);
  expect(withProtocol(a, 'reviewer').prompt).toContain(REVIEWER_PROTOCOL);
  expect(withProtocol(a).prompt).toContain(MEMBER_PROTOCOL);
  expect(withProtocol(a, 'head').prompt).toContain(MANAGER_PROTOCOL);
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run tests/main/conductor.test.ts tests/main/thread-protocol.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 4: Implement the behaviour listed under Interfaces, and delete the built-in build agents and their constants**

- [ ] **Step 5: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS, and `grep -rn "BUILD_AGENTS\|BUILD_ROLES\|DEVELOPER\b\|CODE_REVIEWER\|SECURITY_REVIEWER" src` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: the thread's own agents build and review"
```

---

### Task 6: The Head of Staff

**Files:**
- Create: `src/main/services/head-of-staff.ts`
- Delete: `src/main/services/thread-agents.ts`
- Modify: `src/shared/thread.ts`, `src/shared/types.ts`, `src/main/services/settings.ts`, `src/main/services/catalog.ts`, `src/main/services/threads/conductor.ts`, `src/main/services/threads/protocol.ts`, `src/main/services/threads/rules.ts` (wording of notes only), `src/main/ipc/index.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/pages/Agents.tsx` (remove the "Thread roles" section), `tests/fixtures/catalog-agents.ts`, `tests/live/*.ts` (ids and blocks only, so they compile)
- Test: `tests/main/head-of-staff.test.ts`, `tests/main/settings.test.ts`, `tests/main/conductor.test.ts`, `tests/main/thread-protocol.test.ts`, `tests/main/catalog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/thread.ts
  export const MANAGER = 'head-of-staff';          // the Head of Staff, Ark's built-in coordinator
  export const LEGACY_MANAGER = 'project-manager'; // what threads saved by older versions call it
  // src/shared/types.ts
  export type HeadSettings = { skills: string[]; engine: EngineSetting; lock: boolean };
  // ArkApi gains: head: { get(): Promise<AgentDef>; save(s: HeadSettings): Promise<void> }
  // ArkApi.catalog loses addThreadAgents
  // src/main/services/head-of-staff.ts
  export const HEAD: AgentDef;                       // see below
  export function checkHeadSettings(v: unknown): HeadSettings; // throws on anything invalid (same rules as an agent's skills, engine and lock)
  export function headWith(saved: unknown): AgentDef; // HEAD with the saved settings; a missing or invalid saved value gives HEAD
  // src/main/services/settings.ts
  export function readHead(userData: string): AgentDef;
  export function writeHead(userData: string, v: unknown): void; // checkHeadSettings, then settings.json key `headOfStaff`
  // ConductorDeps gains: head: () => AgentDef
  ```
- `HEAD`: `id: MANAGER`, `name: 'Head of Staff'`, `description: 'Reads each request, judges how hard it is and puts the right agents and models on it.'`, `engine: { kind: 'auto' }`, `tier: 'light'`, `skills: []`, `permissions: 'read-only'`, `avatar: HEAD_FACE`, `prompt: "You are the Head of Staff. The user is your boss; the agents in the catalog are the user's staff. You coordinate, you do not do the work yourself. Respond in the user's language."`
- IPC channels `head:get` and `head:save`; `catalog:add-thread-agents` is removed, with `Catalog.addThreadAgents`, `Catalog.addDefaultAgent` and the call in `src/main/index.ts`.
- Conductor: `def(id)` is `id === MANAGER ? deps.head() : catalog.get(id)`; `names()` includes the Head of Staff; `create()` throws `NOTES.noAgents` when `catalog.list().agents` is empty, before creating the thread or calling an engine.
- `NOTES.noAgents`: `No agents yet. Create an agent or add a ready team in Agents.`
- `MANAGER_PROTOCOL` is renamed `HEAD_PROTOCOL` and replaced by this exact text:

````text
# Working in an Ark thread
You are the Head of Staff of this thread: a conversation between the user, who is your boss, and a team of the user's own agents. Ark relays it. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark.
You do not do the work yourself. You read the request, judge how hard it is, and put the right agents and models on it.
End every reply with exactly one Ark block: a fenced code block tagged ark holding one JSON object.

## First: propose the team
Ark lists the catalog: each agent's username, name and task, and whether it can change files. Reply with
{"team":[{"agent":"<username>","reason":"<one line>"}],"leftOut":"<one line on the obvious agents you left out>","difficulty":"easy"|"hard","planner":"<username>","builders":["<username>"],"codeReview":"<username>","securityReview":"<username>"}
- Pick only usernames from the catalog, never yourself. Everyone with a role must be in team.
- difficulty: easy for a small, precise change such as fixing one known bug; hard for a new feature, a refactoring, or anything whose requirements are not settled.
- A request that changes no files (a question, an analysis) needs only team and difficulty.
- builders: only agents that can change files. Name one per area that must change, for example backend and frontend.
- planner: who writes the plan. For an easy request leave it out: the first builder writes a short plan and nobody else is consulted. For a hard request choose an agent whose task is managing or planning.
- codeReview and securityReview: agents suited to review, never a builder of this thread. One agent may do both.
When the catalog lacks someone the work needs, do not improvise. Ask the user and say which agent to create in Agents:
- a hard request and no agent suited to manage and plan it: a project manager agent;
- files must change and no agent can change files: an agent that can build;
- no agent suited to a review: a reviewer. Offer the choices "I will create a reviewer" and "Go on without it". If the user goes on without it, leave that review out; Ark confirms it with the user before the build.

## Then: lead the planning (hard requests)
- To give the floor to one team member: {"next":"<username>"}. One agent speaks per turn; after they reply it is your turn again. Add "level":"light"|"standard"|"heavy" to run that one turn on a lighter or stronger model than the agent's own. An agent whose model the user locked ignores it.
- First have the manager work out with the user what is wanted, then have the builders size the work, then give the floor to the planner to write the plan, with "level":"heavy".
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]}. choices is optional, at most 4. The team waits for the answer.
- To change who plans, builds or reviews before the build starts: {"roles":{"builders":["<username>"]}} with only the keys that change (planner, builders, codeReview, securityReview), team members only.
The plan's phases are the tasks. A phase heading may end with (@username) to name the builder of that phase.

## Building
Team members read the project but change nothing while the thread plans. Once the plan is approved, Ark runs the build: each phase is implemented by its builder in the thread's own Git worktree, Ark commits and runs the project's checks, and the reviewers review each phase. Never ask the user to apply a patch, open another session or grant tools: to get something built, get the plan written. When Ark tells you a phase is blocked, ask the user how to continue. When the build is finished, Ark asks you for the summary.
````

- `MEMBER_PROTOCOL` becomes:

````text
# Working in an Ark thread
You are a member of this thread's team, led by the Head of Staff. Ark relays the conversation. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark. You speak only when you are given the floor: answer what you were asked, briefly. While the thread plans you read the project but cannot change files or run commands, even if you build later: describe the changes for the plan instead of writing patches.
You may end your reply with one Ark block, a fenced code block tagged ark holding one JSON object:
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]} (choices optional, at most 4).
- When your reply is the complete plan in Markdown, split into phases each with its goal and its checks: {"plan":true}. Start each phase with a heading "## Phase <n>: <title>"; add " (@username)" at the end of a heading to name the builder who implements that phase.
Without a block the floor goes back to the Head of Staff.
````

- In the autonomous-policy text inside `withProtocol`, and in the notes of `rules.ts` and `protocol.ts`, "project manager" and "manager" become "Head of Staff", and "developer" becomes "builder" or "the build", whichever the sentence means. `NOTES.summary`, `NOTES.blocked` and the rest keep their meaning.

- [ ] **Step 1: Write the failing tests**

`tests/main/head-of-staff.test.ts`:

```ts
import { expect, test } from 'vitest';
import { HEAD_FACE } from '@shared/avatars';
import { MANAGER } from '@shared/thread';
import { checkHeadSettings, HEAD, headWith } from '../../src/main/services/head-of-staff';

test('the Head of Staff is a read-only built-in with its own face', () => {
  expect(HEAD).toMatchObject({ id: MANAGER, name: 'Head of Staff', permissions: 'read-only', tier: 'light', avatar: HEAD_FACE, engine: { kind: 'auto' } });
  expect(MANAGER).toBe('head-of-staff');
});

test('saved settings change only skills, model and lock', () => {
  const saved = { skills: ['superpowers:brainstorming'], engine: { kind: 'model', engine: 'claude', model: 'sonnet' }, lock: true, prompt: 'hacked', permissions: 'build' };
  expect(headWith(saved)).toEqual({ ...HEAD, skills: ['superpowers:brainstorming'], engine: { kind: 'model', engine: 'claude', model: 'sonnet' }, lock: true });
});

test('missing or invalid settings fall back to the built-in', () => {
  expect(headWith(undefined)).toEqual(HEAD);
  expect(headWith({ skills: 'all', engine: { kind: 'auto' }, lock: false })).toEqual(HEAD);
  expect(() => checkHeadSettings({ skills: ['../x'], engine: { kind: 'auto' }, lock: false })).toThrow('skills');
  expect(() => checkHeadSettings({ skills: [], engine: { kind: 'model', engine: 'claude', model: 'gpt' }, lock: false })).toThrow('engine');
});
```

`tests/main/settings.test.ts`:

```ts
test('the Head of Staff settings round-trip and leave the other settings alone', () => {
  writeView(dir, 'detailed');
  writeHead(dir, { skills: [], engine: { kind: 'engine', engine: 'codex' }, lock: false });
  expect(readHead(dir).engine).toEqual({ kind: 'engine', engine: 'codex' });
  expect(readView(dir)).toBe('detailed');
  expect(() => writeHead(dir, { skills: [] })).toThrow();
});
```

`tests/main/conductor.test.ts`: drop `project-manager` from `SEED_AGENTS`; pass `head: () => HEAD` in the deps; replace every `'project-manager'` in the file with `MANAGER`. Replace the "create without a manager" test with:

```ts
test('with no agents a thread does not start and no engine is called', () => {
  const none = { get: () => undefined, list: () => ({ agents: [], invalid: [] }) };
  const empty = new Conductor({ store, catalog: none, head: () => HEAD, runner, workspace: ws, worktrees, windows: () => undefined });
  expect(() => empty.create(projectId, 'x')).toThrow('No agents yet. Create an agent or add a ready team in Agents.');
  expect(store.threads()).toEqual([]);
  expect(runner.started).toEqual([]);
});

test('the Head of Staff runs from its built-in profile and is not offered to itself', async () => {
  runner.reply(MANAGER, TEAM);
  create(projectId, 'Build a landing page');
  await idle();
  expect(runner.started[0]).toMatchObject({ id: MANAGER, name: 'Head of Staff' });
  expect(runner.started[0].prompt).toContain('You are the Head of Staff of this thread');
  expect(runner.turns[0].text).not.toContain('- head-of-staff:');
});
```

`tests/main/thread-protocol.test.ts`:

```ts
test('no protocol text names the removed built-ins', () => {
  for (const text of [HEAD_PROTOCOL, MEMBER_PROTOCOL, BUILDER_PROTOCOL, REVIEWER_PROTOCOL, withProtocol({ ...HEAD }, 'head', 'auto').prompt]) {
    expect(text).not.toMatch(/project manager|Ark's developer/i);
  }
  expect(HEAD_PROTOCOL).toContain('"difficulty":"easy"|"hard"');
  expect(HEAD_PROTOCOL).toContain('a project manager agent');
});
```

`tests/main/catalog.test.ts`: delete the tests of `addThreadAgents` and `addDefaultAgent`; add

```ts
test('a file named head-of-staff.md is listed as invalid, never as an agent', () => {
  writeFileSync(join(dir, 'head-of-staff.md'), serializeAgentFile({ ...agent, id: 'x' }));
  const { agents, invalid } = catalog.list();
  expect(agents.some((a) => a.id === 'head-of-staff')).toBe(false);
  expect(invalid).toEqual([{ file: 'head-of-staff.md', error: 'username: head-of-staff is reserved' }]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/head-of-staff.test.ts tests/main/settings.test.ts tests/main/conductor.test.ts tests/main/thread-protocol.test.ts tests/main/catalog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement everything listed under Interfaces**

`src/main/index.ts` passes `head: () => readHead(userData)` to the conductor. Remove the "Thread roles" section and its handler from `Agents.tsx` so the renderer compiles; the rest of the page is Task 8.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS, and `grep -rni "project.manager\|addThreadAgents\|thread-agents" src` prints only `LEGACY_MANAGER` in `src/shared/thread.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat: the Head of Staff replaces the built-in project manager"
```

---

### Task 7: Threads saved by the old version

**Files:**
- Create: `src/shared/thread-upgrade.ts`
- Modify: `src/main/services/threads/store.ts`, `src/main/services/threads/conductor.ts`, `src/main/services/threads/protocol.ts`
- Test: `tests/shared/thread-upgrade.test.ts`, `tests/main/thread-store.test.ts`, `tests/main/conductor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** A thread as this version expects it. Pure and idempotent; a thread of this version is returned as it is. */
  export function upgradeThread(t: Thread): Thread;
  ```
  Rules, applied only when `t.roles` is undefined: `LEGACY_MANAGER` becomes `MANAGER` in `team[0]`, `speaking` and `waitingOn`; a thread with a `build` gets `roles: { builders: [] }`. A thread that has `roles` is untouched, so a user agent that happens to be called `project-manager` is never renamed in a new thread.
- `ThreadStore.get()` returns `upgradeThread(...)` and does not write. `ThreadStore.recover()` also appends, once per thread, the note `NOTES.legacyBuild` to every thread on disk that is in the build phase and has no `roles`, and saves it upgraded (so the note is not repeated).
- `NOTES.legacyBuild`: `This build used Ark's built-in developer and reviewers, which no longer exist. Send a message and the Head of Staff will pick who continues.`
- `NOTES.assignRoles`: `This thread is mid-build and has nobody set to build or review. Pick them from the catalog with one roles block, or ask the user to create an agent that can build.`
- Conductor: a user message to a thread in the build phase whose `roles.builders` is empty does not go to the build loop. The Head of Staff gets a turn with `NOTES.assignRoles` and `NOTES.catalog(...)`. Its reply:
  - a valid `roles` block (checked with `checkRoles`, with the whole catalog as the team; the agents it names are added to `thread.team`): the roles are saved, every phase that is not done gets `builder = roles.builders[0]`, the missing reviews are confirmed with the user by the same cards as at Start, and the build resumes through `afterBuildUser`;
  - an `ask`: the thread waits on the Head of Staff;
  - anything else: one correction, then the thread waits with a note.

- [ ] **Step 1: Write the failing tests**

`tests/shared/thread-upgrade.test.ts`:

```ts
import { expect, test } from 'vitest';
import { LEGACY_MANAGER, MANAGER, type Thread } from '@shared/thread';
import { upgradeThread } from '@shared/thread-upgrade';

const old: Thread = {
  id: 't', projectId: 'p', title: 'T', createdAt: 0, phase: 'planning', status: 'waiting',
  team: [LEGACY_MANAGER, 'planner'], waitingOn: LEGACY_MANAGER, agentTurns: 0, retried: false, summarizing: false, cursors: {}, handoffs: {},
};

test('the old coordinator id becomes the Head of Staff', () => {
  expect(upgradeThread(old)).toMatchObject({ team: [MANAGER, 'planner'], waitingOn: MANAGER });
});

test('an old build has no builders until the Head of Staff picks them', () => {
  const t = upgradeThread({ ...old, phase: 'build', build: { worktree: 'w', branch: 'b', plan: 'p', phases: [], current: 0 } });
  expect(t.roles).toEqual({ builders: [] });
});

test('a thread of this version is left alone, even with an agent called project-manager', () => {
  const now: Thread = { ...old, team: [MANAGER, LEGACY_MANAGER], waitingOn: LEGACY_MANAGER, roles: { builders: [] } };
  expect(upgradeThread(now)).toBe(now);
  expect(upgradeThread(upgradeThread(old))).toEqual(upgradeThread(old));
});
```

`tests/main/thread-store.test.ts`:

```ts
test('an old mid-build thread gets one note and is saved upgraded', () => {
  const t = store.create(projectId, 'T');
  store.save({ ...t, phase: 'build', status: 'idle', team: ['project-manager', 'developer'], build: { worktree: 'w', branch: 'b', plan: 'p', phases: [], current: 0 } });
  store.recover();
  store.recover();
  expect(store.messages(t.id).filter((m) => m.kind === 'note')).toHaveLength(1);
  expect(store.get(t.id)).toMatchObject({ team: ['head-of-staff', 'developer'], roles: { builders: [] } });
});
```

`tests/main/conductor.test.ts`:

```ts
test('an old mid-build thread gets its roles from the Head of Staff on the next message', async () => {
  const t = store.create(projectId, 'Old build');
  const phase = { title: 'A', text: '## Phase 1: A', step: 'develop' as const, rounds: 0, notes: 0, open: 0, base: 'abc' };
  store.save({ ...t, phase: 'build', status: 'idle', team: ['project-manager'], build: { worktree: join(root, 'wt', 'x'), branch: 'ark/x', plan: 'p', phases: [phase], current: 0 } });
  runner.reply(MANAGER, ark({ roles: { builders: ['developer'], codeReview: 'code-reviewer', securityReview: 'security-reviewer' } }));
  runner.reply('developer', 'done'); runner.reply('code-reviewer', PASS); runner.reply('security-reviewer', PASS); runner.reply(MANAGER, 'summary');
  c.send(t.id, 'continue');
  await idle();
  expect(runner.turns[0].text).toContain(NOTES.assignRoles);
  expect(thread(t.id)).toMatchObject({ phase: 'done', roles: { builders: ['developer'] } });
  expect(thread(t.id).team).toEqual(expect.arrayContaining(['developer', 'code-reviewer', 'security-reviewer']));
});

test('when nobody can build, the old thread waits on the question and its worktree is kept', async () => {
  const t = store.create(projectId, 'Old build');
  store.save({ ...t, phase: 'build', status: 'idle', team: ['project-manager'], build: { worktree: 'w', branch: 'b', plan: 'p', phases: [{ title: 'A', text: 'a', step: 'develop', rounds: 0, notes: 0, open: 0 }], current: 0 } });
  runner.reply(MANAGER, ark({ ask: 'Create an agent that can build.' }));
  c.send(t.id, 'continue');
  await idle();
  expect(thread(t.id)).toMatchObject({ phase: 'build', status: 'waiting', waitingOn: MANAGER });
  expect(thread(t.id).build!.removed).toBeUndefined();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/shared/thread-upgrade.test.ts tests/main/thread-store.test.ts tests/main/conductor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: threads from older versions continue under the Head of Staff"
```

---

### Task 8: The renderer

**Files:**
- Create: `src/renderer/pages/HeadForm.tsx`
- Modify: `src/renderer/hooks/useCatalog.ts`, `src/renderer/pages/Agents.tsx`, `src/renderer/pages/Threads.tsx`, `src/renderer/components/Cards.tsx`, `TeamPanel.tsx`, `ThreadView.tsx`, and the file that defines the `Navigate` routes (`src/renderer/agents.ts` and the page switch that renders `agent-form`)
- Test: `tests/renderer/cards.test.ts`

**Interfaces:**
- Consumes: `window.ark.head` (Task 6); `roleLabels`, `reviewer` (Task 2); `parsePhases` from `@shared/plan` (Task 4); `AgentAvatar`, `ModelField`, `SkillsField` (part 1).
- Produces: `useCatalog()` also returns `head: AgentDef | null`; a route `{ name: 'head-form' }`.
- Screens:
  - **Agents page.** Meta line: `The agents the Head of Staff picks each team from`. Above the agent rows, one fixed row: the Head of Staff's avatar, `Head of Staff`, the muted text `Built into Ark. It coordinates every thread.`, its model, and an **Edit** button to `head-form`. No Chat and no Delete. With no agents, the list shows `No agents yet. Create one with New agent, or add the IT Services team.`
  - **HeadForm.** Title `Head of Staff`, meta `Its instructions are part of Ark. You choose its skills and model.` `SkillsField`, `ModelField`, Save (`window.ark.head.save`) and Cancel.
  - **Thread view.** Wherever a thread looks up an agent's name or picture, the list is `[head, ...catalog.agents]`.
  - **Team card.** Under the title a muted line `Easy request` or `Hard request` when the control has a difficulty. After each pick's name, its role labels as small Raised pills with muted text.
  - **Plan card.** New props `roles?: Roles` and `name: (id: string) => string`. Under the plan, muted lines: `Builds: Phase 1 - Forge, Phase 2 - Gon` (from `parsePhases`, falling back to the first builder), `Code review: Orion` or `Code review: none`, `Security review: Cipher` or `Security review: none`. The button reads `🚀 Start build`.
  - **Phase card.** New props `builder?: string` (a name) and `reviews: { code: boolean; security: boolean }`. The first line becomes `development - <builder>`; a review that will not run reads `review - skipped` or `security - skipped` with the `·` mark.
  - **Team panel.** Groups `🧭 Head of Staff` and `👥 Team`; under each member's name, its role labels joined by `, ` in muted meta text.
  - **Threads page copy.** `The Head of Staff proposes a team and waits for your approval.` and `Start one and the Head of Staff will propose a team.`

- [ ] **Step 1: Write the failing test** (`tests/renderer/cards.test.ts`)

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { PhaseCard, PlanCard } from '../../src/renderer/components/Cards';

const name = (id: string) => ({ dev: 'Forge', ui: 'Gon', rev: 'Orion' })[id] ?? id;
const plan = '## Phase 1: API (@dev)\na\n## Phase 2: UI (@ui)\nb\n## Phase 3: Docs\nc';

test('the plan card says who builds each phase and who reviews', () => {
  const html = renderToStaticMarkup(createElement(PlanCard, { text: plan, active: true, pending: false, start: () => {}, name, roles: { builders: ['dev', 'ui'], codeReview: 'rev' } }));
  expect(html).toContain('Builds: Phase 1 - Forge, Phase 2 - Gon, Phase 3 - Forge');
  expect(html).toContain('Code review: Orion');
  expect(html).toContain('Security review: none');
  expect(html).toContain('Start build');
});

test('the phase card names the builder and marks a review that will not run', () => {
  const phase = { title: 'API', text: '', step: 'develop' as const, rounds: 0, notes: 0, open: 0 };
  const html = renderToStaticMarkup(createElement(PhaseCard, { phase, index: 0, total: 1, builder: 'Forge', reviews: { code: true, security: false } }));
  expect(html).toContain('development - Forge');
  expect(html).toContain('security - skipped');
  expect(html).not.toContain('review - skipped');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/renderer/cards.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the screens listed under Interfaces**

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: Head of Staff and thread roles in the interface"
```

---

### Task 9: Documents and a run in the app

**Files:**
- Modify: `README.md`, `PROJECT.md`, `CLAUDE.md`

- [ ] **Step 1: Update the documents**

- `CLAUDE.md`, "Rules specific to Ark": the rule `Agents are read-only by default. Only the developer builds, inside a Git worktree ...` becomes `Agents are read-only by default. Only a thread's builders build, during the build phase, inside a Git worktree ark/<title>-<id>; risky actions need an approval card, except in a thread the user explicitly set to Full access (src/shared/permissions.ts). Keep that the only bypass. A build skips a review only after the user allowed it on a card.` Add one line: `Ark ships no agents. The Head of Staff (src/main/services/head-of-staff.ts) is built in and is not a catalog file; the user's agents do the planning, building and reviewing.` In "User data", add `avatars`.
- `README.md` and `PROJECT.md`: every passage that describes the project manager, the developer, the reviewers or "Add thread roles" is rewritten for the Head of Staff, the empty catalog, the easy and hard paths and the roles. Keep the documents' length and tone.

- [ ] **Step 2: Run every check**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 3: Try it in the app and report what you saw**

Run: `npm run dev`. Use a throwaway Git repository as the project. These steps call the real engines on the user's subscriptions: ask the user before doing them, and skip the ones they decline.
1. With an empty catalog (rename `%APPDATA%\ark\agents` aside first, and restore it after): the Agents page shows the Head of Staff row and the empty text; starting a thread shows `No agents yet. Create an agent or add a ready team in Agents.` and nothing runs.
2. Create one agent that can change files and one that cannot. Start a thread with a one-line bug fix: the team card says `Easy request`, the builder has the `Builds` label, and after approval the builder writes a one-phase plan with no discussion.
3. Press Start build: because no reviewer is set, two cards ask to build without a code review and without a security review. Deny one: the plan stays, nothing is built. Start again and allow both: the build runs in the worktree and the opening note names the skipped reviews.
4. Start a thread asking for a new feature with no manager-type agent: the Head of Staff asks you to create a project manager agent.
5. Open a thread created before this change: its history is there and a message gets an answer from the Head of Staff.

- [ ] **Step 4: Commit**

```bash
git add README.md PROJECT.md CLAUDE.md
git commit -m "docs: the Head of Staff and user-made agents"
```
