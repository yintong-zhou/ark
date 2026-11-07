# Phase 2 Step 2: Terminal, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real terminal (PowerShell, Command Prompt, Git Bash) in a bottom panel of the Threads area, several per project, which survives switching screens and dies with the window.

**Architecture:**
- **Main.** `src/main/services/terminals.ts` owns the PTYs. It takes a `spawn` function, so tests use a fake. node-pty is loaded with a dynamic `import()` on the first `terminal:create`, so a broken native module shows as an error in the panel, not a crashed app.
- **IPC.** `terminal:*` handlers validate every payload. All PTYs die on reload (the existing `did-start-loading` handler) and on `before-quit`.
- **Renderer.** A module-level store (`src/renderer/terminal/terms-store.ts`) keeps one xterm per PTY, loaded lazily like Monaco. Each xterm lives in its own detached `<div>`, which the panel re-attaches on mount (spec §5.5).

**Tech Stack:** Electron 45, React 19, Tailwind 4, electron-vite 6, `node-pty@1.1.0`, `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-phase2-editor-terminal-design.md` (§5.2 toggle button, §5.4, §5.5, §6.4, §8, §10). Step 1 (files and editor) is in `main`.

## Global Constraints

- Shells (spec §6.4):
  - **PowerShell**: `pwsh.exe` when `which('pwsh')` finds it, else `powershell.exe`; args `['-NoLogo']`;
  - **Command Prompt**: `cmd.exe`, no args;
  - **Git Bash**: `findGitBash()` from `src/main/services/exec.ts`, args `['--login', '-i']`, listed only when found.
- Shell env: the user's `process.env` minus every key starting with `ELECTRON_` (case-insensitive). Never `cleanEnv`: this is the user's shell, not an agent's.
- Output is buffered 16 ms per terminal, then sent as `terminal:data(id, chunk)`. Exit sends `terminal:exit(id, code)`.
- Limits: `terminal:write` data is a string of at most 65 536 characters; cols and rows are integers from 1 to 1000; ids must be UUIDs, and `write`/`resize` on an id the service does not hold throw `Unknown terminal` (`kill` on one is a no-op: the shell may have just exited).
- Terminal look: 5000 lines of scrollback, font `'Cascadia Mono', Consolas, monospace` at 13px, background `--color-primary`, foreground `--color-neutral-light`, cursor `--color-secondary`, xterm's default ANSI palette.
- Panel: default height 35% of the main pane, remembered in memory only. Tab names `PowerShell 1`, `Command Prompt 1`, `Git Bash 1`, numbered per shell per project.
- xterm is loaded with a dynamic `import()` only, never in the startup bundle.
- Packaging: `node-pty` in `dependencies`; `@xterm/xterm` and `@xterm/addon-fit` in `devDependencies`; `electron-builder.yml` gets `asarUnpack: [node_modules/node-pty/**]` and `npmRebuild: false`.
- UI text is English. Colours come only from the existing Tailwind tokens and CSS variables.
- Commits use `git commit -F <file>` (PowerShell 5.1 splits `-m` here-strings). Never write to `~/.claude`, `~/.codex` or `%APPDATA%\ark`; app checks use `--user-data-dir` in the scratchpad.
- Checks before done: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **Output that arrives before the renderer knows the id.** A fast shell (`cmd.exe` prints its banner at once) can send `terminal:data` before the `create` reply is handled. Those chunks must be shown, not dropped. → Task 3 test `data that arrives before create resolves is written once the terminal exists`.
2. **A large paste.** Pasting 200 KB must reach the shell whole, in order, without `terminal:write` throwing on the 64 KB limit. → Task 3 test `a write longer than 64 KB is sent in order in chunks of at most 65 536`.
3. **Killing a terminal whose shell already exited, and a shell that exits while killAll runs.** Neither may throw nor send a stray `terminal:exit` for an id the renderer already dropped. → Task 1 tests `kill after exit is a no-op` and `killAll kills every pty and sends nothing`.
4. **Output bursts.** `yes`-style output must arrive as few large messages, not one IPC per chunk, and the last chunk before exit must arrive before the exit message. → Task 1 test `chunks within 16 ms are sent once, and pending data is flushed before exit`.
5. **The worktree root vanishes.** Creating a terminal on a thread whose worktree was cleaned must fail with `Worktree not found` (from `rootDir`) and show the error, never fall back to another folder. → Task 2 reuses `rootDir`; Task 4 shows the thrown message in the panel.

