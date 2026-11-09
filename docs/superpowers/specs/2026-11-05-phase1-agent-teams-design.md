# Ark Phase 1 - Agent teams in threads - Design

Date: 2026-11-05 · Source brief: `PROJECT.md` (Phase 1) · Builds on: `docs/superpowers/specs/2026-11-05-phase0-usage-design.md` · Visual rules: `brand-guidelines.md` · Working rules: `AGENTv2.md` · Mockups: `.superpowers/brainstorm/30747-1793885178/content/` (`thread-team.html`, `catalog-and-team.html`, `build-phases.html`)

Items marked **[call]** are decisions made by the designer, not by the user. Everything else was decided by the user or comes from the brief.

## 1. Intent

Today the user runs one Opus session, driven by the Superpowers skills, for the whole cycle: design, coding and review. The quality is good. The problem is **cost**: Opus also does the easy parts (chatting, reading a plan, deciding who does what) and burns the 5-hour and weekly limits that Phase 0 now makes visible.

Phase 1 splits that single agent into a **small team of agents that work in a thread**, like colleagues in a Slack channel. Each agent has a role (project manager, planner, developer, reviewer, security, marketing, SEO, …), **its own model and its own skills**. The team talks among itself to understand what the project needs and tags the user when it needs a confirmation. Once the plan is agreed, the developer builds it phase by phase, and every phase is checked by other agents before moving on.

Success: the user gets the same quality they get from Opus alone today, for a clearly smaller share of their limits, because cheap models do the cheap work and the strong models only do the hard work.

## 2. Goals, non-goals, anti-goals

**Goals**
- Detect the engines on the machine (Claude Code, Codex) at startup, reusing Phase 0 detection; allow manual configuration in a settings file.
- An **agent catalog**: a collection of agents, each with a role prompt, an engine/model setting and a list of skills. Agents can be created, edited and imported.
- **Projects and threads**: a project is a local folder; a thread is one piece of work inside it, with its own team.
- A **team phase** at the start of each thread: the project manager proposes which agents are needed; the user approves or adds agents from the catalog. Teams differ from thread to thread.
- A **planning phase**: the team discusses, tags the user (`@you`) when in doubt, the user answers or reacts, the planner writes the plan, the user approves it.
- A **build phase**: the developer works through the plan's phases on its own. Each phase runs development → code review → security review, then moves on.
- **Model routing**: per agent, either a fixed engine/model or **Auto**, where Ark picks the model suited to the work.
- **Cost per thread**: how much of the 5-hour and weekly limits the thread and each agent consumed, using Phase 0's data.

**Non-goals (Phase 1)**
- OpenCode and any engine other than Claude Code and Codex (user decision; the engine layer stays open to them).
- Kanban board and project memory shared across agents (brief items, deferred) **[call]**.
- Merging the thread's branch into the main branch, and other Git UI (Phase 3). File editor and terminal (Phase 2).
- API-key accounts as a target: Phase 1 runs agents through the user's subscriptions **[call]**.
- OS notifications **[call]**: a thread that waits for the user shows a badge in the sidebar.
- macOS/Linux.

**Anti-goals (a failure even if it technically works)**
- A poor cost/quality ratio: an agent running on a model stronger than its work needs, or a cheap model doing work it does badly (user).
- **An agent that sees skills it was not given.** Every agent only has access to its own skills (user). The same applies to plugins, MCP servers, hooks and the user's personal instruction files (§6.3) **[call]**. If Ark cannot restrict an agent this way on an engine, that agent does not run on that engine **[call]**.
- Agents looping (developer ↔ reviewer, or endless discussion) and burning limits without converging.
- Changing the project's main branch, or the user's `~/.claude` / `~/.codex` configuration, without explicit consent (Phase 0 rule, kept).
- Code reaching the end of a phase without having passed review and security review.

## 3. Constraints

