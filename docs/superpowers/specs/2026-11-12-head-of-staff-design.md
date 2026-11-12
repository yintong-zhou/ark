# Head of Staff, user-made agents and ready teams

Status: approved by the user on 2026-11-12.

Every decision below is marked **(user)** when the user stated it, or **(call)** when it is the author's own choice that the user has not explicitly confirmed. A builder may revisit a **(call)** with a good reason; a **(user)** decision needs the user.

## Intent

Today Ark ships its own cast: a project manager profile ("Alex") that is installed into the catalog and without which no thread starts, and three hidden build roles (developer, code reviewer, security reviewer) that write and review the code. The user wants the opposite: Ark ships **no agents**. The user builds their own staff, from scratch or from a ready team, and each agent is a recognisable colleague with a face, an alias, a role, a username and a model.

What Ark keeps is the conductor of that staff: one built-in orchestrator, the **Head of Staff**, which reads each request, judges how hard it is, and puts the right agents and the right models on it. When the staff lacks someone the work needs, it says so to the user (its "boss") and tells them which agent to create.

The thread itself must stay what it is: messages, `@` mentions, team card, question cards, plan, build in a Git worktree, checks, reviews, permission modes.

## Goals

1. A fresh install has an empty catalog and still explains what to do next.
2. The Head of Staff is part of Ark: always present, not in the catalog, cannot be deleted.
3. Planning, building and reviewing are done by the user's agents, chosen per thread by the Head of Staff.
4. Easy requests go straight to the builders; hard requests go through a manager, a discussion and a plan written on a strong model.
5. An agent has an image, alias, role, username, task, model (with a lock), skills and system prompt.
6. Ready teams can be added in one click. IT Services is the only one for now, and it must cover a whole thread by itself.
7. A skill written by anyone can be imported into Ark and given to an agent.

## Non-goals

- Marketing, design or other ready teams. They were only an example **(user)**. The ready-teams list must simply be able to hold more than one later.
- Parallel builders or several worktrees per thread. Builders work one phase at a time, as today.
- Letting the user edit the Head of Staff's instructions.
- A skill editor inside Ark. Skills are written elsewhere and imported **(call)**.
- Generating profile images. The set is drawn once and bundled.
- Renaming an agent's username after creation.
- Changing direct Chat with one agent: it stays a read-only advisor session.
- OpenCode as an engine.

## Anti-goals

These would make the work a failure even if everything else runs:

- A user with an empty or incomplete catalog who is left stuck, or told only "something is missing" without being told which agent to create.
- A build that silently runs without a review. Skipping a review is allowed only after the user chose it, and the thread says so.
- Spending engine tokens when there is no agent to do anything.
- Any weakening of isolation, of the worktree boundary, or a second bypass next to **Full access**.
- Existing users losing agents, threads or history on upgrade.
- A thread that looks or flows differently from today's for no reason.

## Constraints

From `CLAUDE.md`, still binding:

- Agents stay isolated (`engines/isolation.ts`): each sees only its own skills; the user's memory, plugins and MCP servers are left out.
- Ark never writes into `~/.claude` or `~/.codex` (except Connect status line). Imported skills and images live in `%APPDATA%\ark`.
- Writing happens only in the build phase, only inside the thread's worktree `ark/<title>-<id>`. Risky actions need an approval card unless the thread is in Full access. This rule now reads "only the thread's builders build" instead of "only the developer builds".
- IPC payloads are validated in main; the renderer never sends an arbitrary absolute path to be read or copied. File and folder pickers are opened by main.
- UI text is English; colours and fonts from `brand-guidelines.md`; a hyphen in place of an em dash everywhere.
- Codex skills are passed as a list in the instructions.

## 1. The agent profile

### Fields