---

### Task 1: Terminal service

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm i node-pty@1.1.0`)
- Create: `src/shared/terminal.ts`
- Create: `src/main/services/terminals.ts`
- Test: `tests/main/terminals.test.ts`

**Interfaces:**
- Consumes: `which(cmd)`, `findGitBash()` from `src/main/services/exec.ts`.
- Produces in `src/shared/terminal.ts`:
  - `type ShellId = 'powershell' | 'cmd' | 'gitbash'`;
  - `type ShellOption = { id: ShellId; name: string }` (names: `PowerShell`, `Command Prompt`, `Git Bash`).
- Produces in `src/main/services/terminals.ts`:
  - `type Shell = ShellOption & { file: string; args: string[] }`;
  - `type Pty = { onData(cb: (d: string) => void): unknown; onExit(cb: (e: { exitCode: number }) => void): unknown; write(d: string): void; resize(cols: number, rows: number): void; kill(): void }` (a structural subset of node-pty's `IPty`);
  - `type Spawn = (file: string, args: string[], opts: { cwd: string; env: Record<string, string>; cols: number; rows: number; name: string }) => Pty`;
  - `listShells(find?: { which: typeof which; gitBash: typeof findGitBash }): Promise<Shell[]>`, in the order PowerShell, Command Prompt, Git Bash;
  - `shellEnv(env: NodeJS.ProcessEnv): Record<string, string>`;
  - `termSize(v: unknown): number` (throws `Invalid size`) and `termData(v: unknown): string` (throws `Invalid input`);
  - `class Terminals { constructor(spawn: Spawn, send: { data(id: string, chunk: string): void; exit(id: string, code: number): void }, flushMs = 16); create(shell: Shell, cwd: string, cols: number, rows: number): string; write(id: string, data: string): void; resize(id: string, cols: number, rows: number): void; kill(id: string): void; killAll(): void }`.

- [ ] **Step 1: Install node-pty**

Run: `npm i node-pty@1.1.0`
Expected: `node-pty` appears under `dependencies` in `package.json`, no build step runs (N-API prebuilds).

- [ ] **Step 2: Write the failing tests** in `tests/main/terminals.test.ts`, with a `FakePty` that records `write`/`resize`/`kill` calls and exposes `emitData(s)` and `emitExit(code)`, and `vi.useFakeTimers()`:

```ts
test('create spawns the shell in cwd with the clean env and returns a uuid', () => {
  // spawn called with ('powershell.exe', ['-NoLogo'], { cwd: 'C:\\p', cols: 80, rows: 24, name: 'xterm-256color', env })
  expect(id).toMatch(UUID_RE);
});
test('chunks within 16 ms are sent once, and pending data is flushed before exit', () => {
  pty.emitData('a'); pty.emitData('b');
  expect(sent).toEqual([]);
  vi.advanceTimersByTime(16);
  expect(sent).toEqual([['data', id, 'ab']]);
  pty.emitData('c'); pty.emitExit(3);
  expect(sent.slice(1)).toEqual([['data', id, 'c'], ['exit', id, 3]]);
});
test('write and resize on an unknown id throw Unknown terminal', ...);
// The shell can exit while the user clicks ×: kill must not turn that race into an error.
test('kill after exit is a no-op', () => { pty.emitExit(0); expect(() => t.kill(id)).not.toThrow(); expect(pty.killed).toBe(0); });
test('kill sends no exit for the id', () => { t.kill(id); pty.emitExit(1); vi.runAllTimers(); expect(sent.filter(([k]) => k === 'exit')).toEqual([]); });
test('killAll kills every pty and sends nothing', () => { /* two terminals, one pty.kill throws */ t.killAll(); /* both kill() called, no throw, sent stays [] after runAllTimers */ });
test('shellEnv drops ELECTRON_* in any case and keeps the rest', () => {
  expect(shellEnv({ PATH: 'x', ELECTRON_RUN_AS_NODE: '1', electron_no_attach_console: '1', Foo: undefined })).toEqual({ PATH: 'x' });
});
test('listShells prefers pwsh and lists Git Bash only when found', async () => {
  // which('pwsh') → 'C:\\pwsh\\pwsh.exe', gitBash → undefined
  expect(shells.map((s) => [s.id, s.file, s.args])).toEqual([['powershell', 'C:\\pwsh\\pwsh.exe', ['-NoLogo']], ['cmd', 'cmd.exe', []]]);
  // which → undefined, gitBash → 'C:\\Git\\bin\\bash.exe'
  expect(shells2.map((s) => s.file)).toEqual(['powershell.exe', 'cmd.exe', 'C:\\Git\\bin\\bash.exe']);
});
test('termSize accepts integers 1..1000 only', () => { /* 1, 1000 ok; 0, 1001, 1.5, '80', NaN throw 'Invalid size' */ });
test('termData accepts strings up to 65 536 characters', () => { /* 'x'.repeat(65536) ok; 65537, 1, null throw 'Invalid input' */ });
```

Plus one real-PTY smoke test, skipped off Windows:

```ts
test.runIf(process.platform === 'win32')('node-pty runs cmd.exe /c echo', async () => {
  const { spawn } = await import('node-pty');
  // spawn('cmd.exe', ['/c', 'echo ark-pty-ok'], { cwd: tmpdir(), cols: 80, rows: 24, name: 'xterm-256color', env: shellEnv(process.env) })
  // collect onData until onExit; expect output toContain 'ark-pty-ok' and exitCode 0; timeout 10 s
}, 10_000);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/main/terminals.test.ts`
Expected: FAIL, cannot resolve `../../src/main/services/terminals`.

- [ ] **Step 4: Implement `src/shared/terminal.ts` and `src/main/services/terminals.ts`**

`create` uses `randomUUID()`, spawns with `name: 'xterm-256color'` and `env: shellEnv(process.env)`, and keeps `{ pty, buf, timer }` per id. `onData`/`onExit` callbacks ignore ids no longer in the map. On exit: clear the timer, send pending `buf` as data, send exit, delete the entry. `kill` returns at once for an id it does not hold; otherwise it deletes the entry first, then calls `pty.kill()` inside try/catch. `killAll` does the same for every entry, one failure never skipping the next.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/terminals.test.ts`
Expected: PASS, including the real-PTY smoke test. If the smoke test is flaky across 3 runs, change it to `test.skip` with a comment naming it as a manual check (spec §10).

