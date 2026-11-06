# Ark Phase 1, Step 1 — Engines and agent catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick an agent from a catalog and chat with it in a project folder, on Claude Code or Codex. The agent runs with its own role, its own model and **only its own skills**, and isolation is verified on both engines.

**Architecture:**
- **Shared:** the agent file format, pure and tested (`src/shared/agent-file.ts`).
- **Main:**
  - a skill index plus a private skill folder for each session;
  - launch rules: isolation flags, a cleaned environment, the model for each tier;
  - one session type per engine: a Claude Code stream-json process, and a Codex `app-server` speaking JSON-RPC;
  - an `AgentRunner` that turns an agent plus a folder into a running chat;
  - the catalog in `userData`, and the IPC.
- **Renderer:** the Agents screen, the agent form and the chat screen.

**Tech Stack:** the Phase 0 stack (Electron, electron-vite, React, TypeScript, Tailwind v4, Vitest, ESLint), plus one new dependency, `yaml`. It parses agent and skill frontmatter written by users and plugins, which uses YAML features a hand-written parser would get wrong.

**Spec:** `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md`. This step covers §5, §6.1–6.3 and §12 step 1. Read §5 and §6 before starting.

**Verified on this machine (2026-11-05), use as given:**
- **Claude Code 2.1.318: isolation flags.**
  - The flags are `-p --setting-sources project,local --strict-mcp-config --plugin-dir <dir>`, run with the environment variables listed in Task 3 removed.
  - The result: the subscription login stays; plugins are only `ark-agent` plus `path: "builtin"` ones; there are no MCP servers and no user hooks.
  - Skills are the `ark-agent:<folder>` ones plus 19 Claude Code built-ins, all unprefixed. The project `CLAUDE.md`, including its `@imports`, is still loaded.
  - `--safe-mode` is **not** usable: it also drops `--plugin-dir` skills.
  - Without the cleaned environment, Orca's `CLAUDE_CODE_PLUGIN_DIRS` injects a plugin that carries hooks.
- **Claude Code: chat protocol.** Run `--input-format stream-json --output-format stream-json --verbose` as one long-lived process.
  - Each user line has the shape `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`.
  - Every turn emits `system/init`, then `assistant` lines, then `result` (with `usage`). The session id is stable and memory carries across turns.
- **Codex 0.165.0: isolation.** Start `codex app-server --disable plugins --disable apps --disable hooks`, then:
  - `-c skills.config=[{path=…,enabled=false},…]` turns off every found skill for that session only;
  - `-c mcp_servers.<name>.enabled=false` turns off each MCP server (`config/read` then shows `enabled: false`);
  - `skills/extraRoots/set` adds the private folder;
  - `skills/list` then shows only the private skills enabled.
  - Nothing is written to `~/.codex`. `skills/config/write` **does** write there, so never call it.
- **Codex: chat protocol.**
  - `thread/start {model, cwd, approvalPolicy, sandbox, developerInstructions}`. The role in `developerInstructions` is honoured.
  - `turn/start {threadId, effort, input:[{type:"text", text, text_elements:[]}]}`.
  - Then the notifications `item/completed` (with `item.type === "agentMessage"`, `item.text`), `thread/tokenUsage/updated` (`tokenUsage.last`) and `turn/completed` (`turn.status`).
- **Codex: models.** `model/list` returns, newest first: `gpt-6.1-sol*` (default), `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`.
- **Plugins.** Installed plugins are listed in `<claudeConfigDir>/plugins/installed_plugins.json`: `{version: 2, plugins: {"<plugin>@<marketplace>": [{scope, installPath, version, projectPath?}]}}`. Plugin agents live in `<installPath>/agents/*.md`.

**Out of this step** (later steps, do not build):
- Projects and threads saved to disk, teams, and the 50% handoffs (step 2).
- Worktrees, build permissions and approval cards (step 3). In this step **every agent runs read-only**, whatever its `permissions` field says.
- The Auto rule table, the 90% switch and window costs (step 4). In this step `auto` means Claude at the agent's tier, or Codex when Claude is not installed.
- Claude `--effort`.
- Listing the engine's tolerated built-in skills on the agent card (spec §6.3). They are only known once a session starts; the live gate in Task 6 checks them.

**Deviation from the spec, decided here:** spec §5.3 seeds the reviewers with the skills `code-review` and `security-review`. Those are Claude Code built-ins with no files on disk, so they can't be copied to Codex (§5.5). The seeds use the installed equivalents instead: `agent-skills:code-review-and-quality` and `agent-skills:security-and-hardening`.

## Global Constraints

- All Phase 0 constraints still hold:
  - Windows only, with the rules in `AGENTv2.md`;
  - every window keeps `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, and the preload exposes only the typed `ArkApi`;
  - every IPC payload is validated in main;
  - runtime data goes only under `app.getPath('userData')`.
- **Never write to** `~/.claude`, `~/.codex` or `~/.agents`. Skill and agent files there are only read and copied. **Never read** `auth.json`, `.credentials.json` or any other credential file.
- **How engines are started:**
  - always with `cleanEnv(process.env)` (Task 3);
  - `.exe` files are never started through a shell, and `.cmd`/`.bat` ones go through `spawnCommand` (Task 4);
  - the Claude role prompt is passed as a file (`--append-system-prompt-file`), never inline.
- Session working files go in `<app.getPath('temp')>/ark/sessions/<chatId>/` and are deleted when the chat stops.
- **Isolation is a hard rule:**
  - every session passes the Task 3 checks before an answer reaches the user;
  - a failed check stops the session with an `isolation` error;
  - there is no silent retry and no fallback to an unisolated session.
- Tests that hit the real CLIs live only in `tests/live/` and run only through `npm run test:live`. They use the light tier and one-line prompts. `npm test` never calls a model.
- **Brand:**
  - Accent `#00A896` only on calls to action: New agent, Save, Start chat, Send.
  - No "·" between metadata; use spaces.
  - UI copy in English; agents write in the user's language.
- **Commits:**
  - commit after each task;
  - write the message to a file and run `git commit -F <file>`; never `-m` with quotes in PowerShell 5.1;
  - every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An agent file in the catalog folder was edited by hand into invalid YAML.** The Agents screen still loads. That file shows as invalid, with the parse error, and the other agents work (Task 7 test `lists invalid files without failing`).
2. **The project folder has a space or accented letters in its path** (e.g. `D:\Progetti Ark\città`), or the CLI is an npm `.cmd` shim. The session starts with the path intact (Task 4 tests `spawnCommand quotes args for .cmd shims` and `keeps the cwd as given`).
3. **The user sends a second message while a turn is still running.** The session refuses with `busy` instead of steering or reordering turns, and the chat keeps Send disabled until the turn ends (Task 4 test `refuses a second message while a turn runs`; Task 10 reducer test `busy until the turn ends`).
4. **The engine process dies mid-turn** (crash, killed, or logged out). The chat shows "The engine stopped." with the last stderr lines, and Send stays disabled (Task 4 test `reports an unexpected exit with the stderr tail`; Task 5 test `reports app-server exit`).
5. **The project has its own `.claude/skills`.** The Claude session refuses with `skill not allowed: <name>`; this is strict by design, and the chat shows the name. Closing Ark with chats open leaves no engine process running (Task 8 tests `forbids the project's own skills` and `stopAll stops every session and removes its folder`).

---

### Task 1: Agent file format