- Everything in Phase 0's constraints still holds: Windows only, the `AGENTv2.md` stack and directory layout, the Electron security rules, runtime data in `app.getPath('userData')`.
- Installed today: Claude Code 2.1.318 (claude.ai subscription), Codex CLI 0.165.0 (ChatGPT team plan).
- **Verified on this machine (2026-11-05):**
  - Claude Code headless (`claude -p`, `--output-format stream-json`) runs on the subscription with `--model haiku`. `--append-system-prompt` gives the agent its role (it answered as the project manager). The stream carries a `system/init` event (model, skills, plugins, agents) and a `rate_limit_event` for the 5-hour window. Other relevant flags exist: `--system-prompt[-file]`, `--effort`, `--input-format stream-json`, `--resume`, `--session-id`, `--permission-mode`, `--allowedTools`/`--disallowedTools`, `--setting-sources`, `--plugin-dir`, `--agents`.
  - **By default a headless Claude Code session loads all 157 of the user's skills and 17 plugins**, plus the user's MCP servers (including a trading connector that can place orders, Gmail and Drive) and hooks that inject instructions at session start. Isolation is therefore real work, not a flag that is already on. Flags that exist in `claude --help`: `--safe-mode` (starts without CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands and agents), `--disable-slash-commands` (disables all skills and commands), `--strict-mcp-config` with `--mcp-config`, `--setting-sources`, `--plugin-dir`. `--bare` is not usable: it does not keep the subscription login.
  - Codex `app-server` (the channel Phase 0 already uses): `thread/start` accepts `model`, `cwd`, `sandbox`, `approvalPolicy`, `config`, `baseInstructions`, `developerInstructions`; `turn/start` can change `model` and `effort` **per turn**. Skills: `skills/list` (Codex sees 40: 35 user, 5 system), `skills/extraRoots/set`, `skills/config/write`. Not yet tested live: that `developerInstructions` is honoured, and how to restrict a thread's skills.
  - Skills use the same `SKILL.md` format on both engines. The user keeps copies in `~/.claude/skills` and `~/.agents/skills`; Superpowers is a Claude Code plugin and is not visible to Codex.
  - The user has no personal agents in `~/.claude/agents`; plugin agents exist (e.g. `agent-skills:code-reviewer`, `agent-skills:security-auditor`).
- Agents run through the user's installed CLIs and their subscriptions, never by reading or storing OAuth tokens.

## 4. Concepts

