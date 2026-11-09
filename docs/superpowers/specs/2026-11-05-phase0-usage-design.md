# Ark Phase 0 - Agent detection and usage - Design

Date: 2026-11-05 · Source brief: `PROJECT.md` (Phase 0) · Visual rules: `brand-guidelines.md` · Working rules: `AGENTv2.md`

Items marked **[call]** are decisions made by the designer, not by the user. Everything else was decided by the user or comes from the brief.

## 1. Intent

The user codes heavily with several agents (today: Claude Code and Codex). They want one glance to answer two questions:

1. **How full is each open session's context?** Around 40–50% they decide, by themselves, to compact or hand off (restart the session from a single handoff file).
2. **How much is left of the 5-hour and weekly limits?** This tells them when to pause or when to start wrapping up with a handoff.

Ark only **shows** the numbers. The user makes the decisions.

## 2. Goals, non-goals, anti-goals

**Goals**
- Detect Claude Code, Codex and OpenCode on the machine.
- For every active session: agent, model, project, context used / context window, context %.
- For every agent: 5-hour and weekly window (% used, time to reset), logged-in account.
- Global status bar, always visible.
- Usage details & history.

**Non-goals (Phase 0)**
- No notifications or alerts (user decision).
- No automatic compact/handoff.
- No running agents from Ark: no chat, terminal, kanban or per-task costs (Phases 1–2).
- No multi-account switching. "Manage accounts" only shows which account is logged in (user decision).
- macOS/Linux.

**Anti-goals (a failure even if it technically works)**
- Breaking or replacing the user's existing Claude Code status line.
- Reading or storing OAuth tokens, or calling undocumented internal endpoints.
- Numbers that look precise but are stale or wrong without saying so: always show the data's age.
- Modifying the user's agent config files without their explicit consent.

## 3. Constraints

- Windows only. Node 24 / npm 11 are available on the dev machine.
- Installed today: Claude Code 2.1.318 (logged in via claude.ai), Codex CLI 0.165.0 (logged in via ChatGPT, team plan). OpenCode is **not** installed.
- Stack and structure from `AGENTv2.md`: Electron + React + Tailwind + TypeScript, electron-vite, electron-builder, the directory layout given there. App logic lives in `src/main/services/`.
- Electron security rules from `AGENTv2.md` apply as written: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a narrow typed `contextBridge` API, validated IPC payloads, a CSP, local content only.
- Runtime data goes in `app.getPath('userData')`, never in the install dir.

## 4. Screens

Visual reference: the mockup the user chose (option **B · Compact**), `.superpowers/brainstorm/474-1793878794/content/usage-layout.html`.

