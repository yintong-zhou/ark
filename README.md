# Ark

Where coding agents work together. Ark is a local, open-source desktop app for Windows that brings the coding agents on
your machine (Claude Code, Codex, OpenCode) into one place.

## Phase 0: usage at a glance

Ark currently shows, for the agents installed on your machine:

- **Each open session's context**: how full it is, with a tick at 50%, so you can decide when to compact or hand off.
- **The 5-hour and weekly limits** of each agent, with time to reset. A tick on the weekly bar marks where usage would
  be if you spread the week evenly.
- **History** of the last 7 days, and **which account** each agent is signed in with.

Ark only reads. It never runs the agents and never sends anything anywhere.

| Agent       | Where the numbers come from                                                                |
| ----------- | ------------------------------------------------------------------------------------------ |
| Claude Code | Its status line (after you click **Connect status line**) and `claude auth status`        |
| Codex       | Its local session files in `~/.codex/sessions` (read-only) and `codex app-server`          |
| OpenCode    | Detection only for now                                                                     |

### The Claude Code status line

Claude Code shares context and limits only through its status line. **Connect status line** changes the `statusLine`
entry in `~/.claude/settings.json` so it runs a small Ark script first. Your own status line keeps running unchanged.
Ark backs up `settings.json` before changing it, and **Disconnect** restores the original entry. Projects that set their
own `statusLine` in `.claude/settings*.json` won't report to Ark. Limits appear after a session's first response, on Pro
and Max plans.

**Before uninstalling Ark, click Disconnect** so Claude Code goes back to your own status line. Otherwise
`settings.json` keeps pointing at Ark's script. If you already uninstalled, restore the `statusLine` entry from the
latest backup in `%APPDATA%\ark\backups`.

## Agents

Ark keeps a catalog of agents. Each agent is a Markdown file in `%APPDATA%\ark\agents`, so you can edit it in any
editor and keep it in Git. It has a role prompt, an engine (Claude Code or Codex), and the list of skills it may use.

- **Seeds**: a first set of agents (for example project manager, planner, developer, code and security reviewers) is
  there from the start.
- **Import**: copy agents from `~/.claude/agents` and from Claude Code plugins into the catalog.
- **Draft with AI**: describe an agent in one sentence and a light-tier agent writes a draft for you to approve.
- **Chat**: pick an agent and a project folder and talk to it, on Claude Code or Codex.

Each agent sees only its own skills. The project's own `CLAUDE.md` or `AGENTS.md` is kept, so the agent follows the
project's rules. Your personal instructions, memory, other skills, plugins and MCP servers are left out: Claude Code's
auto-memory is turned off, and Ark refuses to start a Codex agent while `~/.codex/AGENTS.md` (or `AGENTS.override.md`)
exists, because Codex would load it into every session. In this step every agent is read-only: it can read the project
but has no edit, write or shell tools.

Agents never change `~/.claude` or `~/.codex`: Ark only reads skills and agents there, and copies the skills an agent
needs into a private folder for each session. The engines themselves still keep their usual session logs
(`~/.claude/projects` and `~/.codex/sessions`). (Only **Connect status line**, above, edits `settings.json`.)

`npm run test:live` checks this against the real engines. It makes a few cheap calls on your Claude Code and Codex
subscriptions.

### IT Services team

The catalog includes the 14 profiles from [IT Services standard](docs/agents/it-services.md): Nova, Jarvis, Killua and
Atlas lead product, development, QA and DevOps, with Pixel, Sage, Orion, Forge, Gon, Echo, Scout, Bolt, Helix and Cipher
as specialists. Profiles carry their role, reporting line, handoff rules and L1/L2/L3 decision boundaries. You are
`@head_of_engineering`; this human role is never an AI agent.

New catalogs include the team. In an existing catalog, open **Agents → Add IT Services team** to add missing profiles;
customized or invalid files are kept, and repeating the action does not duplicate profiles. Agents use the standard's
usernames, for example `@frontend_dev`, in mentions and task assignments once approved for the thread. Engine **Auto**
uses the existing Claude Code/Codex routing; profiles need no extra skills and can be edited like any other agent.

