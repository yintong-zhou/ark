# Skill Import Implementation Plan (Head of Staff, part 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user import a skill folder into Ark and give it to an agent or to the Head of Staff, next to the skills installed on the PC.

**Architecture:** An imported skill is a checked copy under `%APPDATA%\ark\skills\<name>`. The skill index scans that folder first, so an imported skill wins over an installed one of the same name. The isolation check keeps forbidding the user's personal Claude skills by reading them from their own list, not from the de-duplicated index.

**Tech Stack:** Electron main (Node 22), React 19 + Tailwind renderer, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-head-of-staff-design.md`, section 4. Requires part 1 merged (`SkillsField` with its `children` slot) and part 2 for the Head of Staff's screen.

## Global Constraints

- UI text is English. Use a hyphen (-) in place of an em dash, in code, copy and commit messages.
- Ark never writes into `~/.claude`, `~/.codex` or `~/.agents`. Imported skills live only in `%APPDATA%\ark\skills`.
- Main opens the folder dialog. The renderer never sends a path.
- Links inside the chosen folder are never followed and never copied.
- Caps: at most 200 files and 5 MB per skill.
- A skill's name is its folder name and must match `^[A-Za-z0-9][\w.-]{0,63}$`.
- Do not weaken `engines/isolation.ts`: an agent session still loads only its own skills, and the user's personal skills stay forbidden.
- Removing an imported skill moves it to the Recycle Bin.
- Do not run `npm run test:live`.
- Every task ends green on `npm run typecheck`, `npm run lint` and `npm test`.

## Review Focus

1. The user imports a skill named like one of their personal Claude skills and gives it to an agent: the session loads Ark's copy, and the personal one is still reported as a violation if Claude loads it. (Task 2)
2. The chosen folder holds a link to a folder outside it (for example to the user's home): the import is refused and nothing is copied. (Task 1)
3. The chosen folder is huge (a whole repository picked by mistake): refused on the caps before any byte is copied. (Task 1)
4. The original folder is moved or deleted after the import: the agent still starts with the skill. (Task 1)
5. An agent is assigned an imported skill that is later removed: its card shows `Skill not installed: <name>` and its session refuses to start with that message, as for any missing skill today. (Task 3 run)

---

### Task 1: Import, check and index

**Files:**
- Modify: `src/main/services/skills.ts`, `src/shared/types.ts` (`SkillSource`), `src/main/index.ts` (roots)
- Test: `tests/main/skills.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/types.ts
  export type SkillSource = 'ark' | 'claude-user' | 'claude-plugin' | 'agents-user' | 'codex-user' | 'codex-system';
  // src/main/services/skills.ts
  export type SkillRoots = { claudeConfigDir: string; home: string; codexHome: string; ark: string }; // ark: %APPDATA%\ark\skills
  export const SKILL_MAX_FILES = 200;
  export const SKILL_MAX_BYTES = 5 * 1024 * 1024;
  /** The files of a folder that can be imported, as paths relative to it. Throws with the reason when it cannot. */
  export function checkSkillFolder(src: string): { name: string; files: string[] };
  /** Copies a checked folder to <arkDir>/<name>. An existing one is replaced only when `replace`. */
  export function importSkill(src: string, arkDir: string, replace?: boolean): { status: 'imported' | 'exists'; name: string };
  /** The folder of an imported skill; throws 'Not an imported skill' for anything else. */
  export function arkSkillDir(name: string, arkDir: string): string;
  /** Every skill in the user's own Claude folder, including one an imported skill hides in the index. */
  export function personalSkills(roots: SkillRoots): SkillEntry[];
  ```
- `indexSkills` scans `roots.ark` first, with source `'ark'`; the rest of its order is unchanged.
- `checkSkillFolder` errors, checked in this order while walking with `lstat` (no file is read):
  - `This folder has no SKILL.md`
  - `Rename the folder: use letters, digits, dots, dashes and underscores`
  - `The skill contains a link (<relative path>); links are not imported`
  - `The skill has more than 200 files`
  - `The skill is larger than 5 MB`
- `importSkill` copies exactly the files `checkSkillFolder` listed, into a temporary sibling folder that is renamed into place at the end, so a failed copy leaves no half skill.

- [ ] **Step 1: Write the failing tests** (`tests/main/skills.test.ts`; add `ark: join(root, 'ark')` to the file's `roots`)

```ts
const src = (name: string) => join(root, 'incoming', name);