### 4.1 Main window - Usage (Compact is the default)
- Header: title "Usage", a Detailed / Compact toggle, and a **Refresh** button (the accent-coloured CTA).
- Table, one row per active session: session (project folder name), agent · model, **context** bar + %, **5-hour** bar + % + time to reset, **weekly** bar + % + time to reset.
- Context bar: a fixed tick at **50%** (the user's handoff threshold). **[call]** For now it's a constant; making it configurable is left for later.
- Weekly bar: a "pace" tick at the fraction of the current 7-day window already elapsed: `pace = 1 − (resets_at − now) / 7 days`. This is the "daily limit" the user described **[call]**. Being above or below pace never changes the colour.
- 5-hour and weekly values belong to the agent's account, so they repeat on every row of the same agent.
- "Updated Xs ago" shown per row (anti-goal: stale data).
- Below the table: the agents that have no active session (installed, not installed, waiting for data).
- Links: **Usage details & history**, **Manage accounts**.

### 4.2 Detailed mode
Agent cards on the left (5-hour and weekly bars), active sessions on the right (context bar). Same data as Compact. See option A in the mockup.

### 4.3 Agent detail (clicking an agent name)
Version and executable path, account (method, email or plan when available), both windows with their reset time, that agent's sessions (active and recent), session totals for tokens and cost when the agent reports them.

### 4.4 Usage details & history **[call]**
A simple table with no chart library: one row per day for the last 7 days and per agent, showing the peak 5-hour %, the weekly % at the end of the day, and the peak context % per session. Data comes from the snapshot log (§6.4).

### 4.5 Manage accounts
Read-only. For each agent: installed yes/no, logged in yes/no, method (subscription / API key), email/plan when the agent exposes them. If not logged in, show the login command to run (`claude`, `codex login`) as copyable text. Ark never logs in on the user's behalf.

### 4.6 Global status bar (always visible, bottom)
For each installed agent: `Name  5h NN% · time to reset   week NN% · time to reset`. With an API key (no windows), show tokens and cost instead.

### 4.7 Empty and edge states
- Not installed → "not installed" (dimmed row).
- Claude Code installed but no data yet → "Waiting for a Claude Code response" (limits only arrive after the session's first response, on Pro/Max plans).
- Status line not connected yet → a message plus a **Connect status line** CTA (see §5.1).
- API-key mode → no window bars; tokens and cost instead.
- Idle session **[call]**: after 30 minutes with no updates the row stays in the table, dimmed, with its age ("idle 1h 10m"). It moves to the recent sessions in the agent detail only after 12 hours without updates. Neither agent sends an "ended" signal, and an idle session is often exactly the one the user is deciding to hand off.
- Window past its `resets_at` **[call]** → "reset · awaiting data", dimmed, never the old %.

## 5. Data sources (adapters)

Each agent has an adapter in `src/main/services/adapters/` that maps everything to the common model (§6). Windows are always told apart by **duration**, never by their position in a response (open question in `PROJECT.md`: Codex can put the weekly window in "primary").

### 5.1 Claude Code
- **Detection:** `claude --version` resolved on PATH.
- **Account:** `claude auth status` prints JSON (`loggedIn`, `authMethod`, `apiProvider`, …).
- **Sessions and limits:** through the official status line. Verified fields in the user's own status line script: `context_window.context_window_size`, `context_window.used_percentage`, `rate_limits.five_hour.{used_percentage,resets_at}`, `rate_limits.seven_day.{used_percentage,resets_at}`. Also used: `session_id`, `cwd` / `workspace`, `model.display_name`, `cost.total_cost_usd`.
- **Integration without overwriting:** the user already has `statusLine = { "type": "command", "command": "node C:/Users/zhouy/.claude/statusline.js" }` in `~/.claude/settings.json`. Ark installs a small wrapper script that:
  1. reads the JSON from stdin;
  2. writes it, atomically, to `<userData>/claude/sessions/<session_id>.json` **[call: a file drop instead of an HTTP port, so it works while Ark is closed, needs no open port and no auth]**;
  3. runs the user's original command with the same stdin and passes its stdout through unchanged.

  If step 2 fails, step 3 still runs. The wrapper must add no noticeable delay.
- **No original status line [call]:** the wrapper prints a minimal line of its own: `model · ctx NN% · 5h NN% · wk NN%`.
- **Wrapper runtime [call]:** the wrapper is a JS file in `<userData>`. If `node` is on PATH when the user clicks Connect, the command runs it with `node`; otherwise it runs it with Ark's own executable in Node mode (`ELECTRON_RUN_AS_NODE=1`). The builder verifies how Claude Code on Windows invokes the command (which shell, how env vars are set) and measures the delay.
- **Project-level status lines [call]:** only the user-level `statusLine` gets wrapped. A project-level `.claude/settings*.json` with its own `statusLine` overrides it, and those sessions won't report to Ark. The Connect screen says so in one line. Ark doesn't scan or modify project files.
- **Consent:** the wrapper is installed only after the user clicks **Connect status line**. A screen explains exactly which file changes. Ark backs up `settings.json`, saves the original command in Ark's settings, and **Disconnect** restores it. If the user later changes their `statusLine`, Ark detects it and doesn't overwrite it again; it shows "status line disconnected" instead.
- **Not used in Phase 0:** headless `claude -p` / Agent SDK `rate_limit_event`. Ark doesn't drive sessions until Phase 1.

### 5.2 Codex
- **Detection:** `codex --version`.
- **Account:** `codex login status` (output: "Logged in using ChatGPT"). Email and plan come from `codex app-server` when it exposes them.
- **Limits:** `codex app-server` (JSON-RPC), `account/rateLimits/read` at startup and on **Refresh**. TypeScript types are generated from the installed version (`codex app-server generate-ts`), as `PROJECT.md` asks.
- **Sessions (context) - [call]:** sessions the user starts in their own terminal aren't visible to app-server. Ark therefore reads, **read-only**, the local rollout files `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Sample from this machine (Codex 0.165.0), last `token_count` event:
  ```json
  {"type":"event_msg","payload":{"type":"token_count",
    "info":{"total_token_usage":{...},"last_token_usage":{"input_tokens":101260,"cached_input_tokens":99200,"output_tokens":7615,"reasoning_output_tokens":1534,"total_tokens":108875},"model_context_window":258400},
    "rate_limits":{"primary":{"used_percent":48.0,"window_minutes":300,"resets_at":1793714251},
                   "secondary":{"used_percent":16.0,"window_minutes":10080,"resets_at":1793988408},
                   "plan_type":"team"}}}
  ```
  Session id, cwd and model come from the session's metadata line (the builder checks the exact shape). Context % uses Codex's own formula (the builder looks it up in the Codex source for this version) so it matches what the Codex CLI shows. These `rate_limits` also update the account windows between Refresh clicks, newest `resets_at`/timestamp wins.
- Only files touched in the last 30 minutes are tailed; reading is incremental (from the last offset).

### 5.3 OpenCode - [call]
Detection only (`opencode --version`) and the "not installed" state. The `opencode serve` adapter (tokens and cost per session; windows depend on the provider) is built once OpenCode is installed and can be tested. The adapter interface (§6) stays open to it.

### 5.4 API keys
No 5-hour or weekly windows. Show tokens, and cost where the agent reports it (Claude Code `cost.total_cost_usd`). **[call]** No price table for Codex in Phase 0: tokens only.

### 5.5 Excluded
Undocumented internal endpoints, and any reading of OAuth tokens or credential files.

## 6. Common model and main-process services

### 6.1 Types (illustrative)
```ts
type AgentId = 'claude' | 'codex' | 'opencode';
type Window = { usedPct: number; resetsAt: number /* epoch s */; minutes: number };
type AgentStatus = {
  id: AgentId; installed: boolean; version?: string; path?: string;
  account?: { loggedIn: boolean; method: 'subscription' | 'apiKey' | 'unknown'; email?: string; plan?: string };
  fiveHour?: Window; weekly?: Window; updatedAt?: number;
};
type Session = {
  id: string; agent: AgentId; project: string; cwd: string; model?: string;
  contextUsed?: number; contextSize?: number; contextPct?: number;
  tokens?: number; costUsd?: number; lastSeen: number;
};
```

### 6.2 Adapter contract
Each adapter exposes `detect()`, `account()`, `refresh()`, and pushes `AgentStatus` / `Session` updates. A single `usage` service merges them and broadcasts changes.

### 6.3 IPC (named by domain, payloads validated in main)
`usage:get`, `usage:refresh`, `usage:changed` (event main → renderer), `accounts:get`, `history:get`, `statusline:status`, `statusline:connect`, `statusline:disconnect`. The preload exposes only typed functions (e.g. `window.ark.usage.get()`), never `ipcRenderer`.

### 6.4 Persistence
`<userData>/settings.json` (view mode, status line backup info) and `<userData>/history.jsonl` **[call]**:
- `{"kind":"agent", ...}` lines: written whenever a window value changes, at most one every 5 minutes per agent.
- `{"kind":"session", ...}` lines: context %, tokens and cost, written whenever they change, at most one every 5 minutes per session.
- 30 days are kept, and older lines are pruned at startup. Claude session files in `<userData>/claude/sessions/` older than 30 days are deleted at the same time.
- "Recent sessions" means the last 7 days.
- History is only recorded while Ark is running. At startup Ark ingests the last value of each Claude session file and the last `token_count` of the Codex rollouts modified in the last 7 days (a read from the end of each file), so a closed-Ark gap shows as a single point, not as missing data.

## 7. Brand application

- Dark theme. Background Primary `#0E1013`; text Secondary `#FAFAF9`; borders and bar tracks Dark neutral `#2C2F36`; bar fills and secondary text Light neutral `#DEE1E6`; **Accent `#00A896` only on CTAs** (Refresh, Connect status line). Ticks use `#FAFAF9`.
- Headings: Outfit 600, one weight per heading. Body: Hanken Grotesk 400. Fonts are **bundled locally** (works offline). Numbers use tabular figures.
- Spacing scale 8 / 16 / 24 / 40 / 64 / 104 px; corner radius 2–4 px; an 8-column grid; alignment as the main decoration.
- No textures, no stock icons; icons never outnumber content. The agent "icon" is a text monogram in Outfit (CC, CX, OC) **[call]**, which avoids using the vendors' trademarked logos.
- Tone of the UI copy: orderly, quiet, exact. UI language: English **[call]**, since the target is the open-source community.
- All values are mapped to the Tailwind theme (colours, fonts, spacing, radius), so components never use raw hex values.

## 8. Verification

- `package.json` scripts: `typecheck`, `lint`, `test`, `build`, `dev`.
- Unit tests on fixtures: Claude status line JSON → model; Codex rollout lines → model; window ordering by duration (including weekly-as-primary); pace calculation; the status line wrapper still runs the original command when forwarding fails.
- Manual check in dev mode on this machine, with real data from a live Claude Code session and a live Codex session; connect / disconnect the status line and confirm the user's original status line still renders.
- Package with electron-builder (Windows NSIS) and launch the installed build once.

## 9. Left to the builder

File watching method, polling intervals, how app-server is launched and kept alive, the exact Codex metadata/context formula (verified against the installed version), table component details, test runner choice, and the window size and minimum size.

## 10. Open questions from `PROJECT.md` (status after this design)

- Codex windows sorted by duration: handled (sort by `window_minutes`).
- Status line integration without overwriting: handled by the wrapper with backup and restore (§5.1).
- `rate_limit_event` in headless mode: not needed in Phase 0, still to verify in Phase 1.
- Terms of use for automated CLI use with subscriptions: not relevant to Phase 0 (Ark only reads); still to verify in Phase 1.
