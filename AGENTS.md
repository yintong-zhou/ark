# Codex instructions

Read and follow `AGENTv2.md` before working in this repository. It contains the shared architecture,
development, security, and verification instructions. Direct user instructions take precedence.
The project notes below are adapted from `CLAUDE.md`; keep them aligned when project rules change.

# Ark: project notes

Local Electron desktop app for Windows (Node 22+) that puts Claude Code, Codex and OpenCode in one place: usage view,
agent catalog, and threads where a team of agents plans and builds. Product scope is in `PROJECT.md`, user-facing
behavior in `README.md`.

## Commands

- `npm run dev`: run the app (if "Electron uninstall": `node node_modules/electron/install.js`)
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`: the checks to run before reporting done
- `npm run test:live`: hits the real engines on the user's subscriptions (costs tokens). Ask first, never run unprompted.

## Layout

- `src/main/services/`: app logic. `adapters/` (agent detection and usage), `engines/` (Claude/Codex sessions,
  isolation, project rules), `threads/` (conductor, protocol, build rules, workspace/worktree, store), `files/`
  (explorer and editor: path guard, file operations, watcher), `git/` (the Git UI's runner and operations).
- `src/renderer/editor/`, `src/renderer/files/`, `src/renderer/git/`: module-level stores for open tabs (Monaco, loaded
  lazily), the file tree and the Git status.
- `src/main/services/terminals.ts`, `src/renderer/terminal/`: the user's terminals (node-pty in main, xterm loaded lazily).
- `src/main/ipc/index.ts`: IPC handlers. `src/preload/index.ts`: the `contextBridge` API.
- `src/shared/`: types and pure logic used by both main and renderer.
- `src/renderer/`: React UI (`pages/`, `components/`, `hooks/`).
- `tests/main`, `tests/shared`: unit tests (vitest). `tests/live`: real-engine tests. `tests/fixtures`, `tests/helpers`: shared test data.
- `docs/handoff/`: session handoffs (Italian, newest last). Read the latest before continuing earlier work.
- `docs/superpowers/`: specs and plans. `directives/` and `execution/` are currently empty.

## Rules specific to Ark

- Always use a hyphen (-) in place of an em dash (U+2014), in project text and responses.
- Ark only reads `~/.claude` and `~/.codex`. The one exception is **Connect status line** (edits `settings.json`, with a backup).
- Agents are isolated: each sees only its own skills; the user's memory, plugins and MCP servers are left out. Don't weaken `engines/isolation.ts`.
- Agents are read-only by default. Only the developer builds, inside a Git worktree `ark/<title>-<id>`; risky actions need an approval card,
  except in a thread the user explicitly set to **Full access** (`src/shared/permissions.ts`). Keep that the only bypass.
- Ark's own Git runs without project hooks. Keep that.
- The Git UI runs git only through `services/git/run.ts` (no hooks, literal pathspecs, no prompts).
- The editor writes only inside a project folder or a thread worktree, when the user saves; the renderer sends a root and a
  relative path, and main checks every path (`services/files/guard.ts`). Deletes go to the Recycle Bin.
- The terminal is the user's own shell, not an agent: it gets the user's env minus `ELECTRON_*` (not `cleanEnv`) and is
  not isolated. All PTYs die on reload and quit. node-pty stays out of the asar (`electron-builder.yml`); never rebuild it.
- User data lives in `%APPDATA%\ark` (`agents`, `threads`, `worktrees`, `backups`).
- Codex skills are passed as a list in the instructions, not via native skill roots (codex-cli 0.132.0 lacks them).
- UI text is English. Colors and fonts come from `brand-guidelines.md`.
