# Phase 2 Step 1: Files and Editor, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse, open, edit and save project and worktree files inside Ark, with a Monaco editor in tabs next to the thread.

**Architecture:**
- **Main process.** A path guard and file operations live in `src/main/services/files/`. They are exposed through `files:*` IPC. The renderer names only a root (project or thread) and a relative path.
- **Watcher.** A recursive `fs.watch` per root pushes batched changes to the renderer.
- **Renderer.** A Files switch in the sidebar shows a lazy tree. A tab strip in the main pane holds the thread tab and file tabs, and Monaco is loaded on demand.
- **Tab logic.** The pure rules (disk changes, conflicts, saves) live in `src/shared/editor-tabs.ts`, so they are unit tested.

**Tech Stack:** Electron 45, React 19, Tailwind 4, electron-vite 6, `monaco-editor` (bundled ESM), vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-phase2-editor-terminal-design.md` (§4, §5.1–5.3, §5.5, §6.1–6.3, §6.5, §7). The terminal (§5.4, §6.4, §8) is step 2.

## Global Constraints

- The renderer sends only `RootRef` plus a rel path. The main process resolves and checks every path (spec §6.1). It never accepts an absolute path from the renderer.
- Rel path rules:
  - a string of at most 1024 characters, with no NUL, no drive letter and no leading `/` or `\`;
  - no `..` segment;
  - `\` is accepted and normalised to `/`;
  - `''` means the root.
- Size and content limits:
  - read limit: 5 MB (`5 * 1024 * 1024`);
  - binary means a NUL byte in the first 8192 bytes;
  - list cap: 5000 entries, with `.git` hidden.
- Watch events under `.git/` are dropped, and the rest are batched for 150 ms.
- Delete is always `shell.trashItem`, never a permanent delete.
- Monaco is loaded with a dynamic `import()` only, never in the startup bundle (anti-goal: a slower start).
- CSP adds only `worker-src 'self' blob:`.
- The UI text is English. Colours come only from the existing Tailwind tokens (`bg-primary`, `bg-sidebar`, `bg-content`, `bg-raised`, `border-divider`, `text-secondary`, `text-muted`, `bg-accent`).
- Ark's existing rules stay: it never writes in `~/.claude`, `~/.codex` or `%APPDATA%\ark` from the editor (the root guard ensures this), and commits use `git commit -F <file>`.
- Checks before done: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **Ark's own save echoes back through the watcher.** After a save, the change event must not raise "Changed on disk". → Task 4: `diskChanged` with the tab's own `mtimeMs` is a no-op.
2. **Windows path spellings.** `src\a.ts`, a trailing `/`, names with spaces or non-ASCII, and a different drive-letter case must resolve inside the root, while `..\x` and `C:x` are refused. → Task 1 tests.
3. **A thread worktree that no longer exists** (the thread finished and its worktree was cleaned) while its tabs are open. The root must throw "Worktree not found", never fall back to another folder. → Task 1 test.
4. **A folder deleted or renamed with open files inside.** Those tabs get "Deleted on disk", and a save then recreates the file at the old path. → Task 4 test (`diskChanged(tab, null)`, then `saveBase` is `null`).
5. **A huge folder (`node_modules`).** It is capped at 5000 entries with `truncated: true`, never a frozen UI. → Task 2 test.

---

### Task 1: Shared file types, root and path guard

**Files:**
- Create: `src/shared/files.ts`
- Create: `src/main/services/files/guard.ts`
- Test: `tests/main/files-guard.test.ts`

**Interfaces:**
- Produces in `src/shared/files.ts`:
  - `type RootRef = { kind: 'project'; id: string } | { kind: 'thread'; id: string }`;
  - `rootKey(r: RootRef): string`, which returns `` `${r.kind}:${r.id}` ``;
  - `type FileEntry = { name: string; kind: 'dir' | 'file' | 'link' }`;
  - `type DirListing = { entries: FileEntry[]; truncated: boolean }`;
  - `type ReadResult = { kind: 'text'; text: string; mtimeMs: number; bom: boolean; readonly: boolean } | { kind: 'binary' } | { kind: 'large'; size: number }`;
  - `type WriteResult = { conflict: true } | { conflict: false; mtimeMs: number }`;
  - `parentOf(rel: string): string`, where `'a/b/c.ts'` → `'a/b'` and `'c.ts'` → `''`;
  - `joinRel(dir: string, name: string): string`, where `('', 'x')` → `'x'` and `('a', 'x')` → `'a/x'`.
- Produces in `guard.ts`:
  - `normRel(v: unknown): string`, which validates and returns the `/`-separated rel without a trailing `/`, and throws `Error('Invalid path')`;
  - `resolveInside(root: string, rel: string): string`, which returns an absolute path and throws `Error('Path is outside the folder')`;
  - `rootRef(v: unknown): RootRef`, which validates the shape, a UUID id and a known kind, and throws `Error('Invalid folder')`;
  - `rootDir(ref: RootRef, store: Pick<ThreadStore, 'projects' | 'get'>): string`, which throws `Error('Unknown project')`, `Error('Unknown thread')` or `Error('Worktree not found')`.

- [ ] **Step 1: Write the failing tests** in `tests/main/files-guard.test.ts`. Use a temp root (`mkdtempSync`) that holds `src/a.ts`, `dir with space/é.txt`, and a junction `out → <another temp dir>` made with `symlinkSync(target, link, 'junction')`.
  - `normRel`:
    - `'src\\a.ts'` → `'src/a.ts'`;
    - `'src/'` → `'src'`;
    - `''` → `''`;
    - it throws on `'../x'`, `'a/../../x'`, `'C:x'`, `'C:\\x'`, `'/x'`, `'\\x'`, `'a\0b'`, `5`, and on `'x'.repeat(1025)`.
  - `resolveInside`:
    - `(root, 'src/a.ts')` equals `join(root, 'src', 'a.ts')`;
    - `(root, 'dir with space/é.txt')` resolves;
    - `(root, 'new/deeper/file.ts')` resolves, because the nearest existing parent is the root;
    - `(root, 'out/x.txt')` throws `'Path is outside the folder'`;
    - `resolveInside(root.toUpperCase(), 'src/a.ts')` resolves (drive and case spelling).
  - `rootRef`:
    - it accepts `{ kind: 'project', id: <uuid> }`;
    - it throws on `{ kind: 'other', id }`, on a bad id, and on `null`.
  - `rootDir`, with a fake store:
    - a project returns its `dir`;
    - a thread with `build.worktree` set to an existing folder returns it;
    - a thread with no `build` throws `'Worktree not found'`;
    - a thread whose worktree folder is missing throws `'Worktree not found'`;
    - an unknown id throws.
  - Tests for `parentOf` and `joinRel` go in the same file.

- [ ] **Step 2: Run** `npx vitest run tests/main/files-guard.test.ts`. Expected: FAIL (the modules are missing).

- [ ] **Step 3: Implement.**
  - `resolveInside`:
    - `abs = resolve(root, rel)`;
    - `base = realpathSync.native(root)`;
    - walk up from `abs` to the nearest existing path `p`, then `real = realpathSync.native(p)`;
    - it is inside when `real` equals `base` or starts with `base + sep`, comparing case-insensitively on `win32`.
  - The UUID regex is the one in `src/main/ipc/index.ts`. Move it to `src/shared/files.ts` as `export const UUID_RE` and import it in both places.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat(files): root and path guard`.