These profiles advise in Chat and planning with read-only access. The reporting hierarchy and governance rules are
instructions in their prompts, not a separate scheduler or an automated release gate. Ark's existing project manager
still coordinates turns, and its developer and reviewers still run the approved build. Specialists hand implementation
to that developer; they gain no production, deployment or write access. OpenCode execution and configuration remain
on hold.

## Threads

A **project** is a local folder that is a Git repository (Ark offers **Initialize Git** when it is not). A **thread** is
one piece of work in a project: a conversation between you and a team of agents from the catalog. Each thread keeps its
transcript on disk in `%APPDATA%\ark\threads`, so it survives closing Ark.

- **Team phase**: when you start a thread, the project manager reads your request and proposes a team from the catalog,
  with a one-line reason for each agent. You edit the list and press **Approve team**. Nobody else speaks until you do.
- **Planning**: the project manager gives the floor to one agent at a time. Only one agent speaks per turn, and each
  agent sees only its own skills, as in Chat. After 20 agent turns without a plan, the manager summarizes and asks you
  how to continue.
- **`@you`**: an agent that needs your decision tags you. The thread is marked **Your turn** (an Accent bar on the message and the thread) and the team pauses until
  you answer, with the quick replies the agent offers or in your own words. You can also write at any time (to steer the
  team, or `@` an agent to talk to it) and **Pause** a running turn.
- **Mentions and tags**: type `@` to pick an agent and `#` to label the thread (`#bug`, `#ui`). A tag stays on the thread, shows as a chip in the message and in the project's sidebar, and a click on it narrows the thread list.
- **Files and images**: attach with the paperclip, a drop or a paste (up to 5 per message). Images (png, jpg, gif, webp, 5 MB each) reach the agents as images; text and code files (200 KB each) are pasted into the message they read. Other types are refused, since agents only see what Ark gives them. Attachments live in the thread's `files` folder.
- **Emoji**: the smiley in the composer opens a grid of emoji.
- **Reactions**: react 👍 or 👎 to any agent message. A reaction does not start a turn: the agents see it on their next turn ("the user reacted 👍 to ...").
- **The plan card**: when the planner finishes, its plan appears as a card in the thread and is saved as `plan.md` in the
  thread's folder. **Start developer** approves it.

- **Build phase**: **Start developer** creates a Git worktree on a new branch `ark/<title>-<id>` (under
  `%APPDATA%\ark\worktrees`) from the project's current commit, so uncommitted changes are not in it, and your checked-out
  branch is never touched. The plan is copied into the worktree and committed first. The developer then builds the plan
  phase by phase. After each developer turn Ark commits the work and runs the project's `typecheck`, `lint`, `test` and
  `build` scripts, then the code reviewer and the security reviewer each get a turn. After two rounds without agreement the
  project manager sends the open points to you. When every phase is done the manager closes the thread with a summary.
- **Auto**: an agent runs at its own `tier`. When the project manager marks a task as hard (`"hard": true`), that one turn runs
  one tier up, in a fresh session. Agents set to `engine: auto` run light and standard work on Codex when Claude's 5-hour or
  weekly window is at 90% or more, when Codex is installed; heavy work stays on Claude. A running auto agent moves at its
  next turn, and moves back when Claude is under 90% again. Agents with a fixed engine or model never move. A rerouted
  session leaves a note in the thread.
- **Thread cost**: the team panel shows tokens per model, and how the usage windows moved while the thread ran, for example
  `Claude 5h 41% → 44%`, marked "Including your other sessions" because a window counts all your usage. The build summary
  lists the same.
- **Approvals**: build agents can edit files in the worktree, but anything risky (installing packages, network commands,
  commands outside the worktree) shows an approval card with the agent, the tool and the command. **Allow** or **Deny**
  it; a card that was not answered before its turn ended shows "Expired". A thread that waits on an approval gets a badge.
  Ark refuses to start a developer session when the worktree's `.claude/settings.json` sets `permissions.allow`,
  `permissions.defaultMode` or `hooks` (they would act without a card) or is not valid JSON; the note names the file.
