# Ready Teams Implementation Plan (Head of Staff, part 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer ready teams on the Agents page, and make the IT Services team able to run a whole thread alone: its developers build, its tech lead and security agent review.

**Architecture:** A ready team is a named list of `AgentDef`s in code. Adding one copies the missing profiles into the catalog; updating one rewrites its profiles after the user confirms. The list has one entry today and is a plain array, so a second team is one more element.

**Tech Stack:** Electron main (Node 22), React 19 + Tailwind renderer, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-head-of-staff-design.md`, section 3. Requires parts 1 and 2 merged (`alias`, `role`, `avatar` on `AgentDef`; `checkProposal`; the Head of Staff).

## Global Constraints

- UI text is English. Use a hyphen (-) in place of an em dash, in code, copy, prompts and commit messages.
- Only IT Services is shipped. No marketing or design team.
- Adding a team never overwrites an existing profile. Only **Update team** does, and only after a confirmation that says edits will be lost.
- Team agents become ordinary catalog agents: editable and deletable like any other.
- Do not run `npm run test:live`.
- Every task ends green on `npm run typecheck`, `npm run lint` and `npm test`.

## Review Focus

1. The user edited two IT Services profiles and deleted one, then presses Update team: the confirmation names how many profiles will be replaced; after it, all 14 exist in their shipped form. (Task 2)
2. One of the team's files on disk is broken (invalid YAML): Add team keeps it and reports it as kept; Update team replaces it. (Task 2)
3. A team id that is not in the list arrives over IPC: refused with `Unknown team`, nothing written. (Task 2)
4. A user who added the old read-only team and never updates: a build request ends with the Head of Staff saying nobody can build, not with a crash. (Covered by part 2's missing-role path; check it in Task 3's run.)
5. The catalog already has an agent of the user's own with a team username (for example `security`): Add team keeps the user's; the count shown is honest about it. (Task 2)

---

### Task 1: IT Services profiles that build and review

**Files:**
- Modify: `src/main/services/it-services.ts`
- Test: `tests/main/it-services.test.ts` (new), `tests/main/conductor.test.ts`

**Interfaces:**
- Consumes: `checkProposal` from `@shared/roles`; `FACES` from `@shared/avatars`.
- Produces: `IT_SERVICES_AGENTS` with the same 14 usernames, each with `alias`, `role` and a fixed `avatar` (`face-01` to `face-14`, in the order of the list).
- Changes to the profiles:

| Username | Change |
|---|---|
| `backend_dev` | `permissions: 'build'`. Mission: `Design and implement APIs, application logic and databases.` Responsibilities: `Server-side code, data models, performance and API documentation.` |
| `frontend_dev` | `permissions: 'build'`. Mission: `Design and implement the web interface.` |
| `mobile_dev` | `permissions: 'build'`. Mission: `Design and implement the iOS and Android apps.` Responsibilities: `App code, store release planning and device compatibility.` |
| `test_automation` | Mission: `Design reliable automated tests; hand test implementation to the team's developers.` |
| `tech_lead` | Mission: `Ensure technical consistency of the product and review the code of every build phase.` |
| `security` | Mission: `Protect data, access and code, and review every build phase for security problems.` L1: `Report vulnerabilities and send a build phase back with concrete findings, notifying the manager immediately.` |
| `product_manager` | Mission: `Define what gets built and in what order, and work out with the user what a request really needs.` |
| `dev_manager` | Mission: `Coordinate development and delivery, and write the plan the developers build from.` |

- The `# Ark execution boundaries` part of the shared working agreement becomes exactly:

````text
# Ark execution boundaries
While a thread discusses and plans, everyone is a read-only advisor: your role does not grant write, shell, infrastructure or production access. Code is written only during the build, by the developers the Head of Staff set as builders, each in the thread's isolated worktree, one plan phase at a time. If you are not building, hand implementation work to those developers. Do not run deployments or migrations.
Ark's Head of Staff coordinates thread turns; area managers do not start other agents or bypass team approval. Request a missing role from the Head of Staff. Use Ark's ask block when a human decision is required in a thread; in Chat ask directly. @head_of_engineering refers to the user, not a catalog agent. Use exact catalog usernames in Ark control blocks.
When your manager is absent, ask the Head of Staff or the user instead of inventing approval. Write in the user's language. Keep updates concise and traceable.
````

- [ ] **Step 1: Write the failing tests** (`tests/main/it-services.test.ts`)