### Task 2: File operations

**Files:**
- Create: `src/main/services/files/ops.ts`
- Test: `tests/main/files-ops.test.ts`

**Interfaces:**
- Consumes: `resolveInside`, and the shared types from Task 1.
- Produces in `ops.ts`, where every function takes the root's absolute `dir` and an already-normalised `rel`:
  - `listDir(dir: string, rel: string): DirListing`;
  - `readText(dir: string, rel: string): ReadResult`;
  - `statFile(dir: string, rel: string): { mtimeMs: number } | null`, with `null` when the path is missing or a folder;
  - `writeText(dir: string, rel: string, text: string, base: number | null, bom: boolean): WriteResult`;
  - `createEntry(dir: string, rel: string, kind: 'file' | 'dir'): void`, which throws `Error('Already exists')`;
  - `renameEntry(dir: string, from: string, to: string): void`, which throws `Error('Already exists')`;
  - `trashEntry(dir: string, rel: string, trash: (abs: string) => Promise<void>): Promise<void>`.

- [ ] **Step 1: Write the failing tests** in a temp dir.
  - `listDir`:
    - folders come first, then files, case-insensitively: `['B/', 'a/', 'c.txt', 'D.txt']` sorts to dirs `a`, `B`, then files `c.txt`, `D.txt`;
    - `.git` is hidden;
    - a junction is listed as `'link'`;
    - for 5001 files: `entries.length === 5000` and `truncated === true`.
  - `readText`:
    - UTF-8 text gives `kind: 'text'`, `bom: false`, `readonly: false`;
    - a file starting with `EF BB BF` gives `bom: true` and text without the BOM;
    - bytes `[0x61, 0x00, 0x62]` give `{ kind: 'binary' }`;
    - a 5 MB + 1 file gives `{ kind: 'large', size: 5242881 }`;
    - bytes `[0xC3, 0x28]` (invalid UTF-8) give `readonly: true` with the text containing `'\uFFFD'`;
    - `mtimeMs` equals `statSync(...).mtimeMs`.
  - `writeText`:
    - with `base` equal to the current mtime, it writes and returns a new `mtimeMs` that equals `statFile`'s;
    - with a stale `base` (the file was rewritten in between, or set the mtime with `utimesSync`), it returns `{ conflict: true }` and the content is unchanged;
    - with `base: null`, it overwrites;
    - with `bom: true`, the bytes start with `EF BB BF`;
    - writing a missing file with `base: null` creates it, along with its missing parent folders;
    - writing a missing file with a number `base` returns `{ conflict: true }`.
  - `createEntry`: it creates a file (empty) and a dir. When the path already exists it throws `'Already exists'`.
  - `renameEntry`: it moves a file. When the target exists it throws `'Already exists'`.
  - `trashEntry`: it calls the injected `trash` with `join(dir, rel)`.
  - Every function refuses `'out/x'`, where `out` is a junction pointing outside the temp dir.