- **Dependencies**: a new worktree has no `node_modules`, so the developer asks to run `npm ci` on first use. That is one
  approval card per thread; Ark never installs anything by itself.

If Ark is closed during a turn, the thread notes it and continues when you send a message. A long agent session is
handed off to a fresh one at 50% of its context, so a thread can run for a long time.

`npm run test:live` also starts a real thread on the light tier and checks that the project manager answers with a team
proposal or a question, and runs the approval round trip (deny and allow) with a Claude build agent, and a deny with a
Codex build agent.

Known limit: Ark does not rely on Codex's experimental skill roots (codex-cli 0.132.0 lacks them, 0.167.0 has them
again). It turns off every skill Codex finds and gives a Codex agent its own skills as a list (name, description, file)
in its instructions; the agent reads the SKILL.md on request. Codex agents therefore have no native `$skill` mentions.
Live-tested with codex-cli 0.167.0; 0.132.0 cannot talk to the current model service. Ark also turns on Codex's
Windows sandbox (`windows.sandbox = "unelevated"`, no admin rights; without it Codex runs commands unsandboxed on
Windows) and refuses to start a Codex agent if a read-only command can still write.

## Task board

Open a thread and press **Tasks** to view its board. Add a title, optionally assign an agent from the thread's approved
team, and choose **To do**, **In progress** or **Done**. Change a card's status from its menu, or use **Edit** to rename
or reassign it. **Delete** asks first. **Conversation** returns to the messages.

The board is saved with the thread and survives restarting Ark. Agents receive its current state on their next turn,
including fresh build sessions. Assignment does not start an agent or change the team's turn order; editing cards leaves
running turns and approval cards alone. Up to 100 tasks per thread, with titles up to 200 characters.

## Files and editor

- **Files**: the project sidebar switches between **Threads** and **Files**. Files shows the project folder as a tree,
  or the open thread's build worktree once it has one. Right-click for new file, new folder, rename, delete (to the
  Recycle Bin), reveal in Explorer and copy path.
- **Editor**: files open in tabs next to the thread, in Monaco (the editor of VS Code): highlighting, find and replace,
  multiple cursors. Ctrl+S saves, Ctrl+W closes the tab. The team panel shows while the thread tab is active.
- **Agents writing the same file**: an open file with no unsaved edits reloads when it changes on disk. With unsaved
  edits, a bar asks to **Reload** or **Keep mine**; a save never overwrites a newer version on disk without that click.
  Closing Ark with unsaved files asks first.
- Binary files and files over 5 MB are not opened; a file that is not UTF-8 opens read-only.

## Terminal

