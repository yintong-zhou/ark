# Phase 3 Step 2: Branches, sync, worktrees and thread merge, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the Git view the user switches, creates and deletes branches, fetches, pulls and pushes, lists and removes worktrees, and merges a finished thread's branch into the project, then removes its worktree.

**Architecture:**
- **Shared.** `src/shared/git.ts` gets the branch and worktree types and two pure parsers (`for-each-ref`, `worktree list --porcelain -z`). `Build` gets `removed?: true`.
- **Main.** The new operations go in `src/main/services/git/repo.ts`, each one a single `inRepo` call (queued per folder, top-folder check), like step 1. The thread rules (busy, which thread owns a worktree, may it be removed) move out of `ipc/index.ts` into a new `src/main/services/git/rules.ts`, so they can be tested. The conductor gets `worktreeRemoved(threadId)`, which saves `build.removed` and emits a thread update.
- **Renderer.** `GitView.tsx` gets the branch row actions. A new `components/GitSections.tsx` holds `BranchMenu`, `WorktreesSection` and `ThreadBranchSection`. `Threads.tsx` drops the worktree option once `build.removed`, and wires **Show** and "go to the project root after a conflict".

**Tech Stack:** Electron 45, React 19, Tailwind 4, the user's `git` on PATH via step 1's runner, vitest.

**Carried from step 1's final review:**
- In this plan:
  - M3, the commit draft (Task 5);
  - M4, the nested repo row (Task 5);
  - M6, the dead exports (Task 2);
  - the unstage conflict check via `ls-files -u` (Task 2);
  - the busy rule's test via `rules.ts` (Task 3).
- Still deferred: M5 (Discard all trashes files one by one), plus the minor test and cosmetic items in step 1's ledger.
- Sync stays inside the folder queue. A slow push holds stage and commit for up to 2 minutes, while its button spins **[call]**.

**Spec:** `docs/superpowers/specs/2026-11-07-phase3-git-design.md` (§5.1 branch row, §5.4–§5.7, §6.2, §6.4, §9). Step 1 (`docs/superpowers/plans/2026-11-07-phase3-step1-git-status.md`) is merged in `main`. The busy rule (§5.8) already exists, and this step extends it to the new write actions.

## Global Constraints

- Every git call goes through `src/main/services/git/run.ts` (`gitNow` inside `inRepo`/`queued`). That means no hooks, `GIT_LITERAL_PATHSPECS=1` and `GIT_TERMINAL_PROMPT=0`. `threads/workspace.ts` stays as is.
- The renderer names only a root (or a project or thread id), a branch name, or a worktree path. Main checks every one of them:
  - a branch to switch to, delete or merge must appear in `branches(dir)`, read inside the same queued operation;
  - a new branch name must pass `git check-ref-format --branch <name>` and must not start with `-`;
  - a worktree path must be one that `git worktree list` returned, and never the first (main) one.
- IPC payloads:
  - names and paths are strings, `name.length <= 255`, `path.length <= 1024`, with no `\0`;
  - `track` and `force` go through `bool()`.
- Sync timeout: 120_000 ms (spec §5.5) for `fetch --prune`, `pull --ff-only` and `push`. Everything else keeps the runner's default of 60 s.
- Busy rule: every new write action on a **thread root** (switch, create, delete, fetch, pull, push) is refused with `GIT_BUSY` while that thread's `status === 'running'`. `git:merge-thread` is refused with `GIT_BUSY` while its thread is running. `git:remove-worktree` on a thread's worktree is refused unless the thread is `phase === 'done'` and not running.
- After every write action main returns fresh data (a status, or the worktree list), so the view never needs a second call.
- Copy, verbatim (the spec's text plus mine, marked **[call]** in the spec's sense):
  - buttons and titles: `Fetch`, `Pull`, `Push`, `Create branch…`, `Delete branch…`, `Remote` (muted label), `Worktrees`, `Prune`, `Show`, `Remove`, `Thread branch`, `Merge into <branch>`, `Remove worktree`, `Merged`;
  - the branch name field placeholder is `Branch name`;
  - confirms:
    - `Delete branch <name>?`;
    - `Not merged. Delete anyway?`;
    - `Remove worktree <folder>? The branch <branch> stays.`;
    - `Merge <branch> into <into>?`;
  - the thread branch line is `<branch> → <into>`, then `<n> commits to merge` (`1 commit to merge`) or `Nothing to merge`;
  - main's errors:
    - `Invalid branch name`;
    - `Unknown branch`;
    - `Unknown worktree`;
    - `The main worktree can't be removed`;
    - `Finish the thread before removing its worktree`;
    - `Check out a branch in the project first`;
    - `The branches have diverged. Pull from the terminal to merge or rebase.`;
    - `No remote named origin. Add one from the terminal to push.`