- **Engine**: an installed coding agent that Ark can drive (Claude Code, Codex). Each engine offers models, grouped by Ark into three tiers: **light**, **standard**, **heavy** **[call]**. Claude: Haiku / Sonnet / Opus. Codex: the builder maps the models (and reasoning efforts) that `app-server` reports to the same three tiers.
- **Agent**: a catalog entry. Name, short description, role prompt, engine setting, skills, and a permission profile (§6.4).
- **Engine setting** per agent: `auto` (Ark picks engine and tier per task, §7), an engine only (`claude`, `codex`: the engine is fixed and the agent's `tier` picks the model), or an exact model (`claude:opus`, `codex:<model>`, …).
- **Project**: a local folder that is a Git repository. Ark offers `git init` when it is not one **[call]**.
- **Thread**: one piece of work in a project, with its own team, transcript, plan and Git branch. Phases: `team` → `planning` → `build` → `done`.
- **Team**: the agents in a thread. There is always a **project manager**, who leads the thread; the rest depend on the work.

## 5. Agent catalog

### 5.1 Format
One Markdown file per agent, with a YAML header, in the same shape as Claude Code agents (`.claude/agents/*.md`), so existing agents can be imported and files can be edited in any editor and kept in Git:

```markdown
---
name: Planner
description: Turns the team's decisions into a phased plan.
engine: auto            # or claude, codex, claude:sonnet, codex:<model>, ...
tier: standard          # light | standard | heavy; ignored when engine names an exact model
skills: [writing-plans]
permissions: read-only  # read-only | build (§6.4)
---
You are the planner of a small team working in Ark. ...
```

The **role prompt** says who the agent is: responsibilities, when to call the user, what it must not do. **Skills** say how to do specific things. A skill is not an agent: an agent lists the skills it may use, and several agents can share one skill.

### 5.2 Where agents live
- The user's catalog: `<userData>/agents/*.md` **[call]**. Phase 1 has one global catalog, not per-project catalogs.
- Import: `~/.claude/agents/*.md` and plugin agents (e.g. `agent-skills:security-auditor`) can be imported, which copies them into the catalog with an engine and a skills list added. The original files are never modified.

### 5.3 Seed agents **[call]**
The catalog ships with agents that reproduce the user's current Superpowers cycle, so a first thread works without any setup:

| Agent | Engine (default) | Skills | Permissions |
|---|---|---|---|
| Project manager | auto (light) | brainstorming | read-only |
| Planner | auto (standard) | writing-plans | read-only |
| Developer | claude:opus | test-driven-development, executing-plans, verification-before-completion | build |
| Code reviewer | **codex** (user decision), tier standard **[call]** | code-review | read-only |
| Security reviewer | **codex** (user decision), tier standard **[call]** | security-review | read-only |
| Marketing, SEO | auto (light) | none | read-only |

Skill names are the ones installed today. `code-review` and `security-review` exist only on the Claude side; §5.5 is what lets the Codex reviewers use them.

### 5.4 Catalog screen
- **Engines found on this machine** at the top (CC / CX tags with the logged-in plan, from Phase 0) and "add manually", which writes the engine to `<userData>/engines.json` **[call]**.
- One card per agent: name, description, engine setting, skills. "New agent" opens a form (name, description, role prompt, engine, skills chosen from the installed ones, permissions).
- **Draft with AI**: the user describes the agent in one sentence; a light-tier agent writes a draft of the form for the user to approve **[call]**.
- A card is flagged when the agent cannot run as defined: an engine that is not installed, a skill that is not installed anywhere, or an engine on which Ark cannot isolate the agent.

### 5.5 Skill library **[call]**
- Ark indexes every installed skill, wherever it lives: `~/.claude/skills`, the skills of installed Claude Code plugins (e.g. Superpowers), `~/.agents/skills`, `~/.codex/skills`. Same name in several places: the user-level copy wins over a plugin copy.
- An agent's skills are resolved from this index, not from the engine's own list. For each session Ark builds a **private skills folder** that holds copies of only that agent's `SKILL.md` folders, and points the engine at it. This is how a Codex reviewer gets `code-review`, and how Auto can move an agent to the other engine without losing its skills. It is also the natural way to get isolation (§6.3).
- The user's skill folders are only read, never changed.
- A skill written for one engine may mention that engine's tools (Superpowers mentions Claude Code tools). The catalog shows each skill's origin. A badly behaving skill on the other engine is fixed by pinning that agent's engine.

## 6. Engines: running an agent

### 6.1 Engine sessions and handoffs **[call]**
An agent runs as a session on its engine: a Claude Code headless session (stream-json in and out, or resumed by session id), or a Codex `app-server` thread. The agent keeps its own history inside that session. When it is the agent's turn, Ark sends it only the thread messages it has not seen yet, not the whole transcript again.

Sessions do not live forever. This follows the user's own practice of handing off at 40–50% context to keep quality, and it is cheaper:
- **Developer**: a fresh session for each plan phase. It starts from a handoff made of the plan, the phase's goal, a short summary of the previous phases and the branch state.
- **Reviewers**: a fresh session for each review. They start from the phase's goal and its diff.
- **Manager, planner and the other planning agents**: one session per thread. When a session reaches **50% of its context window**, Ark asks the agent for a handoff summary and continues in a fresh session from it.
- Ark never relies on the engine's automatic compaction.

### 6.2 Role and model
- Claude Code: role prompt through `--append-system-prompt` (keeps Claude Code's base prompt, which the coding tools need); model through `--model`, plus `--effort` where useful.
- Codex: role prompt through `developerInstructions` on `thread/start`; model and effort through `thread/start` and per turn through `turn/start`.

### 6.3 Isolation (hard requirement)
An agent's session gets only what its file gives it **[call]**:
- **Skills:** only the ones listed (through the private folder of §5.5).
- **Turned off:** all of the user's other skills, plugins, MCP servers, hooks (e.g. modes that inject instructions at session start) and personal instruction files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`). Phase 1 agents have no MCP servers; choosing MCP servers per agent comes later.
- **Kept:** the **project's own instruction files** (`CLAUDE.md` / `AGENTS.md` at the project root, with their imports). They are the project's rules, and the developer needs them to work the way the project expects. Ark passes them to every agent of that project.
- **Engine built-in skills** that cannot be turned off (Claude Code's bundled skills, Codex system skills) are tolerated, because they are part of the engine and not the user's library. The acceptance test lists them, and the agent card shows them.

Mechanism and test:
- The builder picks the mechanism per engine after testing it. Candidates on Claude Code: `--safe-mode` (keeps the subscription login; verify) plus the private skills folder, `--disable-slash-commands`, `--strict-mcp-config`, `--setting-sources`, `--plugin-dir`. Candidates on Codex: `skills/extraRoots/set`, `skills/config/write`, per-thread `config`.
- **Acceptance test:** for each engine, start an agent with two skills. Check what the engine reports (`system/init` skills, plugins and MCP servers on Claude Code; `skills/list` on Codex) against the agent's list plus the tolerated built-ins.
- The mechanism must not modify `~/.claude` or `~/.codex`. If it can only be done by changing them, stop and ask the user.

### 6.4 Permissions **[call]**
- **read-only** agents (manager, planner, reviewers, marketing, SEO) can read the project but cannot edit files or run commands that change anything. Claude Code: edit/write tools disallowed. Codex: `read-only` sandbox.
- **build** agents (developer) work in the thread's **Git worktree** (§8.3). Inside it they can edit files and run the project's checks (typecheck, lint, test, build, scripts from `package.json`). Anything else is a risky action and asks the user in the thread with an approval card (Allow / Deny), as the brief requires: commands outside the worktree, installing packages, network access, `git push`, deleting files outside the worktree. On Claude Code this goes through its permission prompt mechanism; on Codex through `approvalPolicy` with approvals routed to Ark. The builder verifies both.

## 7. Model routing (Auto)

- Auto is a **deterministic rule table in the main process**, not a model deciding **[call]**, as `AGENTv2.md` asks for (push decisions into deterministic code).
- The table maps the kind of work to a tier:
  - **light**: chatting, reading, summarising, routing, team proposals;
  - **standard**: writing the plan, code review, security review;
  - **heavy**: implementation and hard decisions.
- An agent's `tier` is its starting point. The project manager can mark a task as **hard**, which moves it up one tier for that task only.
- Engine choice under Auto **[call]**: Claude by default. When Claude's 5-hour or weekly window is at **90% or more** (Phase 0 data), Auto runs light and standard work on Codex instead. The agent keeps its skills thanks to §5.5. Agents with a fixed engine are never moved.
- Every agent message shows the model that produced it (tag next to the name, as in the mockup).

## 8. Thread lifecycle

### 8.1 Team phase
The user writes what they want. The project manager proposes a team from the catalog, with a one-line reason for each agent and for leaving the obvious ones out ("Marketing and SEO are not needed: it is a library"). The proposal is a card with **Approve team**, **+ add from catalog** and a reply box. The thread moves on only after approval.

### 8.2 Planning phase
- The project manager leads. **It decides who speaks next** **[call]**: one agent per turn, so there is never a free-for-all where everyone answers everything.
- Any agent can tag `@you`. A tag sets the thread to **waiting for you** (sidebar badge) and pauses the team until the user answers. The question can carry quick replies (chips); the user can also reply in text or react to any message (👍 / 👎). Reactions reach the agents as messages ("the user reacted 👍 to …").
- The user can write in the thread at any time, and can `@` a specific agent.
- The planner writes the plan as a Markdown file split into **phases**, each with its goal and its checks. A **plan card** links to it with **Start developer**, which is the user's approval. Nothing is built before that click.
- Discussion budget **[call]**: if planning goes 20 agent turns without a plan, the project manager stops and tags the user with a summary.

### 8.3 Build phase
- On **Start developer**, Ark creates a Git worktree on a new branch `ark/<thread-slug>` from the project's current HEAD **[call]**. The developer works only there; the main branch is never touched.
- For each phase of the plan, in order:
  1. **Development**: the developer implements the phase and runs the checks. The phase cannot leave this step while checks fail.
  2. **Code review**: the code reviewer (Codex) reads the phase's diff.
  3. **Security review**: the security reviewer (Codex) reads the same diff.
  4. Findings from either review go back to the developer. **After 2 rounds without agreement, the project manager tags the user** with the open points **[call]**.
  5. When both reviews pass, the phase is marked done and the next one starts.
- Each phase shows as a card in the thread: ✓ development, ✓ review (n notes, fixed), ✓ security, ✓ tests n/n, with its state (in progress, in review, done, blocked).
- When the last phase is done, the project manager posts a summary: what was built, the branch name, the review notes, and the cost (§9). The thread moves to `done`. Merging is up to the user (Phase 3 adds Git UI).

## 9. Cost

Honest numbers first, following Phase 0's anti-goal of numbers that look precise but aren't **[call]**:
- **Main measure: tokens per agent and per model**, which are exact. They come from the engine events: Claude Code's `result` event of each turn, Codex's `thread/tokenUsage/updated`. This is what shows whether the cheap models did the cheap work.
- **Limits:** the 5-hour and weekly windows belong to the account and move in whole percents. Ark shows how they moved while the thread ran (e.g. "5h 41% → 44% while this thread ran"), labelled as **including your other sessions**. It never shows them as the thread's own cost.
- When an engine reports no percentage, only tokens are shown.
- Sources for the windows: Claude Code `rate_limit_event`, Codex `account/rateLimits/read`. The window maths from Phase 0's `usage-math.ts` is reused.
- The thread's right panel shows tokens per agent and model, plus the window movement. The final summary shows the same, so the mockup's "Thread cost: 5h +3%" becomes these two lines.
- The thread header also carries the brief's per-thread status line: active models, context of the busiest agent, 5-hour and weekly bars, number of agents running **[call]**.
- Ark-driven sessions feed the Phase 0 usage screens too, so the main view stays complete.

## 10. Screens

Layout as in `thread-team.html`: **projects and threads** on the left, the **thread** in the middle (messages, cards, composer with `@` mentions), the **team** on the right (agents, model, state, thread cost).

New screens and elements:
- Agent catalog and agent form (§5.4), `catalog-and-team.html`.
- Team proposal card (§8.1), plan card with Start developer (§8.2), phase cards (§8.3), approval card for risky actions (§6.4), `build-phases.html`.
- Sidebar badge on threads waiting for the user.
- The Phase 0 Usage screen stays reachable from the navigation; the global status bar stays at the bottom.

Brand rules from Phase 0 §7 apply unchanged: dark theme, accent `#00A896` only on calls to action (Approve team, Start developer, New agent, Allow), Outfit / Hanken Grotesk bundled, 8 px grid, radius 2–4 px. UI copy in English **[call]**. Agents write in the language the user writes in **[call]**.

## 11. Persistence **[call]**

- `<userData>/agents/*.md`: the catalog.
- `<userData>/engines.json`: manually added engines and overrides.
- `<userData>/projects.json`: projects (name, folder).
- `<userData>/threads/<id>/thread.json`: project, team, phase, plan path, branch, engine session ids per agent, cost so far.
- `<userData>/threads/<id>/messages.jsonl`: the transcript (messages, reactions, cards), append-only.
- The plan file lives in the thread's worktree (`docs/plans/…`), so it is versioned with the code.
- Closing Ark stops running agents. Reopening a thread resumes the engine sessions by id.

## 12. Build order **[call]**

Each step is usable on its own and gets its own implementation plan:

1. **Engines and catalog**: run one agent (role, model, only its skills) in a thread and chat with it, on both engines. Includes the skill-isolation acceptance test (§6.3). If isolation fails on an engine, stop and report before going on.
2. **Team threads**: projects, threads, team phase, planning phase with the manager choosing speakers, `@you`, reactions, plan card.
3. **Build phases**: worktree, developer → code review → security review per phase, the 2-round limit, phase cards, approval cards, final summary.
4. **Auto routing and cost**: the tier table, the 90% switch, per-thread and per-agent cost.

## 13. Verification

- `package.json` scripts: `typecheck`, `lint`, `test`, `build`, `dev`.
- Unit tests: agent file parsing and validation; the Auto rule table (including the 90% switch and the "hard" bump); speaker selection limits (20 turns); the review loop (2 rounds then escalation); the permission profile mapped to each engine's flags; transcript persistence and resume.
- Unit tests also cover the skill index and private-folder build (§5.5) and the handoff triggers: new phase, new review, 50% context (§6.1).
- Engine tests against the installed CLIs, kept cheap (light tier, one-line prompts): role prompt honoured, model as requested, **skills, plugins and MCP servers exactly as given** (§6.3), project instruction file present, `rate_limit_event` and Codex token usage received.
- Manual check in dev mode: one full thread on a small throwaway repo, from team proposal to final summary, with the main branch untouched and the cost shown.

## 14. Left to the builder

The exact Claude Code and Codex mechanisms for skill isolation and approvals (within §6.3 and §6.4), process management of engine sessions, how Codex models map to tiers, the message format sent to each agent on its turn, how quick replies are encoded, list virtualisation and other component details, and the slug format for branches.

## 15. Open questions from `PROJECT.md` (status after this design)

- `rate_limit_event` in headless mode: received for the 5-hour window on a live Haiku call; still to confirm that the weekly window and the percentage are always present (step 1).
- Terms of use for automated CLI use with subscriptions: **still open**. Ark drives the user's own installed CLIs on their own machine; check both providers' terms before a public release.
- Kanban board, shared project memory, OpenCode, checkpoints/rollback of agent changes: deferred beyond Phase 1.