**Files:**
- Modify: `package.json` (add `yaml` to `dependencies`)
- Create: `src/shared/agent-file.ts`
- Test: `tests/shared/agent-file.test.ts`

**Interfaces:**
- Produces:
```ts
export type Tier = 'light' | 'standard' | 'heavy';
export type EngineId = 'claude' | 'codex';
export type EngineSetting =
  | { kind: 'auto' }
  | { kind: 'engine'; engine: EngineId }
  | { kind: 'model'; engine: EngineId; model: string };
export type Permissions = 'read-only' | 'build';
export type AgentDef = {
  id: string; name: string; description: string; engine: EngineSetting;
  tier: Tier; skills: string[]; permissions: Permissions; prompt: string;
};
export type ParseResult = { ok: true; agent: AgentDef } | { ok: false; error: string };
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined;
export function parseAgentFile(text: string, id: string): ParseResult;
export function serializeAgentFile(a: AgentDef): string;
export function validateAgent(a: unknown): ParseResult; // IPC payloads: serialize, then parse again
export function parseEngineSetting(s: string): EngineSetting | undefined;
export function formatEngineSetting(e: EngineSetting): string;
export function agentId(name: string): string;
```

**Rules:**
- **Frontmatter:** `^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$`, parsed with `yaml`'s `parse`.
- **Required fields:**
  - `name`: a string of 1–80 characters;
  - the body (the prompt): non-empty after trimming, at most 50 000 characters.
- **Optional fields and defaults:**
  - `description`: at most 4 000 characters, default `''`;
  - `tier`: `light`, `standard` or `heavy`, default `standard`;
  - `permissions`: `read-only` or `build`, default `read-only`;
  - `skills`: an array of names matching `^[A-Za-z0-9][\w.-]*(:[A-Za-z0-9][\w.-]*)?$`, default `[]`.
- **`engine`** goes through `parseEngineSetting`, which accepts `auto`, `claude`, `codex`, `claude:haiku|sonnet|opus` and `codex:<[\w.-]+>`. The default is `auto`.
- **Imports from Claude agent files:** when `engine` is missing and `model` is `haiku`, `sonnet` or `opus`, the engine becomes `{kind:'model', engine:'claude', model}`.
- Unknown keys (`tools`, `color`, …) are ignored.
- **`formatEngineSetting`** produces `Auto`, `Claude Code`, `Codex`, `Claude Opus`, and `Codex gpt-6-luna`.
- **`agentId`:**
  - lowercase, with diacritics removed via NFKD;
  - every run of characters outside `[a-z0-9]` becomes one `-`, and leading or trailing `-` are trimmed;
  - at most 64 characters; an empty result becomes `agent`.
- **`serializeAgentFile`** writes keys in the order `name, description, engine, tier, skills, permissions`, then `---`, then the prompt, then a trailing newline.

- [ ] **Step 1: `npm install yaml`** (a runtime dependency).
- [ ] **Step 2: Write the failing tests** in `tests/shared/agent-file.test.ts`:
  - `parses the documented example`: the §5.1 block of the spec gives `name: 'Planner'`, `engine: {kind:'auto'}`, `tier: 'standard'`, `skills: ['writing-plans']`, `permissions: 'read-only'`, and a prompt that starts with `You are the planner`.
  - `defaults missing fields`: `'---\nname: X\n---\nHi'` gives `{engine:{kind:'auto'}, tier:'standard', skills:[], permissions:'read-only', description:'', prompt:'Hi'}`.
  - `round-trips`: `parseAgentFile(serializeAgentFile(a), a.id)` equals `{ok:true, agent:a}` for an agent with `engine {kind:'model', engine:'codex', model:'gpt-6-luna'}` and `skills ['superpowers:writing-plans']`.
  - `imports a Claude agent`: a header of `name: code-reviewer`, `description: Senior code reviewer`, `model: sonnet`, `tools: Read, Grep` gives `engine {kind:'model', engine:'claude', model:'sonnet'}`.
  - `rejects bad files`: each of these gives `ok: false` with an error naming the field: missing name, empty body, `tier: huge`, `engine: claude:gpt`, `skills: [../x]`, and no frontmatter.
  - `agentId slugs`: `'Città Planner!'` gives `'citta-planner'`, and `'***'` gives `'agent'`.