- No colours. Ahead/behind is `↑n ↓m` in muted text. 24px rows (`h-3`). Brand tokens only. UI text English.
- Tests use real repos (step 1's `repo()` / `committed()` helpers in `tests/main/git.test.ts`, with local `user.name`, `user.email`, `commit.gpgsign=false`, `core.autocrlf=false`). Push and pull go to a local bare repo added as `origin`, so the tests never touch the network.
- Commits use `git commit -F <file>` with no BOM. Never write to `~/.claude`, `~/.codex` or `%APPDATA%\ark`. App checks use `--user-data-dir` in the scratchpad, with `ark-profile` in the name.
- Checks before done: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **Removing a worktree that Ark is watching or polling.** On Windows the recursive `fs.watch` holds the folder, so `git worktree remove` fails or leaves half a folder. → Task 4: the handler unwatches the thread root before removing. Task 7 checks it in the app with that worktree's Files view open first.
2. **Merging a thread branch that conflicts with the project.** The merge must stay in progress and return `'conflict'`, not throw, so the UI can send the user to the project's conflicts. → Task 3 test `mergeBranch leaves a conflicting merge in progress`.
3. **A pull when local and upstream diverged.** It must give the readable message and change nothing. → Task 2 test `pull refuses diverged branches with a readable message`.
4. **Deleting an unmerged branch.** The first call must not delete it and returns `'unmerged'`; only `force` deletes. → Task 2 test `deleteBranch reports unmerged and keeps the branch until forced`.
5. **Removing a worktree whose thread is not done, or the main worktree, or a path git did not list.** All three are refused in main, whatever the UI shows. → Task 3 tests in `tests/main/git-rules.test.ts` and `removeWorktree refuses the main worktree and unknown paths`.

---

### Task 1: Shared branch and worktree model

**Files:**
- Modify: `src/shared/git.ts`, `src/shared/thread.ts` (`Build`)
- Test: `tests/shared/git.test.ts`

**Interfaces:**
- Produces in `src/shared/git.ts`:
  - `type GitBranch = { name: string; current: boolean; upstream?: string; ahead: number; behind: number }`;
  - `type GitBranches = { local: GitBranch[]; remote: string[] }`. `remote` holds short names like `origin/feat`, with `*/HEAD` left out, as are remote branches that already have a local twin (a local branch with that upstream, or a local branch named like the part after the first `/`);
  - `const REFS_FORMAT = '%(refname)%00%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)'`;
  - `parseRefs(out: string): GitBranches`. The input is one ref per line, the fields above split by `\0`. Locals keep their order, except that the current branch goes first;
  - `type GitWorktree = { path: string; head?: string; branch?: string; detached: boolean; locked: boolean; prunable: boolean }`. `branch` is the short name, without `refs/heads/`;
  - `parseWorktrees(out: string): GitWorktree[]`. The input is the output of `git worktree list --porcelain -z`: attributes are NUL-terminated and a record ends with an empty token;
  - `type ThreadBranch = { branch: string; into: string | null; ahead: number }`;
  - `type WorktreeRow = GitWorktree & { thread?: { id: string; title: string; done: boolean } }`.
- Produces in `src/shared/thread.ts`: `Build` gains `removed?: true`. It is set once the worktree is removed and is never cleared.

- [ ] **Step 1: Write the failing tests**

```ts
test('parseRefs: current first, track counts, remote HEAD and twins left out', () => {
  const line = (...f: string[]) => f.join('\0');
  const out = [
    line('refs/heads/a', 'a', '', '', ' '),
    line('refs/heads/main', 'main', 'origin/main', 'ahead 2, behind 1', '*'),
    line('refs/heads/old', 'old', 'origin/old', 'gone', ' '),
    line('refs/remotes/origin/HEAD', 'origin', '', '', ' '),
    line('refs/remotes/origin/main', 'origin/main', '', '', ' '),
    line('refs/remotes/origin/a', 'origin/a', '', '', ' '),
    line('refs/remotes/origin/feat/x', 'origin/feat/x', '', '', ' '),
  ].join('\n') + '\n';
  expect(parseRefs(out)).toEqual({
    local: [
      { name: 'main', current: true, upstream: 'origin/main', ahead: 2, behind: 1 },
      { name: 'a', current: false, ahead: 0, behind: 0 },
      { name: 'old', current: false, upstream: 'origin/old', ahead: 0, behind: 0 },
    ],
    remote: ['origin/feat/x'],
  });
});

test('parseWorktrees: main first, branch short name, detached and prunable', () => {
  const out = 'worktree C:/r\0HEAD abc\0branch refs/heads/main\0\0worktree C:/w\0HEAD def\0detached\0prunable gitdir file points to non-existent location\0\0';
  expect(parseWorktrees(out)).toEqual([
    { path: 'C:/r', head: 'abc', branch: 'main', detached: false, locked: false, prunable: false },
    { path: 'C:/w', head: 'def', detached: true, locked: false, prunable: true },
  ]);
});
```

- [ ] **Step 2: Run them and see them fail:** `npx vitest run tests/shared/git.test.ts` should report FAIL, because `parseRefs` is not exported.
- [ ] **Step 3: Implement the types and the two parsers** in `src/shared/git.ts`, and `removed?: true` on `Build`.
- [ ] **Step 4: Run them and see them pass:** `npx vitest run tests/shared/git.test.ts` should PASS, and `npm run typecheck` should be clean.
- [ ] **Step 5: Commit** `feat(git): branch and worktree parsers`.

### Task 2: Branches and sync in main, plus step 1's leftovers in repo.ts

**Files:**
- Modify: `src/main/services/git/repo.ts`, `src/main/services/git/run.ts`
- Test: `tests/main/git.test.ts`

**Interfaces:**
- Consumes: `REFS_FORMAT`, `parseRefs`, `GitBranches` (Task 1).
- Produces in `repo.ts`, each one a single `inRepo(dir, …)`:
  - `branches(dir): Promise<GitBranches>`. It runs `for-each-ref --format=<REFS_FORMAT> refs/heads refs/remotes`;
  - `switchBranch(dir, name: string, track: boolean): Promise<void>`. With `track` false, `name` must be in `local`, and it runs `switch <name>`. With `track` true, `name` must be in `remote`, and it runs `switch --track <name>`. Anything else throws `Unknown branch`;
  - `createBranch(dir, name: string): Promise<void>`. It checks the name (`check-ref-format --branch`, no leading `-`; otherwise `Invalid branch name`), then runs `switch -c <name>`;
  - `deleteBranch(dir, name: string, force: boolean): Promise<'deleted' | 'unmerged'>`. `name` must be a local branch that is not the current one (`Unknown branch` otherwise). It runs `branch -d` (or `-D` with `force`). Git's "not fully merged" refusal returns `'unmerged'`; any other error throws;
  - `fetch(dir)`, `pull(dir)`, `push(dir): Promise<void>`, with a timeout of 120_000:
    - `fetch` runs `fetch --prune`;
    - `pull` runs `pull --ff-only`. When git says it can't fast-forward, it throws the diverged copy (Global Constraints);
    - `push` runs plain `push` when the status has an upstream. Otherwise, if `git remote` lists `origin`, it runs `push -u origin <branch>`; if not, it throws the no-origin copy. On a detached HEAD it throws `Check out a branch in the project first`.
- Leftovers from step 1's final review:
  - `unstage` decides "is a conflict open" with `ls-files -u`, not the capped status. With `rels` empty and no unmerged path, it restores `.` without reading the status;
  - delete the unused exports `gitRun` and `gitBuffer` from `run.ts` (M6).

- [ ] **Step 1: Write the failing tests.** Add a helper `withOrigin(): { dir, bare }`: a `committed()` repo plus `git init --bare` in another temp dir, `remote add origin <bare>` and `push -u origin main`. Then the tests:
  - `branches lists local with track counts and remote-only branches`: push a `feat` branch from a clone, `fetch`, and expect `remote` to contain `origin/feat` and `local[0]` to be `main`, with `current: true`;
  - `createBranch switches to the new branch and refuses bad names`: after `createBranch(dir, 'x/y')` the status shows `branch: 'x/y'`; `'-x'`, `'a..b'` and `'a b'` reject with `Invalid branch name`;
  - `switchBranch refuses names not in the list`: `switchBranch(dir, 'nope', false)` rejects with `Unknown branch`, and `switchBranch(dir, 'origin/feat', true)` creates a local `feat` that tracks `origin/feat`;
  - `deleteBranch reports unmerged and keeps the branch until forced`: commit on `u`, switch back to `main`. `deleteBranch(dir,'u',false)` returns `'unmerged'` and `u` still exists; with `force` it returns `'deleted'` and `u` is gone. Deleting the current branch rejects with `Unknown branch`;
  - `push sets an upstream on first push and pull fast-forwards`: push a new branch, then expect `status().upstream === 'origin/<branch>'`. A commit made from a second clone and pushed comes in through `pull(dir)`;
  - `pull refuses diverged branches with a readable message`: local and remote each get a commit. `pull` rejects with the diverged copy, and HEAD is unchanged;
  - `push without origin names the missing remote`: a `committed()` repo with no remote rejects with the no-origin copy;
  - `unstage all leaves conflicts alone without reading status`: keep the existing conflict test passing. Add one where `unstage([])` on a repo with only staged files unstages them all.
- [ ] **Step 2: Run them and see them fail:** `npx vitest run tests/main/git.test.ts` should report FAIL on the missing exports.
- [ ] **Step 3: Implement the functions above** in `repo.ts`. Sync passes `{ timeoutMs: 120_000 }` to `gitNow`. Detect "not fully merged" and "Not possible to fast-forward" / "diverg" in the error message with a regex, case-insensitive.
- [ ] **Step 4: Run them and see them pass:** `npx vitest run tests/main/git.test.ts` should PASS, and `npm run typecheck` should be clean, with no other importer of `gitRun` or `gitBuffer` left (grep).
- [ ] **Step 5: Commit** `feat(git): branches, fetch, pull, push`.

### Task 3: Worktrees, thread merge and the thread rules

**Files:**
- Modify: `src/main/services/git/repo.ts`, `src/main/services/files/guard.ts` (`rootDir`), `src/main/services/threads/conductor.ts`
- Create: `src/main/services/git/rules.ts`
- Test: `tests/main/git.test.ts`, `tests/main/git-rules.test.ts` (new), `tests/main/files-guard.test.ts`, `tests/main/conductor.test.ts`

**Interfaces:**
- Consumes: `parseWorktrees`, `GitWorktree`, `ThreadBranch` (Task 1), `branches` (Task 2).
- Produces in `repo.ts`:
  - `worktrees(dir): Promise<GitWorktree[]>`, from `worktree list --porcelain -z`;
  - `removeWorktree(dir, path: string): Promise<void>`. `path` must equal, by `samePath`, a listed worktree other than the first: `The main worktree can't be removed` for the first, `Unknown worktree` when it isn't listed. It runs `worktree remove <listed path>` with no `--force`, passing git's own spelling of the path;
  - `pruneWorktrees(dir): Promise<void>`, which runs `worktree prune`;
  - `threadBranch(dir, branch: string): Promise<ThreadBranch>`. `into` is `symbolic-ref --short -q HEAD`, or null when detached. `ahead` is `rev-list --count <into>..<branch>`, or 0 when `into` is null. A branch missing from `local` throws `Unknown branch`;
  - `mergeBranch(dir, branch: string): Promise<'merged' | 'conflict'>`. `branch` must be local, and HEAD must be on a branch (`Check out a branch in the project first` otherwise). It runs `merge --no-ff --no-edit <branch>`. When that fails and `MERGE_HEAD` exists, it returns `'conflict'`; otherwise it rethrows.
- Produces in `rules.ts` (pure apart from `rootDir`, so the tests pass a fake store):
  - `samePath(a: string, b: string): boolean`, which compares `resolve(a).toLowerCase()` with `resolve(b).toLowerCase()` (git prints `C:/x`, Node `C:\x`);
  - `gitRoot(ref: RootRef, store: RootStore, write: boolean): string`. This is step 1's `gitDir`, moved out of `ipc/index.ts`: a write on a running thread throws `GIT_BUSY`. `RootStore` is the store shape `rootDir` already takes;
  - `worktreeThread(threads: Thread[], path: string): Thread | undefined`, the thread whose `build.worktree` is `samePath` to `path` and whose build isn't `removed`;
  - `checkRemovable(t: Thread | undefined): void`, which throws `Finish the thread before removing its worktree` when `t` exists and is not (`phase === 'done'` and `status !== 'running'`);
  - `checkMergeable(t: Thread): string`, which returns `t.build.branch`. It throws `GIT_BUSY` while running, and `Unknown worktree` when there's no build.
- `rootDir` in `guard.ts` throws `Worktree not found` for a thread whose `build.removed` is set.
- `Conductor.worktreeRemoved(threadId: string): void` sets `build.removed = true` through the existing private `save(t, [])`, so it is saved and emitted. It does nothing when the thread has no build.

- [ ] **Step 1: Write the failing tests.**
  - `git.test.ts`:
    - `worktrees lists the main one first and removeWorktree removes a clean one`: `git worktree add -b wt <tmp>/wt` from the test, then `removeWorktree(dir, <same path with backslashes>)`, then expect `worktrees(dir)` to have length 1 and `wt` to still be in `branches(dir).local`;
    - `removeWorktree refuses the main worktree and unknown paths` (both copies);
    - `removeWorktree refuses a worktree with changes`: an untracked file in it means it rejects, and the folder still exists;
    - `mergeBranch merges with a merge commit`: `merged`, and `rev-list --parents -1 HEAD` shows two parents;
    - `mergeBranch leaves a conflicting merge in progress`: the result is `'conflict'`, `status().merging` is true, and there is a conflict entry;
    - `threadBranch counts commits to merge`: 2 commits on the branch give `{ into: 'main', ahead: 2 }`.
  - `git-rules.test.ts`:
    - `gitRoot refuses writes on a running thread but allows reads`;
    - `worktreeThread matches across slash and case`;
    - `checkRemovable allows only done, idle threads`;
    - `checkMergeable refuses a running thread`.
  - `files-guard.test.ts`: `rootDir refuses a removed worktree` (the folder exists, `build.removed: true`).
  - `conductor.test.ts`: `worktreeRemoved marks the build and emits`, using the existing conductor test setup.
- [ ] **Step 2: Run them and see them fail:** `npx vitest run tests/main/git.test.ts tests/main/git-rules.test.ts tests/main/files-guard.test.ts tests/main/conductor.test.ts` should report FAIL.
- [ ] **Step 3: Implement the functions above.** In `ipc/index.ts`, replace the inline `gitDir` with `gitRoot(rootRef(r), store, write)`, with the same behaviour.
- [ ] **Step 4: Run them and see them pass:** the same command should PASS, and `npm test` should be green.
- [ ] **Step 5: Commit** `feat(git): worktrees, thread merge and thread rules`.

### Task 4: IPC and preload for the new channels

**Files:**
- Modify: `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/shared/types.ts` (`ArkApi.git`)

**Interfaces:**
- Consumes: everything Tasks 2 and 3 produce, `conductor`, `watcher`, `store`.
- Produces in `ArkApi.git`, in addition to step 1's channels:
  - `branches(root): Promise<GitBranches>`, for `git:branches` (read);
  - `switchBranch(root, name, track): Promise<GitStatus>`, `createBranch(root, name): Promise<GitStatus>`, and `deleteBranch(root, name, force): Promise<{ status: GitStatus; unmerged: boolean }>`, for `git:switch`, `git:create-branch` and `git:delete-branch` (writes);
  - `fetch(root)`, `pull(root)`, `push(root): Promise<GitStatus>`, for `git:fetch`, `git:pull` and `git:push` (writes);
  - `worktrees(projectId): Promise<WorktreeRow[]>`, for `git:worktrees`. It fills each row's `thread` with `worktreeThread`, where `done` is `phase === 'done' && status !== 'running'`;
  - `removeWorktree(projectId, path): Promise<WorktreeRow[]>`, for `git:remove-worktree`. In order, it:
    1. finds `t = worktreeThread(...)`;
    2. calls `checkRemovable(t)`;
    3. if `t`, calls `watcher.unwatch(rootKey({ kind: 'thread', id: t.id }))` (Review Focus 1);
    4. calls `removeWorktree(projectDir, path)`;
    5. if `t`, calls `conductor.worktreeRemoved(t.id)`;
    6. returns the fresh rows;
  - `pruneWorktrees(projectId): Promise<WorktreeRow[]>`, for `git:prune-worktrees`;
  - `threadBranch(threadId): Promise<ThreadBranch | null>`, for `git:thread-branch` (null when there's no build), run in the thread's project folder;
  - `mergeThread(threadId): Promise<{ merged: boolean; status: GitStatus }>`, for `git:merge-thread`. It runs `checkMergeable`, then `mergeBranch(projectDir, branch)`, and `status` is the **project's** status.
- Validation helpers live next to `bool()` in `ipc/index.ts`: `branchArg(v)` (a string of 1–255 characters, no `\0`) and `pathArg(v)` (a string of 1–1024 characters, no `\0`). Project and thread ids go through the existing `uuid()` / `rootDir`.

- [ ] **Step 1: Add the handlers, the preload functions and the `ArkApi.git` types.** Every write on a root goes through `gitRoot(…, true)`.
- [ ] **Step 2: Verify:** `npm run typecheck` and `npm run lint` should be clean, and `npm test` should be green. The ipc file has no harness: its rules are tested through `rules.ts` (Task 3).
- [ ] **Step 3: Commit** `feat(git): ipc for branches, sync, worktrees and thread merge`.

### Task 5: Branch row, branch menu, and step 1's GitView leftovers

**Files:**
- Modify: `src/renderer/components/GitView.tsx`, `src/renderer/components/Icons.tsx`
- Create: `src/renderer/components/GitSections.tsx` (`BranchMenu` in this task)
- Test: `tests/renderer/git-store.test.ts` (only if the store changes; it shouldn't)

**Interfaces:**
- Consumes: `ArkApi.git` (Task 4), `act` and `useGit` from `status-store.ts`.
- Produces: `BranchMenu({ root, status, locked, attempt, at, onClose })` in `GitSections.tsx`.

Behaviour (spec §5.1 and §5.4, copy from Global Constraints):
- **Branch row:**
  - the branch name is a button that opens `BranchMenu`;
  - `↑n ↓m` shows only with an upstream;
  - then three icon buttons, `Fetch`, `Pull` and `Push` (new line icons in `Icons.tsx`), each running `act(root, () => git.fetch(root))` and so on;
  - while one runs, its icon spins (`animate-spin`) and the other two are disabled; all three follow `locked`.
- **`BranchMenu`:**
  - its own small popup, styled like `Menu.tsx` (`bg-raised`, `rounded-sm`, `shadow-lg`, Escape and an outside click close it). `Menu` can't hold a field or a submenu;
  - it loads `git.branches(root)` when it opens. It has three modes:
    - **list** shows `Create branch…`, then the locals with the current one first and checked (`✓`) and `↑n ↓m` in muted text, then a muted `Remote` label and the remote-only names, then `Delete branch…`. A local runs `switchBranch(name, false)`, a remote runs `switchBranch(name, true)`;
    - **create** is an inline `Branch name` field: Enter creates, Escape goes back to the list;
    - **delete** lists the locals other than the current one. A pick confirms `Delete branch <name>?` and runs `deleteBranch(name, false)`. When the result says `unmerged`, it confirms `Not merged. Delete anyway?` and runs it again with `force`;
  - every action goes through `attempt(() => act(root, …))`, so git's refusals land on the pane's problem line, and the menu closes.
- **M3:** the commit message draft survives a view or root switch. Keep it in a module-level `Map<rootKey, string>` in `GitView.tsx`, and clear it on a successful commit.
- **M4:** an untracked nested repo row (`rel` ending in `/`) shows the folder's name (the trailing `/` trimmed). Its discard confirm reads `Move folder <name> to the Recycle Bin?`.

- [ ] **Step 1: Implement it.** Keep `GitView.tsx` focused: the row and the commit box stay there, and the menu lives in `GitSections.tsx`.
- [ ] **Step 2: Verify:** `npm run typecheck`, `npm run lint` and `npm test` should be clean, and `npm run build` should succeed.
- [ ] **Step 3: Commit** `feat(git): branch row, branch menu and sync buttons`.

### Task 6: Worktrees and Thread branch sections, and the root picker

**Files:**
- Modify: `src/renderer/components/GitSections.tsx`, `src/renderer/components/GitView.tsx`, `src/renderer/pages/Threads.tsx`

**Interfaces:**
- Consumes: `ArkApi.git.worktrees / removeWorktree / pruneWorktrees / threadBranch / mergeThread` (Task 4), `Build.removed` (Task 1).
- Produces:
  - `WorktreesSection({ projectId, attempt, onShowThread })`;
  - `ThreadBranchSection({ thread, attempt, onConflict })`;
  - new `GitView` props `onShowThread(id: string)` and `onConflict()`, passed by `Threads.tsx`.

Behaviour (spec §5.6, §5.7, §6.4):
- **`WorktreesSection`:**
  - shown only on a project root, collapsed by default. The header is `Worktrees`, with `Prune`;
  - the rows are the main worktree first, then the rest, each showing its branch (or `detached`) and its folder name, with the full path as `title`;
  - a thread's row shows `#<title>` and `Show`, which calls `onShowThread(id)`;
  - `Remove` appears on every row except the first. It is disabled for a thread row whose `done` is false. It confirms `Remove worktree <folder>? The branch <branch> stays.`;
  - the section reloads its rows from each action's return value, and loads when expanded.
- **`ThreadBranchSection`:**
  - shown on a thread root whose thread has a build that isn't removed. It loads `threadBranch(thread.id)` on mount and when the thread's status changes;
  - it shows `<branch> → <into>`, the count line, and `Merge into <into>`, disabled with `ahead === 0`, a null `into`, or a running thread. That button confirms `Merge <branch> into <into>?`;
  - on `merged: true` it shows `Merged` and calls `act(projectRoot, …)` with the returned status, so the project's view refreshes. On `merged: false` (a conflict) it pushes the status into the project root the same way, then calls `onConflict()`;
  - `Remove worktree` is enabled only when the thread is `done` and not running, and it uses the same confirm and `removeWorktree(projectId, build.worktree)`.
- **`Threads.tsx`:**
  - `worktree` is `thread?.build && !thread.build.removed ? thread.build.worktree : undefined`. A removed build drops the picker option, and the root falls back to the project;
  - `onShowThread(id)` selects that thread (`ws.select`) and leaves the picker on `worktree` for it. The existing `rootFor` reset must not undo that: keep the wanted thread id in state and apply `worktree` when `rootFor` catches up;
  - `onConflict()` sets the picker to `project` and keeps the view on `git`.

- [ ] **Step 1: Implement it.**
- [ ] **Step 2: Verify:** `npm run typecheck`, `npm run lint` and `npm test` should be clean, and `npm run build` should succeed.
- [ ] **Step 3: Commit** `feat(git): worktrees and thread branch sections`.

### Task 7: Docs and the check in the built app

**Files:**
- Modify: `README.md` (the `## Git` section: branches, sync, worktrees, thread merge), `CLAUDE.md` only if a rule changed

- [ ] **Step 1: Update the README** in the existing section's voice.
- [ ] **Step 2: Run the checks:** `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` must all be green.
- [ ] **Step 3: Check it in the built app over CDP** (recipe: `docs/handoff/2026-11-07-ark-phase2-step2-done.md`, last section). Use a scratch profile `ark-profile-*`, a scratch repo with a bare `origin`, and a scratch thread written straight into the profile: `threads/<uuid>/thread.json` with `phase: 'done'`, `status: 'idle'`, and `build: { worktree, branch, plan: '', phases: [], current: 0 }`, where the worktree is made with `git worktree add -b ark/demo-1234 <path>` and holds one commit. Then:
  1. create a branch from the menu, switch back, and delete it;
  2. push the new branch (an upstream gets set) and fetch;
  3. open the thread, pick `Worktree` in Files (so it is watched), then Git → `Thread branch` → `Merge into main`, and check the project's `git log` for the merge commit;
  4. `Remove worktree`: the folder is gone, the picker drops `Worktree`, and the project root's `Worktrees` lists only the main one;
  5. repeat with a conflicting thread branch: the view lands on the project root with the merge banner, then `Abort merge`;
  6. take a screenshot of each state. Close the test app by filtering `electron.exe` on `*ark-profile*`.
- [ ] **Step 4: Commit** `docs: git branches, sync and worktrees`.