- [ ] **Step 2: Run** `npx vitest run tests/main/files-ops.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Every function resolves through `resolveInside` first.
  - Decoding uses `new TextDecoder('utf-8', { fatal: true })` and falls back to a non-fatal decode with `readonly: true`.
  - The write goes through the existing `writeAtomic` from `src/main/services/files.ts`. That file is a sibling of the new `files/` folder, so import it as `'../files'`.
  - `writeText` creates the parent folders with `mkdirSync(..., { recursive: true })`.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(files): list, read, write, create, rename, trash`.

### Task 3: Root watcher

**Files:**
- Create: `src/main/services/files/watch.ts`
- Test: `tests/main/files-watch.test.ts`

**Interfaces:**
- Produces `class RootWatcher`, built with `constructor(send: (key: string, rels: string[] | null) => void, delayMs = 150)`:
  - `watch(key: string, dir: string): void`, which is reference counted per key;
  - `unwatch(key: string): void`, which closes the watcher when the count reaches 0;
  - `closeAll(): void`.
- `rels` are `/`-separated and deduplicated. `null` means the platform gave no filename, so "everything changed".

- [ ] **Step 1: Write the failing tests**, using a real temp dir and real timers (wait up to 2 s with `vi.waitFor`).
  - Writing `a.txt` and then `sub/b.txt` within 150 ms produces one `send` call containing both `'a.txt'` and `'sub/b.txt'`.
  - Writing `.git/HEAD` alone produces no `send` within 500 ms.
  - `watch` twice and `unwatch` once still delivers events. A second `unwatch` stops them: no `send` within 500 ms after a write.
  - After `closeAll()`, no events arrive.

