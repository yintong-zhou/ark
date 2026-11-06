# Ark Phase 0 — Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows Electron app that shows, for Claude Code and Codex, each active session's context and each agent's 5-hour/weekly limits, plus history and the logged-in account.

**Architecture:**
- **Main process:** one adapter per agent (`src/main/services/adapters/`) maps its sources to a common model. Claude Code: status line wrapper file drop, plus `claude auth status`. Codex: rollout files, plus `codex app-server`.
- **Shared state:** a `UsageService` merges the adapter updates, logs history and pushes state to the renderer over typed IPC.
- **Renderer:** a sandboxed React + Tailwind UI that only renders the state, with all logic in `src/shared/` (pure, tested).

**Tech Stack:** Electron, electron-vite, electron-builder (NSIS), React, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Vitest, ESLint (typescript-eslint), `@fontsource/outfit`, `@fontsource/hanken-grotesk`.

**Spec:** `docs/superpowers/specs/2026-11-05-phase0-usage-design.md`. Read it before starting any task; the chosen mockup is `.superpowers/brainstorm/474-1793878794/content/usage-layout.html` (option B).

## Global Constraints

- Windows only. Rules in `AGENTv2.md` apply; app logic in `src/main/services/`, IPC handlers in `src/main/ipc/`.
- Every BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Preload exposes only the typed `ArkApi` (Task 2), never `ipcRenderer`/`fs`.
- Every IPC payload is validated in main; channels are named by domain (`usage:get`, …).
- No OAuth token or credential file is ever read. No undocumented endpoints. Agent files are read-only, except `~/.claude/settings.json` and only on explicit Connect/Disconnect (Task 5).
- Runtime data only under `app.getPath('userData')`.
- Brand: Primary `#0E1013`, Secondary `#FAFAF9`, Accent `#00A896` (CTAs only: Refresh, Connect status line), Dark neutral `#2C2F36`, Light neutral `#DEE1E6`. Headings Outfit 600, body Hanken Grotesk 400, fonts bundled locally. Spacing 8/16/24/40/64/104 px, radius 2–4 px. No stock icons, no textures. Raw hex only in the Tailwind `@theme` block.
- UI copy in English; tone orderly, quiet, exact.
- Times: `resetsAt` is epoch **seconds**; `lastSeen`/`updatedAt` are epoch **milliseconds**.
- Windows are identified by `minutes` (300 = 5-hour, 10080 = weekly), never by position.
- Commit after each task; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. User's `~/.claude/settings.json` has many other keys → Connect/Disconnect must leave every other key untouched (Task 5 test `preserves other keys`).
2. `settings.json` is not valid JSON → Connect refuses and writes nothing (Task 5 test `refuses invalid settings`).
3. Status line stdin is not JSON, or `session_id` is `../../x` → the wrapper writes no file outside the drop dir and still prints the user's original line (Task 4 tests).
4. Codex is mid-write, so the last rollout line is truncated JSON → the parser skips that line and uses the previous `token_count` (Task 6 test `skips truncated line`).
5. Claude session before its first response (no `rate_limits`), or a Claude session using an API key → the session row still appears, there are no window bars, and cost is shown (Task 3 test `payload without rate_limits`).

---

