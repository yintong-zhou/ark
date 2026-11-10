# Agent security hardening

Status: approved by the user on 2026-11-10 (in chat). Source: Codex audit `task-mwauas4k-bqamlm`, each finding checked against the code before this design.

## Intent

The user wants to open any repository in Ark, including code they do not trust. A hostile repository, in any permission mode other than **Full access**, must not run code with the user's privileges, or act outside the thread worktree, without the user saying yes. Today it can, in several ways listed below.

## Goals

1. Outside Full access, the project's own code (its checks) runs unsandboxed only after the user consents, once per thread.
2. No Claude session, of any role, starts on a `.claude/settings.json` that could run commands, change the environment or skip approval cards.
3. Close the smaller holes the audit found: check flags that write outside the worktree, project skills that slip past the skill gate, a `CLAUDE.md` link read from outside the project.
4. Pause and a permission change really stop the work they claim to stop.
5. README and PROJECT describe what sessions actually do.

## Non-goals

- A real sandbox for checks on Windows. The user chose consent over a sandbox.
- A capability matrix per role, mode and engine (audit A3), and versioned schemas for stored threads (audit A4). Neither fixes a concrete defect today.
- Any change to Full access behavior.

## Anti-goals

- A consent card that reads like "allow npm test". It must say the user lets the repository's code run with their privileges; anything softer misleads.
- A card on every phase or every check run. The user asked for once per thread.
- Weakening `engines/isolation.ts`, the approval policy or the no-hooks Git rule to make the new checks pass.

## Verified problems