- [ ] **Step 3: Run** `npx vitest run tests/shared/agent-file.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement `src/shared/agent-file.ts`** per the interfaces and rules above.
- [ ] **Step 5: Run** the same command. Expected: PASS. Then run `npm run typecheck`.
- [ ] **Step 6: Commit** `feat: agent file format`.

---

### Task 2: Skill index and private skill folders

**Files:**
- Modify: `src/shared/types.ts` (add `SkillSource`)
- Create: `src/main/services/skills.ts`
- Test: `tests/main/skills.test.ts`

**Interfaces:**
- Consumes: `splitFrontmatter` (Task 1).
- Produces:
```ts
// src/shared/types.ts
export type SkillSource = 'claude-user' | 'claude-plugin' | 'agents-user' | 'codex-user' | 'codex-system';
// src/main/services/skills.ts
export const ARK_PLUGIN = 'ark-agent';
export type SkillEntry = { name: string; folder: string; dir: string; source: SkillSource; description: string };
export type SkillRoots = { claudeConfigDir: string; home: string; codexHome: string };
export function indexSkills(roots: SkillRoots): SkillEntry[];
export function buildSkillFolder(layout: 'claude-plugin' | 'codex-root', target: string, names: string[], index: SkillEntry[]): { missing: string[]; folders: string[] };
```

**Rules:**
- A skill is a folder with a `SKILL.md`. `folder` is the folder's basename.
- **Sources, scanned in this order:**
  1. `claude-user`: `<claudeConfigDir>/skills/*`.
  2. `claude-plugin`: for each key `<plugin>@<marketplace>` in `installed_plugins.json`, take the install with `scope: "user"`, otherwise the last one in the list. Scan `<installPath>/skills/*`. The name is `<plugin>:<folder>`.
  3. `agents-user`: `<home>/.agents/skills/*`.
  4. `codex-user`: `<codexHome>/skills/*`, skipping dot-folders.
  5. `codex-system`: `<codexHome>/skills/.system/*`.
- If an unprefixed name appears in more than one source, the first one in this order wins.
- `description` comes from the frontmatter of `SKILL.md`, and is `''` when it is missing.
- A missing or invalid `installed_plugins.json` means no plugin skills.
- Unreadable folders are skipped.
- **The `claude-plugin` layout** writes `<target>/.claude-plugin/plugin.json`, containing `{"name":"ark-agent","version":"0.0.0","description":"Ark private skills for one agent session"}`. It copies each skill to `<target>/skills/<folder>`.
- **The `codex-root` layout** copies each skill to `<target>/<folder>`.
- Copies use `fs.cpSync(..., { recursive: true })`.
- If two requested names share the same `folder`, throw `Two skills named <folder>`.

- [ ] **Step 1: Write the failing tests.** Build a fixture tree in `mkdtempSync` with:
  - `claude/skills/handoff`;
  - `claude/plugins/installed_plugins.json`, with `superpowers@official` holding a project-scope install at `A` and a user-scope install at `B`, and `B/skills/writing-plans` on disk;
  - `home/.agents/skills/caveman` and `home/.agents/skills/handoff`;
  - `codex/skills/mine` and `codex/skills/.system/imagegen`;
  - `claude/skills/empty`, with no `SKILL.md`.

  Tests:
  - `indexes every source`: the names are `['handoff','superpowers:writing-plans','caveman','mine','imagegen']`, with sources `claude-user, claude-plugin, agents-user, codex-user, codex-system`. The plugin `dir` is under `B`.
  - `first source wins for the same name`: `handoff` is `claude-user`.
  - `skips folders without SKILL.md`: `empty` is absent.
  - `reads the description`.
  - `claude-plugin layout writes plugin.json and copies only the requested skills`: requesting `['superpowers:writing-plans']` writes `plugin.json` with the exact JSON above, creates `skills/writing-plans/SKILL.md`, does not create `skills/caveman`, and returns `folders` = `['writing-plans']`.
  - `codex-root layout copies under the target`: `<target>/caveman/SKILL.md` exists.
  - `reports skills that are not installed`: `missing` is `['nope']`.
  - `rejects two skills with the same folder`: requesting `['handoff', 'x:handoff']` throws, with a fixture plugin `x` that has a `handoff` folder.
- [ ] **Step 2: Run** `npx vitest run tests/main/skills.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/main/services/skills.ts`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: skill index and private skill folders`.

---

### Task 3: Launch rules (isolation and model choice)

**Files:**
- Create: `src/main/services/engines/isolation.ts`
- Create: `src/main/services/engines/models.ts`
- Test: `tests/main/isolation.test.ts`, `tests/main/models.test.ts`

**Interfaces:**
- Consumes: `AgentDef`, `Tier` and `EngineId` (Task 1); `ARK_PLUGIN` (Task 2).
- Produces:
```ts
// isolation.ts
export const STRIPPED_ENV = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT'] as const;
export class IsolationError extends Error { constructor(readonly violations: string[]) }
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function claudeArgs(o: { model: string; roleFile: string; pluginDir: string }): string[];
export function codexArgs(deny: { skillPaths: string[]; mcpServers: string[] }): string[];
export function checkClaudeInit(init: unknown, expectedFolders: string[], forbidden: ReadonlySet<string>): string[];
export function checkCodexSkills(skills: { name: string; path: string; enabled: boolean }[], expectedFolders: string[], privateRoot: string): string[];
export function checkCodexMcp(servers: Record<string, { enabled?: boolean }>): string[];
// models.ts
export const CLAUDE_TIER_MODEL: Record<Tier, string> = { light: 'haiku', standard: 'sonnet', heavy: 'opus' };
export const CODEX_TIER_EFFORT: Record<Tier, 'low' | 'medium' | 'high'> = { light: 'low', standard: 'medium', heavy: 'high' };
export type CodexModel = { id: string; hidden: boolean; isDefault: boolean };
export function codexTierModel(tier: Tier, models: CodexModel[], overrides?: Partial<Record<Tier, string>>): string | undefined;
export type RunPlan = { engine: EngineId; tier: Tier; model?: string };
export function resolveRun(agent: AgentDef, installed: Record<EngineId, boolean>): RunPlan | { error: string };
```

**Exact values:**
- `claudeArgs` returns:
  `['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--setting-sources','project,local','--strict-mcp-config','--plugin-dir',pluginDir,'--model',model,'--append-system-prompt-file',roleFile,'--disallowedTools','Edit','Write','NotebookEdit','Bash']`.
  The disallowed tools make the session read-only, as required in this step.
- `codexArgs` returns `['app-server','--disable','plugins','--disable','apps','--disable','hooks']`, followed by:
  - if there are skill paths: `'-c', 'skills.config=[{path=<JSON.stringify(p)>,enabled=false},…]'`;
  - for each MCP server: `'-c', 'mcp_servers.<key>.enabled=false'`, where `<key>` is the name as is when it matches `^[A-Za-z0-9_-]+$`, and otherwise `JSON.stringify(name)`.
- **`checkClaudeInit` violations:**
  - `no init event`, when `init` is not an object;
  - `plugin not allowed: <name>`, for any plugin whose name is not `ark-agent` and whose `path` is not `'builtin'`;
  - `MCP server not allowed: <name>`, for each entry in `mcp_servers`;
  - `skill not allowed: <s>`, for a skill that contains `:` but does not start with `ark-agent:`, or a skill without `:` that is in `forbidden`;
  - `skill not loaded: ark-agent:<folder>`, for each expected folder that is missing.
- **`checkCodexSkills` violations:**
  - `skill not allowed: <name>`, for an enabled skill whose path is not inside `privateRoot` (compare with `path.resolve`) or whose name is not expected;
  - `skill not loaded: <folder>`, for an expected folder that is not enabled from `privateRoot`.
- **`checkCodexMcp`:** `MCP server not allowed: <name>` for each server where `enabled !== false`.
- **`codexTierModel`:**
  - an override wins;
  - `heavy` is the `isDefault` model;
  - `standard` is the first non-hidden id ending in `-terra`;
  - `light` is the first non-hidden id ending in `-luna`;
  - otherwise the default model, otherwise the first non-hidden one, otherwise `undefined`.
- **`resolveRun`, step-1 rule:**
  - `model` kind: that engine and that model;
  - `engine` kind: that engine at the agent's tier;
  - `auto`: Claude if installed, otherwise Codex, at the agent's tier;
  - when the chosen engine is not installed: `{error: 'Claude Code is not installed'}` / `'Codex is not installed'` / `'No engine installed'`.

- [ ] **Step 1: Write the failing tests.**
  - `cleanEnv removes the session variables and keeps the rest`: `CLAUDE_CODE_PLUGIN_DIRS` and `CLAUDECODE` are gone; `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_GIT_BASH_PATH` and `PATH` stay.
  - `claudeArgs is exact`: deep-equal to the list above.
  - `codexArgs denies skills by path and MCP servers by name`: paths `['C:\\u\\.agents\\skills\\caveman\\SKILL.md']` and servers `['node_repl','my.server']` give `'skills.config=[{path="C:\\\\u\\\\.agents\\\\skills\\\\caveman\\\\SKILL.md",enabled=false}]'`, `'mcp_servers.node_repl.enabled=false'` and `'mcp_servers."my.server".enabled=false'`. With no paths, there is no `skills.config` argument.
  - `checkClaudeInit accepts a clean init`: plugins `[{name:'ark-agent',path:'D:\\x'},{name:'cc-plugin-telemetry',path:'builtin'}]`, `mcp_servers []`, skills `['dataviz','ark-agent:writing-plans']`, expected `['writing-plans']` give `[]`.
  - `checkClaudeInit flags each kind of leak`: these cases give the matching violations: an extra plugin `superpowers`; `mcp_servers [{name:'alpaca'}]`; skill `superpowers:brainstorming`; skill `caveman` with `forbidden` = `{'caveman'}`; a missing expected `ark-agent:x`; and `undefined`, which gives `['no init event']`.
  - `checkCodexSkills`: with root `R`:
    - `{name:'a', path:'R/a/SKILL.md', enabled:true}` and expected `['a']` give `[]`;
    - an enabled `caveman` outside `R` gives `['skill not allowed: caveman']`;
    - a disabled `a` gives `['skill not loaded: a']`.
  - `checkCodexMcp`: `{node_repl:{enabled:false}}` gives `[]`, and `{x:{}}` gives `['MCP server not allowed: x']`.
  - `codexTierModel picks from the observed list`: with the list in the header (`gpt-6.1-sol` default), it returns light `gpt-6-luna`, standard `gpt-6.1-terra`, heavy `gpt-6.1-sol`. The override `{light:'gpt-5.6-luna'}` wins. An empty list gives `undefined`.
  - `resolveRun`: an auto/light agent with both engines installed gives `{engine:'claude', tier:'light'}`. With Claude missing it gives `{engine:'codex', tier:'light'}`. `claude:opus` gives `{engine:'claude', tier, model:'opus'}`. A codex agent with Codex missing gives `{error:'Codex is not installed'}`.
- [ ] **Step 2: Run** `npx vitest run tests/main/isolation.test.ts tests/main/models.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: engine launch rules for isolation and models`.

---

### Task 4: Claude Code session

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/services/engines/session.ts`, `src/main/services/engines/claude-session.ts`
- Create: `tests/helpers/fake-child.ts`, `tests/fixtures/claude-stream.jsonl`
- Test: `tests/main/claude-session.test.ts`

**Interfaces:**
- Consumes: `checkClaudeInit` (Task 3).
- Produces:
```ts
// src/shared/types.ts
export type TokenCount = { input: number; cached: number; output: number };
export type ChatEvent =
  | { type: 'message'; text: string }
  | { type: 'turn'; model: string; tokens: TokenCount }
  | { type: 'error'; kind: 'isolation' | 'engine' | 'exit'; detail: string };
// session.ts
export interface EngineSession { readonly busy: boolean; send(text: string): void; stop(): void; onEvent(cb: (e: ChatEvent) => void): void }
export type ChildLike = { stdin: Writable; stdout: Readable; stderr: Readable; kill(): void; on(ev: 'exit', cb: (code: number | null) => void): void };
export type SpawnFn = (command: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean }) => ChildLike;
export const nodeSpawn: SpawnFn; // child_process.spawn, stdio pipes, windowsHide: true
export function spawnCommand(file: string, args: string[]): { command: string; args: string[]; shell: boolean };
export function jsonLines(stream: Readable, cb: (o: Record<string, unknown>) => void): void; // splits on \n, skips non-JSON
// claude-session.ts
export function startClaudeSession(o: { exe: string; cwd: string; args: string[]; env: NodeJS.ProcessEnv;
  expectedFolders: string[]; forbidden: ReadonlySet<string>; spawn?: SpawnFn }): EngineSession;
// tests/helpers/fake-child.ts
export class FakeChild implements ChildLike { /* PassThrough streams; killed: boolean; written(): string[] (stdin lines); emitLine(o); exit(code, stderr?) */ }
```

**Rules:**
- **`spawnCommand`:**
  - `.exe` (or anything else): `{command: file, args, shell: false}`;
  - `.cmd`/`.bat`: `{command: '"' + file + '"', args, shell: true}`, where each argument containing whitespace or one of `"&|<>^` is wrapped in `"…"`, with inner `"` doubled.
- **`send(text)`:**
  - writes `{"type":"user","message":{"role":"user","content":[{"type":"text","text":text}]}}` followed by `\n`;
  - throws `Error('busy')` while a turn runs;
  - throws `Error('session ended')` after an exit or an isolation stop.
- **Stream events:**
  - On `system/init`, run `checkClaudeInit`. If there are violations, emit `{type:'error', kind:'isolation', detail: violations.join('; ')}`, kill the child, and ignore all later output.
  - An `assistant` line emits a `message` with the concatenated `text` parts. `thinking` and `tool_use` parts are skipped, and an empty text produces no event.
  - A `result` line emits a `turn` and clears `busy`. Tokens: `input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, `cached = cache_read_input_tokens`, `output = output_tokens`. `model` comes from `init.model`. A `subtype` other than `success` emits an `error` of kind `engine` with that subtype.
