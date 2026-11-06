# Agent Instructions

You operate within a 3-layer architecture that separates responsibilities to maximize reliability. LLMs are probabilistic, while most business logic is deterministic and requires consistency. This system fixes that mismatch. Direct user instructions override this file.

## 3-Layer Architecture

**Layer 1: Directive (what to do)**
- Essentially SOPs written in Markdown, living in `directives/`
- They define goals, inputs, tools/scripts to use, outputs, and edge cases
- Natural-language instructions, like you would give a mid-level employee

**Layer 2: Orchestration (decision-making)**
- This is your job: intelligent routing.
- Read directives, call execution tools in the right order, handle errors, ask for clarification, and update directives with what you learn
- You are the glue between intent and execution. For example, you don't scrape websites yourself: you read `directives/scrape_website.md`, define inputs/outputs, then run `execution/scrape_single_site.ts`

**Layer 3: Execution (doing the work)**
- Deterministic scripts in `execution/` (Node.js/TypeScript by default)
- Environment variables, API tokens, etc. are stored in `.env`
- They handle API calls, data processing, file operations, and database interactions
- Reliable, testable, fast. Use scripts instead of manual work. Well commented.
- Code that ships inside the app (logic the user triggers from the UI) lives in `src/main/services/`, not in `execution/`. `execution/` holds development and automation scripts. Both follow the same rule: deterministic, testable, commented.

**Why this works:** if you do everything yourself, errors compound. 90% accuracy per step = 59% success over 5 steps. The solution is to push complexity into deterministic code, so you focus only on decision-making.

## Operating Principles

**1. Check existing tools first**
Before writing a script, check `execution/` (and `src/main/services/` for app code) as your directive indicates. Create new scripts only if none exist.

**2. Self-correct when something breaks**
- Read the error message and stack trace
- Fix the script and test it again (unless it uses paid tokens/credits: in that case, ask the user first)
- Update the directive with what you learned (API limits, timing, edge cases)
- Example: you hit an API rate limit → you look into the API → you find a batch endpoint that would solve it → you rewrite the script to use it → you test → you update the directive.

**3. Update directives as you learn**
Directives are living documents. When you discover API constraints, better approaches, common errors, or timing expectations, update the directive. Do not create or overwrite directives without asking, unless explicitly told to. Directives are your instruction set and must be preserved (and improved over time, not used ad hoc and then discarded).

## Self-Correction Loop

Errors are learning opportunities. When something breaks:
1. Fix it
2. Update the tool
3. Test the tool and make sure it works
4. Update the directive to include the new flow
5. The system is now stronger

## Electron App Development

**Tech stack:**
When asked to build a desktop app, use the following stack:
- **Shell**: Electron (main process in Node.js, a preload script, and a sandboxed renderer)
- **UI**: React + Tailwind CSS, in TypeScript
- **Backend logic**: main-process services exposed to the renderer through IPC. Use a local Python (FastAPI) sidecar only when a directive requires Python-only libraries.
- **Tooling**: for an existing project, use the bundler and packager already in `package.json`; for a new project, default to electron-vite and electron-builder.

**Security rules** (the renderer is a web page, so it must not reach Node or the OS directly):
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` on every window.
- Expose only narrow, typed functions through `contextBridge` in the preload script. Never expose `ipcRenderer`, `fs`, or other raw modules.
- Validate every IPC payload in the main process. Name channels by domain (e.g. `files:save`).
- Keep secrets and third-party API calls in the main process. The renderer never reads `.env` or tokens. Store user-supplied and OAuth tokens with Electron `safeStorage`, not in plain files or `localStorage`.
- Load only local content, set a Content-Security-Policy, and open external links with `shell.openExternal` after checking the URL against an allowlist.

**Brand guidelines:**
Before starting UI development, check whether `brand-guidelines.md` exists in the project root. If present, use the fonts and colors it specifies, mapped to the Tailwind theme, to stay consistent with the brand. Bundle fonts locally so the app works offline.

**Directory structure for the app:**
```
project-root/
├── src/
│   ├── main/            # Electron main process (Node.js)
│   │   ├── index.ts     # App entry point, window creation
│   │   ├── ipc/         # IPC handlers
│   │   └── services/    # Business logic that ships with the app
│   ├── preload/         # contextBridge API exposed to the renderer
│   └── renderer/        # React app
│       ├── components/  # React components
│       ├── pages/       # Screens/routes
│       └── assets/      # Fonts, images
├── resources/           # Icons and static files packaged with the app
├── directives/          # SOPs in Markdown
├── execution/           # Node/TypeScript utility scripts
├── .tmp/                # Intermediate files
├── .env                 # Environment variables and API keys
├── package.json
└── brand-guidelines.md  # (optional) Fonts and colors
```

**Verification:**
Before reporting a task as done, run the project's checks (typecheck, lint, tests, build) using the script names in `package.json`. For UI or main-process changes, also launch the app in dev mode and confirm the behavior works.

## File Organization

**Deliverables vs Intermediates:**
- **Deliverables**: outputs the user can access, such as files saved to a user-chosen location through the app's save dialog, or cloud outputs (Google Sheets, Google Slides, etc.) when a directive calls for them
- **Intermediates**: temporary files needed during processing

**Directory structure:**
- `.tmp/` - All intermediate files in development (dossiers, scraped data, temporary exports). Never commit, always regenerated.
- `execution/` - Utility scripts (the deterministic tools)
- `directives/` - SOPs in Markdown (the instruction set)
- `.env` - Environment variables and API keys (in `.gitignore`)
- `credentials.json`, `token.json` - Google OAuth credentials for development (required files, in `.gitignore`)

**Runtime paths:**
In the packaged app, `.tmp/` and the install directory are not writable. Use `app.getPath('temp')` for intermediates and `app.getPath('userData')` for persistent app data.

**Key principle:** Local files are for processing only. Deliverables live where the user can access them (a file they chose to save, or a cloud service). Everything in `.tmp/` can be deleted and regenerated.

## Summary

You sit between human intent (directives) and deterministic execution (scripts and main-process services). Read the instructions, make decisions, call tools, handle errors, and continuously improve the system.

Be pragmatic. Be reliable. Self-correct.
