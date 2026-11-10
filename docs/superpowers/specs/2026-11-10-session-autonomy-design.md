# Session permissions, multi-engine routing and team autonomy

Status: approved by the user on 2026-11-10. Implementation in progress.

## Intent

Make Ark use the connected Claude Code and Codex engines as a working team. The user wants fewer interruptions, real distribution of work across models, an explicit permission choice per session, and visually distinct Git-ignored entries in Files.

## Current behavior and constraints

- `resolveRun` prefers Claude whenever it is installed. Auto only moves light and standard work to Codex when a live Claude usage window reaches 90%. Heavy work stays on Claude.
- The conductor retains one engine session per team member. Changing routing must preserve this continuity and the existing handoff mechanism.
- Planning members return to the manager after each reply. A member's `ask` currently waits for the user; members' `next` controls are ignored. Planning stops for a user summary at 20 turns.
- Teams require approval, completed plans require Start developer, and build checks and reviews already run automatically in a thread worktree.
- Agent capabilities (`read-only` / `build`) are separate from the proposed permission policy. Only the developer writes, during build, in the thread's Git worktree. Advisors and reviewers remain read-only.
- Claude build sessions accept edits and allow a small list of check commands; other shell commands prompt. Codex uses workspace-write with on-request approvals.
- Current approval events contain display text, insufficient to safely classify arbitrary tool calls. The implementation must retain structured request metadata and default to asking on unsupported shapes.
- Personal skills, memory, plugins and MCP remain excluded. Git operations keep hooks disabled. Editor path guards and the user's own terminals retain their existing behavior.
- Files currently lists ignored entries without marking them. `.git` itself stays hidden.
- Existing local UI and branding edits must be preserved.

## Approaches

1. Prompt-only manager: ask the manager to mix engines and approve routine work. Small initial change, but does not enforce routing, risks or permission boundaries consistently.
2. Manager coordination with deterministic execution policy: Ark chooses and records real engines, validates handoffs, and applies a structured permission policy. The manager handles task decisions and escalates material issues. Recommended and selected for this proposal by the implementer.

Parallel execution is not required for this first version. Agents cooperate through the existing ordered transcript, with controlled direct handoffs. Concurrent writers and multiple developer worktrees would be a separate architecture change.

## 1. Permission policy per session

Add an independent `permissionMode`: `ask`, `auto`, `full`. Persist it on each thread and pass it through typed IPC, conductor, runner and engine startup. Show an English selector near the composer and the active mode in session information:

```text
Permissions: Approve for me v

Ask for approval   - Ask before actions outside the allowed scope
Approve for me     - Allow routine work; ask you for sensitive actions
Full access       - Run tools without approval prompts
```

New threads default to Approve for me, reflecting the requested autonomy. Existing threads without the field retain Ask for approval. The user can select a mode before the first message. A mode change during a turn applies only after pausing/stopping the affected sessions; it must never silently broaden a live session or reuse pending approvals. Persist and display the effective mode rather than an unapplied selection.

Direct Chat remains a read-only advisor session, in line with Ark's existing role boundary. It exposes the session policy and read-only capability together; selecting a policy does not enable editing or shell tools. A future writable direct chat is outside this proposal.

### Ask for approval

Keep the existing build behavior: worktree edits and already permitted checks run; other engine approval requests create user cards. Team and plan confirmations stay explicit.

### Approve for me

Allow the team to progress through team selection, planning and build without a click for every stage. Validate proposed team IDs, plan phases, developer capability and worktree setup with the same main-process checks used by the manual path. Show the team and plan in the conversation and retain Pause and manual intervention.

Within build, automatically allow only positively recognized routine operations: reads, guarded edits inside the worktree, and a finite list of local inspection/check commands. Recognize complete command structures and paths, not substring matches. Compound shell syntax, redirections, interpolation, encoded commands and unsupported tool requests require user approval unless explicitly supported and tested. Package scripts can execute arbitrary repository code; only the project's existing check-script exception is retained, not generalized to all scripts.

Sensitive operations require a user approval card: external writes or broader sandbox grants, destructive commands, dependency installation and lifecycle scripts, network transfers, publishing, push/deploy, credential or security-setting changes. Unclassifiable actions also ask. The manager receives the reason and can clarify the request, but neither a prompt instruction nor another agent can authorize a sensitive operation. Do not spend extra LLM turns to rubber-stamp known routine checks.

All decisions are recorded with tool, scope and outcome. Keep raw approval metadata in main; render only the necessary user-facing description. Auto mode is a conservative explicit policy, not a claim to understand arbitrary shell programs.

The adapter must obtain an approval request before each action that the policy needs to classify. A sandbox or `on-request` setting alone does not prove this: destructive commands inside a writable workspace may otherwise run without asking. Verify supported approval hooks/policies against the installed CLI and test this boundary. If an engine cannot expose the required pre-execution gate, refuse Auto build for that engine with a clear explanation; do not claim to protect actions Ark never receives.

### Full access

An explicit user opt-in to the engine's tool approval bypass for the developer build session. The selector describes that engine tools may write beyond the worktree and use the network without prompting. This is an intentional exception to the normal engine write boundary, only when the user selects this mode. Ark still starts builds in a worktree, keeps other roles read-only, and enforces personal-context isolation and its own editor/IPC/Git rules.