| Field | Meaning | Notes |
|---|---|---|
| Profile image | A face from Ark's gallery or an image uploaded from the PC | New |
| Alias | The agent's own name, e.g. `Forge` | New |
| Role | Its job title, e.g. `Backend dev` | New |
| Username | How the user calls it with `@`, e.g. `@backend_dev` | This is today's agent id (the file name). Now typed by the user, prefilled from the role. |
| Task | One sentence on what the agent does | Today's `description`. The Head of Staff reads it to decide who to involve, so the label and hint must say so. |
| Model | Auto, or one model from the engines found on this PC | See below |
| Lock this model | Checkbox | New |
| Can change files | Yes / No | Today's `permissions` (`build` / `read-only`), reworded |
| Skills | Installed skills plus skills imported into Ark | "Import skill" is new (section 4) |
| System prompt | Role and rules | Today's role prompt. "Draft with AI" keeps working and should also fill alias, role and task. |

The approved mockup is `.superpowers/brainstorm/311-1794475635/content/agent-avatars-form.html` (not committed; layout reference only). The user picked avatar style A and raised no objection to the form.

- The display name everywhere (thread, team panel, cards) is `Alias - Role`, as the IT Services team already does.
- The username follows today's id rule (lowercase letters, digits, `-`, `_`, up to 64), must be unique, and cannot change after creation because threads refer to it **(call)**. `head-of-staff` is reserved.
- Existing agent files without the new fields must keep loading: the current name is shown as is, the image is assigned as for a new agent. How alias, role, image and lock are stored in the agent file is left to the builder; the file must stay a Markdown file with a YAML header that Claude Code agent files can still be imported into.

### Profile image

- Style A, "characters" **(user)**: simple faces drawn as vector art using only the brand colours (no accent), shown in the round avatar. About 24 of them, drawn by the builder and bundled locally. The six faces in the mockup set the level of detail.
- A new agent automatically gets the first gallery face no other agent uses, so every agent looks different by default **(user: always a default, every agent different)**. When all faces are taken, reuse the least used one **(call)**.
- The user can pick another face from the gallery, or **Upload from PC**. Main opens the file dialog, accepts PNG, JPEG or WebP up to a small size cap, and copies the image into Ark's data folder. Removing the upload returns to a gallery face.
- The Head of Staff has its own reserved face that is not in the gallery **(call)**.
- The avatar replaces the two-letter initials wherever an agent is shown. The user's own avatar is unchanged.

### Model and lock

- The list offers `Auto` plus only the models of engines detected on this PC **(user)**: Claude Haiku, Sonnet and Opus when Claude Code is installed; the models Codex reports when Codex is installed (a list, no longer a free text box).
- **Unlocked** (default for new agents): the chosen model is the starting point; the Head of Staff may run a given turn one level lower or higher **(user: the orchestrator decides unless I lock the model)**.
- **Locked**: the agent always runs on exactly that model.
- Existing agent files that name an exact model count as locked, which is how they behave today **(call)**.
- The separate Tier field leaves the form **(call)**: the level is implied by the model (Haiku light, Sonnet standard, Opus heavy; Auto is standard). Files that still carry a tier keep working.

Levels map to models as they do today: light / standard / heavy is Haiku / Sonnet / Opus on Claude, and Luna / Terra / the default model on Codex.

## 2. The Head of Staff

### What it is

- A built-in agent named **Head of Staff** **(user)**, defined in Ark's code, never written to the catalog, never listed among the user's agents, not deletable. Its instructions are Ark's and are not editable **(call, stated to the user)**.
- In a thread it appears exactly as the project manager does today: its own avatar, its own messages, the team card, question cards, the blocked-phase question and the final summary **(call, stated to the user)**.
- The Agents page shows it as a fixed first row. Its edit screen offers only Skills, Model and Lock. Its default model is Auto at the light level, as the manager has today **(call)**.
- It is subject to the same isolation as any agent.

The built-in profiles `project-manager`, `developer`, `code-reviewer` and `security-reviewer` are removed from Ark **(user: they must not exist any more)**, together with the "Add thread roles" section of the Agents page.

### Empty or incomplete catalog

- **No valid agents at all**: no engine is called. Ark tells the user, in plain words, to create an agent or add a ready team, and points to the Agents page **(call, stated to the user)**. Whether this is a note in the thread or the existing inline refusal is the builder's choice.
- **A role the work needs is missing**: the Head of Staff asks the user with an ordinary question card, naming the agent to create:
  - nobody suited to manage and plan a hard request: "create a project manager agent" **(user)**;
  - nobody who can change files: "create an agent that can build" **(user)**;
  - nobody suited to review: the card offers to create a reviewer or to go on without that review **(call, stated to the user)**.