- [ ] **Step 6: Commit** `feat(terminal): pty service with shells, env and output batching`

---

### Task 2: IPC, preload, main wiring and packaging

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Modify: `electron-builder.yml`
- Modify (only if Step 4 shows node-pty bundled): `electron.vite.config.ts`

**Interfaces:**
- Consumes: Task 1's `Terminals`, `listShells`, `termSize`, `termData`, `Shell`; `rootDir`, `rootRef` from `services/files/guard.ts`; the `uuid(v, what)` helper in `ipc/index.ts`.
- Produces in `ArkApi` (`src/shared/types.ts`):

```ts
terminal: {
  shells(): Promise<ShellOption[]>;
  /** Starts a shell in the root's folder; returns the terminal id. */
  create(root: RootRef, shell: ShellId, cols: number, rows: number): Promise<string>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  onData(cb: (id: string, chunk: string) => void): () => void;
  onExit(cb: (id: string, code: number) => void): () => void;
};
```

- [ ] **Step 1: Add the handlers in `registerIpc`**

- `terminal:shells` returns `listShells()` mapped to `{ id, name }`. Cache the promise for the app's life (PATH does not change under a running app).
- `terminal:create(r, shell, cols, rows)`: the cwd is `rootDir(rootRef(r), store)`; the shell must be one of the listed ids, else `Unknown shell`; cols/rows go through `termSize`. The `Terminals` instance is made on the first call with `(await import('node-pty')).spawn`, kept in a `let terms: Terminals | undefined`.
- `terminal:write(id, data)`: `uuid(id, 'terminal')`, `termData(data)`. `terminal:resize`, `terminal:kill` alike. With no `terms` yet, write and resize throw `Unknown terminal` and kill does nothing.
- Sends go to `win.webContents` behind the `!win.isDestroyed()` check, like `files:changed`.
- Add `terms?.killAll()` to the existing `did-start-loading` handler and to a `before-quit` handler next to `watcher.closeAll()`.

