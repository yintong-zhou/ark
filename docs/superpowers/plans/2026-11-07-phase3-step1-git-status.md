# Phase 3 Step 1: Git status, staging, commit and diffs, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Git view in the project sidebar (changes, stage, unstage, discard, commit), diffs in tabs, and status letters in the file tree, for a project folder or a thread worktree.

**Architecture:**
- **Shared.** `src/shared/git.ts` holds the types and the pure parsers (porcelain v2 status, groups, letters).
- **Main.** `src/main/services/git/run.ts` is the one way Ark's Git UI calls git: no hooks, literal pathspecs, no prompts, one call at a time per folder. `src/main/services/git/repo.ts` has the operations. `git:*` IPC handlers resolve the root with Phase 2's `rootDir` and return the fresh status after every write.
- **Renderer.** `src/renderer/git/status-store.ts` keeps each root's status at module level and refreshes it (watcher, focus, 5 s poll while shown). `GitView.tsx` is the third sidebar view. Diff tabs live in the existing tabs store as docs with a `diff` side, shown by `DiffView.tsx` (Monaco's diff editor).

**Tech Stack:** Electron 45, React 19, Tailwind 4, Monaco (already bundled), the user's `git` on PATH via `execFile`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-phase3-git-design.md` (§3, §4, §5.1–§5.3, §5.8, §6.1–§6.3, §7, §9). Step 2 (branches, sync, worktrees, thread merge) gets its own plan.

**Deviation from spec §8:** the busy-thread rule (§5.8) moves into this step, because stage and commit on a worktree already race the conductor here.

## Global Constraints

- Every git call from the Git UI goes through `gitRun` (Task 2): args start with `-c core.hooksPath=<NO_HOOKS>` (import `NO_HOOKS` from `src/main/services/threads/workspace.ts`), env is `process.env` plus `GIT_LITERAL_PATHSPECS=1` and `GIT_TERMINAL_PROMPT=0`, `windowsHide: true`, buffer 64 MB, default timeout 60 s. `threads/workspace.ts` keeps its own `git()` unchanged.
- Paths reach git only through stdin (`--pathspec-from-file=- --pathspec-file-nul`) or after `--`, never as an option position.
- Status: `git status --porcelain=v2 -z --branch --untracked-files=all`, capped at 5000 entries with `truncated: true`.
- Show limits: over 5 MB (5 * 1024 * 1024) is `large`; a NUL in the first 8192 bytes is `binary`.
- Letters: `M` modified (also type change `T`), `A` added (also copy `C`), `D` deleted, `R` renamed, `U` untracked, `!` conflict. No colours: letters are muted text, `!` is Secondary (spec §3, brand "no new hues").
- Copy, verbatim:
  - Commit placeholder: `Message (Ctrl+Enter to commit)`;
  - under Commit: `Runs without Git hooks. Use the terminal to run them.`;
  - merge banner: `Merging <branch>. Fix the conflicts, stage them, then commit.` with button `Abort merge`;
  - busy note: `The team is working in this worktree. Git actions wait for the turn to end.`;
  - empty: `No changes`;
  - discard tracked: `Discard changes to <file>? This can't be undone.`; untracked: `Move <file> to the Recycle Bin?`;
  - group headers: `Merge conflicts`, `Staged changes`, `Changes`;
  - diff tab name: `<name> (staged)` / `<name> (changes)`; diff empty: `No changes`;
  - main's busy error: `The team is working in this worktree. Git actions wait for the turn to end.`;
  - empty message error: `Write a commit message`.