- **Exit:** an exit that `stop()` did not cause emits `{type:'error', kind:'exit', detail}`. The detail is the last 500 characters of stderr, or `exit code <n>` when stderr is empty.
- **`stop()`:** kills the child, and emits nothing.

- [ ] **Step 1: Write the fixture** `tests/fixtures/claude-stream.jsonl`, with three lines:
  - init: `session_id 's1'`, `model 'claude-haiku-5-5'`; skills `['dataviz','ark-agent:ark-probe-a']`; plugins `[{name:'ark-agent',path:'D:\\x'},{name:'cc-plugin-telemetry',path:'builtin'}]`; `mcp_servers []`;
  - assistant: content `[{type:'thinking',thinking:''},{type:'text',text:'noted.'}]`;
  - result: `subtype 'success'`, usage `{input_tokens:2, cache_creation_input_tokens:6909, cache_read_input_tokens:17329, output_tokens:5}`.

  Write `FakeChild` too.
- [ ] **Step 2: Write the failing tests:**
  - `sends the user text as one stream-json line`: the stdin line deep-equals the shape above for `'hi'`.
  - `emits the assistant text and the turn tokens`: replaying the fixture after `send` gives the events `[{type:'message',text:'noted.'}, {type:'turn', model:'claude-haiku-5-5', tokens:{input:24240, cached:17329, output:5}}]`, and `busy` is false afterwards.
  - `stops on an init that breaks isolation`: an init with the extra plugin `{name:'superpowers',path:'C:\\p'}` gives an error event of kind `isolation` whose detail contains `plugin not allowed: superpowers`. The child is killed, the following assistant line emits nothing, and `send` then throws `session ended`.
  - `reports an unexpected exit with the stderr tail`: `exit(1, 'not logged in')` gives `{type:'error', kind:'exit', detail:'not logged in'}`.
  - `refuses a second message while a turn runs`: the second `send` throws `busy`.
  - `spawnCommand quotes args for .cmd shims`: `('C:\\n\\claude.cmd', ['--plugin-dir','D:\\Progetti Ark\\città'])` gives `{command:'"C:\\n\\claude.cmd"', args:['--plugin-dir','"D:\\Progetti Ark\\città"'], shell:true}`. For `.exe`, the args are unchanged and `shell` is false.
  - `keeps the cwd as given`: the fake spawn receives `cwd 'D:\\Progetti Ark\\città'` unchanged.
- [ ] **Step 3: Run** `npx vitest run tests/main/claude-session.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `session.ts` and `claude-session.ts`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat: claude code chat session with isolation check`.

---

### Task 5: Codex session

**Files:**
- Create: `src/main/services/engines/app-server-client.ts`, `src/main/services/engines/codex-session.ts`, `src/main/services/engines/project-rules.ts`
- Modify: `src/main/services/adapters/codex-appserver.ts`: `appServerRequest` becomes `AppServerClient.open` → `request` → `close`. Its signature and behaviour stay the same, and its own JSON-RPC framing is deleted.
- Create: `tests/helpers/fake-app-server.ts`
- Test: `tests/main/codex-session.test.ts`, `tests/main/project-rules.test.ts`

**Interfaces:**
- Consumes:
  - `ChildLike`, `SpawnFn`, `nodeSpawn`, `spawnCommand`, `jsonLines` and `EngineSession` (Task 4);
  - `codexArgs`, `checkCodexSkills`, `checkCodexMcp`, `IsolationError` and `CodexModel` (Task 3).