### Task 1: Scaffold the Electron app with the brand theme

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `eslint.config.js`, `electron-builder.yml`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/index.css`
- Modify: `.gitignore` (add `out/`, `dist/`)

**Interfaces:**
- Produces: scripts `dev`, `build`, `typecheck`, `lint`, `test`, `dist`; alias `@shared` → `src/shared` in main, preload, renderer and Vitest.

- [ ] **Step 1: Install dependencies.** Runtime: `react react-dom @fontsource/outfit @fontsource/hanken-grotesk`. Dev: `electron electron-vite vite @vitejs/plugin-react typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest eslint typescript-eslint eslint-plugin-react-hooks electron-builder tsx` (`tsx` is used for the one-off live checks). Pin `vite` to the major that `npm view electron-vite peerDependencies` accepts. No `"type": "module"` in `package.json`: the sandboxed preload must build as CommonJS. Set `"main": "out/main/index.js"`.
- [ ] **Step 2: Add the scripts.** `dev: electron-vite dev`, `build: electron-vite build`, `typecheck: tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`, `lint: eslint .`, `test: vitest run`, `dist: npm run build && electron-builder --win`. In `vitest.config.ts`, include `tests/**/*.test.ts`, use the `node` environment and set `passWithNoTests: true`. In `tsconfig.node.json`, cover `src/main`, `src/preload`, `src/shared` and `tests`. In `tsconfig.web.json`, cover `src/renderer` and `src/shared`.
- [ ] **Step 3: Set up the main window.** In `src/main/index.ts`, create a window of 1200×760, minimum 960×600, `backgroundColor: '#0E1013'`, with the security flags from Global Constraints. Use `setWindowOpenHandler(() => ({ action: 'deny' }))` and `preventDefault` on `will-navigate`.
- [ ] **Step 4: Set up the renderer shell.** `index.html` carries the CSP meta `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:`. `main.tsx` imports `@fontsource/outfit/600.css`, `@fontsource/hanken-grotesk/400.css` and `./index.css`. `App.tsx` renders the heading "Ark" (`font-heading`) on `bg-primary text-secondary`.
- [ ] **Step 5: Add the theme tokens to `src/renderer/index.css`** (the only place with raw values):

```css
@import "tailwindcss";
@theme {
  --color-primary: #0E1013;   --color-secondary: #FAFAF9;  --color-accent: #00A896;
  --color-neutral-dark: #2C2F36; --color-neutral-light: #DEE1E6;
  --font-heading: "Outfit", sans-serif;  --font-body: "Hanken Grotesk", sans-serif;
  --spacing: 8px;            /* use only multipliers 1,2,3,5,8,13 = 8,16,24,40,64,104px */
  --radius-sm: 2px; --radius: 4px;
}
body { @apply bg-primary text-secondary font-body; font-variant-numeric: tabular-nums; }
h1, h2, h3, h4 { @apply font-heading; font-weight: 600; }
```

- [ ] **Step 6: Configure packaging.** `electron-builder.yml`: `appId: dev.ark.app`, `productName: Ark`, `win.target: nsis`, `extraResources: [{ from: resources/statusline-wrapper.cjs, to: statusline-wrapper.cjs }]`, `files: [out/**]`.
- [ ] **Step 7: Verify.** Run `npm run typecheck && npm run lint && npm test && npm run build`: all exit 0. Then run `npm run dev`: a dark window shows "Ark" in Outfit, and DevTools reports no CSP errors.
- [ ] **Step 8: Commit** (`chore: scaffold electron app with brand theme`).

---

### Task 2: Shared types and usage math

**Files:**
- Create: `src/shared/types.ts`, `src/shared/usage-math.ts`
- Test: `tests/shared/usage-math.test.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`), exactly:

```ts
export type AgentId = 'claude' | 'codex' | 'opencode';
export type UsageWindow = { usedPct: number; resetsAt: number; minutes: number };
export type Account = { loggedIn: boolean; method: 'subscription' | 'apiKey' | 'unknown'; email?: string; plan?: string };
export type AgentStatus = { id: AgentId; installed: boolean; version?: string; path?: string; account?: Account;
  fiveHour?: UsageWindow; weekly?: UsageWindow; updatedAt?: number };
export type Session = { id: string; agent: AgentId; project: string; cwd: string; model?: string;
  contextUsed?: number; contextSize?: number; contextPct?: number; tokens?: number; costUsd?: number; lastSeen: number };
export type UsageState = { agents: AgentStatus[]; sessions: Session[] };
export type StatuslineStatus = 'connected' | 'disconnected' | 'bypassed';
export type ViewMode = 'compact' | 'detailed';
export type HistoryDay = { day: string; agent: AgentId; peakFiveHourPct?: number; weeklyEndPct?: number;
  sessions: { id: string; project: string; peakContextPct: number }[] };
export interface ArkApi {
  usage: { get(): Promise<UsageState>; refresh(): Promise<UsageState>; onChanged(cb: (s: UsageState) => void): () => void };
  history: { get(): Promise<HistoryDay[]> };
  statusline: { status(): Promise<StatuslineStatus>; connect(): Promise<StatuslineStatus>; disconnect(): Promise<StatuslineStatus> };
  settings: { getView(): Promise<ViewMode>; setView(v: ViewMode): Promise<void> };
}
```

- Produces (`src/shared/usage-math.ts`):
  - `pickWindows(ws: UsageWindow[]): { fiveHour?: UsageWindow; weekly?: UsageWindow }`: picks by `minutes` (300 / 10080).
  - `mergeWindow(cur?: UsageWindow, next?: UsageWindow): UsageWindow | undefined`: keeps the later `resetsAt`; when they are equal, `next` wins.
  - `windowView(w: UsageWindow | undefined, nowMs: number): { kind: 'none' } | { kind: 'reset' } | { kind: 'live'; pct: number; resetIn: number; pace?: number }`: `resetIn` is in seconds. `pace` only when `minutes === 10080`: `pace = clamp(0,100, (1 − (resetsAt − now)/(minutes·60))·100)`.
  - `sessionState(lastSeen: number, nowMs: number): 'active' | 'idle' | 'recent' | 'gone'`, with thresholds `< 30 min`, `< 12 h`, `< 7 days`, else gone.
  - `formatDuration(sec: number): string` → `"12m"`, `"1h 52m"`, `"4d 6h"`.
  - `formatAge(ms: number): string` → `"12s"`, `"3m"`, `"1h 10m"`.
  - Constants: `HANDOFF_TICK = 50`, `IDLE_MS = 30*60e3`, `RECENT_MS = 12*3600e3`, `KEEP_MS = 7*86400e3`.

- [ ] **Step 1: Write the failing tests** in `tests/shared/usage-math.test.ts`:

```ts
const NOW = 1_793_878_800_000; const S = NOW / 1000;
test('pickWindows by duration, weekly as primary', () => {
  const w = pickWindows([{ usedPct: 71, resetsAt: S + 1, minutes: 10080 }, { usedPct: 21, resetsAt: S + 2, minutes: 300 }]);
  expect(w.fiveHour?.usedPct).toBe(21); expect(w.weekly?.usedPct).toBe(71);
});
test('mergeWindow keeps later reset, ties go to next', () => {
  const a = { usedPct: 40, resetsAt: S + 100, minutes: 300 }, old = { usedPct: 90, resetsAt: S - 100, minutes: 300 };
  expect(mergeWindow(a, old)).toBe(a);
  expect(mergeWindow(a, { ...a, usedPct: 45 })?.usedPct).toBe(45);
  expect(mergeWindow(undefined, a)).toBe(a);
});
test('windowView: reset when past, pace on weekly only', () => {
  expect(windowView({ usedPct: 62, resetsAt: S - 1, minutes: 300 }, NOW)).toEqual({ kind: 'reset' });
  const wk = windowView({ usedPct: 38, resetsAt: S + 4 * 86400 + 6 * 3600, minutes: 10080 }, NOW);
  expect(wk).toMatchObject({ kind: 'live', pct: 38, resetIn: 4 * 86400 + 6 * 3600 });
  expect((wk as { pace: number }).pace).toBeCloseTo(39.29, 1);
  expect(windowView({ usedPct: 5, resetsAt: S + 60, minutes: 300 }, NOW)).not.toHaveProperty('pace');
  expect(windowView(undefined, NOW)).toEqual({ kind: 'none' });
});
test('sessionState thresholds', () => {
  expect(sessionState(NOW - 29 * 60e3, NOW)).toBe('active');
  expect(sessionState(NOW - 31 * 60e3, NOW)).toBe('idle');
  expect(sessionState(NOW - 13 * 3600e3, NOW)).toBe('recent');
  expect(sessionState(NOW - 8 * 86400e3, NOW)).toBe('gone');
});
test('formatting', () => {
  expect(formatDuration(12 * 60)).toBe('12m'); expect(formatDuration(6720)).toBe('1h 52m');
  expect(formatDuration(4 * 86400 + 6 * 3600)).toBe('4d 6h'); expect(formatAge(4_200_000)).toBe('1h 10m');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/shared`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/shared/types.ts` and `src/shared/usage-math.ts` as specified.
- [ ] **Step 4: Run** `npx vitest run tests/shared && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`feat: shared usage model and math`).

---

### Task 3: Command helper and Claude Code adapter

**Files:**
- Create: `src/main/services/exec.ts`, `src/main/services/adapters/types.ts`, `src/main/services/adapters/claude.ts`
- Test: `tests/main/claude.test.ts`, `tests/fixtures/claude-statusline.json`, `tests/fixtures/claude-auth.json`

**Interfaces:**
- Consumes: Task 2 types, `pickWindows`.
- Produces:
  - `exec.ts`:
    - `which(cmd: string): Promise<string | undefined>`: first line of `where.exe cmd`.
    - `run(file: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string }>`: `execFile` with `windowsHide`, and `shell: true` only when `file` ends in `.cmd`/`.bat`.
    - `detect(cmd: string): Promise<{ installed: boolean; path?: string; version?: string }>`: version = first `\d+\.\d+\.\d+` in `--version` output.
  - `adapters/types.ts`:

```ts
export type AdapterUpdate = { agent: AgentId; windows?: UsageWindow[]; session?: Session; account?: Account };
export interface Adapter {
  id: AgentId;
  detect(): Promise<{ installed: boolean; path?: string; version?: string }>;
  account(): Promise<Account | undefined>;
  refresh(): Promise<UsageWindow[]>;            // [] when the agent has no live source
  start(emit: (u: AdapterUpdate) => void): Promise<void>;
  stop(): void;
}
```

  - `claude.ts`:
    - `parseStatusline(raw: unknown, seenAt: number): { session: Session; windows: UsageWindow[] } | undefined`: undefined when `session_id` is missing.
    - `parseAuthStatus(raw: unknown): { account: Account; configDir?: string }`: `authMethod === 'claude.ai'` → subscription; matches `/api/i` → apiKey; otherwise unknown. `plan = subscriptionType`, `configDir = configDirectory`.
    - `createClaudeAdapter(opts: { dropDir: string; now?: () => number }): Adapter`. `start()` creates `dropDir`, deletes files with mtime older than 30 days, emits one update per remaining file (`seenAt` = file mtime), then `fs.watch`es the dir and emits on each change (`seenAt` = now). Unparseable files are ignored. `refresh()` returns `[]`. `account()` runs `claude auth status`.
  - `project` = `path.win32.basename(workspace.project_dir ?? cwd)`. `contextUsed = round(used_percentage/100 · context_window_size)`. Windows: `five_hour` → minutes 300, `seven_day` → minutes 10080.

- [ ] **Step 1: Write the fixtures and failing tests.** `claude-statusline.json` = `{"session_id":"abc-123","cwd":"D:\\DEVS\\ark","workspace":{"current_dir":"D:\\DEVS\\ark","project_dir":"D:\\DEVS\\ark"},"model":{"id":"claude-opus-5-5","display_name":"Opus 5.5"},"cost":{"total_cost_usd":1.25},"context_window":{"context_window_size":200000,"used_percentage":46},"rate_limits":{"five_hour":{"used_percentage":62,"resets_at":1793900000},"seven_day":{"used_percentage":38,"resets_at":1794200000}}}`. `claude-auth.json` = `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"dev@example.com","subscriptionType":"team","configDirectory":"C:\\Users\\dev\\.claude"}`. Tests:
  - `parses statusline`: session `{ id:'abc-123', agent:'claude', project:'ark', model:'Opus 5.5', contextSize:200000, contextPct:46, contextUsed:92000, costUsd:1.25, lastSeen: seenAt }`. Windows `[{usedPct:62,resetsAt:1793900000,minutes:300},{usedPct:38,resetsAt:1794200000,minutes:10080}]`.
  - `payload without rate_limits` (Review Focus 5): delete `rate_limits` → `windows` is `[]`, session still returned with `costUsd: 1.25`.
  - `missing session_id` → `undefined`.
  - `parses auth status` → `{ account: { loggedIn:true, method:'subscription', email:'dev@example.com', plan:'team' }, configDir:'C:\\Users\\dev\\.claude' }`. With `authMethod:'api_key'`, method is `'apiKey'`.
  - `adapter ingests and prunes drop dir` (temp dir): `a.json` (fixture) and `old.json` with mtime set 31 days back via `fs.utimesSync`. After `start(emit)`, `emit` is called once with `session.id === 'abc-123'` and `old.json` no longer exists.
- [ ] **Step 2: Run** `npx vitest run tests/main/claude.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `exec.ts`, `adapters/types.ts`, `claude.ts` as specified.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then run `npx tsx -e "import('./src/main/services/exec.ts').then(m=>m.detect('claude')).then(console.log)"`. Expected: `installed: true, version: '2.1.318'` on the dev machine.
- [ ] **Step 5: Commit** (`feat: claude code adapter`).

---

### Task 4: Status line wrapper script

**Files:**
- Create: `resources/statusline-wrapper.cjs` (plain Node, no dependencies, CommonJS)
- Test: `tests/main/statusline-wrapper.test.ts`

**Interfaces:**
- Produces: a script that lives at `<userData>/statusline-wrapper.cjs` and reads `<same dir>/statusline-original.json` = `{ "originalCommand": string | null }`. Behaviour:
  1. Read all of stdin.
  2. `try`: parse it. If `session_id` matches `/^[A-Za-z0-9_-]{1,128}$/`, write `<dir>/claude/sessions/<id>.json.tmp`, then rename it to `.json` (creating the dirs). On any error, continue.
  3. If `originalCommand` is set: `spawnSync(originalCommand, { input: stdin, shell: process.env.SHELL || true, encoding: 'utf8', timeout: 5000, windowsHide: true })` and write its stdout unchanged. Otherwise print `` `${model.display_name} · ctx ${ctx}% · 5h ${fh}% · wk ${wk}%` ``, omitting the parts that are missing.
  4. Always `process.exit(0)`.

- [ ] **Step 1: Write the failing tests.** Each test copies the wrapper into a fresh temp dir. The original command is `node "<tmp>/orig.cjs"`, where `orig.cjs` prints `ORIG:` + stdin length. Run the wrapper with `spawnSync(process.execPath, [wrapper], { input })`.
  - `drops payload and passes original through`: stdout starts with `ORIG:`; `claude/sessions/abc-123.json` equals the input.
  - `still runs original when drop fails`: create `claude/sessions` as a **file**; stdout still starts with `ORIG:`; exit 0.
  - `rejects unsafe session id` (Review Focus 3): `session_id: '../../x'` → no file anywhere in the temp dir except the originals; stdout starts with `ORIG:`.
  - `non-JSON stdin` → stdout starts with `ORIG:`; exit 0.
  - `minimal line without original`: `originalCommand: null` with the Task 3 fixture → stdout `Opus 5.5 · ctx 46% · 5h 62% · wk 38%`.
- [ ] **Step 2: Run** `npx vitest run tests/main/statusline-wrapper.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `resources/statusline-wrapper.cjs`. Comment why each step can't fail the status line.
- [ ] **Step 4: Run** the tests. Expected: PASS. Time one run with `Measure-Command`; it should stay under ~150 ms over the bare `node orig.cjs` run.
- [ ] **Step 5: Commit** (`feat: claude status line wrapper`).

---

### Task 5: Connect / disconnect the status line

**Files:**
- Create: `src/main/services/statusline.ts`
- Test: `tests/main/statusline.test.ts`

**Interfaces:**
- Consumes: Task 2 `StatuslineStatus`.
- Produces:

```ts
export type StatuslinePaths = { claudeSettings: string; userData: string; wrapperSource: string;
  runner: { kind: 'node' } | { kind: 'electron'; exe: string } };
export function buildCommand(runner: StatuslinePaths['runner'], wrapperPath: string): string;
export function statuslineStatus(p: StatuslinePaths): StatuslineStatus;
export function connectStatusline(p: StatuslinePaths): StatuslineStatus;
export function disconnectStatusline(p: StatuslinePaths): StatuslineStatus;
```

- State file `<userData>/statusline-original.json` = `{ originalCommand: string | null, ourCommand: string, backupPath: string }`. The wrapper reads only `originalCommand`.
- `buildCommand`: node → `node "<wrapper>"`; electron → `ELECTRON_RUN_AS_NODE=1 "<exe>" "<wrapper>"`. Paths use forward slashes.
- Status:
  - `connected`: `settings.statusLine?.command === state.ourCommand`.
  - `bypassed`: the state file exists, but the command differs.
  - `disconnected`: there is no state file.
- `connectStatusline` does, in order:
  1. Parse the settings, or start from `{}` if the file is missing. If the file is invalid JSON, **throw before writing anything**.
  2. Back up the file to `<userData>/backups/claude-settings-<epochMs>.json`.
  3. Copy `wrapperSource` to `<userData>/statusline-wrapper.cjs`.
  4. Write the state file, with `originalCommand` = the current `statusLine.command` or `null`.
  5. Set `statusLine = { type: 'command', command: ourCommand }` (keeping any other `statusLine` fields) and write atomically (tmp + rename) with 2-space indent.
- `disconnectStatusline`:
  - when `connected`: restore `originalCommand`, or delete `statusLine` if it was null;
  - when `bypassed`: don't touch the settings;
  - in both cases delete the state file.

- [ ] **Step 1: Write the failing tests** (temp dirs, `runner: { kind: 'node' }`):
  - `connect wraps existing command`: settings `{ statusLine: { type:'command', command:'node C:/x/statusline.js' } }` → status `connected`; the state's `originalCommand === 'node C:/x/statusline.js'`; the wrapper is copied; one backup exists.
  - `preserves other keys` (Review Focus 1): settings with `{ model:'opus', hooks:{ a:1 }, permissions:{ allow:['x'] } }` → after connect and after disconnect, those keys deep-equal the originals.
  - `disconnect restores original`: settings `statusLine.command` is back to `'node C:/x/statusline.js'`; status `disconnected`.
  - `connect without existing statusLine` → `originalCommand: null`; disconnect removes the `statusLine` key.
  - `bypassed when user changed it`: after connect, the user edits the command → `bypassed`; disconnect leaves the user's command intact.
  - `refuses invalid settings` (Review Focus 2): settings file `{ not json` → `connectStatusline` throws; the settings bytes are unchanged; there is no state file.
  - `buildCommand electron`: `buildCommand({kind:'electron', exe:'C:\\A b\\Ark.exe'}, 'C:\\u\\w.cjs')` === `'ELECTRON_RUN_AS_NODE=1 "C:/A b/Ark.exe" "C:/u/w.cjs"'`.
- [ ] **Step 2: Run** `npx vitest run tests/main/statusline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `statusline.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** (`feat: connect and disconnect claude status line`).

---

### Task 6: Codex adapter (rollouts and app-server) and OpenCode detection

**Files:**
- Create: `src/main/services/adapters/codex.ts`, `src/main/services/adapters/codex-appserver.ts`, `src/main/services/adapters/opencode.ts`
- Test: `tests/main/codex.test.ts`, `tests/fixtures/codex-rollout.jsonl`

**Interfaces:**
- Consumes: `Adapter`, `AdapterUpdate` (Task 3), `exec.ts` (Task 3), Task 2 types.
- Produces:
  - `parseRollout(lines: string[], seenAt: number): { session?: Session; windows: UsageWindow[] }`:
    - `session_meta.payload` → `id`, `cwd`, `project` = `path.win32.basename(cwd)`;
    - the last `turn_context.payload.model` → `model`;
    - the last `event_msg` with `payload.type === 'token_count'` → `contextSize = info.model_context_window`, `contextUsed = info.last_token_usage.total_tokens`, `tokens = info.total_token_usage.total_tokens`, `contextPct = codexContextPct(...)`, and windows from `rate_limits.primary/secondary` (`used_percent`, `resets_at`, `window_minutes`).
    - Unparseable lines are skipped.
  - `codexContextPct(used: number, window: number): number = clamp(0,100, round((used − 12000)/(window − 12000)·100))`. **Check this against the Codex source for v0.165.0** (`percent_of_context_window_remaining`, baseline tokens). If it differs, use Codex's formula and update the test value.
  - `createCodexAdapter(opts: { sessionsDir: string; codexPath?: string; pollMs?: number; now?: () => number }): Adapter`.
    - `start()`: for every `rollout-*.jsonl` under `sessionsDir` (recursive) with mtime within 7 days, read the first line plus the last 1 MB and emit `parseRollout`.
    - Every `pollMs` (default 5000), re-read the files with mtime within 30 minutes from their stored byte offset, and emit when a new `token_count`/`turn_context` arrives.
    - `account()`: `codex login status` → `"Logged in using ChatGPT"` = subscription; `/API key/i` = apiKey; a non-zero exit or `/not logged in/i` = `loggedIn:false`. The `plan` comes from the latest `rate_limits.plan_type`, or from app-server when it has one.
    - `refresh()` = `readCodexRateLimits`.
  - `codex-appserver.ts`: `readCodexRateLimits(codexPath: string, timeoutMs = 10000): Promise<UsageWindow[]>` and `parseRateLimitsResult(result: unknown): UsageWindow[]`. It spawns `codex app-server` (stdio JSON-RPC), sends `initialize` and then `account/rateLimits/read`, and kills the child process. Before writing it, run `codex app-server generate-ts --out .tmp/codex-schema` and take the exact message, method and field names from the generated types. Return `[]` on any error or timeout (never throw to the UI).
  - `opencode.ts`: `createOpencodeAdapter(): Adapter`. Only `detect('opencode')`; `account()` → `undefined`; `refresh()` → `[]`; `start`/`stop` do nothing.

- [ ] **Step 1: Write the fixture and failing tests.** `codex-rollout.jsonl` has 4 lines:
  1. `{"type":"session_meta","payload":{"id":"01a1","cwd":"D:\\ICPN\\proj","cli_version":"0.165.0"}}`
  2. `{"type":"turn_context","payload":{"cwd":"D:\\ICPN\\proj","model":"gpt-5.6-sol"}}`
  3. the `token_count` line recorded in spec §5.2 (`last_token_usage.total_tokens` 108875, `model_context_window` 258400, `total_token_usage.total_tokens` 1116235, primary 48%/300/1793714251, secondary 16%/10080/1793988408)
  4. a truncated line `{"type":"event_msg","payload":{"type":"tok`

  Tests:
  - `parses rollout`: session `{ id:'01a1', agent:'codex', project:'proj', model:'gpt-5.6-sol', contextSize:258400, contextUsed:108875, tokens:1116235, contextPct:39 }`; windows `[{usedPct:48,resetsAt:1793714251,minutes:300},{usedPct:16,resetsAt:1793988408,minutes:10080}]`.
  - `skips truncated line` (Review Focus 4): the same result as above, with no throw.
  - `parseRateLimitsResult`: a fixture object shaped like the generated response type, with the weekly window first → 2 windows, each with the correct `minutes`.
  - `adapter emits on append`: write lines 1–2 to `<tmp>/2026/11/05/rollout-x.jsonl`, `start(emit)` with `pollMs: 50`, append line 3, wait 200 ms → `emit` is called with `session.contextPct === 39`.
- [ ] **Step 2: Run** `npx vitest run tests/main/codex.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files as specified.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then call `readCodexRateLimits` once against the installed Codex with `npx tsx -e …`. Expected: two windows (300 and 10080) with plausible values.
- [ ] **Step 5: Commit** (`feat: codex adapter and opencode detection`).

---

### Task 7: History store

**Files:**
- Create: `src/main/services/history.ts`
- Test: `tests/main/history.test.ts`

**Interfaces:**
- Consumes: Task 2 types.
- Produces: a `HistoryStore` class: `constructor(file: string, now: () => number = Date.now)`.
  - `recordAgent(a: AgentStatus): void`:
    - appends `{"kind":"agent","t":ms,"agent":id,"fiveHourPct":n?,"weeklyPct":n?}`;
    - only when one of the two values changed since the last line for that agent;
    - at most once every 5 minutes per agent.
  - `recordSession(s: Session): void`:
    - appends `{"kind":"session","t":ms,"agent":id,"id":sid,"project":p,"contextPct":n?,"tokens":n?,"costUsd":n?}`;
    - only on a change of those values;
    - at most once every 5 minutes per session.
  - `prune(): void` rewrites the file without lines older than 30 days.
  - `days(): HistoryDay[]` covers the last 7 local calendar days (`YYYY-MM-DD`), one entry per agent per day that has data:
    - `peakFiveHourPct` = the max over that day;
    - `weeklyEndPct` = the last value of the day;
    - `sessions` = the peak `contextPct` per session.
  - Comment the throttle with `// ponytail: changes inside the 5-min throttle are dropped, a peak can be missed by ≤5 min; buffer the latest value if that matters.`

- [ ] **Step 1: Write the failing tests** (temp file, controllable `now`):
  - `throttles and dedupes`: record 62% at t0, 63% at t0+1 min, 63% at t0+6 min, 64% at t0+7 min → the file has 2 agent lines (62 and 64).
  - `days aggregates`: agent lines 40/70/55 five-hour and weekly 30→33 on one day, plus session lines 20/48/35 → `peakFiveHourPct 70`, `weeklyEndPct 33`, the session's `peakContextPct 48`.
  - `prune drops >30 days`: a line at now−31 days is gone and a line at now−29 days stays.
  - `ignores corrupt lines`: a garbage line in the file → `days()` still works.
- [ ] **Step 2: Run** `npx vitest run tests/main/history.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `history.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** (`feat: usage history store`).

---

### Task 8: Usage service, settings, IPC, preload, main wiring

**Files:**
- Create: `src/main/services/usage.ts`, `src/main/services/settings.ts`, `src/main/ipc/index.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/renderer/env.d.ts` (`declare global { interface Window { ark: ArkApi } }`)
- Test: `tests/main/usage.test.ts`

**Interfaces:**
- Consumes: `Adapter`/`AdapterUpdate` (Task 3), the three adapters (Tasks 3 and 6), `HistoryStore` (Task 7), `statusline.ts` (Task 5), and `pickWindows`/`mergeWindow`/`KEEP_MS` (Task 2).
- Produces:
  - `UsageService`:
    - `constructor(adapters: Adapter[], history: HistoryStore, now: () => number = Date.now)`.
    - `start(): Promise<void>`: detect + account for each adapter, then `adapter.start(u => this.apply(u))`, then `history.prune()`.
    - `refresh(): Promise<UsageState>`: re-runs detect, account and `adapter.refresh()`, then applies the windows.
    - `get(): UsageState`; `onChanged(cb): () => void`.
    - `apply(u: AdapterUpdate): void`:
      - windows go through `pickWindows`, then `mergeWindow` per slot;
      - `updatedAt = now`;
      - sessions are upserted by `agent:id`, with the larger `lastSeen` winning;
      - sessions older than `KEEP_MS` are dropped;
      - calls `history.recordAgent`/`recordSession`, then notifies.
    - `stop(): void`.
  - `settings.ts`: `readView(userData: string): ViewMode` (default `'compact'`) and `writeView(userData: string, v: ViewMode): void`, stored in `<userData>/settings.json`.
  - IPC channels:
    - invoke: `usage:get`, `usage:refresh`, `history:get`, `statusline:status`, `statusline:connect`, `statusline:disconnect`, `settings:get-view`, `settings:set-view` (rejects anything other than `'compact'|'detailed'`);
    - event: `usage:changed`.
    - Account data travels inside `AgentStatus`, so there is no separate `accounts:get`.
  - The preload implements `ArkApi` with `contextBridge.exposeInMainWorld('ark', api)`. `onChanged` wraps `ipcRenderer.on`/`removeListener` and returns the unsubscribe function.
  - The main wiring decides the paths:
    - drop dir `<userData>/claude/sessions`;
    - Codex `sessionsDir` = `$CODEX_HOME/sessions` or `~/.codex/sessions`;
    - Claude settings = `<configDir from claude auth status>/settings.json`, falling back to `~/.claude/settings.json`;
    - `runner` = `node` if `which('node')`, else `{ kind:'electron', exe: process.execPath }`;
    - `wrapperSource` = `app.isPackaged ? join(process.resourcesPath,'statusline-wrapper.cjs') : join(app.getAppPath(),'resources/statusline-wrapper.cjs')`.

- [ ] **Step 1: Write the failing tests** with fake adapters and a temp `HistoryStore`:
  - `stale window ignored`: apply a 5-hour window with `resetsAt` S+100, then one with S−100 → state keeps the S+100 value.
  - `weekly as primary`: apply `[weekly, fiveHour]` → slots are correct.
  - `session upsert keeps newer`: apply `lastSeen` 2000, then 1000 → state has 2000.
  - `drops sessions older than 7 days` → absent from `get().sessions`.
  - `notifies and records`: `onChanged` is called once per `apply`; the history file gains a line.
- [ ] **Step 2: Run** `npx vitest run tests/main/usage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `usage.ts`, `settings.ts`, `ipc/index.ts`, the preload, the wiring in `src/main/index.ts` and `env.d.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS. Then run `npm run dev` and, in DevTools, `await window.ark.usage.get()`: it shows Claude and Codex installed, OpenCode not installed, and Codex sessions from the last 7 days.
- [ ] **Step 5: Commit** (`feat: usage service, ipc and preload api`).

---

### Task 9: Usage screen (compact and detailed) and status bar

**Files:**
- Create: `src/renderer/hooks/useUsage.ts`, `src/renderer/components/Bar.tsx`, `src/renderer/components/AgentTag.tsx`, `src/renderer/components/StatusBar.tsx`, `src/renderer/pages/Usage.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `window.ark` (Task 8), `windowView`, `sessionState`, `formatDuration`, `formatAge`, `HANDOFF_TICK` (Task 2).
- Produces:
  - `useUsage(): { state: UsageState | null; refresh(): Promise<void>; now: number }`: subscribes to `onChanged`; `now` ticks every 30 s.
  - `<Bar pct?: number; ticks?: number[]; dim?: boolean />`: a track `bg-neutral-dark`, a fill `bg-neutral-light`, ticks of 2 px `bg-secondary` extending 4 px above and below, height 8 px (`h-1`), `rounded-sm`.
  - `<AgentTag id />`: a monogram `CC` / `CX` / `OC` in `font-heading`, with no logo.
  - `<StatusBar state now />`: one segment per installed agent, `Name  5h NN% · {formatDuration}   week NN% · {formatDuration}` (a reset window shows `reset`). In API-key mode it shows `tokens · $cost` instead. Background `bg-neutral-dark`, text 12 px.
  - `App` navigation, with no router library: `type Screen = { name:'usage' } | { name:'agent'; id: AgentId } | { name:'history' } | { name:'accounts' } | { name:'statusline' }`, with `onNavigate` passed down. `StatusBar` is always rendered at the bottom.
- Layout follows mockup option B: header (title "Usage", a Compact/Detailed toggle saved through `settings.setView`, and **Refresh** as the only accent element); the table columns are Session · Agent · model · Context · 5 hours · Week · Updated.
  - The context bar uses `ticks=[HANDOFF_TICK]`.
  - The week bar uses `ticks=[pace]`.
  - A `reset` window shows the text "reset · awaiting data" (dimmed).
  - An `idle` row is dimmed and shows `idle {formatAge}`.
  - `recent`/`gone` rows are not in this table.
- Under the table: agents with no active/idle session ("not installed", "waiting for a Claude Code response", or their window bars).
- Banner: when `statusline.status()` is not `connected`, show one line, "Claude Code sessions aren't reported yet.", plus a **Connect status line** CTA that navigates to `statusline`.
- Links: "Usage details & history" → `history`; "Manage accounts" → `accounts`; an agent name → `agent`.
- In API-key mode (`account.method === 'apiKey'`), the window columns show tokens/cost instead of bars.
- Detailed mode: agent cards on the left and session cards on the right (mockup option A), with the same components.

- [ ] **Step 1: Implement** the hook, the components, the page and the `App` navigation as specified, using only theme tokens and the spacing multipliers 1/2/3/5/8/13.
- [ ] **Step 2: Verify.** Run `npm run typecheck && npm run lint` (pass). Then run `npm run dev` with a live Codex session open: its row shows the context %, the 50% tick, both windows with reset times and the weekly pace tick. Toggle to Detailed and restart the app: the mode is kept. Refresh updates the "Updated" column. Compare side by side with the mockup option B.
- [ ] **Step 3: Commit** (`feat: usage screen and status bar`).

---

### Task 10: Agent detail, history, accounts, connect screen

**Files:**
- Create: `src/renderer/pages/AgentDetail.tsx`, `src/renderer/pages/History.tsx`, `src/renderer/pages/Accounts.tsx`, `src/renderer/pages/StatuslineConnect.tsx`
- Modify: `src/renderer/App.tsx` (route the 4 screens)

**Interfaces:**
- Consumes: `useUsage` and `Bar`/`AgentTag` (Task 9), `window.ark.history.get` and `window.ark.statusline.*` (Task 8).
- Content (spec §4.3–4.5, §5.1):
  - **AgentDetail:** version, path, account (method, email, plan), both windows with their reset times, and the sessions (`active`, `idle`, `recent`) with token/cost totals when present. Back link.
  - **History:** a table with one row per `HistoryDay`: Day · Agent · Peak 5h · Week (end of day) · Sessions (`project peak%`). No chart library.
  - **Accounts:** per agent: installed, logged in, method, email/plan. When not logged in, a copyable command: `claude` for Claude Code, `codex login` for Codex.
  - **StatuslineConnect:** explanation copy at max `65ch`, stating that Ark changes the `statusLine` entry in `~/.claude/settings.json`, backs up the file first, keeps the current status line running, and restores it on Disconnect. Plus one line: "Projects with their own statusLine in .claude/settings*.json won't report to Ark." Show the current status. Connect is the accent CTA; Disconnect is a plain button. Show any error from `connect()` (for example, invalid settings) as text.

- [ ] **Step 1: Implement** the four pages and the routing.
- [ ] **Step 2: Verify.** Run `npm run typecheck && npm run lint` (pass). Then run `npm run dev`:
  - Connect: `~/.claude/settings.json` now points to the wrapper and a backup exists in `<userData>/backups`.
  - Open a Claude Code session and send one message: its row appears with the context % and both windows, **and the user's own status line still renders in Claude Code**.
  - Disconnect: `settings.json` is back to `node C:/Users/zhouy/.claude/statusline.js`.
  - History lists today; Accounts shows both agents logged in.
- [ ] **Step 3: Commit** (`feat: agent detail, history, accounts and connect screens`).

---

### Task 11: Package and end-to-end check

**Files:**
- Modify: `README.md` (what Ark Phase 0 does, `npm install`, `npm run dev`, `npm run dist`, and the status line note)

- [ ] **Step 1: Run** `npm run typecheck && npm run lint && npm test && npm run dist`: all exit 0, and `dist/` contains the NSIS installer.
- [ ] **Step 2: Install and launch the packaged app.** Repeat the Task 10 Step 2 checks against the installed build. In particular, the wrapper is copied from `resources` and the Claude row appears.
- [ ] **Step 3: Check the Electron fallback.** Temporarily set `runner` to `{ kind:'electron', exe: process.execPath }` in a dev build. Confirm that Claude Code runs the command (this verifies how Claude Code on Windows invokes the status line shell, spec §5.1). If it doesn't work, write down what does and fix `buildCommand` and its test.
- [ ] **Step 4: Commit** (`docs: readme for phase 0`) and report the results.
