# Ark Phase 2 — File editor and terminal — Design

Date: 2026-11-07 · Source brief: `PROJECT.md` (feature 4, Phase 2) · Builds on: `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md` · Visual rules: `brand-guidelines.md` · Working rules: `AGENTv2.md`, `CLAUDE.md`

The user skipped the design questions, so every decision below is the designer's. Items marked **[call]** are those decisions; the rest comes from the brief.

## 1. Intent

Today the user watches the team work in a thread, then leaves Ark to open the files in VS Code or to run a command in a terminal. Phase 2 removes that trip. Inside a project the user can browse the files, open them, read and edit them, and use a real terminal, all without losing the thread they are following.

Success: during a normal thread (team → plan → build → summary) the user never needs another app to look at a file, fix a line, or run `npm test`.

## 2. Goals, non-goals, anti-goals

**Goals**
- A **file explorer** for the open project: a lazy tree, opened in the sidebar.
- An **editor** with VS Code's engine: syntax highlighting, find/replace, multiple cursors, tabs, save with Ctrl+S.
- Basic file operations: new file, new folder, rename, delete (to the Recycle Bin), reveal in Windows Explorer.
- The explorer and editor also work on a **thread's build worktree**, so the user can read and fix what the developer is writing.
- Files change on disk while they are open (agents write them). The editor follows those changes and never loses the user's edits without asking.
- An **integrated terminal**: real PTY, several terminals per project, PowerShell / Command Prompt / Git Bash.
- **Interchangeable with chat** (brief): the thread, the files and the terminals sit in one window. Switching between them never loses state, whether that is the scroll position, an unsaved edit or a running command.

**Non-goals (this phase)**
- Search across files, quick open (Ctrl+P), go to symbol, language servers, IntelliSense across files. Monaco's built-in single-file features stay.
- Git UI: status colours in the tree, diffs, staging. That is Phase 3.
- Sending a terminal or editor selection into a thread message; `@file` mentions in the composer.
- Clickable links in the terminal, split editors, persisting open tabs or terminals across restarts, settings for fonts and keybindings.
- Image or binary previews.

**Anti-goals** (would make this a failure even if it works)
- Losing a user's edit: a save silently overwriting what an agent wrote, or an agent's change silently overwriting an unsaved buffer, or quitting with unsaved files without a warning.
- The renderer gaining general file system or process access. The renderer names a root and a relative path; the main process decides.
- Reading or writing outside the project or worktree folder (`..`, absolute paths, symlinks or junctions that point outside).
- A slower app start: the editor engine loads only when a file is first opened.

## 3. Constraints

