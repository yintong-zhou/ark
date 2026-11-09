# Ark Phase 3 - Git management - Design

Date: 2026-11-07 · Source brief: `PROJECT.md` (feature 5, Phase 3) · Builds on: `docs/superpowers/specs/2026-11-07-phase2-editor-terminal-design.md` · Visual rules: `brand-guidelines.md` · Working rules: `AGENTv2.md`, `CLAUDE.md`

The user skipped the design questions, so every decision below is the designer's. Items marked **[call]** are those decisions. The rest comes from the brief, from Phase 2's hand-over ("status colours in the tree, diffs, staging") and from rules already in `CLAUDE.md`.

## 1. Intent

Today the user sees a thread's work in Ark and edits files there, but leaves for VS Code or the terminal for everything Git: seeing what changed, staging, committing, switching branches, pushing. The developer's work also stays forever on an `ark/<title>-<id>` branch in a worktree, and nothing in Ark brings it back into the user's branch or cleans up afterwards.

Phase 3 closes that loop. Success: after a thread's summary, the user reviews the diff, merges the thread's branch, commits and pushes, then removes the worktree, all without another app.

## 2. Goals, non-goals, anti-goals

**Goals**
- A **Git view** in the project sidebar, VS Code style: changes grouped as conflicts, staged and unstaged; stage, unstage and discard per file or for a whole group; a message box and Commit.
- **Diffs**: clicking a change opens a side-by-side Monaco diff in a tab.
- **Status in the file tree**: a letter per changed file and a mark on folders that contain changes.
- **Branches**: show the current one, switch, create, delete.
- **Sync**: fetch, pull, push, with ahead/behind counts.
- **Worktrees**: list the project's worktrees; remove one.
- **Thread branch**: merge a thread's build branch into the project's current branch, then remove its worktree.
- All of it works on a project folder and on a thread's worktree, like Files.

**Non-goals (this phase)**
- GitHub: pull requests, issues, sign-in. `gh` in the terminal covers it **[call]**.
- History or graph view, blame, stash, rebase, cherry-pick, tags, amend, partial (line or hunk) staging, editing inside the diff view.
- Creating a worktree from the UI (threads create theirs; the user has the terminal) **[call]**.
- Resolving conflicts in a 3-way merge editor. Conflicted files open in the normal editor with Git's markers.

**Anti-goals** (would make this a failure even if it works)
- Losing work: a discard, branch delete or worktree removal without a confirm, a discarded untracked file gone for good instead of in the Recycle Bin, a forced operation the user did not choose.
- Ark's Git running project hooks (rule in `CLAUDE.md`).
- The renderer naming arbitrary paths, refs or git arguments. It names a root, rel paths and a branch name; main builds the command.
- Ark's Git and the conductor's commits racing on the same worktree.
- A Git action hanging the app: a credential prompt waiting on a stdin nobody sees, or a status call on a big repo that blocks the window.

## 3. Constraints

- Windows, Electron 45, React 19, Tailwind 4, Monaco already bundled (Phase 2). No new dependency: Git is the user's `git` on PATH (tested with 2.50.1), run with `execFile`, as `threads/workspace.ts` already does **[call]**.
- Renderer security as in Phase 2: narrow typed preload functions, every payload validated in main.
- **No hooks**: every Ark git call carries `-c core.hooksPath=<NO_HOOKS>` (the existing `NO_HOOKS` in `workspace.ts`). That includes the user's own commits from the Git view: `CLAUDE.md` says "Ark's own Git runs without project hooks. Keep that." The Git view says so under the Commit button: "Runs without Git hooks. Use the terminal to run them." **[call]**
- **Literal paths**: every call also sets `GIT_LITERAL_PATHSPECS=1`, and every path goes after `--`, so a file named `:(top)` or `-rf` is just a name.
- **No prompts**: `GIT_TERMINAL_PROMPT=0` for every call. Credential helpers that open their own window (Git Credential Manager) still work.
- Brand: no new hues and no coloured badges. Git status shows as letters and text weight, not VS Code's colours **[call]**.
- UI text is English.

## 4. Concepts