- [ ] **Step 2: Run** `npx vitest run tests/main/files-watch.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** with `fs.watch(dir, { recursive: true })`:
  - collect the filenames into a `Set`, or set a `null` flag;
  - flush after `delayMs`;
  - normalise `\` to `/`;
  - drop `.git` and `.git/...`;
  - an `error` event on the watcher closes it quietly (the folder was deleted).

- [ ] **Step 4: Run.** Expected: PASS, three runs in a row (`1..3 | % { npx vitest run tests/main/files-watch.test.ts }`).

- [ ] **Step 5: Commit** `feat(files): batched recursive watcher`.

### Task 4: Pure tab rules

**Files:**
- Create: `src/shared/editor-tabs.ts`
- Test: `tests/shared/editor-tabs.test.ts`

**Interfaces:**
- Produces:
  - `type FileTab = { key: string; root: RootRef; rel: string; dirty: boolean; mtimeMs: number | null; bom: boolean; readonly: boolean; bar?: 'changed' | 'deleted'; force: boolean }`;
  - `tabKey(root: RootRef, rel: string): string`, which returns `rootKey(root) + '\n' + rel`;
  - `diskChanged(tab: FileTab, disk: { mtimeMs: number } | null): { tab: FileTab; reload: boolean }`;
  - `keepMine(tab: FileTab): FileTab`, which clears `bar` and sets `force: true`;
  - `saveBase(tab: FileTab): number | null`, which returns `null` when `force` is set or `bar === 'deleted'`, and `mtimeMs` otherwise;
  - `afterSave(tab: FileTab, r: WriteResult): FileTab`;
  - `touches(rels: string[] | null, rel: string): boolean`, which is true when `rels` is `null`, contains `rel`, or contains a parent folder of `rel` (a deleted or renamed folder);
  - `dirsToRefresh(expanded: string[], rels: string[] | null): string[]`, which returns every expanded dir when `rels` is `null`, and otherwise the expanded dirs equal to `parentOf(r)` or to `r` itself, for each changed `r`.

- [ ] **Step 1: Write the failing tests.** Start from `base: FileTab = { key, root, rel: 'a.ts', dirty: false, mtimeMs: 100, bom: false, readonly: false, force: false }`.
  - `diskChanged(base, { mtimeMs: 100 })` returns `{ tab: base, reload: false }`, the own-save echo (Review Focus 1).
  - `diskChanged(base, { mtimeMs: 200 })` returns `{ reload: true }` with no `bar`.
  - `diskChanged({ ...base, dirty: true }, { mtimeMs: 200 })` returns `reload: false` and `bar: 'changed'`.
  - `diskChanged(base, null)` returns `bar: 'deleted'`, `mtimeMs: null` and `reload: false`, whether the tab is clean or dirty.
  - `saveBase` gives:
    - `100` for `base`;
    - `null` for `keepMine({ ...base, bar: 'changed' })`;
    - `null` for a `bar: 'deleted'` tab (Review Focus 4).
  - `afterSave(tab, { conflict: true })` sets `bar: 'changed'` and keeps `dirty`.
  - `afterSave({ ...base, dirty: true, force: true }, { conflict: false, mtimeMs: 300 })` gives `dirty: false`, `force: false`, no `bar` and `mtimeMs: 300`.
  - `touches`:
    - `(['src'], 'src/a.ts')` → true;
    - `(['srcx/a.ts'], 'src/a.ts')` → false;
    - `(null, 'x')` → true.
  - `dirsToRefresh(['', 'src'], ['src/a.ts', 'b.txt'])` → `['src', '']`, compared as sets.

- [ ] **Step 2: Run** `npx vitest run tests/shared/editor-tabs.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the functions in `src/shared/editor-tabs.ts`.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(editor): tab rules for disk changes and saves`.

### Task 5: IPC, preload and the quit warning

**Files:**
- Modify: `src/shared/types.ts` (`ArkApi.files`, `ArkApi.editor`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/index.ts` (handlers; `UUID` imported from `@shared/files`)
- Modify: `src/main/index.ts` (the `RootWatcher` and the close dialog)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces `ArkApi.files`:
  - `list(root: RootRef, rel: string): Promise<DirListing>`;
  - `read(root, rel): Promise<ReadResult>`;
  - `stat(root, rel): Promise<{ mtimeMs: number } | null>`;
  - `write(root, rel, text: string, base: number | null, bom: boolean): Promise<WriteResult>`;
  - `create(root, rel, kind: 'file' | 'dir'): Promise<void>`;
  - `rename(root, from: string, to: string): Promise<void>`;
  - `remove(root, rel): Promise<void>`;
  - `reveal(root, rel): Promise<void>`;
  - `watch(root): Promise<void>`;
  - `unwatch(root): Promise<void>`;
  - `onChanged(cb: (key: string, rels: string[] | null) => void): () => void`.