- After the user replies, the Head of Staff must see the catalog as it is now, including agents created meanwhile.

### Reading the request: team, roles and difficulty

On its first turn the Head of Staff receives the request and the catalog (username, display name, task, whether the agent can change files). Its proposal, which is today's team block extended, states:

- the **team**: who takes part, with a one-line reason each, as today;
- the **difficulty**: `easy` or `hard`;
- the **planner**: who writes the plan;
- the **builders**: one or more agents that can change files;
- the **code reviewer** and the **security reviewer**: each optional, and one agent may hold both.

A request that changes no files (a question, an analysis) needs no builders and no reviewers: such a thread works as it does today and simply never reaches a build **(call)**. When the request does mean changing files, the Head of Staff names builders and reviewers in this first proposal, so that a missing role is raised with the user at once and not after a long planning.

Ark checks the proposal deterministically, the way it already rejects unknown agents: every id exists, builders can change files, the planner is on the team, and a reviewer is not a builder of the same thread **(call)**. A bad proposal gets the existing single correction.

The team card shows the roles and the difficulty next to the picks. Approval works as today: the user approves in **Ask for approval**; in **Approve for me** and **Full access** it is approved automatically with a note. The user can always answer in the thread to get a different proposal (for example "plan this properly").

Roles are not frozen by the team card **(call)**. While the thread plans, the Head of Staff may change builders and reviewers (the plan may show that the frontend developer is needed after all), limited to agents on the approved team; Ark records each change as a note. There is no second approval card: the plan card, which the user already approves with Start, shows who builds each phase and who reviews. Starting the build fixes the roles. Before a build can start, automatically or by the user, Ark requires at least one builder, and each review slot either filled or left empty by the user's own choice; otherwise the Head of Staff asks the user as in "a role the work needs is missing".

The roles are stored on the thread, and the team panel labels members by them.

### Easy request

Example **(user)**: fix one precise bug with a known error.

- No manager is involved and there is no discussion **(user)**.
- Once the team is approved, Ark gives the floor straight to the builder, who writes a short plan: one phase, or one phase per builder when both, say, backend and frontend must change **(call: the mini-plan keeps the worktree, checks and reviews working unchanged and shows the user what will be touched)**.
- From there on it is today's flow: plan card and Start in Ask mode, automatic start in the other modes, then build.

### Hard request

Examples **(user)**: a new feature, a refactoring of a section.

- The Head of Staff involves a manager-type agent to work out with the user what is wanted, then the developers to size the work **(user)**.
- The planner writes a plan split into phases; these are the tasks **(user)**. That turn runs at the heavy level (Opus) unless the planner's model is locked **(user)**.
- The planning rules stay as they are: one speaker per turn, the floor returns to the Head of Staff, the planning budget, the autonomous-mode handoffs.

### Levels

- The Head of Staff may attach a level (light, standard, heavy) when it gives the floor. This replaces today's `hard` flag. Unlocked agents run that turn at that level on their engine; locked agents ignore it; with no level the agent runs on its own model.
- Build and review turns run at the standard level (Sonnet, or Luna/Terra on Codex) unless locked **(user)**.
- A turn at another level uses a fresh session, as the hard turn does today, and the existing "X runs on ... (model)" note keeps the user informed.

### Build

The loop is unchanged: phase by phase, builder turn, Ark's commit, the project's checks, code review, security review, at most two rounds, then escalation; finally the summary. What changes is who does it:

- Each plan phase is built by one of the thread's builders. A phase may name its builder; a phase that names none, or names someone who is not a builder, goes to the first builder **(call)**. How a phase names its builder in the plan text is the builder's choice, but it must be parsed deterministically and shown on the phase card.
- A review slot the user chose to leave empty is skipped, and the note that opens the build says which review will not run.
- The Head of Staff asks the user when a phase is blocked and writes the final summary.
- Everything that today applies to "the developer" applies to the phase's builder: build permissions only in the worktree, the approval policy, project-code consent, the Claude-only rule for a writable session in Approve for me, unread user messages.
- An agent that can change files is still read-only while the thread discusses and plans.