| Id | Where | Problem |
|----|-------|---------|
| V1 | `threads/conductor.ts:750`, `threads/workspace.ts:119` | After every developer turn Ark runs the project's checks with `execFile(..., { shell: true })` in the main process: full user privileges, Ark's environment, no card. The developer can change what those checks run. |
| V1b | `engines/isolation.ts:43-73`, `engines/approval-policy.ts:28` | A Claude developer in Ask has `acceptEdits` plus `npm run test/lint/...` preallowed, and in Auto `isProjectCheck` allows them. It can edit a script and run it with no card. A Codex developer's own commands run in the Windows sandbox and are not affected. |
| V2 | `agent-runner.ts:76-103` | Claude chat and planning sessions start with `--setting-sources project` and no settings check. `claudeSettingsProblem` runs only in the conductor's build and review paths. A denylist is not enough: besides hooks and `apiKeyHelper`, project settings can set `env` (for example `ANTHROPIC_BASE_URL`) and other command helpers, and `-p` skips Claude's workspace trust prompt. `--setting-sources project` must stay: it is what loads the project's `CLAUDE.md`. |
| V3 | `engines/approval-policy.ts:10` | `PY_ARG` accepts absolute flag values (`pytest --basetemp=/x` deletes `/x`; `ruff --output-file=/x`) and arguments like `-p module` or `-c file` (loads a plugin or another config). |
| V4 | `agent-runner.ts:88-95` | For project skills only folder names are forbidden; Claude lists skills by frontmatter `name`, so a folder whose `name` differs passes `checkClaudeInit`. |
| V5 | `engines/project-rules.ts:45` | The top `CLAUDE.md` is followed through `realpathSync` and read with no containment check; imports are checked, the file itself is not. |
| I1 | `threads/conductor.ts:421` (pause), `:132` (permission change), `workspace.ts:211` | Halting bumps the generation, but `runChecks` keeps running the whole batch while the thread is already saved `idle`, which also re-enables Git UI writes on the worktree. |
| I2 | `threads/conductor.ts:217,677,727` | The Claude settings check runs whatever the engine, so it can block an all-Codex build, and it is missing where Claude does start (V2). |
| I3 | `isolation.ts:43`, `approval-policy.ts:9`, `workspace.ts:202` | Three different definitions of "a project check" (Ask preallowed rules, Auto policy, Ark's runner). |
| I4 | `README.md:67,169`, `PROJECT.md:61`, `services/settings.ts:26` | Docs say advisors have no shell (Codex advisors are sandboxed, not shell-less), one worktree per agent (it is one per thread), handoff at 50% (default is 40%). |

## Design

### 1. Code consent, once per thread (V1, V1b, I3)

- "Project code" here means the project's checks run unsandboxed: Ark's own check runs, and a Claude developer's check commands. A Codex developer's sandboxed commands are unchanged.
- Outside Full access (Ask and Auto), before Ark first needs to run project code in a thread, the thread shows a card. Its text states that the user lets the repository's code run on their computer with their privileges, and that the developer can change that code. Two answers: allow, deny.
- The answer is stored on the thread and holds for the rest of the thread. It survives restarts. *Implementer's call:* it also survives a permission mode change within the thread; switching to Full access needs no consent, and switching back uses the stored answer (or asks, if there is none).
- **Allowed:** behavior as today. Ark runs the checks after each developer turn; the Claude developer's check commands need no card (Ask preallowed rules, Auto `isProjectCheck`).
- **Denied:** Ark does not run the checks and says so in the checks note ("Checks not run: you did not allow project code in this thread."). The build continues to review as if no check failed. The Claude developer gets no preallowed check commands, so each one goes to a normal approval card. *Implementer's call:* a denial is final for the thread, except by switching to Full access.
- *Implementer's call, when the card is shown:* if the worktree has checks when the build starts, the card is shown at build start, before the first developer turn, since the user is present (they just pressed Start developer) and the developer session's preallowed commands are fixed when it starts. If it has none, no card is shown; until one is answered the Claude developer has no preallowed check commands, so each one it runs gets a normal approval card, and the consent card is shown before Ark's first check run (for example after the developer added a `package.json`). An allow takes effect from the next developer session (sessions are fresh per phase); the current one is not restarted.
- One shared definition of "a project check" feeds the runner, the Ask preallowed rules and the Auto policy, so the same command is never allowed on one path and carded on another. Differences between paths, if any remain, are explicit and tested.

### 2. Claude settings allowlist before every Claude start (V2, I2)

- The check moves from the conductor into the Claude launch path (`agent-runner.ts`, before `startClaude`), for every role and every mode except none: it runs always. The conductor keeps only checks that are engine-independent, so a Codex session is never blocked by a Claude settings file.
- `.claude/settings.json` is checked against an allowlist of keys. Any key outside it refuses the start with a message naming the file and the keys, as today. Build sessions keep the current extra refusals (`permissions.allow`, `permissions.defaultMode`, `permissions.additionalDirectories`).
- *Builder's call:* the exact allowlist; start from keys that cannot run a command or change the environment (for example `permissions.deny`, `permissions.ask`) and keep it short. A missing file is fine; an invalid file fails closed.
- *Implementer's call:* `--setting-sources project` may load more than `settings.json` (project `.claude/commands` with `!` shell lines, `.claude/agents`, output styles). The plan starts with a short survey of what a `-p` session loads from the project; each item that can run a command or widen tools is refused or neutralized like the settings keys, and what is left is stated in the README. Subagents are already unusable (no Task tool in `--tools`). If the survey finds the work grows well past this design, stop and ask the user.
- Defense in depth, *builder's call after a live check:* also pass Ark-owned settings (for example `--settings` with `disableAllHooks: true`) if Claude Code honors them over project settings.

### 3. Point fixes

- **V3:** replace `PY_ARG` with an explicit list of harmless pytest and ruff flags. Anything that writes output, deletes a folder, sets a root, loads a plugin or another config (`--basetemp`, `--output-file`, `--rootdir`, `-p`, `-c`, `--config`...) needs a card. Every path argument still allowed is checked to stay inside the worktree.
- **V4:** forbid the frontmatter `name` of every project skill as well as its folder, as is already done for user skills.
- **V5:** check the canonical path of the top `CLAUDE.md` against the canonical project root before reading it, as imports are checked.

### 4. Pause that stops (I1)

- `runChecks` takes a cancel signal. Halt (pause, permission change, delete, quit) stops the running check with the existing tree kill and skips the rest of the batch.
- The thread is not reported `idle`, and the worktree stays busy for the Git UI, until the check processes have exited.
- *Implementer's call:* the wait is bounded (about 10 s after the kill). A hostile repo can start processes that escape `taskkill /T`; after the bound the thread goes `idle` anyway with a note that processes started by the checks may still be running. The thread shows as running (not a new status) during the wait; `pause` and the permission change may become async for this.

### 5. Docs (I4)

- README: describe per engine what read-only means (Claude: no shell tools; Codex: read-only sandbox). Document the consent card and the settings allowlist.
- PROJECT: one worktree per thread is the current design; a worktree per agent stays roadmap.
- Handoff threshold: state the real default (40%) and that it is configurable.

## Constraints

- Everything in `CLAUDE.md` "Rules specific to Ark" holds, in particular isolation, read-only by default, Full access as the only bypass, Git without hooks.
- Existing tests that pin `claudeArgs` exactly change only where this design requires it.
- Each fix leaves one test that fails if the fix is undone (consent allowed/denied/no checks, settings allowlist per role, the V3 flags from the audit, a skill with a different frontmatter name, a linked `CLAUDE.md`, a pause during a slow fake check).
- `npm run test:live` costs tokens: ask the user before running it.

## Findings: what a `-p` session loads from the project

Desk survey against Claude Code 2.1.321 (`claude --version`, `claude --help`) and the official docs. **No live probe was run** (they cost tokens): every row is "not verified live" and rests on the doc page cited. Ark starts Claude with `-p --setting-sources project --strict-mcp-config --tools <whitelist>`; in `-p` no trust dialog ever appears, so the "folder never trusted" column of [permissions: What runs before you trust a folder](https://code.claude.com/docs/en/permissions) is the one that applies.

| What the project supplies | Risk in `-p` (source) | How Ark handles it |
| --- | --- | --- |
| `.claude/settings.json`: hooks, `env`, `apiKeyHelper` and other helpers | Used in `-p` without trust: can run commands and change the environment ([permissions](https://code.claude.com/docs/en/permissions), "What runs before you trust a folder") | Refused by the key allowlist in `claudeSettingsProblem` (section 2). Only `$schema` and `permissions.deny/ask` pass |
| `permissions.allow`, `additionalDirectories`, `defaultMode`, `outputStyle` in settings | `allow` and `additionalDirectories` are not used in an untrusted `-p` run; `bypassPermissions`/`auto` defaults are ignored from project files ([permissions](https://code.claude.com/docs/en/permissions), [settings](https://code.claude.com/docs/en/settings)) | Refused by the same allowlist anyway (fail closed) |
| `.claude/settings.json` edited **while the session runs** | Docs: Claude Code watches settings files and reloads them mid-session, "including edits to `permissions`, `hooks`" and a file created mid-session ([settings](https://code.claude.com/docs/en/settings), "When edits take effect") | **Known limit, no code change.** The allowlist runs only at start. A developer's edit under `.claude` gets an approval card, but a check command (`npm test`) that writes the file would not. Closing it needs `--settings` hardening (below) or a live probe. Not verified live |
| `--settings '{"disableAllHooks":true}'` as an Ark-owned override | Docs: `--settings` sits above project and local files ([settings](https://code.claude.com/docs/en/settings), "Settings precedence"), so it should win over a project hook. Whether `disableAllHooks` actually stops a project hook is untested | Not added. Needs the live probe (a). Not verified live |
| `.claude/skills/*` and `.claude/commands/*.md` | Same mechanism; `!` shell injection and `allowed-tools` pre-approval run "even in a `-p` run in a folder you've never trusted", and the model may call them through the Skill tool ([skills](https://code.claude.com/docs/en/skills)). Skill frontmatter `hooks` also run | `checkClaudeInit` refuses any listed skill whose name is forbidden. **Changed in this task:** the forbidden set now also holds each project skill's frontmatter `name` (it was the folder name only) and every `.claude/commands` file name (`x` and `dir:x`), via `projectSkillNames`. Whether commands appear in the init `skills` list is not verified live; if they do not, they are not caught |
| `/command` in a user message | A message starting with `/` invokes a skill or command | Ark's messages start with `[Ark]` or a speaker label, never `/` |
| `.claude/agents/*.md` (subagents) | Need the Agent tool to be spawned ([sub-agents](https://code.claude.com/docs/en/sub-agents)); their frontmatter hooks and inline `mcpServers` are skipped in an untrusted `-p` run ([permissions](https://code.claude.com/docs/en/permissions)); `permissionMode` cannot widen an `acceptEdits`/stricter parent | `--tools` has no Agent/Task, so no subagent can start |
| `.mcp.json` | Connected without asking in an untrusted `-p` run ([permissions](https://code.claude.com/docs/en/permissions)) | `--strict-mcp-config` ignores it; `checkClaudeInit` refuses any `mcp_servers` entry |
| `.claude/workflows/*.js` | Each file becomes a `/<name>` command ([claude-directory](https://code.claude.com/docs/en/claude-directory)) | Only reachable by a `/` message (never sent); no workflow tool in `--tools`. Not verified live |
| `.claude/output-styles/*`, `.claude/rules/*.md`, `CLAUDE.local.md` | Text added to the prompt; cannot run a command or widen tools. `outputStyle` is a settings key (allowlist refuses it) | Kept by design. A `rules/` symlink to a file outside the project is an "external import" too ([memory](https://code.claude.com/docs/en/memory)); it loads only after the user approved external imports for the folder, and a symlink needs Developer Mode on Windows. Not handled, residual |
| `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and their `@` imports | Docs: "Both relative and absolute paths are allowed", `@~/...` included, up to four hops. A path outside the working directory is an "external import": an approval dialog the first time in an interactive session, otherwise disabled; once approved for the folder it loads with no prompt ([memory](https://code.claude.com/docs/en/memory), "Import additional files"). So an import such as `@~/.ssh/id_rsa` reaches the model if the user ever approved it. A `-p` run shows no dialog, and where the approval is stored was not checked. Not verified live | **Changed in this task:** `claudeImportProblem` (in `engines/project-rules.ts`, same containment as `codexProjectRules`, links included) refuses the Claude start with a message naming the file and the import, for any import of an existing file outside the project, nested files included. Imports in code spans and fences are skipped, as Claude Code does. A Codex session is not blocked (it inlines only imports inside the project) |
| Ancestor `CLAUDE.md` files | Loaded from every folder above the project | Already refused (`ancestorInstructions`) |
| `--bare`, `--safe-mode`, `--restricted`, `--disable-slash-commands` (in `claude --help`) | Would turn off project loading wholesale, but `--bare` skips CLAUDE.md and plugin skills too, `--restricted` removes Bash/PowerShell and ignores project settings, and `--disable-slash-commands` removes the agent's own skills | Not used: they break the build role and the agent's skills. Worth a live look as a replacement for the allowlist only if a future need arises |

Live probes still open, for a session with the user's go-ahead (cheap `claude -p --model haiku` calls in a temp repo): (a) does `--settings '{"disableAllHooks":true}'` stop a project hook; (b) does a session pick up a `.claude/settings.json` written mid-session (docs say yes); (c) does a `CLAUDE.md` import of an absolute path outside the project load, and does it need a stored approval in `~/.claude.json`.

## Left to the builder

- How the consent card is modeled (new message kind or a variant of the approval card), where the answer is stored on `Thread`, and its exact wording within the anti-goal above.
- The settings allowlist contents and whether `--settings` hardening works.
- The harmless flag list for pytest and ruff.
- Order of work; the suggested order is 2, 1, 3, 4, 5 (the settings check closes the hole that needs no build at all).