```ts
import { expect, test } from 'vitest';
import { validateAgent } from '@shared/agent-file';
import { checkProposal } from '@shared/roles';
import { IT_SERVICES_AGENTS } from '../../src/main/services/it-services';

const get = (id: string) => IT_SERVICES_AGENTS.find((a) => a.id === id);

test('14 valid profiles, each with alias, role and its own face', () => {
  expect(IT_SERVICES_AGENTS).toHaveLength(14);
  for (const a of IT_SERVICES_AGENTS) {
    expect(validateAgent(a), a.id).toMatchObject({ ok: true });
    expect(a.name).toBe(`${a.alias} - ${a.role}`);
  }
  expect(new Set(IT_SERVICES_AGENTS.map((a) => a.avatar)).size).toBe(14);
});

test('the three developers build, everyone else advises', () => {
  expect(IT_SERVICES_AGENTS.filter((a) => a.permissions === 'build').map((a) => a.id).sort()).toEqual(['backend_dev', 'frontend_dev', 'mobile_dev']);
});

test('the team covers a whole thread by itself', () => {
  const picks = ['dev_manager', 'backend_dev', 'frontend_dev', 'tech_lead', 'security'].map((agent) => ({ agent, reason: 'r' }));
  const roles = { planner: 'dev_manager', builders: ['backend_dev', 'frontend_dev'], codeReview: 'tech_lead', securityReview: 'security' };
  expect(checkProposal({ kind: 'team', picks, leftOut: '', difficulty: 'hard', roles }, get)).toBeUndefined();
});

test('no profile mentions the roles Ark no longer has', () => {
  for (const a of IT_SERVICES_AGENTS) {
    expect(`${a.description}\n${a.prompt}`, a.id).not.toMatch(/build developer|Ark's developer|project-manager|Ark's project manager|the coordinator/i);
  }
  expect(get('tech_lead')!.description).toContain('review the code of every build phase');
  expect(get('security')!.description).toContain('review every build phase for security problems');
});
```

In `tests/main/conductor.test.ts`, the test `IT Services team participates in planning, username mentions and assigned tasks without build access` loses `without build access` from its name and any assertion that a developer is read-only by profile; its planning assertions stay (during planning every session still starts read-only).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/it-services.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `src/main/services/it-services.ts`**

`profile()` takes the alias and role it already receives into the new fields, plus the face and an optional build flag.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/it-services.ts tests
git commit -m "feat: the IT Services developers build, its tech lead and security agent review"
```

---

### Task 2: Ready teams in the catalog

**Files:**
- Create: `src/main/services/teams.ts`
- Modify: `src/main/services/catalog.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`
- Test: `tests/main/catalog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/main/services/teams.ts
  export type ReadyTeam = { id: string; name: string; description: string; agents: AgentDef[] };
  export const READY_TEAMS: ReadyTeam[];
  // [{ id: 'it-services', name: 'IT Services', description: 'Product, development, quality and operations. You are the Head of engineering.', agents: IT_SERVICES_AGENTS }]

  // src/shared/types.ts
  /** `present`: how many of the team's usernames already have a file in the catalog, valid or not. */
  export type TeamInfo = { id: string; name: string; description: string; count: number; present: number };
  // ArkApi.catalog: addItServices is removed; added:
  teams(): Promise<TeamInfo[]>;
  addTeam(id: string): Promise<{ added: string[]; skipped: string[] }>;
  updateTeam(id: string): Promise<{ updated: string[] }>;

  // Catalog
  teams(): TeamInfo[];
  addTeam(id: string): { added: string[]; skipped: string[] };   // only the missing profiles; throws 'Unknown team'
  updateTeam(id: string): { updated: string[] };                 // writes every profile of the team; throws 'Unknown team'
  ```
- IPC channels `catalog:teams`, `catalog:add-team`, `catalog:update-team` replace `catalog:add-it-services`. The id must be a string; `Catalog` refuses one that is not in `READY_TEAMS`. After `updateTeam`, the handler removes any uploaded image of the updated usernames (`avatars.remove`), since the profiles are back on their shipped faces.

- [ ] **Step 1: Write the failing tests** (`tests/main/catalog.test.ts`; replace the `addItServices` tests)

```ts
test('teams lists the ready teams and how much of each is already here', () => {
  expect(catalog.teams()).toEqual([{ id: 'it-services', name: 'IT Services', description: expect.any(String), count: 14, present: 0 }]);
  catalog.save({ ...agent, id: 'security' }); // the user's own agent with a team username
  expect(catalog.teams()[0].present).toBe(1);
});