The protocol texts must be rewritten accordingly: there is no "Ark's developer" and no "project manager" any more, and build and review protocols are chosen by the role an agent holds in the thread, not by its id.

### Upgrade

- Existing agents stay **(call, stated to the user)**. A catalog that contains "Alex - Project manager" keeps it as an ordinary agent; it is a natural pick as planner.
- Existing threads keep their history and continue with the Head of Staff as coordinator **(call, stated to the user)**.
- A thread that was mid-build with the removed built-in roles must not crash or lose its worktree: it stops with a note, and on the user's next message the Head of Staff assigns the build roles from the catalog **(call)**.
- The upgrade does not write the old developer and reviewers into the catalog: the user decided they must not exist any more. An upgraded install whose catalog has no agent that can build is treated like any catalog with a missing role: the Head of Staff tells the user to create one or to add the IT Services team.
## 3. Ready teams

- The Agents page gets a **Ready teams** list in place of the two fixed sections. Each entry has a name, a one-line description, the number of agents and an Add button. Today it holds one entry, IT Services.
- With an empty catalog the page shows an empty state offering the two ways in: **New agent** and **Add a ready team** **(user)**.
- Adding a team copies its agents into the catalog, where they are edited and deleted like any other **(user)**. Agents that already exist are kept, as today.
- Importing Claude Code agents stays.

### IT Services, updated

The team must run a whole thread alone **(user: the developers are inside IT Services)**:

- `backend_dev` (Forge), `frontend_dev` (Gon) and `mobile_dev` (Echo) can change files and their missions say they implement; no more "hand implementation to the build developer" **(user)**.
- `tech_lead` (Orion) is described so it is picked for code review, `security` (Cipher) for security review, and `product_manager` (Nova) and `dev_manager` (Jarvis) for requirements and planning **(call)**.
- `test_automation` stays an advisor and hands test work to the developers **(call)**.
- The shared working agreement drops its references to Ark's developer and Ark's project manager and names the Head of Staff and the team's own developers.
- Every member gets alias, role and a fixed distinct face.
- A user who added the old team has read-only profiles that cannot build. When the team's agents already exist, the entry offers **Update team**, which rewrites those profiles after a confirmation that says edits to them will be lost **(call)**.

## 4. Importing a skill

- **Import skill** sits in the Skills section of the agent form and of the Head of Staff's screen **(user: in the agent configuration section)**.
- Main opens a folder dialog. The folder must contain a `SKILL.md`; Ark copies it into `%APPDATA%\ark\skills` so it survives the original being moved **(call)**. Reasonable caps on size and file count, a safe folder name, and no following of links that lead outside the chosen folder.
- Imported skills are listed with the installed ones, marked with their source, and are assigned the same way. When an imported skill has the same name as an installed one, the imported one is used **(call)**.
- An imported skill can be removed from Ark; importing the same name again replaces it after a confirmation **(call)**.
- Skills installed on the PC keep working exactly as today.

## Left to the builder

- The exact shape of the extended team block and of the level on a handoff, and the wording of every protocol text and note.
- Storage of the new profile fields, of the Head of Staff's settings and of uploaded images, and how the renderer displays an uploaded image under the content security policy.
- Whether the roles can be changed directly on the team card, or only by asking the Head of Staff for a new proposal.
- The drawing of the 24 faces.
- Size caps for images and skills.
- Migration details for threads and files.
- Order of work, suggested: (1) agent profile, (2) Head of Staff and build roles, (3) ready teams and IT Services, (4) skill import. Part 2 is the large one and should be planned in its own phases.
- `README.md`, `PROJECT.md` and `CLAUDE.md` must be updated where they describe the project manager, the developer or "only the developer builds".

## Verification

- The turn and build rules are pure state machines with unit tests; the new paths (easy, hard, missing role, skipped review, builder per phase, level and lock, upgrade of old threads) get tests there.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then the app in dev mode: empty catalog, an agent made from scratch, the IT Services team, one easy and one hard thread.
- `npm run test:live` spends the user's tokens: ask first.