- [ ] **Step 2: Add `terminal` to the preload and `ArkApi`**, following the `files` block (`invoke` per call, `on`/`removeListener` for `onData` and `onExit`).

- [ ] **Step 3: Add packaging** to `electron-builder.yml`:

```yaml
asarUnpack:
  - node_modules/node-pty/**
npmRebuild: false
```

- [ ] **Step 4: Verify node-pty stays external in the main build**

Run: `npm run build`, then `Select-String -Path out\main\*.js -Pattern 'node-pty'`
Expected: only a `require("node-pty")` (or `import("node-pty")`) reference, no inlined node-pty source. If it is inlined, set `main: { build: { externalizeDeps: true } }` (or `rollupOptions.external: ['node-pty']`) in `electron.vite.config.ts` and re-check.

- [ ] **Step 5: Run the checks**

Run: `npm run typecheck; npm run lint; npm test`
Expected: all pass.

- [ ] **Step 6: Commit** `feat(terminal): ipc, preload and packaging`

---

### Task 3: Renderer terminal store

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm i -D @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0`)
- Create: `src/renderer/terminal/xterm.ts`
- Create: `src/renderer/terminal/terms-store.ts`
- Test: `tests/renderer/terms-store.test.ts`

**Interfaces:**
- Consumes: `window.ark.terminal` (Task 2), `ShellId`, `ShellOption` (Task 1), `RootRef`.
- Produces in `src/renderer/terminal/xterm.ts`: `loadXterm(): Promise<{ Terminal: typeof import('@xterm/xterm').Terminal; FitAddon: typeof import('@xterm/addon-fit').FitAddon }>`, memoised like `loadMonaco`, also importing `@xterm/xterm/css/xterm.css`.
- Produces in `src/renderer/terminal/terms-store.ts`:
  - `type Term = { id: string; name: string; el: HTMLDivElement; xterm: Terminal; fit: FitAddon; exited?: number }`;
  - `type TermsView = { terms: Term[]; active: string | null; open: boolean; error?: string }` (`error`: the last failed create, cleared by the next success);
  - `useTerms(projectId: string | undefined): TermsView` (`useSyncExternalStore`, a stable snapshot per project like `tabsOf`);
  - `toggle(projectId: string, root: RootRef): void`: opens or closes the panel; opening a project with no terminals creates a PowerShell one;
  - `create(projectId: string, root: RootRef, shell: ShellOption): Promise<void>`;
  - `activateTerm(projectId: string, id: string): void`;
  - `closeTerm(projectId: string, id: string): void`: kills the PTY (unless exited), disposes the xterm, removes it; the panel stays open even when empty;
  - `fitTerm(t: Term): void`: `fit.fit()`, then `terminal.resize` when cols/rows changed;
  - `shells(): Promise<ShellOption[]>`, cached;
  - `panelHeight(): number` and `setPanelHeight(f: number)` (fraction, clamped 0.15–0.85, default 0.35).

- [ ] **Step 1: Install xterm**

Run: `npm i -D @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0`

- [ ] **Step 2: Write the failing tests** in `tests/renderer/terms-store.test.ts`, reusing the `tabs-store.test.ts` approach: `vi.mock('../../src/renderer/terminal/xterm')` with a `FakeTerminal` (`open`, `write`, `onData`, `onResize`, `loadAddon`, `attachCustomKeyEventHandler`, `dispose`, `cols`, `rows`, `getSelection`) and a `window.ark.terminal` stub whose `create` resolves on a gate and whose `onData`/`onExit` capture the callbacks. `document.createElement` is stubbed to return a plain object.

```ts
test('data that arrives before create resolves is written once the terminal exists', async () => {
  // create() in flight; emitData(ID, 'banner') before gate opens; open gate
  expect(fake.written).toEqual(['banner']);
});
test('a write longer than 64 KB is sent in order in chunks of at most 65 536', () => {
  // xterm onData('x'.repeat(200_000)) → ark.terminal.write called 4 times, lengths [65536, 65536, 65536, 3392], joined equals input
});
test('names count per shell per project', async () => {
  // PowerShell, PowerShell, Git Bash in p1; PowerShell in p2 → ['PowerShell 1', 'PowerShell 2', 'Git Bash 1'], ['PowerShell 1']
});
test('exit marks the term and writes the notice', () => {
  // emitExit(ID, 2) → term.exited === 2, fake.written.at(-1) contains 'Process exited (code 2)'
});
test('closing an exited terminal does not call kill', ...);
test('toggle on a project with no terminals opens the panel and creates PowerShell', ...);
test('a failed create shows its message and leaves no terminal', async () => {
  // ark.terminal.create rejects with Error('Worktree not found') → view.error === 'Worktree not found', view.terms === []
});
test('panel height clamps to 0.15..0.85', ...);
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/terms-store.test.ts`
Expected: FAIL, cannot resolve `terms-store`.

- [ ] **Step 4: Implement `xterm.ts` and `terms-store.ts`**

- One `onData`/`onExit` subscription for the module, made on first use. Data for an id with no `Term` yet goes into a `pending: Map<string, string[]>`, drained right after the `Term` is registered.
- `create`: `loadXterm()`, make `el = document.createElement('div')` (`h-full w-full`), `new Terminal({ scrollback: 5000, fontFamily, fontSize: 13, theme })`, `loadAddon(fit)`, `open(el)`, then `await window.ark.terminal.create(root, shell.id, xterm.cols || 80, xterm.rows || 24)`. The theme reads `--color-primary`, `--color-neutral-light` and `--color-secondary` from `getComputedStyle(document.documentElement)`.
- `xterm.onData(d)` sends `d` in 65 536-character slices; `xterm.onResize` calls `terminal.resize`.
- `attachCustomKeyEventHandler(e)`, on `keydown` only:
  - Ctrl+C with a selection: `navigator.clipboard.writeText(selection)`, clear the selection, return `false`;
  - Ctrl+V: return `false`, so the browser's paste event reaches xterm's own paste handler;
  - Ctrl+`` ` `` (`e.code === 'Backquote'`): return `false`, so the window shortcut toggles the panel;
  - everything else returns `true`.