- Produces `ArkApi.editor.setDirty(count: number): void`, sent with `ipcRenderer.send('editor:dirty', count)`.
- Channels: `files:list|read|stat|write|create|rename|remove|reveal|watch|unwatch`, plus the `files:changed` event. Handlers go through the existing `handle` wrapper, so the sender is checked.

- [ ] **Step 1: Add the handlers.** Each one runs `rootDir(rootRef(r), store)` and `normRel(rel)`, then calls the op.
  - `files:write`:
    - checks `typeof text === 'string'` and `text.length <= 50_000_000`;
    - `base` is `null` or a finite number;
    - `bom` is a boolean.
  - `files:create`: `kind` is `'file'` or `'dir'`.
  - `files:remove`: passes `(abs) => shell.trashItem(abs)`.
  - `files:reveal`: calls `shell.showItemInFolder(resolveInside(dir, rel))`.
  - `files:watch` / `files:unwatch`: use `rootKey` and `rootDir`, with the `RootWatcher` created in `registerIpc`. It sends `files:changed` to `win`, and the existing `did-start-loading` listener also calls `watcher.closeAll()`.
  - `editor:dirty`: uses `ipcMain.on`, checks the sender and the count (an integer from 0 to 10000), and stores it in a `let dirty = 0` that `registerIpc` returns through a getter. Change `registerIpc` to return `{ dirtyCount: () => number }`.

- [ ] **Step 2: Add the quit warning in `src/main/index.ts`.** Add `win.on('close', e => …)`:
  - when `dirtyCount() > 0`, show `dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Quit anyway', 'Cancel'], defaultId: 1, cancelId: 1, message: `${n} file${n === 1 ? ' has' : 's have'} unsaved changes` })`;
  - when the answer is Cancel, call `e.preventDefault()`.

- [ ] **Step 3: Run** `npm run typecheck` and `npm test`. Expected: both pass.

- [ ] **Step 4: Commit** `feat(files): IPC, watcher wiring and unsaved-changes warning`.

### Task 6: Sidebar Files switch and tree

**Files:**
- Create: `src/renderer/files/tree-store.ts`
- Create: `src/renderer/components/FileTree.tsx`
- Create: `src/renderer/components/Menu.tsx`
- Modify: `src/renderer/pages/Threads.tsx`

**Interfaces:**
- Consumes: `window.ark.files.*`, `dirsToRefresh`, `joinRel`, `parentOf`.
- Produces in `tree-store.ts`, a module-level store per `rootKey`, so the state outlives unmounts (spec §5.5):
  - `useTree(root: RootRef): { listings: Map<string, DirListing>; expanded: Set<string>; toggle(rel: string): void; refresh(rels: string[] | null): void }`, built on `useSyncExternalStore`;
  - while mounted, the hook calls `files.watch(root)` on mount and `unwatch` on unmount;
  - one global `files.onChanged` subscription routes the changes to the store by key and calls `dirsToRefresh`.