test('an imported skill is indexed first and wins over an installed one of the same name', () => {
  skill(src('handoff'), 'Imported handoff');
  expect(importSkill(src('handoff'), roots.ark)).toEqual({ status: 'imported', name: 'handoff' });
  expect(indexSkills(roots).find((s) => s.name === 'handoff')).toMatchObject({ source: 'ark', description: 'Imported handoff', dir: join(roots.ark, 'handoff') });
  expect(personalSkills(roots).map((s) => s.name)).toContain('handoff'); // the user's own is still known
});

test('the copy does not depend on the original', () => {
  skill(src('standalone'), 'x');
  writeFileSync(join(src('standalone'), 'notes.md'), 'n');
  importSkill(src('standalone'), roots.ark);
  rmSync(src('standalone'), { recursive: true });
  expect(readFileSync(join(roots.ark, 'standalone', 'notes.md'), 'utf8')).toBe('n');
});

test('importing a name again needs replace', () => {
  skill(src('twice'), 'first');
  importSkill(src('twice'), roots.ark);
  skill(src('twice'), 'second');
  expect(importSkill(src('twice'), roots.ark)).toEqual({ status: 'exists', name: 'twice' });
  expect(indexSkills(roots).find((s) => s.name === 'twice')!.description).toBe('first');
  expect(importSkill(src('twice'), roots.ark, true)).toEqual({ status: 'imported', name: 'twice' });
  expect(indexSkills(roots).find((s) => s.name === 'twice')!.description).toBe('second');
});

test('refuses a folder that is not a safe skill, and copies nothing', () => {
  mkdirSync(src('empty'), { recursive: true });
  expect(() => importSkill(src('empty'), roots.ark)).toThrow('This folder has no SKILL.md');
  skill(src('my skill'));
  expect(() => importSkill(src('my skill'), roots.ark)).toThrow('Rename the folder');
  skill(src('many'));
  for (let i = 0; i < SKILL_MAX_FILES; i++) writeFileSync(join(src('many'), `f${i}.txt`), '');
  expect(() => importSkill(src('many'), roots.ark)).toThrow('The skill has more than 200 files');
  skill(src('big'));
  writeFileSync(join(src('big'), 'blob.bin'), Buffer.alloc(SKILL_MAX_BYTES + 1));
  expect(() => importSkill(src('big'), roots.ark)).toThrow('The skill is larger than 5 MB');
  for (const n of ['empty', 'my skill', 'many', 'big']) expect(existsSync(join(roots.ark, n))).toBe(false);
});

test('a link inside the folder stops the import', () => {
  skill(src('linked'));
  try {
    symlinkSync(root, join(src('linked'), 'outside'), 'junction');
  } catch {
    return; // this machine cannot create links
  }
  expect(() => importSkill(src('linked'), roots.ark)).toThrow('The skill contains a link (outside); links are not imported');
  expect(existsSync(join(roots.ark, 'linked'))).toBe(false);
});