- Refresh: `files:changed` for the root debounced 300 ms; window `focus`; after each action; every 5000 ms while a view of the root is mounted and `document.hasFocus()`. The poll carries a `ponytail:` comment (upgrade: watch the git dir).
- UI text English; colours only from existing tokens; 24px rows (`h-3`) like `FileTree`.
- Tests make real repos in `mkdtempSync(join(tmpdir(), 'ark-git-'))` with local config `user.name`, `user.email`, `commit.gpgsign=false`, `core.autocrlf=false`.
- Commits with `git commit -F <file>` (no BOM). Never write to `~/.claude`, `~/.codex` or `%APPDATA%\ark`; app checks use `--user-data-dir` in the scratchpad.
- Checks before done: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **A repo with no commit yet.** Unstage and status must work before the first commit (`git restore --staged` needs a HEAD). → Task 2 test `unstage works before the first commit`.
2. **File names git could read as options or pathspec magic** (`-rf.txt`, `:(top)x`, names with spaces and accents). They must stage, unstage, discard and show as plain names. → Task 2 test `odd names stage, unstage and discard as plain names`.
3. **A status poll during a commit.** Two calls on one folder at once must not fail on `index.lock`. → Task 2 test `a status started during a commit waits for it`.
4. **Unstaging a staged rename.** Unstaging the new path must also unstage the old one, or the deletion stays staged. → Task 2 test `unstaging a rename unstages both paths`.
5. **A non-Git project in Files.** The tree must not poll git or show errors when `project.git` is false. → Task 4 test `a disabled root never calls git`.

---

### Task 1: Shared git model and parsers

**Files:**
- Create: `src/shared/git.ts`
- Test: `tests/shared/git.test.ts`

**Interfaces:**
- Produces in `src/shared/git.ts`:
  - `type GitEntry = { rel: string; x: string; y: string; orig?: string; conflict: boolean }` (`x`, `y` are porcelain v2 chars; untracked is `x: '?', y: '?'`);
  - `type GitStatus = { branch: string | null; oid: string | null; upstream?: string; ahead: number; behind: number; merging: boolean; entries: GitEntry[]; truncated: boolean }` (`branch` null when detached; `oid` null before the first commit);
  - `type GitSide = 'staged' | 'changes'`;
  - `type ShowResult = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'large'; size: number } | { kind: 'missing' }`;
  - `parseStatus(out: string, max = 5000): Omit<GitStatus, 'merging'>`;
  - `groups(entries: GitEntry[]): { conflicts: GitEntry[]; staged: GitEntry[]; changes: GitEntry[] }`;
  - `letter(e: GitEntry, side: GitSide | 'tree'): string` (tree: `!` for conflict, `U` for untracked, else the worktree char if not `.`, else the index char);
  - `changedDirs(entries: GitEntry[]): Set<string>` (every ancestor folder of every entry, `''` excluded).

- [ ] **Step 1: Write the failing tests** in `tests/shared/git.test.ts`:
  - `parseStatus reads branch, upstream and ahead/behind`: input `'# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0'` → `{ branch: 'main', oid: 'abc123', upstream: 'origin/main', ahead: 2, behind: 1, entries: [], truncated: false }`.
  - `parseStatus reads detached and initial`: `# branch.oid (initial)` + `# branch.head (detached)` → `oid: null, branch: null, ahead: 0, behind: 0`, no `upstream` key.
  - `parseStatus reads ordinary, rename, unmerged and untracked entries, names with spaces`: entries `'1 .M N... 100644 100644 100644 a1 a1 src/a b.ts'`, `'2 R. N... 100644 100644 100644 a1 a1 R100 new name.ts\0old name.ts'`, `'u UU N... 100644 100644 100644 100644 h1 h2 h3 c.ts'`, `'? dir/ü.txt'` → `[{rel:'src/a b.ts',x:'.',y:'M',conflict:false},{rel:'new name.ts',x:'R',y:'.',orig:'old name.ts',conflict:false},{rel:'c.ts',x:'U',y:'U',conflict:true},{rel:'dir/ü.txt',x:'?',y:'?',conflict:false}]`.
  - `parseStatus caps entries`: 3 untracked entries with `max = 2` → 2 entries, `truncated: true`.
  - `groups puts a file in staged and changes, conflicts alone`: `MM` entry in both staged and changes; `UU` only in conflicts; `??` only in changes.
  - `letter maps chars per side`: `{x:'M',y:'D'}` → staged `M`, changes `D`, tree `D`; `{x:'A',y:'.'}` tree `A`; `T`→`M`; `C`→`A`; untracked → `U` on changes and tree; conflict tree `!`.
  - `changedDirs lists every ancestor folder`: rels `a/b/c.ts`, `d.ts` → `Set{'a','a/b'}`.