Verify the installed CLI's actual supported permission settings and sandbox behavior before wiring this mode. Never silently fall back from Ask or Approve for me to Full access. A CLI that cannot honor a selected policy must produce a clear error rather than show a false effective mode.

## 2. Real distribution across engines and models

Replace Claude-first Auto for team sessions with a deterministic, thread-local assignment policy. Preserve explicit engine/model selections in agent profiles.

- Use role affinity as the starting preference: coordination and planning favor Claude; implementation and code review favor Codex; exploration and security review balance the remaining assignments.
- When both engines are available, choose a complementary engine for consecutive eligible Auto roles so the manager and first specialist do not both automatically land on Claude. Track assignments within the thread, not in a global round-robin shared with unrelated chats.
- Consult both engines' live usage windows. Prefer the engine below the pressure threshold; expired windows do not count. Unknown usage is not zero usage. When both engines are under pressure, keep the configured choice visible rather than promise capacity that is unavailable.
- Keep the existing light/standard/heavy tiers and Codex's reported model inventory and configured tier overrides. No invented model IDs or new account login/storage layer.
- Once assigned, retain a member's live session and engine. Re-evaluate only when starting a new session or performing a supported handoff. Preserve transcript, task board and handoff state.
- Persist/display the actual engine and model per agent message and team member. Explain assignments or capacity-driven switches with a brief note.
- An explicitly pinned profile may make a thread use only one engine; do not override that choice to meet a mixing quota.

This distributes the CLI accounts Ark already detects. Multiple accounts within one provider, API-key setup, OpenCode execution and a model benchmarking service are out of scope.

## 3. Decisions within the team

In Approve for me and Full access, specialist questions return to the manager first. The manager can answer using context, ask another member, or escalate a question that needs the user's intent, external credentials, a security decision, or a material scope change. A specialist cannot create an immediate user wait for an ordinary internal question.

Allow a member to hand off directly to another approved team member using the existing validated `next` control. Reject unknown/self/out-of-team targets. Keep a single active turn and include the roster and new transcript messages so agents can actually read each other's decisions. The manager remains responsible for resolving conflicts and reporting the outcome.

Maintain finite turn and retry budgets. At the planning limit, request a manager synthesis that either yields a valid plan and proceeds, or explains a specific blocker to the user. Never silently reset the budget or auto-approve indefinitely. Keep existing build review limits and manager escalation when fixes remain blocked.

In Ask for approval, preserve manual team/build gates. Protocol text and runtime rules must agree on which agent may ask, hand off or start a build. Invalid controls fail closed and follow bounded correction behavior.

## 4. Git-ignored files and directories

Add optional `ignored` metadata to each listed entry. Resolve ignore state in main with Git's own rules, through the existing hooks-disabled runner, using NUL-delimited stdin/output for names. Honor nested `.gitignore`, negations, `.git/info/exclude` and configured excludes. Tracked files are not presented as ignored merely because an ignore pattern matches their name.

Batch only the entries in the requested directory; do not scan ignored trees recursively or spawn a Git process per entry. On non-Git roots, render the normal listing. A Git inspection failure does not prevent file browsing and must not mark every entry ignored.

Render ignored names in italic with reduced text opacity (approximately 50-55%), preserving clickability, selection, hover and readable focus states. Include an `Ignored by Git` tooltip. Refresh expanded listings when ignore configuration changes, including nested rules and changes to excluded parent directories. Keep current sorting and Git change decorations.

## Acceptance and verification

- Unit tests cover policy validation and persistence, legacy defaults, mode changes and pending approvals, routine/sensitive/unknown request classification, and compound-command rejection.
- Conductor tests use fake engines to prove automatic team/plan progression, specialist-to-manager questions, validated member handoffs, bounded loops, Pause, and build failure escalation.
- Routing tests prove actual Claude/Codex assignment with both installed, single-engine fallback, explicit pins, both providers' usage pressure and stable ongoing sessions. No real subscription calls are needed for these tests.
- Files tests use real temporary Git repositories to cover ignored folders, nested rules, negation, tracked files, unusual names, worktrees, refresh and non-Git folders.
- Run typecheck, lint, unit tests and build. Launch dev using an asserted temporary profile and verify the selector, effective mode, conversation flow, model labels and ignored-file styling with fake engine fixtures.
- Do not run `test:live` or start subscription-backed conversations without explicit user authorization. Fake-engine verification cannot prove real provider behavior; report that limit clearly.

## Delivery order and remaining builder choices

Implement as four reviewable parts within this request: permission contracts and policy, routing, autonomous conductor/protocol behavior, ignored-file metadata and UI. This order lets autonomy consume tested permission and routing boundaries.

The builder chooses helper names, exact UI placement consistent with current styling, command recognizers and test fixture organization. Reuse current stores, runner, protocol and typed IPC; introduce no dependency unless the existing code demonstrably cannot meet the requirements.

Update README and PROJECT to describe the final behavior and align architectural notes if the explicit Full access exception is approved. Do not edit the user's global Claude/Codex configuration or include unrelated local changes in this work.