- Windows, Electron 45 (Node 24.22), React 19, Tailwind 4, electron-vite 6, electron-builder 26 (from `package.json`).
- Renderer security from `AGENTv2.md`: `contextIsolation`, no `nodeIntegration`, `sandbox`, narrow typed preload functions, every IPC payload validated in main, CSP kept.
- `CLAUDE.md`: Ark only reads `~/.claude` / `~/.codex`. Editor writes happen **only** inside a project folder or a thread worktree, and only when the user acts. That rule gets one line in `CLAUDE.md`.
- Agent isolation (`engines/isolation.ts`) is untouched. The terminal is the user's, not an agent's.
- Offline: everything bundled, no CDN (rules out `@monaco-editor/react`'s default loader).
- **Verified:** `node-pty@1.1.0` ships N-API prebuilds for `win32-x64` and spawns PowerShell under Electron 45's runtime with no rebuild and no C++ toolchain. Spike run on 2026-11-07.

## 4. Concepts

- **Root**: the folder the explorer, editor and new terminals work in. It is one of:
  - `{ kind: 'project', id }`: the project folder;
  - `{ kind: 'thread', id }`: that thread's `build.worktree`, which exists only once the build has started.

  The renderer only ever sends a root and a relative path. Main resolves the folder.
- **Rel path**: a path relative to the root, with `/` separators and no `..`. `''` is the root itself.
- **Tab**: one item in the main pane's tab strip. It is either the thread tab (always first) or a file tab.
- **Terminal**: a PTY owned by main and shown in the bottom panel. It belongs to a project and keeps the cwd it started in.

## 5. Screens

### 5.1 Sidebar: Threads | Files **[call]**

The project sidebar (240px) gets a two-item switch under its header: **Threads** (today's list) and **Files**.

Files shows:
- a **root picker**, shown only when the selected thread has a worktree, with two options:
  - `Project`;
  - `Worktree · #<thread title>`;
- a lazy tree with folders first, then files, sorted case-insensitively. A folder loads its children when the user expands it. `.git` is hidden. Everything else is shown, `node_modules` included, collapsed;
- a row style that follows the brand's sidebar rows, with 24px rows for density **[call]**;
- a context menu on rows (an in-app menu on Raised):
  - New file;
  - New folder;
  - Rename;
  - Delete;
  - Reveal in Explorer;
  - Copy relative path.

  The same actions also sit on hover icons on the root row.

### 5.2 Main pane: tab strip **[call]**

The main pane gets a 32px tab strip at the top:
- **The thread tab** comes first and is always present. It shows `# <thread title>`, or `New thread` / the project name when no thread is open. It renders exactly what the main pane renders today.
- **File tabs** follow. Each shows the file name, plus the root's name in muted text when the root is a worktree. A dot means unsaved changes. A close button appears on hover and when active.
- Clicking a thread in the sidebar activates the thread tab. Clicking a file opens it, or focuses its existing tab.
- The team panel shows only while the thread tab is active.
- Tabs are kept per project in memory. Switching project shows that project's tabs. Nothing is persisted across restarts.
- On the right side of the strip sits a terminal toggle button (same as Ctrl+`).

### 5.3 Editor

- Monaco (`monaco-editor`, imported as ESM and bundled). It is loaded with a dynamic `import()` the first time a file tab opens. Workers come from Vite `?worker` imports **[call]**.
- The language comes from the file extension, using Monaco's built-in languages.
- An `ark-dark` theme built from the brand tokens: background is the Content tone, the selection and line highlight use Raised, the cursor uses Secondary, and Accent is not used in code **[call]**.
- Font: `Cascadia Mono, Consolas, monospace`, 13px. The brand has no mono font and these ship with Windows **[call]**.
- Minimap on, word wrap off. Monaco's other defaults stay.
- One Monaco model per open file. The view state (scroll, cursor) is saved when switching tabs and restored when coming back.
- Shortcuts while the editor has focus: Ctrl+S saves and Ctrl+W closes the tab. Everything else is Monaco's.
- Files that do not open in the editor. Each shows a plain message in place of the editor:
  - **binary** (a NUL byte in the first 8 KB): "Binary file, not shown";
  - **too large** (over 5 MB): "Too large to open here (N MB)";
  - **not valid UTF-8**: opens **read-only** with a bar that says "Not UTF-8: opened read-only so saving can't damage it".
- Encoding on save: UTF-8. A UTF-8 BOM present on read is kept on write. Line endings are kept as Monaco detected them.

### 5.4 Bottom panel: terminals **[call]**

- It lives inside the main pane, under the tab content. It is visible whichever tab is active, so the user can chat and type commands side by side.
- Ctrl+` or the strip button toggles it. A divider sets its height: 35% of the pane by default, and the height is remembered in memory.
- Its header lists the terminals as small tabs (`PowerShell 1`, `Git Bash 1`, …), a `+` with a menu of the available shells, and a close (×) per terminal. The first open with no terminals creates a PowerShell one.
- A new terminal starts in the sidebar's current root: the project folder or the selected thread's worktree.
- When a shell exits, its tab shows "Process exited (code N)" and stays until the user closes it.
- xterm.js with `@xterm/addon-fit`, 5000 lines of scrollback, and the same mono font. Colours come from the brand: background is Primary, foreground is Light neutral, the cursor is Secondary, and the ANSI palette is xterm's default.
- Copy and paste: Ctrl+C copies when there is a selection and otherwise is sent to the shell. Ctrl+V pastes.

### 5.5 Keeping state across switches

Leaving the Threads area (for Usage or Agents) and coming back keeps everything: Monaco models, xterm instances and the terminal processes. The editor and terminal state therefore lives in module-level stores in the renderer, not in component state. xterm instances are created once and their DOM node is re-attached on mount **[call]**.

## 6. Main process

### 6.1 Root and path guard (`src/main/services/files/` **[call]**)

`resolveRoot(ref)` returns:
- the project's `dir` for a `project` root;
- the thread's `build.worktree` for a `thread` root, and only if that folder exists.

Anything else throws.

`inside(root, rel)` validates and resolves a path:
- `rel` must be a string, at most 1024 characters, with no NUL, no drive letter, no leading `/` or `\`, and no `..` segment;
- it resolves `join(root, rel)`;
- it checks that `realpath` of the target, or for a new path the realpath of its nearest existing parent, starts with `realpath(root)` plus a separator, or is equal to it.

Every file IPC goes through it. A symlink inside the root that points outside is listed but cannot be opened.

### 6.2 File operations

`files:list(root, rel)` returns `{ name, kind: 'dir' | 'file' | 'link' }[]`:
- sorted, without `.git`;
- capped at 5000 entries, with `truncated: true` when the cap cuts it.

`files:read(root, rel)` returns one of:
- `{ kind: 'text', text, mtimeMs, bom, readonly }`, where `readonly` is true for invalid UTF-8 (decoded with replacement chars);
- `{ kind: 'binary' }`;
- `{ kind: 'large', size }`.

`files:write(root, rel, text, baseMtimeMs | null)`:
- if `baseMtimeMs` is set and the file's current mtime differs, it returns `{ conflict: true }` and writes nothing;
- otherwise it writes atomically with the existing `writeAtomic` and returns the new `mtimeMs`;
- `null` means "overwrite anyway" (§7).

The other operations:
- `files:create(root, rel, 'file' | 'dir')` fails if the path already exists;
- `files:rename(root, from, to)` stays inside the same root and fails if the target exists;
- `files:delete(root, rel)` uses `shell.trashItem`, never a permanent delete;
- `files:reveal(root, rel)` uses `shell.showItemInFolder`.

### 6.3 Watching

- `files:watch(root)` / `files:unwatch(root)` use one `fs.watch(dir, { recursive: true })` per watched root. It is reference counted and closed on unwatch, on window reload and on quit.
- Events under `.git/` are dropped. The rest are collected for 150 ms and sent as `files:changed(rootKey, rels[])`.
- On Windows the rel can be `null` (a buffer overflow). The renderer then treats it as "everything changed".

### 6.4 Terminals (`src/main/services/terminals.ts` **[call]**)

- It spawns with `node-pty`, injected so tests use a fake.
- The shells come from `terminal:shells()`:
  - **PowerShell**: `pwsh.exe` when it is on PATH, otherwise `powershell.exe`, both with `-NoLogo`;
  - **Command Prompt**: `cmd.exe`;
  - **Git Bash**: `findGitBash()` with `--login -i`, shown only if found.
- The environment is the user's `process.env` minus `ELECTRON_*` variables. It is not `cleanEnv`: this is the user's shell, not an agent's.
- `terminal:create(root, shellId, cols, rows) → id`, where the id is a UUID.
- Output is buffered for 16 ms and sent as `terminal:data(id, chunk)`. A shell that exits sends `terminal:exit(id, code)`.
- `terminal:write(id, data)` takes at most 64 KB per call. `terminal:resize(id, cols, rows)` takes integers from 1 to 1000. `terminal:kill(id)`.
- All PTYs are killed on window reload (`did-start-navigation` of the main frame) and on `before-quit`, which joins the existing shutdown steps.
- Only ids the service created are accepted. Anything else throws.

### 6.5 Unsaved edits at quit

While any tab is dirty, the renderer's `beforeunload` refuses to unload the page. Main's `will-prevent-unload` then shows a native dialog: "Some files have unsaved changes", with **Discard changes** and **Cancel**. This covers closing the window and a reload (Ctrl+R) the same way.

(Changed after the final review: the first version counted dirty tabs over IPC and only guarded `close`, so a reload dropped edits silently.)

## 7. External changes vs unsaved edits

The cases, for an open file whose disk content changed (from a watch event, or a save that came back with `conflict`):

| Buffer | What happens |
|---|---|
| Clean | It reloads silently. The view state is kept where possible. |
| Dirty | A bar above the editor reads "Changed on disk": **Reload** drops the user's edits and loads the disk version; **Keep mine** marks the tab so that the next save sends `baseMtimeMs: null`. |
| File deleted | The tab stays. A bar reads "Deleted on disk", and saving recreates the file. |

A save that returns `conflict` shows the same bar as the dirty case. No path writes over a newer disk version without the user's click.

## 8. Packaging

- Dependencies:
  - `node-pty` goes in `dependencies`;
  - `monaco-editor`, `@xterm/xterm` and `@xterm/addon-fit` go in `devDependencies`, since Vite bundles them into the renderer.
- `electron-builder.yml`:
  - `asarUnpack: node_modules/node-pty/**`;
  - `npmRebuild: false`, because the prebuilds are N-API and a rebuild would need a toolchain the user lacks.
- Main bundling: `node-pty` must stay external in the main build. The builder checks electron-vite 6's default and sets it if needed.
- CSP in `index.html`: add `worker-src 'self' blob:` for the Monaco workers. Nothing else changes.

## 9. Build order **[call]**

Two steps, each with its own plan, executed the same way as the Phase 1 steps:
1. **Files and editor**: guard, file service, IPC, watcher, sidebar switch and tree, tab strip, Monaco, the conflict bars, the quit warning.
2. **Terminal**: the terminal service, IPC, bottom panel, xterm, packaging changes.

## 10. Verification

- Unit tests (vitest, temp folders, no real PTY):
  - the guard: `..`, absolute paths, drive letters, a junction pointing outside, a new path under a missing folder;
  - list, read, write and conflict;
  - binary, large, BOM round trip, invalid UTF-8 read-only;
  - create, rename and delete with `trashItem` injected;
  - watch batching;
  - the terminal service with a fake pty: ids, size limits, kill-all.
- One real-PTY smoke test in `npm test`: it spawns `cmd.exe /c echo` through `node-pty` under Node, which loads the same N-API prebuild. The builder drops it if it is flaky in CI-less local runs and keeps it as a manual check.
- In the built app, through the CDP recipe from the step-4 handoff:
  - open a file;
  - edit it and save;
  - change it on disk and see the bar;
  - open a terminal and run `echo`;
  - switch to Usage and back with the state kept.
- `npm run dist` once, to confirm that node-pty loads from the unpacked asar in the packaged build.

## 11. Left to the builder

- Component and store file names. How the context menu and the confirm dialogs are drawn (in-app, brand tokens).
- The exact Monaco import set: the full `monaco-editor` or `editor.api` plus the languages. The full one is fine unless the build time hurts.
- Debounce values, within reason.
- Whether `Copy relative path` uses `navigator.clipboard` or an IPC call.

## 12. Open questions

None blocking. Candidates for later phases: sending a selection to a thread, `@file` mentions, quick open and search, persisting tabs. Git decorations go to Phase 3.