- Produces:
```ts
// app-server-client.ts
export class AppServerClient {
  static open(exe: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; spawn?: SpawnFn }): Promise<AppServerClient>;
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>; // default 20000; rejects on JSON-RPC error or timeout
  onNotification(cb: (method: string, params: unknown) => void): void;
  onExit(cb: (code: number | null, stderrTail: string) => void): void;
  close(): void;
}
// codex-session.ts
export const CODEX_BASE_ARGS = ['app-server', '--disable', 'plugins', '--disable', 'apps', '--disable', 'hooks'];
export function startCodexSession(o: { exe: string; cwd: string; env: NodeJS.ProcessEnv; privateRoot: string;
  expectedFolders: string[]; model: string; effort: 'low' | 'medium' | 'high'; instructions: string; spawn?: SpawnFn }): Promise<EngineSession>;
export function codexModels(exe: string, env: NodeJS.ProcessEnv, spawn?: SpawnFn): Promise<CodexModel[]>;
// project-rules.ts
export function codexProjectRules(projectDir: string): string | undefined;
// tests/helpers/fake-app-server.ts
export function fakeAppServer(handlers: Record<string, (params: any) => unknown>): { spawn: SpawnFn; spawns: { command: string; args: string[] }[]; requests: { method: string; params: unknown }[]; notify(method: string, params: unknown): void };
```

**`open` sends:**
- `initialize` with `{clientInfo:{name:'ark', title:'Ark', version:'0.1.0'}, capabilities:null}`;
- then the notification `{method:'initialized'}`.

**`startCodexSession` steps, in order:**
1. **Enumerate.**
   - Open with `CODEX_BASE_ARGS`.
   - Call `skills/list {cwds:[cwd], forceReload:true}` and take `data[0].skills`, keeping the `path` of the enabled ones.
   - Call `config/read {includeLayers:false, cwd}` and take the keys of `config.mcp_servers`.
   - Close.
2. **Open the isolated session** with `codexArgs({skillPaths, mcpServers})`.
3. **Add the private skills:** `skills/extraRoots/set {extraRoots:[privateRoot]}`.
4. **Check isolation.**
   - Call `skills/list` (as in step 1) and `config/read` again.
   - Run `checkCodexSkills` and `checkCodexMcp`.
   - If there are any violations, close and reject with `IsolationError`.
5. **Start the thread** with `thread/start {model, cwd, approvalPolicy:'never', sandbox:'read-only', developerInstructions: instructions}` and keep `thread.id`.

**`send(text)`:** calls `turn/start {threadId, effort, input:[{type:'text', text, text_elements:[]}]}`. It uses the same `busy` and `session ended` rules as Task 4.

**Notifications:**
- `item/completed` where `item.type === 'agentMessage'` emits a `message` with `item.text`.
- `thread/tokenUsage/updated` stores `tokenUsage.last`.
- `turn/completed` emits a `turn` with `{model, tokens:{input: last.inputTokens, cached: last.cachedInputTokens, output: last.outputTokens}}` and clears `busy`. If `turn.status !== 'completed'`, it emits `error` of kind `engine` with detail `turn <status>` instead.
- `onExit` without `stop()` emits an `exit` error, as in Task 4.

**`codexModels`:** opens with `CODEX_BASE_ARGS`, requests `model/list {}`, and maps `data` to `{id, hidden, isDefault}`.

**`codexProjectRules`:**
- If `AGENTS.md` exists, return `undefined`: Codex loads it itself.
- Otherwise, if `CLAUDE.md` exists, return its content. A line matching `^@(\S+)\s*$` is replaced by the processed content of that file, resolved relative to the importing file, when it exists inside `projectDir`. Imports outside the project stay as text, and nesting stops at depth 3.
- Otherwise, return `undefined`.

- [ ] **Step 1: Write the failing tests:**
  - `AppServerClient answers by id and rejects JSON-RPC errors`.
  - `enumerates, then denies every found skill by path and every MCP server`:
    - the enumeration returns the enabled skill `{name:'caveman', path:'C:\\u\\.agents\\skills\\caveman\\SKILL.md'}` and `mcp_servers {node_repl:{}}`;
    - the second spawn's args equal `codexArgs({skillPaths:['C:\\u\\.agents\\skills\\caveman\\SKILL.md'], mcpServers:['node_repl']})`.
  - `sets the private root before checking`: the request methods on the second client run in the order `initialize, skills/extraRoots/set, skills/list, config/read, thread/start`.
  - `refuses to start when a foreign skill is still enabled`: it rejects with an `IsolationError` whose `violations` are `['skill not allowed: caveman']`, and `thread/start` is never requested.
  - `refuses when an MCP server is still enabled`.
  - `starts the thread read-only with the role instructions`: the `thread/start` params deep-equal the step 5 shape.
  - `sends a turn and emits message and tokens`:
    - the notifications `item/completed {item:{type:'agentMessage', text:'I am Reviewer.'}}`, `thread/tokenUsage/updated {tokenUsage:{last:{inputTokens:13700, cachedInputTokens:4224, outputTokens:18}}}` and `turn/completed {turn:{status:'completed'}}`;
    - give the events message `'I am Reviewer.'` and turn `{model:'gpt-6-luna', tokens:{input:13700, cached:4224, output:18}}`.
  - `reports app-server exit`.
  - `codexModels maps model/list`.
  - `tests/main/project-rules.test.ts`:
    - `nothing when AGENTS.md exists`;
    - `inlines @imports of CLAUDE.md`: `CLAUDE.md` = `'@AGENTv2.md\n'` and `AGENTv2.md` = `'# Rules\nX'` give `'# Rules\nX'`;
    - `keeps imports outside the project as text`;
    - `stops at depth 3 on a cycle`.
- [ ] **Step 2: Run** `npx vitest run tests/main/codex-session.test.ts tests/main/project-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files and the `appServerRequest` change.
- [ ] **Step 4: Run** those tests, then `npm test`. Expected: PASS, and the Phase 0 tests are still green.
- [ ] **Step 5: Commit** `feat: codex chat session with isolation check`.

---

### Task 6: Live isolation gate (spec §6.3 acceptance test)

**Files:**
- Create: `vitest.live.config.mts`, `tests/live/engines.live.test.ts`
- Create: `tests/fixtures/skills/ark-probe-a/SKILL.md`, `tests/fixtures/skills/ark-probe-b/SKILL.md` (frontmatter `name` and `description`; bodies `Reply with the word ALPHA.` / `…BRAVO.`)
- Modify: `vitest.config.mts` (add `exclude: ['tests/live/**', 'node_modules/**']`), `package.json` (script `"test:live": "vitest run --config vitest.live.config.mts"`)

**Interfaces:**
- Consumes: Tasks 2–5. Find the CLIs with `which` from `src/main/services/exec.ts`.
- **Config:** `vitest.live.config.mts` includes `tests/live/**/*.test.ts`, with the same `@shared` alias and `testTimeout: 180000`.

- [ ] **Step 1: Write the live tests.** Both use `cleanEnv(process.env)` and a temp project directory whose `CLAUDE.md` contains `Your project marker is ARK-MARKER-7.`. The index is two `SkillEntry` items pointing at the fixture skills.
  - **`Claude Code: only the agent's skills, project rules kept`:**
    - build the folder with `buildSkillFolder('claude-plugin', …)` and a role file containing `You are Probe.`;
    - `forbidden` is the set of folders of the real `indexSkills(...)` entries with source `claude-user`;
    - send `Reply with your project marker and nothing else.`;
    - expect no `error` event, a `message` that contains `ARK-MARKER-7`, and `turn.tokens.output > 0`.
  - **`Codex: only the agent's skills`:**
    - use `buildSkillFolder('codex-root', …)` and the model `codexTierModel('light', await codexModels(...))`, with effort `low` and instructions `You are Probe. Reply in one short line.`;
    - `startCodexSession` resolves, so isolation passed;
    - send `Who are you?`;
    - expect a `message` that contains `Probe`, and `turn.tokens.output > 0`.