test('addTeam adds what is missing and keeps what is there, even a broken file', () => {
  catalog.save({ ...agent, id: 'security', name: 'Mine' });
  writeFileSync(join(dir, 'tech_lead.md'), 'not an agent file');
  const r = catalog.addTeam('it-services');
  expect(r.added).toHaveLength(12);
  expect(r.skipped.sort()).toEqual(['security', 'tech_lead']);
  expect(catalog.get('security')!.name).toBe('Mine');
  expect(readFileSync(join(dir, 'tech_lead.md'), 'utf8')).toBe('not an agent file');
});

test('updateTeam rewrites every profile of the team and nothing else', () => {
  catalog.addTeam('it-services');
  catalog.save({ ...catalog.get('backend_dev')!, permissions: 'read-only', prompt: 'edited' });
  catalog.remove('qa_lead');
  writeFileSync(join(dir, 'tech_lead.md'), 'not an agent file');
  catalog.save({ ...agent, id: 'mine' });
  expect(catalog.updateTeam('it-services').updated).toHaveLength(14);
  expect(catalog.get('backend_dev')).toMatchObject({ permissions: 'build', alias: 'Forge' });
  expect(catalog.get('qa_lead')).toBeDefined();
  expect(catalog.get('tech_lead')).toBeDefined();
  expect(catalog.get('mine')).toMatchObject({ id: 'mine' });
  expect(catalog.list().invalid).toEqual([]);
});

test('an unknown team is refused and nothing is written', () => {
  expect(() => catalog.addTeam('marketing')).toThrow('Unknown team');
  expect(() => catalog.updateTeam('../x')).toThrow('Unknown team');
  expect(catalog.list().agents).toEqual([]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/catalog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `teams.ts`, the three `Catalog` methods, the IPC channels, the preload methods and the types; delete `addItServices` everywhere**

`Agents.tsx` still calls `addItServices`: switch that one call to `addTeam('it-services')` so the renderer compiles; Task 3 rebuilds the section.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: ready teams in the catalog, with add and update"
```

---

### Task 3: The Agents page

**Files:**
- Modify: `src/renderer/pages/Agents.tsx`, `src/renderer/hooks/useCatalog.ts`, `README.md`

**Interfaces:**
- Consumes: `window.ark.catalog.teams`, `addTeam`, `updateTeam` (Task 2).
- Produces: `useCatalog()` also returns `teams: TeamInfo[]`.
- The page, top to bottom: Engines on this machine; **Ready teams**; the Head of Staff row; the agents list or the empty state; Files with errors.
- **Ready teams** section (heading `Ready teams`, muted line `Agents ready to use. Adding a team copies them into your catalog, where you can edit or delete them.`). One row per team: name, description, `<count> agents`, and on the right:
  - `present === 0`: button `Add team`. Result line: `Added <n> <name> agents.`
  - `0 < present < count`: buttons `Add missing agents` and `Update team`. Result line for the first: `Added <n> <name> agents. <m> existing profiles kept.`
  - `present === count`: button `Update team`.
  - `Update team` asks first, in place, the way Delete does in the agent form: the button becomes `Replace <present> profiles` and a muted line under the row reads `Your edits to these profiles will be lost.` A second click runs it; anything else on the page cancels it. Result line: `Updated <n> <name> agents.`
- Empty state, when the catalog has no agents: `No agents yet. Create one with New agent, or add a ready team above.`

- [ ] **Step 1: Rebuild the section and the empty state as described**

- [ ] **Step 2: Update `README.md`**

The paragraph on the IT Services team now describes ready teams, Add and Update, and that the team's developers build and its tech lead and security agent review.

- [ ] **Step 3: Run the checks**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 4: Try it in the app and report what you saw**

Run: `npm run dev`.
1. With an empty catalog: the empty state and one Ready teams row with `Add team`. Press it: 14 agents appear, each with a different face; the row now offers `Update team`.
2. Edit `Forge - Backend dev` (change its task), delete one agent: the row offers `Add missing agents` and `Update team`. `Update team` asks before replacing; after it the task text is the shipped one and the deleted agent is back.
3. Ask the user before this one, it calls the real engines: start a thread with a small bug fix on a throwaway repository. The team card names an IT Services developer as builder and Orion and Cipher as reviewers.
4. If a catalog from before this change is at hand (IT Services added with the old version, never updated): a build request there ends with the Head of Staff asking for an agent that can build.

- [ ] **Step 5: Commit**

```bash
git add src README.md
git commit -m "feat: ready teams on the Agents page"
```