- [ ] **Step 2: Run** `npx vitest run tests/shared/git.test.ts` - expected FAIL (module not found).
- [ ] **Step 3: Implement `src/shared/git.ts`.** Split on `\0`, read tokens in order; a `2` line consumes the next token as `orig`. Field counts before the path: `1` has 8 space-separated fields, `2` has 9, `u` has 10, `?` has 1 - split with a limit so the path keeps its spaces. Ignore `!` lines and unknown headers.
- [ ] **Step 4: Run** the same command - expected PASS.
- [ ] **Step 5: Commit** `feat(git): status model and parsers`.

### Task 2: Git runner and repo operations

**Files:**
- Create: `src/main/services/git/run.ts`, `src/main/services/git/repo.ts`
- Test: `tests/main/git.test.ts`

**Interfaces:**
- Consumes: `NO_HOOKS` from `src/main/services/threads/workspace.ts`; `parseStatus`, `groups`, `GitStatus`, `ShowResult` from Task 1; `resolveInside` from `src/main/services/files/guard.ts`.
- Produces in `run.ts`:
  - `gitRun(dir: string, args: string[], opts?: { input?: string; timeoutMs?: number }): Promise<string>`: throws `Error(stderr.trim() || 'git <args[0]> failed')`;
  - `gitBuffer(dir: string, args: string[]): Promise<Buffer>` (same rules, stdout as bytes);
  - both run through `queued(dir, fn)`: a per-folder promise chain (key: `dir.toLowerCase()`), so calls on one folder never overlap and a failure doesn't block the next.