- [ ] **Step 2: Run** `npm run test:live`. Expected: 2 passed. Then run `npm test`, and expect the live tests not to be collected.
- [ ] **Step 3: STOP CONDITION.** If either test fails with an isolation violation, **stop here**. Do not start Task 7. Report the violations to the user, as spec §12 requires. For any other failure (login, network), fix it or report it.
- [ ] **Step 4: Commit** `test: live isolation gate for both engines`.

---

### Task 7: Agent catalog

**Files:**
- Create: `src/main/services/files.ts`, holding `writeAtomic(file: string, data: string): void` moved from `statusline.ts`
- Modify: `src/main/services/statusline.ts` (import it), `src/shared/types.ts`
- Create: `src/main/services/catalog.ts`
- Test: `tests/main/catalog.test.ts`

**Interfaces:**
- Consumes: `AgentDef`, `parseAgentFile`, `serializeAgentFile` and `agentId` (Task 1).
- Produces:
```ts
// src/shared/types.ts
export type CatalogList = { agents: AgentDef[]; invalid: { file: string; error: string }[] };
export type ImportableAgent = { path: string; name: string; source: string }; // source: 'Claude Code' or the plugin name
// catalog.ts
export const SEED_AGENTS: AgentDef[];
export class Catalog {
  constructor(dir: string);
  list(): CatalogList;            // every <dir>/*.md, sorted by name
  get(id: string): AgentDef | undefined;
  save(a: AgentDef): void;        // <dir>/<a.id>.md via writeAtomic; id must match ^[a-z0-9-]{1,64}$
  remove(id: string): void;
  seedIfEmpty(): void;            // writes SEED_AGENTS only when <dir> has no .md file
}
export function importableAgents(claudeConfigDir: string): ImportableAgent[]; // <cfg>/agents/*.md + plugin agents (Task 2's install-selection rule)
export function importAgent(path: string): AgentDef;                         // parse with id agentId(name); throws on invalid
```

**Seeds:**

| id | name | engine | tier | skills | permissions |
|---|---|---|---|---|---|
| project-manager | Project manager | auto | light | superpowers:brainstorming | read-only |
| planner | Planner | auto | standard | superpowers:writing-plans | read-only |
| developer | Developer | claude:opus | heavy | superpowers:test-driven-development, superpowers:executing-plans, superpowers:verification-before-completion | build |
| code-reviewer | Code reviewer | codex | standard | agent-skills:code-review-and-quality | read-only |
| security-reviewer | Security reviewer | codex | standard | agent-skills:security-and-hardening | read-only |
| marketing | Marketing | auto | light | (none) | read-only |
| seo | SEO | auto | light | (none) | read-only |

**Seed prompts:**
- Each one is a short paragraph, written in the second person.
- It always contains: `You are <name>, a member of a small team working in Ark.`, then the role's responsibility in one or two sentences taken from spec §5.3 or §8, then `Write in the language the user writes in. When you need the user's decision, ask one clear question.`
- Seed descriptions are the one-liners from the catalog mockup.

- [ ] **Step 1: Write the failing tests:**
  - `saves, lists, gets and removes`.
  - `lists invalid files without failing`: a broken `x.md` appears in `invalid` with its parse error, and the valid agents are still listed.
  - `seeds once`: the first `seedIfEmpty` writes 7 files, and the second, after one is removed, writes nothing.
  - `refuses unsafe ids`: `save` with id `'../x'` throws.
  - `finds plugin agents through installed_plugins.json`: a fixture plugin with `agents/code-reviewer.md` gives `{name:'code-reviewer', source:'agent-skills'}`.
  - `imports a Claude agent`: `model: sonnet` gives `engine {kind:'model', engine:'claude', model:'sonnet'}`, `skills []` and `permissions 'read-only'`.
- [ ] **Step 2: Run** `npx vitest run tests/main/catalog.test.ts tests/main/statusline.test.ts`. Expected: the catalog tests FAIL and the statusline tests PASS.
- [ ] **Step 3: Implement** `files.ts`, the `statusline.ts` import and `catalog.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: agent catalog with seeds and import`.

---

### Task 8: Engines config, AgentRunner and IPC

**Files:**
- Create: `src/main/services/engines/config.ts`, `src/main/services/agent-runner.ts`
- Modify: `src/shared/types.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/main/engines-config.test.ts`, `tests/main/agent-runner.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5 and 7; `detect` and `run` from `src/main/services/exec.ts`; `claudeAuth` from `adapters/claude.ts`.
- Produces:
```ts
// src/shared/types.ts
export type EngineInfo = { id: EngineId; installed: boolean; path?: string; version?: string; manual: boolean };
export type EnginesConfig = { claude?: { path?: string }; codex?: { path?: string; tiers?: Partial<Record<Tier, string>> } };
export type SkillInfo = { name: string; source: SkillSource; description: string };
export type ChatStarted = { chatId: string; engine: EngineId; model: string };
// ArkApi additions
catalog: { list(): Promise<CatalogList>; save(a: AgentDef): Promise<void>; remove(id: string): Promise<void>;
           importable(): Promise<ImportableAgent[]>; import(path: string): Promise<AgentDef> };
skills: { list(): Promise<SkillInfo[]> };
engines: { status(): Promise<EngineInfo[]>; save(c: EnginesConfig): Promise<void> };
chat: { pickFolder(): Promise<string | null>; start(agentId: string, projectDir: string): Promise<ChatStarted>;
        send(chatId: string, text: string): Promise<void>; stop(chatId: string): Promise<void>;
        onEvent(cb: (chatId: string, e: ChatEvent) => void): () => void };
// config.ts
export function readEngines(userData: string): EnginesConfig;            // <userData>/engines.json; invalid or missing → {}
export function writeEngines(userData: string, c: EnginesConfig): void;  // validates, then writeAtomic
export function validateEngines(c: unknown): EnginesConfig;              // throws on invalid
export function engineStatus(c: EnginesConfig, detectFn?: typeof detect): Promise<EngineInfo[]>;
// agent-runner.ts
export type RunnerDeps = {
  catalog: Pick<Catalog, 'get'>; skills: () => SkillEntry[]; engines: () => Promise<EngineInfo[]>;
  config: () => EnginesConfig; tempDir: string; env: () => NodeJS.ProcessEnv;
  startClaude: typeof startClaudeSession; startCodex: typeof startCodexSession;
  codexModels: (exe: string) => Promise<CodexModel[]>;
};
export class AgentRunner {
  constructor(deps: RunnerDeps);
  start(agentId: string, projectDir: string): Promise<ChatStarted>;      // catalog lookup, then startAgent
  startAgent(agent: AgentDef, projectDir: string): Promise<ChatStarted>;
  send(chatId: string, text: string): void;
  stop(chatId: string): void;
  stopAll(): void;
  onEvent(cb: (chatId: string, e: ChatEvent) => void): () => void;
}
```

**`validateEngines` rules:**
- `path` must be absolute and end with `.exe`, `.cmd` or `.bat`.
- `tiers` keys must be tiers, and their values must match `^[\w.-]{1,64}$`.

**`engineStatus`:**
- A configured path is used when it exists. The version comes from `run(path, ['--version'])`, and `manual` is `true`.
- Otherwise it uses `detect('claude')` / `detect('codex')`, with `manual: false`.