- Exit writes `\r\n\x1b[2m[Process exited (code N)]\x1b[0m\r\n` and sets `exited`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/terms-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit** `feat(terminal): renderer store with lazy xterm`

---

### Task 4: Bottom panel UI

**Files:**
- Create: `src/renderer/components/TerminalPanel.tsx`
- Modify: `src/renderer/components/TabStrip.tsx`
- Modify: `src/renderer/pages/Threads.tsx`
- Modify (if a terminal glyph is missing): `src/renderer/components/Icons.tsx`

**Interfaces:**
- Consumes: Task 3's store; `Menu` from `components/Menu.tsx`; `CloseIcon`, `PlusIcon` from `Icons.tsx`; the `root` already computed in `Threads.tsx`.
- Produces: `TerminalPanel({ projectId, root }: { projectId: string; root: RootRef })`; `TabStrip` gains a `terminal: { open: boolean; onToggle: () => void }` prop.

- [ ] **Step 1: `TerminalPanel`**

- A header (24px, `bg-sidebar`, `border-divider`) lists the terminals as small tabs: the name, `· exited` in muted text with the title `Process exited (code N)` once exited, and a × per terminal. Then a `+` that opens `Menu` with the available shells.
- The body holds only the active term's `el`: a `useEffect` appends `term.el` to the body ref on mount and on switching, removes it on cleanup, then calls `fitTerm`. A `ResizeObserver` on the body calls `fitTerm` for the active term.
- `view.error` shows as a muted line in the body.

