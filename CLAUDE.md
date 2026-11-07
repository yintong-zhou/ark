@AGENTv2.md

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
  (explorer and editor: path guard, file operations, watcher).
- `src/renderer/editor/`, `src/renderer/files/`: module-level stores for open tabs (Monaco, loaded lazily) and the file tree.
- `src/main/ipc/index.ts`: IPC handlers. `src/preload/index.ts`: the `contextBridge` API.
- `src/shared/`: types and pure logic used by both main and renderer.
- `src/renderer/`: React UI (`pages/`, `components/`, `hooks/`).
- `tests/main`, `tests/shared`: unit tests (vitest). `tests/live`: real-engine tests. `tests/fixtures`, `tests/helpers`: shared test data.
- `docs/handoff/`: session handoffs (Italian, newest last). Read the latest before continuing earlier work.
- `docs/superpowers/`: specs and plans. `directives/` and `execution/` are currently empty.

## Rules specific to Ark

- Ark only reads `~/.claude` and `~/.codex`. The one exception is **Connect status line** (edits `settings.json`, with a backup).
- Agents are isolated: each sees only its own skills; the user's memory, plugins and MCP servers are left out. Don't weaken `engines/isolation.ts`.
- Agents are read-only by default. Only the developer builds, inside a Git worktree `ark/<title>-<id>`; risky actions need an approval card.
- Ark's own Git runs without project hooks. Keep that.
- The editor writes only inside a project folder or a thread worktree, when the user saves; the renderer sends a root and a
  relative path, and main checks every path (`services/files/guard.ts`). Deletes go to the Recycle Bin.
- User data lives in `%APPDATA%\ark` (`agents`, `threads`, `worktrees`, `backups`).
- Codex skills are passed as a list in the instructions, not via native skill roots (codex-cli 0.132.0 lacks them).
- UI text is English. Colors and fonts come from `brand-guidelines.md`.