**`startAgent` steps:**
1. **Pick the engine.** `resolveRun(agent, installed)`; an error throws `Error(error)`.
2. **Make the session folder.** `chatId = randomUUID()`, `dir = <tempDir>/ark/sessions/<chatId>`. Run `skills()` once, and call the result `index`.
3. **Claude:**
   - build the private skills with `buildSkillFolder('claude-plugin', dir/plugin, agent.skills, index)`. If any are missing, throw `Error('Skill not installed: ' + missing.join(', '))`;
   - write `dir/role.md` with `agent.prompt`;
   - the model is `plan.model ?? CLAUDE_TIER_MODEL[plan.tier]`;
   - `forbidden` = the folders of `claude-user` entries, plus the folder names under `<projectDir>/.claude/skills`;
   - call `startClaude({exe, cwd: projectDir, args: claudeArgs(...), env: env(), expectedFolders: folders, forbidden})`.
4. **Codex:**
   - `privateRoot = dir/skills`, built with `buildSkillFolder('codex-root', ...)`, with the same missing-skill rule;
   - the model is `plan.model ?? codexTierModel(plan.tier, await codexModels(exe), config().codex?.tiers)`. If none is found, throw `No Codex model for tier <t>`;
   - the effort is `CODEX_TIER_EFFORT[plan.tier]`;
   - `instructions = agent.prompt`, plus `'\n\n# Project instructions\n\n' + rules` when `codexProjectRules(projectDir)` returns something.
5. **Register the session** and forward its events as `(chatId, e)`.

**`stop` / `send`:**
- `stop` stops the session, deletes it, and removes `dir` with `rmSync({recursive:true, force:true})`.
- `send` to an unknown chat throws `Error('Unknown chat')`; otherwise it calls `session.send`, so `busy` and `session ended` propagate.

**IPC** (in `registerIpc`, with the same sender check as Phase 0):

| Channel | Validation |
|---|---|
| `catalog:list`, `catalog:importable`, `skills:list`, `engines:status` | no payload |
| `catalog:save` | `validateAgent(payload)` must be ok, and `id` matches `^[a-z0-9-]{1,64}$` |
| `catalog:remove` | `id` matches the same pattern |
| `catalog:import` | the path is one of `importableAgents(cfgDir)` paths |
| `engines:save` | `validateEngines` |
| `chat:pick-folder` | `dialog.showOpenDialog(win, {properties:['openDirectory']})`; returns the path or `null` |
| `chat:start` | agent id pattern; `projectDir` is an absolute path to an existing directory |
| `chat:send` | `chatId` is a UUID; `text` is a string of 1–100 000 characters |
| `chat:stop` | `chatId` is a UUID |

Events go out on `chat:event` as `(chatId, ChatEvent)`, sent only while the window exists.

**Wiring in `index.ts`:**
- `Catalog(join(userData, 'agents'))`, followed by `seedIfEmpty()`;
- the skill roots come from `claudeAuth()?.configDir ?? ~/.claude`, `homedir()`, and `CODEX_HOME ?? ~/.codex`; the index is recomputed on each `skills:list` and each `start`;
- `env: () => cleanEnv(process.env)`;
- `before-quit` calls `runner.stopAll()`.

- [ ] **Step 1: Write the failing tests.**
  - **`engines-config`:**
    - `invalid file reads as {}`;
    - `rejects relative paths and bad tiers`;
    - `manual path wins over detection`, with a fake `detectFn` and a temp `.exe` file.
  - **`agent-runner`**, with fake `startClaude` / `startCodex` that record their options and return a fake session:
    - `starts Claude with only the agent's skills and its role file`: the `dir/plugin/skills` folder has exactly the agent's folders, `role.md` equals the prompt, and the args equal `claudeArgs({model:'haiku', ...})` for an auto/light agent.
    - `refuses an agent whose skill is not installed`: it throws `Skill not installed: x`.
    - `auto runs on Codex when Claude is missing`: `startCodex` gets the model `gpt-6-luna` and the effort `low`.
    - `gives Codex the role plus the project rules`.
    - `forbids the project's own skills`: `<projectDir>/.claude/skills/local-skill` puts `local-skill` in `forbidden`.
    - `forwards session events with the chat id`.
    - `send to an unknown chat throws`.
    - `stopAll stops every session and removes its folder`.
- [ ] **Step 2: Run** `npx vitest run tests/main/engines-config.test.ts tests/main/agent-runner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `config.ts` and `agent-runner.ts`, then the IPC, the preload, the types and the wiring.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: agent runner and catalog, skills, engines, chat IPC`.

---

### Task 9: Agents screen and agent form

**Files:**
- Create: `src/shared/agent-problems.ts` + `tests/shared/agent-problems.test.ts`
- Create: `src/renderer/pages/Agents.tsx`, `src/renderer/pages/AgentForm.tsx`, `src/renderer/hooks/useCatalog.ts`
- Modify:
  - `src/renderer/agents.ts`: add `{name:'agents'}`, `{name:'agent-form'; id?: string; draft?: AgentDef}` and `{name:'chat'; agentId: string}` to `Screen`;
  - `src/renderer/App.tsx`;
  - `src/renderer/components/Page.tsx`: a `backLabel` prop, defaulting to `Back to usage`;
  - `src/renderer/pages/Usage.tsx`: an `Agents` link next to `History` and `Accounts`.

**Interfaces:**
- Consumes: the `window.ark.catalog`, `skills` and `engines` APIs (Task 8), and `formatEngineSetting` (Task 1).
- Produces: `agentProblems(a: AgentDef, skills: ReadonlySet<string>, engines: EngineInfo[]): string[]`.

**`agentProblems` messages:**
- a fixed engine that is not installed: `Claude Code is not installed` / `Codex is not installed`;
- `auto` with neither engine installed: `No engine installed`;
- one entry per missing skill: `Skill not installed: <name>`.