- **Root**: unchanged from Phase 2. `{ kind: 'project', id }` or `{ kind: 'thread', id }`. Git works on the root's folder.
- **A project with Git**: `project.git` is true (a `.git` in the folder). Otherwise the Git view shows only **Initialize Git** (already exists).
- **Status entry**: `{ rel, x, y, orig? }`, where `x` is the index status and `y` the working tree status from `git status --porcelain=v2`, and `orig` is the old path of a rename. Rels are repo-relative with `/`, which equals root-relative since a project or worktree folder is its repo's top.
- **Groups** (what the Git view lists):
  - **Merge conflicts**: unmerged entries (`u` lines);
  - **Staged**: entries with `x` not `.`;
  - **Changes**: entries with `y` not `.`, plus untracked (`?`). A file can be in both Staged and Changes.
- **Letters** (tree and Git view): `M` modified, `A` added, `D` deleted, `R` renamed, `U` untracked, `!` conflict **[call]**.

## 5. Screens

### 5.1 Sidebar: Threads | Files | Git **[call]**

The sidebar's switch gets a third item, **Git**. It uses the same root picker as Files (`Project` / `Worktree · #<title>`), so both views always point at the same folder. The picker moves above the view so the two share it.

The Git view, top to bottom:
- **Branch row**: the branch name (or `detached at <short sha>`), then `↑n ↓m` when there is an upstream, and three icon buttons: **Fetch**, **Pull**, **Push**. A click on the branch name opens the branch menu (§5.4).
- **Message box**: a 2–6 line field, placeholder `Message (Ctrl+Enter to commit)`.
- **Commit** button, the view's one Accent CTA:
  - with staged changes: `Commit`, commits the staged changes;
  - with nothing staged and some changes: `Commit all`, stages everything (`git add -A`) then commits **[call]**;
  - disabled with no changes, or an empty message (except while a merge is in progress, where an empty message keeps Git's merge message).
  - Under it, muted: "Runs without Git hooks. Use the terminal to run them."
- **Merge banner**, while a merge is in progress: "Merging <branch>. Fix the conflicts, stage them, then commit." with **Abort merge**.
- **Groups**: `Merge conflicts`, `Staged changes`, `Changes`, each a section header (brand small caps) with a count and hover actions: stage all (`+`), unstage all (`−`), discard all (`↺`). Empty groups are hidden.
- **Rows**: 24px like the file tree. The file name, its folder in muted text, the letter on the right. Hover actions: open file, stage or unstage, discard (Changes only). Click opens the diff (§5.2); a conflicted file opens in the editor instead.
- **Worktrees section** (§5.6) and, on a thread root, the **Thread branch** section (§5.7) at the bottom.
- An empty state: "No changes" under the message box.

Discard always confirms: "Discard changes to <file>? This can't be undone." Untracked files go to the Recycle Bin, as Files does, so the dialog says "Move <file> to the Recycle Bin?" for them **[call]**.

### 5.2 Diff tab

- A diff opens as a tab in the existing tab strip, next to file tabs. The tab reads `<name> (staged)` or `<name> (changes)`, plus `· worktree` on a thread root.
- Monaco's diff editor, side by side, read-only on both sides, `ark-dark` theme. Monaco may switch to inline when the pane is narrow (its default) **[call]**.
- Sides:
  - Changes: index on the left, working tree on the right; for an untracked file, empty on the left;
  - Staged: `HEAD` on the left, index on the right; for a new file, empty on the left.
  - A deleted file shows an empty right side.
- A header line with the rel path and **Open file**, which opens the normal editor tab.
- Binary or over 5 MB on either side: the same placeholders as the editor.
- The diff reloads when the status of that file changes (after a stage, a save or an agent's write). If the file is no longer in that group, the tab shows "No changes".
- Diff tabs never hold unsaved state, so they do not count for the quit warning.

### 5.3 Status in the file tree

- Each changed file shows its letter at the right of its row, muted. A conflicted file shows `!` in Secondary.
- A folder that contains changes shows a small `•` at the right, muted.
- Deleted files are not in the tree (they are not on disk); they are in the Git view.
- Ignored files are not marked.

### 5.4 Branch menu

An in-app menu (the existing `Menu`) opened from the branch name:
- **Create branch…**: an inline name field. It creates the branch from the current commit and switches to it (`git switch -c`).
- the local branches, current first and checked, each with its upstream's `↑n ↓m` if any. A click switches to it (`git switch`).
- remote branches without a local twin, under a muted `Remote` label. A click creates the local tracking branch and switches (`git switch --track`).
- **Delete branch…**: a submenu of the local branches other than the current one. `git branch -d`; when Git refuses because it is not merged, a second confirm "Not merged. Delete anyway?" runs `-D` **[call]**.

Git's own refusals are shown as they come (for example "would be overwritten by checkout", or a branch checked out in another worktree). Ark does not stash or force **[call]**.

### 5.5 Sync

- **Fetch**: `git fetch --prune`.
- **Pull**: `git pull --ff-only`. When that fails because the branches diverged, the message says so and points to the terminal **[call]**.
- **Push**: `git push`. With no upstream, `git push -u origin <branch>` when a remote named `origin` exists, otherwise an error naming the missing remote **[call]**.
- While one runs, its button spins and the others are disabled. Time limit 2 minutes. Errors show Git's stderr in the pane's problem line, as file errors do today.

### 5.6 Worktrees section

Shown only on the project root, collapsed by default, from `git worktree list --porcelain`:
- the main worktree first, then the others, each with its branch and folder;
- a worktree that belongs to a thread shows `#<thread title>` and a **Show** action that selects that thread with the root picker on its worktree;
- **Remove** on every worktree but the main one: confirm "Remove worktree <folder>? The branch <branch> stays.", then `git worktree remove` without `--force`. Git refuses when it has uncommitted changes, and Ark shows that **[call]**;
- **Prune** in the header (`git worktree prune`) for worktrees whose folder is already gone.

A thread's worktree can be removed only when the thread is in the `done` phase. While it is building, the conductor needs it **[call]**.

### 5.7 Thread branch section

Shown on a thread root once the thread has a build:
- `<thread branch> → <project's current branch>`, and the count of commits the thread branch has that the project branch lacks;
- **Merge into <branch>**: confirm, then in the **project** folder `git merge --no-ff --no-edit <thread branch>`. On success the note "Merged" shows here and the project's Git view refreshes. On conflict the merge stays in progress and the user is sent to the project root, where §5.1's conflicts group and merge banner take over **[call]**;
- **Remove worktree**: as in §5.6, enabled once the thread is `done`.

### 5.8 Busy threads

On a thread root, every Git action is disabled while the thread's status is `running`, with the note "The team is working in this worktree. Git actions wait for the turn to end." The conductor's `commitAll` (`git add -A`, commit) would otherwise race the user's index **[call]**. Reading status and diffs stays available.

## 6. Main process

### 6.1 Git service (`src/main/services/git/` **[call]**)

- One runner: `git(dir, args, { timeoutMs })` with the no-hooks `-c`, `GIT_LITERAL_PATHSPECS=1`, `GIT_TERMINAL_PROMPT=0`, `windowsHide`, utf8, and a 64 MB buffer. It reuses `NO_HOOKS` from `threads/workspace.ts`. Errors throw git's stderr, trimmed.
- Parsers in `src/shared/git.ts` (pure, tested): `git status --porcelain=v2 -z --branch --untracked-files=all`, `git worktree list --porcelain -z`, `git for-each-ref` output.
- Status is capped at 5000 entries, with `truncated: true` like the tree listing.
- One git call at a time per folder (a promise queue keyed by the folder), so a status poll never collides with a commit's `index.lock` **[call]**.

### 6.2 IPC (`git:*`)

All take a root, resolved by `rootDir` as in Phase 2. Rel paths go through `normRel` / `normEntry`. Branch names are checked with `git check-ref-format --branch` and must not start with `-`.

| Channel | Does |
|---|---|
| `git:status(root)` | branch, upstream, ahead/behind, merge in progress, entries |
| `git:show(root, rel, side)` | `side` is `head` or `index`: the text, or binary / large / missing |
| `git:stage(root, rels)` / `git:unstage(root, rels)` | `git add --` / `git restore --staged --`; `rels` empty = all |
| `git:discard(root, rels)` | tracked: `git restore --worktree --`; untracked: `shell.trashItem` through the guard |
| `git:commit(root, message, all)` | `all` stages everything first; empty message only during a merge (`--no-edit`) |
| `git:branches(root)` | local and remote branches with upstream and ahead/behind |
| `git:switch(root, name, track)`, `git:create-branch(root, name)`, `git:delete-branch(root, name, force)` | §5.4 |
| `git:fetch` / `git:pull` / `git:push(root)` | §5.5 |
| `git:merge-abort(root)` | `git merge --abort` |
| `git:worktrees(projectId)`, `git:remove-worktree(projectId, path)`, `git:prune-worktrees(projectId)` | §5.6. `path` must be one `git worktree list` returned, never the main one |
| `git:merge-thread(threadId)` | §5.7, in the thread's project folder |

Write actions on a thread root check §5.8 in main as well, not only in the UI.

After every write action main re-reads status and returns it, so the view updates without a second call.

### 6.3 Keeping status fresh

The renderer store refreshes a root's status:
- on `files:changed` for that root, debounced 300 ms;
- on window focus;
- after every Ark git action (from its return value);
- every 5 s while a Files or Git view of that root is on screen and the window is focused.

`.git` events stay filtered out by the watcher. The poll catches commits made from the terminal and the conductor's commits in a worktree, whose `.git` lives in the main repo **[call]**. `ponytail:` comment on the poll: upgrade to watching the git dir if it ever costs too much.

### 6.4 Removing a worktree

After `git worktree remove` succeeds for a thread's worktree, the thread gets `build.removed = true` through the store and a thread update, so the root picker drops the worktree option and the Files and Git views fall back to the project **[call]**. The conductor never runs a `done` thread's build again, so nothing recreates it.

## 7. Renderer

- `src/renderer/git/status-store.ts`: module-level, one entry per root key, `useGit(root)` with `useSyncExternalStore` (same pattern as `tree-store.ts`).
- `components/GitView.tsx`, plus a `BranchMenu` and the worktree and thread-branch sections in the same file or next to it.
- `FileTree.tsx` reads the same store for letters and folder marks.
- The tab store learns a second kind of tab, `diff`, with its own key (`<rootKey>\n<rel>\n<side>`). `Editor.tsx` stays for files; a `DiffView.tsx` mounts Monaco's diff editor.

## 8. Build order **[call]**

Two steps, each with its own plan:
1. **Status, staging, commit and diffs**: the git service and runner, status parsing, `git:status/show/stage/unstage/discard/commit/merge-abort`, the status store and polling, the Git view without branch row actions or bottom sections, diff tabs, tree letters.
2. **Branches, sync, worktrees and thread merge**: the branch menu, fetch / pull / push, the worktrees section, the thread branch section, `build.removed`, the busy-thread rule in main.

## 9. Verification

- Unit tests (vitest) against real temp repos made with `git init` in a temp folder, since git is already a requirement:
  - status parsing: modified, staged and modified, renamed, deleted, untracked in a new folder, conflict, a name with spaces and non-ASCII, a name starting with `-` or `:`;
  - stage, unstage, discard (tracked and untracked with `trashItem` injected), commit, commit all, commit refused with an empty message;
  - a hook in `.git/hooks/pre-commit` that writes a file: it must not run;
  - branches: create, switch, delete merged, delete unmerged needs force, a refused switch;
  - worktree list parsing, remove refused with changes, the main worktree refused;
  - merge-thread clean and with a conflict, then abort;
  - the per-folder queue: a status and a commit started together both succeed;
  - IPC validation: bad branch names, `..` rels, a worktree path not in the list.
- Push and pull run against a local bare repo as `origin`, so no network.
- In the built app, through the CDP recipe from the Phase 2 handoff: open the Git view, edit a file, see `M` in the tree and the row in Changes, open its diff, stage, commit, switch branch, merge a thread branch into the project in a test repo, remove its worktree.

## 10. Left to the builder

- Icon glyphs for fetch, pull, push, stage, unstage, discard, open file (line icons in `Icons.tsx`).
- Exact debounce values, within reason.
- Whether the diff editor reuses one Monaco diff instance across diff tabs (like `Editor.tsx` does) or makes one per mount.
- Component file split.

## 11. Open questions

None blocking. Candidates for later: GitHub pull requests from a thread branch, history view, stash, hunk staging, a 3-way merge editor, running hooks on the user's own commits if the user asks for it.
