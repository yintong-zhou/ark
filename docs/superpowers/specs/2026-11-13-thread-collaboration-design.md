# Thread collaboration and continuation

## Intent

Make the user's team communicate clearly, coordinate its work and stay available in the same thread after a build. The user can discuss the result, request further work or explicitly ask for Git operations without losing the conversation or its worktree.

## Approaches

- Continue in the same thread and worktree: selected. Preserve the transcript, team and branch while separating build completion from conversation availability. This requires careful state and recovery handling.
- Open a linked thread on the existing branch: simpler lifecycle isolation, but fragments the conversation and does not meet the user's same-thread goal.

## Team communication

Keep the Head of Staff responsible for coordination, with bounded exchanges between approved team members. Give each participant the task, relevant decisions and actionable handoff information; reviewers must receive the user's relevant requirements and the builder's outcome. Agents should acknowledge unresolved issues, request a relevant specialist when helpful, and report blockers and evidence honestly. Avoid repetitive, ceremonial conversation and unlimited routing loops. Preserve structured control blocks and current approval and review rules.

Use Humanizer for general agents, and Ponytail or i-have-adhd for technical agents when appropriate to their role and task. Make the chosen instructions actually available in each supported engine, rather than depending on hooks Ark does not run. Respect agent-selected skills and invocation constraints; do not silently claim a skill was applied if unavailable. Humanizer currently refers to personal Claude files, so use a safe, explicitly adapted isolated copy or another secure integration that preserves the skill's relevant behavior without exposing personal data. Do not enable plugin hooks or share other agents' skills, memory, plugins or MCP servers. Resolve skill availability and conflicts explicitly and report any meaningful limitation.

Select model and effort according to the difficulty of each task, using Ark's existing routing and honoring user locks. Favor stronger reasoning for ambiguous planning and consequential review, and lighter settings for routine work; avoid unnecessary model switching or token use.

## Continuing after a build

After the final review and checks, summarize the result, branch, checks and unresolved issues. Inspect Git status and offer only relevant next actions, distinguishing uncommitted files from local commits not pushed to an upstream. The thread remains available after this summary, across app restarts, and can answer follow-up questions. Explicit user requests for further changes initiate a new planning/build cycle in the same thread and existing worktree, retaining previous history and preserving all checks, approvals and reviews. Handle messages received during the summary without dropping them. Previously completed threads should also accept follow-ups when their worktree still exists; a removed or missing worktree must be reported clearly without silently recreating or changing it.

Ark retains its automatic phase commits during builds. Final commits for remaining uncommitted work, local merges and pushes require the user's explicit request. Offer merge when relevant, describing the source and target; resolve an ambiguous target with the user. Git operations use Ark's existing guarded Git services, without hooks or prompts. Check repository state immediately before an operation, preserve unrelated changes, report conflicts or failures clearly and avoid destructive automatic recovery. Do not push as a side effect of deleting a thread; preserve uncommitted work and local commits safely and make any requested external push explicit. A completed merge or push does not itself close the conversation.

## Access control and interface

Move the access-mode selector into alignment with the thread message composer, without overlaying messages. Use custom icons consistent with Ark's existing line icons, retain accessible labels and keyboard behavior, and ensure the layout works at narrow widths. Retain existing modes and their meaning; Full access remains the only existing permission bypass, and review waivers still require their existing card.

## Constraints and verification

Only builders write during a build and only inside the thread worktree. Preserve isolation, the removed-worktree invariant, and the existing requirement for review unless the user waives it. Do not introduce automatic external operations. Preserve existing thread data and unrelated working-tree changes.

Verify the lifecycle, persisted restart and legacy threads, delivery during summary, new build cycles, reviewer context, bounded handoffs, role-appropriate skills and isolation, Git status and requested actions including conflicts, missing worktrees and no automatic push. Test layout and accessibility in the running app. Run typecheck, lint, tests and build; do not run paid live-engine tests without the user's permission. The implementer decides the minimal compatible state representation and exact control wording.
