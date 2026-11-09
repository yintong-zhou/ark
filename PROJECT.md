# Ark — Where coding agents work together

## Overview

Ark is a local, open-source desktop app (React + Electron) that merges the channel-and-thread structure of Discord/Slack with a Visual Studio Code–style IDE. It orchestrates the coding agents installed on your machine (Claude Code, Codex, OpenCode) as a single agentic system.

## Problem and opportunity

- People who use several coding agents juggle separate tools and have no single view of context, short-term (e.g. 5-hour) limits and weekly limits.
- The agents don't collaborate: there's no way to combine the strengths of each product.
- Opportunity: use the cheapest models to explore and understand the project, and save the advanced models (Opus, Sonnet and their equivalents) for planning and implementation.

## Goal and target audience

- **Goal:** a single environment where different agents work on the same project and talk to each other and to the user in natural, human-like language, while the user can work on files, terminal, Git and browser without leaving the app.
- **Target audience:** the open-source community of Windows developers who use several coding agents, either through subscriptions (CLI) or pay-as-you-go API keys.

## Scope

**In scope:**

- Windows as the only platform.
- Agent execution with Claude Code and Codex, with an architecture open to other agents. OpenCode currently has detection only.
- Agent access through both subscriptions (CLI) and API keys.
- All modules and features listed below, released in phases.

**Out of scope (for now):**

- macOS and Linux.
- Voice input.
- OpenCode execution and configuration: deferred by user choice; current work focuses on Claude Code and Codex.
- Gemini CLI, GitHub Copilot CLI, Aider.

## Key features / requirements

1. **Agent detection and stats (core)**
   - Detects the coding agents installed locally.
   - Shows each agent's context and usage limits: short-term window (e.g. 5 hours) and weekly window.
   - Cost and token dashboard per task.
   - **Usage panel** (reference: Usage popover screenshot):
     - View across all agents, with a refresh button.
     - Two modes: Detailed and Compact.
     - For each agent: icon, name, time until reset, and percentage bars for the 5-hour and weekly windows.
     - Each agent opens into a detail view.
     - "Usage details &amp; history" entry.
     - "Manage accounts" entry for the accounts linked to each agent.
   - **Global status bar**, always visible at the bottom: for each agent, percentage used and time until reset for both the 5-hour and weekly windows.
   - **Per-session/thread status line** (reference: Claude Code status line):
     - Active model and context window size.
     - Percentage bars for context, 5-hour window and weekly window.
     - Time remaining until reset and a link to the dashboard.
     - Active permission mode and number of running agents.
2. **Thread-based workspace (Discord/Slack style)**
   - Sessions and projects organized as groups with threads.
   - Agents from different products join the same threads and chat with each other and with the user.
   - Task/kanban board with tasks that can be assigned to agents.
3. **Multi-model orchestration**
   - Cheaper models that interact with each other to understand the state of the project or session.
   - Advanced models that create plans and implement them in code.
   - Project memory shared across agents.
   - An isolated Git worktree for each agent.
   - Human approval for risky actions.
   - Checkpoints and rollback of agent changes.
   - Per-agent management of MCP servers and skills.
4. **Editor and terminal (VS Code style)**
   - Browse, open, view and edit files inside the app.
   - Integrated terminal, freely interchangeable with chatting with the agents.
5. **Full Git/GitHub management**
   - Branches, worktrees, staging and commits with a VS Code–like interface.
6. **Built-in browser**
   - Preview of web projects running on a local web server.
   - Select an area of the page to leave a comment or run a command that changes or fixes it.

## Resources

- **Stack:** React + Electron, targeting Windows.
- **Agents:** Claude Code, Codex, OpenCode, through subscriptions (CLI) and API keys.
- **People:** solo developer; open-source project open to future contributions.
- **License:** MIT.
- **Data sources for stats and limits** (an approach already used by community mods and tools, by apps like [onarca.dev](http://onarca.dev) and by Claude itself):
  - **Claude Code, interactive sessions:** the official status line, which passes the script a JSON payload with context (percentage and window size) and 5-hour and 7-day limits (percentage and reset time). Ark registers its own script that forwards the JSON to the app. Limits are only present on Pro/Max plans and after the session's first response.
  - **Claude Code, sessions driven by Ark:** headless mode (`claude -p` with stream-json) or the Agent SDK, through the `rate_limit_event` event with the 5-hour and 7-day windows. Not available with API keys.
  - **Codex:** `codex app-server` (JSON-RPC): `account/rateLimits/read` and its notifications for limits, `thread/tokenUsage/updated` for tokens and context window. Schema generated from the installed version.
  - **OpenCode:** local `opencode serve` server (HTTP) for tokens and cost per session; limit windows depend on the provider in use.
  - **API keys:** no 5-hour or weekly windows; Ark shows tokens and estimated cost.
  - **Architecture:** one adapter per agent that maps everything to a common model (agent, window, percentage, reset, context used/total), fed by the same channels Ark uses to run the agents.
  - **Excluded:** undocumented internal endpoints, because they require handling users' OAuth tokens.

## Timeline and milestones

No deadlines: phased development, following the chosen priority order.


| Milestone                                           | Deadline |
| --------------------------------------------------- | -------- |
| Phase 0 — Agent detection and stats                 | None     |
| Phase 1 — Thread-based chat and agent orchestration | None     |
| Phase 2 — File editor and terminal                  | None     |
| Phase 3 — Full Git management                       | None     |
| Phase 4 — Built-in browser with area selection      | None     |
| Extra features — placement in phases to be defined  | None     |


## IT Services agent profiles

The catalog integrates the 14 AI profiles in `docs/agents/it-services.md`, including aliases, role usernames, reporting
lines, written handoffs and L1/L2/L3 governance instructions. The Head of engineering is the human user. Profiles are
included for new catalogs; existing catalogs can add missing profiles without replacing customized files.

These specialists are read-only advisors in Chat and planning using Claude Code or Codex. Ark's existing coordinator,
developer and reviewers retain the thread and build workflow. The organizational hierarchy is prompt guidance; it does
not add an automated release gate, parallel execution or production access.

## Extra features: current step

The **thread task board** is complete: user-managed cards in To do / In progress / Done, assigned
to members of the approved team and included in each agent's next turn. Assignment does not schedule a turn. Remaining
extras (shared project memory, checkpoints/rollback and API-key setup for Claude Code and Codex) still need a priority
order. OpenCode execution and configuration are on hold.

## Open questions to verify

- Test the data sources against the installed agent versions, since the formats have changed over time. In particular:
  - that `rate_limit_event` in headless mode always reports the usage percentage, not only near the warning thresholds;
  - that Codex windows are sorted by duration, since the weekly one can show up as primary;
  - how to integrate Ark's status line script without overwriting the one the user has already configured.
- Each provider's terms of use on automated use of the CLIs with subscription accounts.
- Which phase each extra feature belongs to.