**Screen copy and layout:**
- **Agents page.**
  - Title `Agents`.
  - Label `Engines found on this machine`, with one tag per engine (`CC` / `CX`, then the logged-in plan from Phase 0's `UsageState`, i.e. `agents[i].account?.plan` when known, then the version, then `manual` when it was set by hand), and a link `Add manually`. `App.tsx` passes the `useUsage` state to the page.
  - `Add manually` opens an inline row: an engine select (Claude Code / Codex), a path input and a Save button. It calls `engines.save`.
  - Buttons: `New agent` (accent) and `Import`.
  - `Import` lists the importable agents (name, then source). Clicking one goes to the form with `draft` = the result of `catalog.import(path)`; nothing is saved until the user presses Save.
- **Agent cards.**
  - Each card shows the name; the description, clamped to 2 lines; and an engine line made of `formatEngineSetting`, plus the tier unless the engine names an exact model, separated by two spaces.
  - Then one chip per skill, the problems in muted warning text, and the actions `Chat` and `Edit`.
  - Invalid files are listed under the heading `Files with errors`, as the file name followed by the error.
- **Agent form.**
  - Fields: `Name`; `Description`; `Engine` (select: Auto, Claude Code, Codex, Claude Haiku, Claude Sonnet, Claude Opus, Codex model…, where the last one shows a text input); `Tier` (Light / Standard / Heavy, hidden for an exact model); `Permissions` (Read-only / Build); `Skills` (a filterable checklist of `skills.list()` showing name and source); `Role prompt` (a monospace textarea).
  - Buttons: `Save` (accent), `Cancel`, and `Delete` when editing.
  - A new agent's id is `agentId(name)`. The `validateAgent` error is shown above Save.

- [ ] **Step 1: Write the failing test** `agentProblems`, one case per message above plus a clean agent that returns `[]`. Run it. Expected: FAIL.
- [ ] **Step 2: Implement `agentProblems`**, then run. Expected: PASS.
- [ ] **Step 3: Build the screens** per the copy above, with brand tokens only (no raw hex).
- [ ] **Step 4: Run** `npm run typecheck`, `npm run lint` and `npm run dev`. Open Agents: the 7 seeds show with their problems, if any. Create, edit and delete an agent. Import `code-reviewer` from agent-skills.
- [ ] **Step 5: Commit** `feat: agents screen and agent form`.

---

### Task 10: Chat screen

**Files:**
- Create: `src/shared/chat-log.ts` + `tests/shared/chat-log.test.ts`
- Create: `src/renderer/pages/Chat.tsx`, `src/renderer/hooks/useChat.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `window.ark.chat` (Task 8), `ChatEvent`, `TokenCount`.
- Produces:
```ts
export type ChatEntry = { role: 'user' | 'agent' | 'error'; text: string; model?: string; tokens?: TokenCount };
export type ChatState = { entries: ChatEntry[]; busy: boolean; ended: boolean };
export const EMPTY_CHAT: ChatState;
export function chatReducer(s: ChatState, a: { type: 'sent'; text: string } | { type: 'event'; event: ChatEvent }): ChatState;
```

**Reducer rules:**
- `sent` appends a user entry and sets `busy`.
- `message` appends an agent entry.
- `turn` attaches `model` and `tokens` to the last agent entry of the turn; if there is none, it appends an agent entry with empty text. It clears `busy`.
- `error` appends an error entry and clears `busy`. `ended` becomes true for the kinds `isolation` and `exit`.
- **Error text:**
  - `isolation`: `Stopped: this agent could see things it was not given.`, followed by a newline and the detail;
  - `exit`: `The engine stopped.`, followed by a newline and the detail;
  - `engine`: the detail.

**Screen:**
- **Before the chat starts:** the title `Chat with <agent name>`, then `Project folder` with a `Choose folder` button (`chat.pickFolder`) showing the chosen path, then `Start chat` (accent, enabled once a folder is chosen). Errors from `chat.start` (missing skill, engine not installed) show inline.
- **After it starts:**
  - The header shows the agent name, the model tag and the folder path.
  - User entries show `You`. Agent entries show the name, the model tag and the text (pre-wrap), with a muted tokens line `in 24,240  cached 17,329  out 5`.
  - The composer is a textarea with the placeholder `Message <agent name>`. Enter sends and Shift+Enter adds a new line.
  - `Send` (accent) is disabled while `busy || ended`.
- **On unmount:** call `chat.stop(chatId)`.

- [ ] **Step 1: Write the failing reducer tests:**
  - `busy until the turn ends`;
  - `turn attaches tokens to the last agent entry`;
  - `isolation error ends the chat with the stop text`;
  - `exit error ends the chat`;
  - `engine error keeps the chat open`.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement the reducer**, then run. Expected: PASS.
- [ ] **Step 3: Build** `useChat` and `Chat.tsx`, and wire the `Chat` button on the cards.
- [ ] **Step 4: Run** `npm run dev`. Chat with `Planner` (Claude) in a scratch folder for two turns: the model tag shows `sonnet` and token lines appear. Then chat with `Code reviewer` (Codex): a reply arrives with model `gpt-6.1-terra`.
- [ ] **Step 5: Commit** `feat: chat screen`.

---

### Task 11: Draft an agent with AI

**Files:**
- Create: `src/shared/agent-draft.ts` + `tests/shared/agent-draft.test.ts`
- Modify:
  - `src/main/services/agent-runner.ts`: add `oneShot`;
  - `src/main/ipc/index.ts`: `catalog:draft`;
  - `src/preload/index.ts` and `src/shared/types.ts`: `catalog.draft(description: string): Promise<AgentDef>`;
  - `src/renderer/pages/AgentForm.tsx`.
- Test: add to `tests/main/agent-runner.test.ts`.

**Interfaces:**
- Produces:
```ts
// agent-draft.ts
export const DRAFTER: AgentDef; // id 'ark-drafter', name 'Agent drafter', engine auto, tier light, skills [], read-only, prompt DRAFTER_PROMPT
export function extractAgentFile(text: string): string | undefined; // strips ``` fences; returns from the first line that is exactly '---'
// agent-runner.ts
oneShot(agent: AgentDef, projectDir: string, text: string, timeoutMs?: number): Promise<string>; // default 120000
```

**Rules:**
- **`DRAFTER_PROMPT`** tells the model to output **only** an Ark agent file in the §5.1 format:
  - frontmatter with `name`, `description`, `engine: auto`, a `tier` chosen for the work (light for talking and reading, standard for planning and review, heavy for writing code), `skills` chosen **only** from the list in the message, and `permissions`;
  - then a role prompt in the second person that says what the agent does, when it asks the user, and what it must not do;
  - no commentary before or after.
- **`oneShot`:** runs `startAgent`, sends the text, joins the `message` texts until the `turn` event, then stops. It rejects on an `error` event or on timeout, and always stops.
- **`catalog:draft(description)`:**
  - validates a string of 1–2 000 characters;
  - runs `oneShot(DRAFTER, <tempDir>, 'Skills available: ' + names.join(', ') + '\n\nThe agent I need: ' + description)`;
  - then `extractAgentFile`, then `parseAgentFile(file, agentId(name))`;
  - throws `The draft was not a valid agent file: <error>` when that fails.
- **UI:** new agents only. A row at the top of the form with the input `Describe the agent in one sentence` and the button `Draft with AI` (secondary; it shows `Drafting…` while running). The result fills the form, unsaved, and errors show inline.

- [ ] **Step 1: Write the failing tests:**
  - `extractAgentFile strips fences and preamble`;
  - `returns undefined without frontmatter`;
  - `oneShot joins messages until the turn and stops`;
  - `oneShot rejects on error and still stops`.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement**, then run. Expected: PASS.
- [ ] **Step 3: Build the UI row.** In `npm run dev`, draft `An agent that writes release notes from git history`. The form fills with a valid agent whose skills all exist.
- [ ] **Step 4: Commit** `feat: draft an agent with AI`.

---

### Task 12: Verification and docs

**Files:**
- Modify: `README.md` (an `Agents` section: what step 1 does; that `npm run test:live` makes a few cheap calls on your subscriptions; that Ark never changes `~/.claude` or `~/.codex`)

- [ ] **Step 1:** Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Expected: all green.
- [ ] **Step 2:** Run `npm run test:live`. Expected: 2 passed.
- [ ] **Step 3: Manual check** in `npm run dev`, as `AGENTv2.md` requires for UI and main-process changes:
  - the seeds are visible;
  - a two-turn chat with Planner on Claude, and one with Code reviewer on Codex;
  - an agent drafted with AI;
  - an agent imported from agent-skills;
  - `%APPDATA%\ark\agents` holds the `.md` files;
  - closing Ark leaves no `claude.exe` or `codex.exe` started by Ark (check with `Get-Process claude,codex` before and after);
  - `~/.claude/settings.json` and `~/.codex/config.toml` are unchanged (same hash before and after).
- [ ] **Step 4: Commit** `docs: readme for agents`.