- [ ] **Step 2: `Threads.tsx` wiring**

- The main pane becomes a column: the current content in a `min-h-0 flex-1` wrapper, then, while the panel is open, a 4px divider (`cursor-row-resize`, `bg-divider` on hover) and `TerminalPanel` at `panelHeight * 100%` of the column. Dragging the divider sets `setPanelHeight` from the pointer's position in the column.
- The tab strip now shows whenever a project is open, not only once a file is open, because it holds the terminal button (spec §5.2: "always present") **[call]**.
- A `keydown` listener on `window` in capture phase, while a project is open: `e.ctrlKey && e.code === 'Backquote'` calls `toggle(project.id, root)` and `preventDefault()`. On an Italian keyboard this is the key left of `1`.
- A new terminal starts in `root`: the project, or the selected worktree when the Files view shows it.

- [ ] **Step 3: `TabStrip`** gets a right-aligned icon button (`ICON_BUTTON`, `aria-pressed={open}`, `title="Terminal (Ctrl+`)"`).

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck; npm run lint; npm test; npm run build`
Expected: all pass.

- [ ] **Step 5: Check it in the built app** with the CDP recipe from `docs/handoff/2026-11-07-ark-phase2-step1-done.md` (profile and project in the scratchpad, `ELECTRON_RENDERER_URL=` empty, `--user-data-dir`, `--remote-debugging-port=9333`):
  - Ctrl+`` ` `` opens the panel with `PowerShell 1`; typing `echo ark-ok` + Enter shows `ark-ok` (read `.xterm-rows` text);
  - `+` → Command Prompt opens `Command Prompt 1` in the project folder (`cd` prints it);
  - `exit` shows `Process exited (code 0)` and the tab stays;
  - Usage and back: the panel, both terminals and their scrollback are still there;
  - Ctrl+R: no `powershell.exe`/`cmd.exe` child of Ark survives (`Get-CimInstance Win32_Process` filtered on the parent PID chain).
  Then stop the `electron.exe` processes whose command line contains the scratchpad profile.

- [ ] **Step 6: Commit** `feat(terminal): bottom panel with xterm tabs`

---

### Task 5: Docs and packaged build

**Files:**
- Modify: `README.md` (a "Terminal" section next to "Files and editor")
- Modify: `CLAUDE.md` (layout: `src/renderer/terminal/`, `services/terminals.ts`; rule: the terminal is the user's shell, env minus `ELECTRON_*`, not isolated like agents)

- [ ] **Step 1: Write the README and CLAUDE.md lines.**

- [ ] **Step 2: Build the installer**

Run: `npm run dist`
Expected: `dist/` holds the NSIS installer and `dist/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/` holds the prebuilt `.node` files.

- [ ] **Step 3: Check node-pty loads from the unpacked asar**

Run `dist/win-unpacked/Ark.exe --user-data-dir=<scratchpad profile> --remote-debugging-port=9333` and open a terminal through CDP; `echo ark-ok` must print. Stop the process afterwards.

- [ ] **Step 4: Final checks**

Run: `npm run typecheck; npm run lint; npm test; npm run build`
Expected: all pass.

- [ ] **Step 5: Commit** `docs: terminal`