- **Ctrl+`** (the key left of 1) or the button at the right of the tab strip opens a panel under the thread or file,
  so you can chat and run commands side by side. Drag its top edge to resize it.
- **+** starts PowerShell, Command Prompt or Git Bash (when Git for Windows is installed). A new terminal opens in the
  project folder, or in the thread's worktree when the Files view's folder picker is set to it.
- Ctrl+C copies when text is selected, otherwise it stops the running command; Ctrl+V pastes.
- Terminals keep running while you visit Usage or Agents. Reloading or closing Ark ends them.

## Git

- **Git view**: the project sidebar's third view, next to Threads and Files. It shares the Files view's folder picker
  (the project or the thread's worktree) and works when that folder is a repository's root; a project without Git
  shows **Initialize Git**. From top to bottom: the branch, a message box (Ctrl+Enter commits), the commit button, then
  the changed files in **Merge conflicts**, **Staged changes** and **Changes**. Empty groups are hidden; with nothing
  changed the view says `No changes`.
- **Commit and Commit all**: with staged changes the button reads **Commit** and commits them. With nothing staged it
  reads **Commit all**, which stages every change (new files too) and commits. Commit all is never offered while a
  conflict is open.
- **Stage, unstage and discard**: hover a row, or a group's header for all its files. Discard asks first. A changed
  file goes back to its last committed or staged state, which can't be undone; a new file moves to the Recycle Bin.
- **Diffs**: click a row to open its diff in a tab next to the file tabs, `<name> (changes)` or `<name> (staged)`,
  side by side and read-only. **Open file** opens the normal editor. The diff follows the file as it changes. A
  conflicted file opens in the editor instead.
- **Letters**: changed files show a letter at the right, in the Git view and in the Files tree: `M` modified, `A`
  added, `D` deleted, `R` renamed, `U` untracked, `!` conflict. A folder with changes inside shows a dot.
- **Merges**: while a merge is in progress, a banner reads "Merging `<branch>`. Fix the conflicts, stage them, then
  commit." with **Abort merge**. Once no conflicts are left, Commit works with an empty message and keeps Git's merge
  message.
- **Branches**: click the branch name for the branch menu. Pick a branch to switch to it; one listed under **Remote**
  gets a local branch that tracks it. **Create branch…** starts a branch from the current commit and switches to it.
  **Delete branch…** asks first, and asks again if the branch isn't merged. With an upstream, the row shows `↑n ↓m`.
- **Fetch, Pull and Push**: the buttons at the right of the branch row. Pull only fast-forwards: when the branches have
  diverged, pull from the terminal to merge or rebase. A branch's first push goes to `origin` and sets its upstream.
  The button spins while it runs (up to 2 minutes), and the folder's other Git actions wait for it.
- **Worktrees**: on the project root, the **Worktrees** section lists the repository's worktrees, the main one first,
  each with its branch and folder, and the thread that owns it. **Show** opens that thread on its worktree. **Remove**
  asks first and keeps the branch; a thread's worktree can go once the thread is done. When another program holds the
  folder (a terminal open in it, Explorer), the worktree is removed but its empty folder stays: close that program,
  then delete the folder. **Prune** forgets worktrees whose folders are gone.
- **Thread branch**: on a thread's worktree, this section shows `<branch> → <project branch>` and how many commits
  are left to merge. **Merge into `<branch>`** merges them into the project's branch with a merge commit. On a conflict
  the view moves to the project root with the merge banner. **Remove worktree** removes the thread's folder once the
  thread is done; the branch stays, and the folder picker goes back to the project.
- **No hooks**: Ark runs Git without the project's hooks, so pre-commit checks don't run. Use the terminal to run them.
- **Threads at work**: on a thread's worktree, every Git action waits while the team's turn is running. Status and diffs
  stay readable.

## Browser

- **Preview your project**: start its dev server in the terminal, then press the globe button at the right of the tab
  strip. The browser opens as a tab next to the thread and the files. Type the address (`localhost:5173` works, `http://`
  is added). Back, forward and reload sit next to the address.
- **Local addresses only**: `localhost`, names ending in `.localhost`, `127.x.x.x` and `[::1]`, on any port, over http
  or https (self-signed certificates are accepted for these). A link to another site opens in your default browser.
  When a page tries to go elsewhere on its own (a redirect to a hosted login, for example), Ark stops it and shows a bar
  with **Open in your browser**.
- **Comment on an area**: press **Select** (or Ctrl+Shift+S), drag a rectangle over the part of the page that's wrong,
  write what you want in the box beside it and press **Send to thread** (or Enter). The comment goes to the thread
  that's open in the project, as your message, with a picture of the area and a line naming the page and the element
  under it, so the team finds the code. Esc cancels. With no thread open, open one first; your comment stays.
  The message keeps the captured page's address even if the page later navigates. Resizing the page area cancels the
  selection and keeps your comment, ready to select again.
- **Isolated**: the page can't reach Ark or your files, and it can't open windows. Camera, notifications and downloads are
  refused. Its logins and storage live in a separate session that survives a restart.
- **Keys in the page**: Ctrl+R and F5 reload the page (not Ark), Ctrl+` toggles the terminal, Ctrl+W does nothing.
- The page stays loaded while you switch tabs, projects or areas. Reloading or closing Ark closes it.

## Run it

Requirements: Windows, Node.js 22 or newer.

```sh
npm install
npm run dev
```

If `npm run dev` fails with "Electron uninstall", npm skipped Electron's download step. Run
`node node_modules/electron/install.js` once.

Other scripts: `npm test`, `npm run test:live`, `npm run typecheck`, `npm run lint`, and `npm run dist`, which builds the Windows installer
into `dist/`.

## License

MIT