test('arkSkillDir names only imported skills', () => {
  skill(src('mine'));
  importSkill(src('mine'), roots.ark);
  expect(arkSkillDir('mine', roots.ark)).toBe(join(roots.ark, 'mine'));
  expect(() => arkSkillDir('nope', roots.ark)).toThrow('Not an imported skill');
  expect(() => arkSkillDir('../claude', roots.ark)).toThrow('Not an imported skill');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/main/skills.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/main/services/skills.ts`, and pass `ark: join(userData, 'skills')` in the roots built in `src/main/index.ts`**

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: import a skill folder into Ark"
```

---

### Task 2: Personal skills stay forbidden

**Files:**
- Modify: `src/main/services/agent-runner.ts`, `src/main/index.ts`
- Test: `tests/main/agent-runner.test.ts`

**Interfaces:**
- Consumes: `personalSkills` (Task 1).
- Produces: `RunnerDeps` gains `personalSkills: () => SkillEntry[]`. In the Claude branch of `startAgent`, the `forbidden` set is built from `deps.personalSkills()` (each one's `folder` and `name`) plus the project's skill names, no longer from the index filtered by source.

- [ ] **Step 1: Write the failing test** (`tests/main/agent-runner.test.ts`, with the file's existing fake deps)

```ts
test('a personal skill hidden by an imported one of the same name is still forbidden', async () => {
  const imported = { name: 'handoff', folder: 'handoff', dir: arkHandoffDir, source: 'ark' as const, description: '' };
  const personal = { name: 'handoff', folder: 'handoff', dir: personalHandoffDir, source: 'claude-user' as const, description: '' };
  const runner = makeRunner({ skills: () => [imported], personalSkills: () => [personal] });
  await runner.startAgent({ ...agent, skills: ['handoff'] }, projectDir);
  const started = claudeStarts.at(-1)!;
  expect(started.expectedFolders).toEqual(['handoff']);   // Ark's copy, loaded as ark-agent:handoff
  expect(started.forbidden.has('handoff')).toBe(true);     // the user's own, loaded bare, is a violation
});
```

Use the names the file already has for its runner factory, its recorded Claude starts and its temp folders; create the two skill folders with a `SKILL.md` each.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/main/agent-runner.test.ts`
Expected: FAIL (`forbidden` does not contain `handoff`).

- [ ] **Step 3: Implement, and pass `personalSkills: () => personalSkills(roots)` from `src/main/index.ts`**

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS, including `tests/main/isolation.test.ts` untouched.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "fix: personal skills stay forbidden when an imported one shares the name"
```

---

### Task 3: Import skill in the forms

**Files:**
- Modify: `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/shared/types.ts` (`ArkApi.skills`), `src/renderer/components/AgentFields.tsx`, `src/renderer/pages/AgentForm.tsx`, `src/renderer/pages/HeadForm.tsx`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `importSkill`, `arkSkillDir` (Task 1).
- Produces:
  ```ts
  // ArkApi.skills
  list(): Promise<SkillInfo[]>;
  /** Main opens a folder dialog. 'exists' means a skill of that name is already imported: call replace() to overwrite it. */
  import(): Promise<{ status: 'imported' | 'exists' | 'cancelled'; name?: string }>;
  replace(): Promise<{ name: string }>;
  remove(name: string): Promise<void>;
  ```
- IPC:
  - `skills:import`: `dialog.showOpenDialog(win, { properties: ['openDirectory'] })`; cancelled gives `{ status: 'cancelled' }`; otherwise the result of `importSkill(path, arkDir)`. On `'exists'` main keeps the path in a variable; any later `skills:import` clears it.
  - `skills:replace`: `importSkill(keptPath, arkDir, true)` and clears the variable; throws `Nothing to replace` when there is none.
  - `skills:remove (name)`: `shell.trashItem(arkSkillDir(name, arkDir))`; the name must be a string.
- Skills field:
  - The source of a skill is shown as `Ark` for `'ark'`; the other sources keep their text.
  - Next to the filter, a button **Import skill**. After `'imported'` the list is reloaded, the new skill is ticked for this agent, and a muted line reads `Imported <name>.` After `'exists'` the line reads `<name> is already imported.` with a button `Replace it`. Errors from main are shown as they are.
  - Each `Ark` row has a small `Remove` button that asks in place (`Remove from Ark`) and then calls `remove`, reloads the list and unticks the skill.
  - The hint under the field: `Skills installed on this PC, plus the ones you import into Ark.`
  - The same field is used in `AgentForm` and in `HeadForm`.

- [ ] **Step 1: Implement the IPC channels, the preload methods and the types**

- [ ] **Step 2: Implement the field and use it in both forms**

- [ ] **Step 3: Update the documents**

`CLAUDE.md`, "User data lives in ...": add `skills`. `README.md`: one short paragraph on importing a skill.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Try it in the app and report what you saw**

Run: `npm run dev`. Prepare a folder `demo-skill` holding a `SKILL.md` with a `description` in its header.
1. In an agent's form, Import skill, choose `demo-skill`: it appears in the list as `Ark`, ticked. Save the agent.
2. Import the same folder again: `demo-skill is already imported.` and `Replace it` works.
3. Choose a folder with no `SKILL.md`: `This folder has no SKILL.md`.
4. Delete the original `demo-skill` folder, then (ask the user first, it calls a real engine) chat with the agent: the session starts.
5. Remove the skill from Ark: it is in the Recycle Bin, and the agent's row on the Agents page shows `Skill not installed: demo-skill`.
6. The Head of Staff's screen has the same Import skill button.

- [ ] **Step 6: Commit**

```bash
git add src README.md CLAUDE.md
git commit -m "feat: import and remove skills from the agent forms"
```