- Produces in `repo.ts` (all take the root's folder):
  - `status(dir): Promise<GitStatus>` (`merging` from `git rev-parse -q --verify MERGE_HEAD`);
  - `show(dir, rel, side: 'head' | 'index'): Promise<ShowResult>` (spec `HEAD:<rel>` or `:0:<rel>`; `cat-file -s` failing → `missing`, then size, then `cat-file blob`);
  - `stage(dir, rels: string[]): Promise<void>` (`[]` = `add -A`);
  - `unstage(dir, rels: string[]): Promise<void>` (`[]` = all; with HEAD `restore --staged`, without HEAD `rm --cached -r -q --ignore-unmatch`; a staged rename's `orig` is added to the list);
  - `discard(dir, rels: string[], trash: (abs: string) => Promise<void>): Promise<void>` (`[]` = every entry in the Changes group; per rel from the Changes group: untracked → `trash(resolveInside(dir, rel))`, tracked → one `restore --worktree`; rels not in Changes are ignored);
  - `commit(dir, message: string, all: boolean): Promise<void>` (message via `-F -` stdin; `all` runs `add -A` first; empty `message.trim()` throws `Write a commit message` unless merging, then `--no-edit`);
  - `mergeAbort(dir): Promise<void>`.

- [ ] **Step 1: Write the failing tests** in `tests/main/git.test.ts` (helper `repo()` = temp dir + `git init -b main` + the local config from Global Constraints; helper `sh(dir, ...args)` runs plain git for setup):
  - `status lists modified, staged, untracked and the branch`;
  - `stage and unstage single files and all`;
  - `unstage works before the first commit` (fresh repo, stage `a.txt`, unstage → entry is `??`);
  - `unstaging a rename unstages both paths` (`git mv a b`, unstage `['b']` → no entry with `x !== '.'` and not untracked);
  - `discard restores a tracked file and trashes an untracked one` (trash is `vi.fn` that deletes; asserts it got the absolute path);
  - `odd names stage, unstage and discard as plain names` (`-rf.txt`, `:(top)x.txt`, `a b ü.txt`);
  - `commit commits staged only; all stages everything first`;
  - `commit refuses an empty message` (rejects `Write a commit message`);
  - `a pre-commit hook never runs` (`.git/hooks/pre-commit` writes `hook-ran` in the repo; after `commit`, the file does not exist);
  - `show reads HEAD and index, reports missing, binary and large`;
  - `a merge conflict shows as conflict and merging; empty message commits with Git's message after staging; mergeAbort clears it` (two branches editing the same line; `sh(dir, 'merge', 'other')` expected to fail);
  - `a status started during a commit waits for it` (`Promise.all([commit(...), status(dir)])` both resolve, and the status shows no staged entries).
- [ ] **Step 2: Run** `npx vitest run tests/main/git.test.ts` - expected FAIL.
- [ ] **Step 3: Implement `run.ts`** with `execFile('git', ['-c', \`core.hooksPath=${NO_HOOKS}\`, ...args], { cwd: dir, ... })`; for `input`, write it to `child.stdin` and end it.
- [ ] **Step 4: Implement `repo.ts`** with pathspec lists sent as `rels.join('\0')` on stdin with `--pathspec-from-file=- --pathspec-file-nul`.
- [ ] **Step 5: Run** the same command - expected PASS.
- [ ] **Step 6: Commit** `feat(git): runner and repo operations`.

### Task 3: IPC, preload and the busy-thread rule

**Files:**
- Modify: `src/main/services/files/guard.ts` (add `normRels`), `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`
- Test: `tests/main/files-guard.test.ts`

**Interfaces:**
- Consumes: Task 2's `repo.ts` functions; `rootDir`, `rootRef`, `normEntry` from `guard.ts`.
- Produces:
  - `normRels(v: unknown): string[]` in `guard.ts`: an array of at most 5000 items, each through `normEntry`; else throws `Invalid path`;
  - `ArkApi.git` in `src/shared/types.ts`:
    ```ts
    git: {
      status(root: RootRef): Promise<GitStatus>;
      show(root: RootRef, rel: string, side: 'head' | 'index'): Promise<ShowResult>;
      stage(root: RootRef, rels: string[]): Promise<GitStatus>;
      unstage(root: RootRef, rels: string[]): Promise<GitStatus>;
      discard(root: RootRef, rels: string[]): Promise<GitStatus>;
      commit(root: RootRef, message: string, all: boolean): Promise<GitStatus>;
      mergeAbort(root: RootRef): Promise<GitStatus>;
    };
    ```
  - channels `git:status`, `git:show`, `git:stage`, `git:unstage`, `git:discard`, `git:commit`, `git:merge-abort`.

- [ ] **Step 1: Write the failing test** in `tests/main/files-guard.test.ts`: `normRels takes a list of entries and refuses the rest` - `['a', 'b/c']` passes; `'a'`, `[1]`, `['..\\x']`, `['']`, an array of 5001 `'a'` all throw `Invalid path`.
- [ ] **Step 2: Run** `npx vitest run tests/main/files-guard.test.ts` - expected FAIL.
- [ ] **Step 3: Implement `normRels`**, then the handlers in `ipc/index.ts`: each resolves `dirOf(r)`; write handlers (stage, unstage, discard, commit, merge-abort) first throw the busy error when the root is a thread whose `store.get(id)?.status === 'running'`, then run the op, then return `status(dir)`. `side` must be `'head'` or `'index'`; `message` a string of at most 100 000 chars; `all` through `bool`. Discard's trash is `(abs) => shell.trashItem(abs)`. Add the preload entries.
- [ ] **Step 4: Run** `npx vitest run tests/main/files-guard.test.ts` and `npm run typecheck` - expected PASS.
- [ ] **Step 5: Commit** `feat(git): ipc and preload`.

### Task 4: Renderer status store

**Files:**
- Create: `src/renderer/git/status-store.ts`
- Test: `tests/renderer/git-store.test.ts`

**Interfaces:**
- Consumes: `window.ark.git`, `window.ark.files.watch/unwatch/onChanged`, `rootKey`.
- Produces:
  - `type GitState = { status?: GitStatus; error?: string; busy: boolean }`;
  - `useGit(root: RootRef, enabled: boolean): GitState`: while mounted and enabled, counts the root as shown, watches it (`files.watch`/`unwatch`), and loads status on first show; disabled returns a constant `{ busy: false }` and never calls git;
  - `refresh(root: RootRef): Promise<void>`;
  - `act(root: RootRef, call: () => Promise<GitStatus>): Promise<void>`: sets `busy`, stores the returned status, rethrows the error after clearing `busy` (so the caller's `attempt` shows it);
  - `gitState(root: RootRef): GitState` (the snapshot, for tests and non-hook readers).

- [ ] **Step 1: Write the failing tests** (stub `window.ark` before the import, as `tests/renderer/terms-store.test.ts` does; fake timers; `document.hasFocus` stubbed true):
  - `a change event refreshes once after 300 ms` (three `files:changed` for the key within 100 ms → one `git.status` call after 300 ms);
  - `polls every 5 s only while shown and focused` (no call after unmount; no call while `hasFocus()` is false);
  - `act stores the returned status and clears busy on failure`;
  - `a disabled root never calls git`.
  Drive mount/unmount through exported `show(root)` / `hide(root)` that `useGit`'s effect calls, so the test needs no React renderer.
- [ ] **Step 2: Run** `npx vitest run tests/renderer/git-store.test.ts` - expected FAIL.
- [ ] **Step 3: Implement** the store (module-level `Map<key, GitState>`, `useSyncExternalStore`, one `onChanged` subscription and one `focus` listener made on first use, one `setInterval` while any root is shown).
- [ ] **Step 4: Run** - expected PASS.
- [ ] **Step 5: Commit** `feat(git): renderer status store`.

### Task 5: Git view, third sidebar tab and tree letters

**Files:**
- Create: `src/renderer/components/GitView.tsx`
- Modify: `src/renderer/pages/Threads.tsx`, `src/renderer/components/FileTree.tsx`, `src/renderer/components/Icons.tsx`

**Interfaces:**
- Consumes: Task 4's `useGit`, `act`; Task 1's `groups`, `letter`, `changedDirs`; `openDiff` from Task 6 (wire the row click in Task 6; until then a row click opens the file).
- Produces: `GitView({ root, busyThread, onOpenFile, onOpenDiff, attempt }: { root: RootRef; busyThread: boolean; onOpenFile: (rel: string) => void; onOpenDiff: (rel: string, side: GitSide) => void; attempt: (call: () => Promise<unknown>) => Promise<void> })`; `FileTree` gains a prop `git: boolean`.

- [ ] **Step 1: Threads.tsx.** The view state becomes `'threads' | 'files' | 'git'` (labels `Threads`, `Files`, `Git`); the root picker renders above Files and Git alike. Git on a project with `git: false` shows the existing **Initialize Git** button and nothing else. `busyThread` is `root.kind === 'thread' && thread?.status === 'running'`.
- [ ] **Step 2: GitView.tsx** per spec §5.1 minus step-2 items (no Fetch/Pull/Push buttons, no branch menu, no worktree or thread-branch sections): branch row text (`branch` or `detached at <oid.slice(0,7)>`, `↑n ↓m` when `upstream`), message field (Ctrl+Enter commits), Commit / Commit all CTA with the disable rules of §5.1, the hooks note, the merge banner, the three groups with header actions and row actions, discard confirms with the Global Constraints copy, the busy note with every write control disabled while `busyThread`, `No changes`, and `Showing first 5000 changes` when `truncated`. Message clears after a successful commit. Untracked-ness for the discard copy is `e.x === '?'`.
- [ ] **Step 3: FileTree.tsx.** With `git`, read `useGit(root, git)`; files show `letter(e, 'tree')` right-aligned in `text-meta text-muted` (`!` in `text-secondary`); folders in `changedDirs` show a muted `•`.
- [ ] **Step 4: Icons.** Add line icons in the existing style for stage (reuse `PlusIcon`), unstage (minus), discard (counter-clockwise arrow) and open file.
- [ ] **Step 5: Run** `npm run typecheck` and `npm run lint` - expected PASS.
- [ ] **Step 6: Commit** `feat(git): git view and tree status`.

### Task 6: Diff tabs

**Files:**
- Create: `src/renderer/components/DiffView.tsx`
- Modify: `src/renderer/editor/tabs-store.ts`, `src/renderer/pages/Threads.tsx`, `src/renderer/components/GitView.tsx` (row click)
- Test: `tests/renderer/tabs-store.test.ts`

**Interfaces:**
- Consumes: `window.ark.git.show`, `window.ark.files.read`, `loadMonaco`, `useGit`, `groups`.
- Produces in `tabs-store.ts`:
  - `Doc` gains `diff?: GitSide`;
  - `openDiff(projectId: string, root: RootRef, rel: string, side: GitSide): void`: key `${tabKey(root, rel)}\n${side}`, name `<file name> (staged|changes)`, no model, `tab.dirty` always false; focuses an existing one;
  - the watcher listener and `reload` skip docs with `diff`.
- `DiffView({ doc, onOpenFile }: { doc: Doc; onOpenFile: () => void })`.

- [ ] **Step 1: Write the failing tests** in `tests/renderer/tabs-store.test.ts`:
  - `openDiff opens one tab per file and side, never a model`: two calls with the same args → one doc; a `staged` and a `changes` → two docs named `a.ts (staged)` / `a.ts (changes)`; `files.read` not called; `models.length` unchanged;
  - `a disk change never reloads a diff tab`: `changed(rootKey, ['a.ts'])` with only a diff tab open → `files.stat` not called.
- [ ] **Step 2: Run** `npx vitest run tests/renderer/tabs-store.test.ts` - expected FAIL.
- [ ] **Step 3: Implement `openDiff`** and the skips.
- [ ] **Step 4: Run** - expected PASS.
- [ ] **Step 5: DiffView.tsx.** Monaco `createDiffEditor` with `readOnly: true`, `originalEditable: false`, theme `ark-dark`, the font of `Editor.tsx`, `automaticLayout: true`. Sides per spec §5.2: changes = `show(index)` vs `files.read` (a read that throws is the empty text); staged = `show(head)` vs `show(index)`; `missing` is empty text. Binary or large on either side shows the editor's placeholder copy. Reload both sides whenever `useGit(root, true).status` changes, calling `setValue` only when the text differs. When the rel is no longer in the doc's group, show `No changes`. Header: rel path and an **Open file** button. Dispose models and the editor on unmount.
- [ ] **Step 6: Wire it.** `Threads.tsx` renders `DiffView` when the active doc has `diff`, `Editor` otherwise; GitView rows call `onOpenDiff(rel, side)` (conflicts call `onOpenFile`).
- [ ] **Step 7: Run** `npm run typecheck`, `npm run lint`, `npm test` - expected PASS.
- [ ] **Step 8: Commit** `feat(git): diff tabs`.

### Task 7: Docs and check in the built app

**Files:**
- Modify: `README.md` (new section `## Git` after `## Terminal`), `CLAUDE.md` (layout line for `services/git/` and `renderer/git/`)

- [ ] **Step 1: README.** Describe the Git view, the letters, diffs, Commit vs Commit all, discard to the Recycle Bin for new files, "Runs without Git hooks", the busy-worktree rule. Plain, like the Files section.
- [ ] **Step 2: CLAUDE.md.** In Layout add `services/git/` (the Git UI's runner and operations) and `src/renderer/git/` (status store). In Rules add: "The Git UI runs git only through `services/git/run.ts` (no hooks, literal pathspecs, no prompts)."
- [ ] **Step 3: Run** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` - all PASS.
- [ ] **Step 4: Check in the built app** with the CDP recipe from `docs/handoff/2026-11-07-ark-phase2-step2-done.md`, on a temp repo as the project in a scratchpad profile: edit a file → `M` in the tree and a row in Changes; open its diff; stage; commit with a message; `No changes`; create a conflict with the terminal (`git merge`) → conflicts group and banner; **Abort merge**. Take a screenshot of the Git view.
- [ ] **Step 5: Commit** `docs: git view`.