- Produces `<Menu items={{ label: string; onClick: () => void; danger?: boolean }[]} at={{ x: number; y: number }} onClose={() => void} />`: a Raised popup that closes on Escape or an outside click.
- Produces `<FileTree root={RootRef} onOpen={(rel: string) => void} />`.

- [ ] **Step 1: Sidebar switch.** In `Threads.tsx`, add `view: 'threads' | 'files'` state under the sidebar header, as two small toggle buttons styled like the tag pills.
  - The Files view shows the root picker (only when the selected thread has `build?.worktree`), then `<FileTree>`.
  - The picker state `rootSel: 'project' | 'worktree'` resets to `'project'` when the thread changes.

- [ ] **Step 2: The tree rows.**
  - Each row is 24px, indented 12px per level. A folder row has a chevron glyph and a file row a blank lead.
  - The name is truncated with `title` set to the rel. A `truncated` listing ends with a muted row "Showing first 5000 entries".
  - A click on a folder calls `toggle`, and a click on a file calls `onOpen(rel)`.
  - A right-click opens `<Menu>` with:
    - New file and New folder (on folders and the root);
    - Rename;
    - Delete;
    - Reveal in Explorer;
    - Copy relative path (`navigator.clipboard.writeText`).
  - New file, New folder and Rename use an inline input row: Enter confirms, Escape cancels.
  - Delete asks with `confirm(\`Move "${name}" to the Recycle Bin?\`)` **[call: native confirm]**.
  - Errors show in the pane's existing `problem` line through the `attempt` prop.

- [ ] **Step 3: Check it in the built app.**
  - Run `npm run build`, then the CDP recipe from `docs/handoff/2026-11-06-ark-phase1-step4-done.md`, with a profile in the scratchpad whose project points to a temp copy of a small folder.
  - Click Files, expand a folder, create `x.txt`, rename it and delete it.
  - Screenshot. Expected: the tree updates after each action, through the watcher.

- [ ] **Step 4: Run** `npm run typecheck` and `npm run lint`. Expected: both pass.

- [ ] **Step 5: Commit** `feat(files): sidebar explorer`.

### Task 7: Tab strip and Monaco editor

**Files:**
- Create: `src/renderer/editor/monaco.ts` (the lazy loader: workers, the `ark-dark` theme)
- Create: `src/renderer/editor/tabs-store.ts` (module-level: tabs per project, models, view states)
- Create: `src/renderer/components/TabStrip.tsx`
- Create: `src/renderer/components/Editor.tsx`
- Modify: `src/renderer/pages/Threads.tsx`
- Modify: `src/renderer/index.html` (CSP)
- Modify: `package.json` (`monaco-editor` in `devDependencies`)

**Interfaces:**
- Consumes: the Task 4 rules, `files.read|stat|write|onChanged`, `editor.setDirty`.
- Produces in `tabs-store.ts`:
  - `useTabs(projectId: string): { tabs: FileTab[]; active: string | null }`, where `null` means the thread tab;
  - `open(projectId: string, root: RootRef, rel: string): Promise<void>`, which reads the file, creates the model (or the binary or large placeholder), activates the tab, and calls `files.watch(root)` for the first tab of a root;
  - `activate(projectId: string, key: string | null): void`;
  - `close(projectId: string, key: string): void`, which asks `confirm('Discard unsaved changes to <name>?')` when the tab is dirty, disposes the model, and unwatches with the last tab of a root;
  - `save(key: string): Promise<void>`, which uses `saveBase`, `files.write` and `afterSave`;
  - `reload(key: string): Promise<void>`;
  - `keep(key: string): void`, which calls `keepMine`.

  On every dirty change the store calls `editor.setDirty(total dirty tabs)`. One `files.onChanged` subscription walks the tabs:
  - it skips tabs where `touches` is false and calls `files.stat` for the others;
  - it calls `diskChanged`, and on `reload` it reads the file and sets the model value with `model.pushEditOperations` so the undo stack survives, keeping the view state.
- Produces in `monaco.ts`: `loadMonaco(): Promise<typeof import('monaco-editor')>`, which is memoised and sets `self.MonacoEnvironment.getWorker` using Vite `?worker` imports:
  - the editor worker, plus the json, css, html and ts workers;
  - the builder checks the exact paths in `node_modules/monaco-editor/esm/vs/...`.

  It defines the `ark-dark` theme, based on `vs-dark`, from the CSS variables in `index.css`, read with `getComputedStyle(document.documentElement)`: background = content, `editor.lineHighlightBackground` and `editor.selectionBackground` = raised, cursor = secondary.

- [ ] **Step 1: Install** `npm i -D monaco-editor@0.57.0`. Add `worker-src 'self' blob:` to the CSP in `src/renderer/index.html`.

- [ ] **Step 2: Build `TabStrip`.**
  - The strip is 32px on `bg-sidebar`, with a `border-divider` bottom border.
  - The first tab is `# <thread title>`, or `New thread` / the project name, and it activates `null`.
  - File tabs show the name, plus `· worktree` in muted text when `root.kind === 'thread'`. A dirty tab has a `●`. A close × shows on hover and when active.
  - A middle-click closes a tab.
  - The active tab is `bg-content text-secondary` and the rest are `text-muted`.

- [ ] **Step 3: Build `Editor`.**
  - It holds one Monaco editor instance, created once per mount, and `setModel` switches files.
  - The language comes from `monaco.languages.getLanguages()`, matched by extension.
  - Font: `'Cascadia Mono', Consolas, monospace`, 13px. The minimap is on.
  - Ctrl+S calls `save` and Ctrl+W calls `close`, through `editor.addCommand`.
  - `readonly` sets `readOnly: true` and shows the bar "Not UTF-8: opened read-only so saving can't damage it".
  - The conflict bars:
    - `bar: 'changed'`: "Changed on disk", with Reload and Keep mine buttons;
    - `bar: 'deleted'`: "Deleted on disk. Saving will recreate it."
  - The placeholders: "Binary file, not shown" and "Too large to open here (N MB)".

- [ ] **Step 4: Wire `Threads.tsx`.**
  - The main pane becomes `<TabStrip>` followed by either today's content (thread tab) or `<Editor>`.
  - `<TeamPanel>` renders only when the thread tab is active.
  - A sidebar thread click calls `activate(projectId, null)`.
  - A FileTree `onOpen` calls `open(project.id, currentRoot, rel)`.

- [ ] **Step 5: Check it in the built app** with the CDP recipe:
  - open a `.ts` file, then type, and the dirty dot appears;
  - Ctrl+S, and the dot clears;
  - edit the same file on disk from the test script, and a clean tab reloads, while a dirty tab shows "Changed on disk";
  - switch to Usage and back, and the tab, its content and the dirty state are kept;
  - screenshots of each.

  Also confirm in the build output that Monaco is in a separate chunk (the `index-*.js` size grows by less than 100 kB).

- [ ] **Step 6: Run** `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Expected: all pass.

- [ ] **Step 7: Commit** `feat(editor): tab strip and Monaco editor`.

### Task 8: Docs

**Files:**
- Modify: `README.md` (a Files and editor bullet)
- Modify: `CLAUDE.md`. Add this rule line: "The editor writes only inside a project folder or a thread worktree, when the user saves; paths are checked in main (`services/files/guard.ts`)." Also add `files/` to the Layout list.

- [ ] **Step 1: Edit both files.**
- [ ] **Step 2: Commit** `docs: files and editor`.
