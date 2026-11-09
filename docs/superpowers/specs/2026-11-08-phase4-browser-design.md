# Ark Phase 4 - Built-in browser with area selection - Design

Date: 2026-11-08 · Source brief: `PROJECT.md` (feature 6, Phase 4) · Builds on: `docs/superpowers/specs/2026-11-07-phase2-editor-terminal-design.md` (tab strip, module-level stores) · Visual rules: `brand-guidelines.md` · Working rules: `AGENTv2.md`, `CLAUDE.md`

Decisions the user made in the design conversation are stated plainly. Items marked **[call]** are the designer's, either played back to the user without objection or settled after the builder check.

## 1. Intent

When a page of the user's web project looks wrong, today they take a screenshot, switch to the thread, paste it and explain where to look. Phase 4 removes that detour. The user previews the project's local dev server inside Ark, selects the area that is wrong, writes a comment next to it and sends it to the thread that is open on that project. The team handles it like any other message: the planner decides, the developer fixes it in the worktree, and risky actions still go through approval cards.

Success: from "this card is misaligned" to a message in the thread, carrying the comment, a picture of the area and enough about the element that an agent finds the code without guessing, in one drag and one Send.

## 2. Goals, non-goals, anti-goals

**Goals**
- A **browser tab** in the main pane's tab strip, next to the thread tab and file tabs (the user chose this over a split beside the thread).
- An address bar for **local addresses only**, with back, forward and reload.
- **Select**: drag a rectangle over the page. A comment box opens next to it.
- **Send to thread**: one message to the thread open in the project, carrying:
  - the comment;
  - the selected area as an attached image;
  - the page address and a short description of the element under the selection.

**Non-goals (this phase)**
- Ark starting or detecting the dev server. The user runs it in Ark's terminal and types the address (the user's decision).
- Non-local sites, including a deployed copy of the project (the user's decision: "local addresses are enough").
- Developer tools, console logs or network logs sent to agents **[call]**.
- Several areas in one comment, or picking an element by hovering and clicking (the user chose the drag) **[call for the first]**.
- More than one browser tab per project **[call]**.
- Remembering the tab or its address across restarts. Tabs are in memory only, as in Phase 2 **[call]**.

**Anti-goals** (would make this a failure even if it works)
- A page in the browser reaching Ark: the preload API, IPC, Node, the user's files, or Ark's own window.
- Ark navigating to a non-local address inside the app, including through a redirect, a link, `window.open` or a form.
- The comment going to a thread other than the one the user sees as open.
- Text from the page reaching the agents unbounded. The page is untrusted content, so the element description is short and capped.
- Losing the comment the user typed because a send failed.

## 3. Constraints

- Windows, Electron 45, React 19, Tailwind 4. No new dependency.
- Renderer security as in earlier phases:
  - narrow typed preload functions;
  - every payload validated in main;
  - channels named by domain (`browser:*`);
  - Ark's main window keeps `contextIsolation`, `sandbox`, no `nodeIntegration`, its CSP, and its denial of navigation and popups.
- The browser is **not** an agent, and agents are not involved until the message is sent. Nothing here touches `engines/isolation.ts`.
- Messages go through the existing thread send path (`threads:send` → `conductor.send`), with the existing attachment rules in `src/shared/attachments.ts`: images up to 5 MB, at most 5 files.
- Brand colours and fonts from `brand-guidelines.md`. The selection rectangle and Send use Accent `#00A896`.
- UI text is English.

## 4. Concepts

- **Local address** **[call]**:
  - the scheme is `http:` or `https:`;
  - the host is `localhost`, any name ending in `.localhost`, an IPv4 address in `127.0.0.0/8`, or `[::1]`;
  - any port is fine;
  - nothing else counts: no `file:`, no LAN IPs, no `0.0.0.0`.

  One pure function in `src/shared/` decides this. Main and the renderer both use it, and it has unit tests.
- **Browser view**: the Electron `WebContentsView` that shows the page, one per project with an open browser tab. It lives in main **[call]**. It was chosen over `<webview>`, which Electron discourages; the renderer only tells main where the view sits.
- **Freeze frame**: while selecting, the user drags over a still capture of the page, not over the live page. §5.3 says why.
- **Element description**: a few facts about the smallest element that contains the selection, read from the page and capped in length (§6.3).

## 5. Screens

### 5.1 The browser tab

- **Opening.** A globe button on the right of the tab strip, next to the terminal toggle, opens the project's browser tab, or focuses it if it is already open **[call]**. The tab's label is the page's host and port (`localhost:5173`). Before the first address, the label is `Browser`.
- **Placement.** The tab sits in the tab strip with the file tabs, in the same per-project order. It has a close button like a file tab. Closing it destroys that project's browser view.
- **Address bar**, at the top of the tab content, 32px:
  - back, forward and reload buttons;
  - an address field;
  - **Select** (Accent when active).

  Enter in the field navigates. An address without a scheme gets `http://` (`localhost:3000` → `http://localhost:3000/`). A non-local address is refused under the field with "Only local addresses (localhost, 127.0.0.1) open here." and the page does not change.
- **Before an address.** The page area shows a short hint: "Start your dev server in the terminal (Ctrl+`), then enter its address, for example localhost:5173."
- **Load failures.** When the page fails to load (server not running, connection refused), the page area shows "Can't reach `<address>`. Is the dev server running?" with a Retry button **[call]**.
- **Leaving the browser.** Back in the browser, the address field shows the current address after every navigation, including links clicked inside the page. A link to a non-local address does not navigate: it opens in the user's default browser, through `shell.openExternal`, for `http`/`https` only. A non-local redirect the user did not start is blocked with a bar instead (§6.1).
- **Keeping state.**
  - The view stays alive, hidden, while the user switches to another tab, project or area. Coming back shows the same page, scrolled where it was.
  - Switching project hides one project's view and shows the other's.
  - The terminal panel under the tab content stays usable while the browser tab is active. The view is sized to the space above it.

### 5.2 Overlays over a native view **[call]**

A `WebContentsView` is drawn above the renderer, so any Ark menu, popover or dialog that would overlap the page area would be hidden under it.

- While such an overlay is open, the view is hidden, and the page area shows the last capture of the page in its place so nothing jumps.
- The builder finds which existing overlays can overlap the page area (tab strip menus, the terminal panel's shell menu, confirm dialogs) and routes them through one "an overlay is open" signal. A separate mechanism per menu is not wanted.

### 5.3 Selecting an area

1. **Select** (or Ctrl+Shift+S while the browser tab is active **[call]**) captures the visible page.
2. The renderer shows the capture in place of the live view (freeze frame), with a crosshair cursor and a thin bar: "Drag over the area to comment on. Esc to cancel."
3. The user drags a rectangle. It shows as a dashed Accent border with a light Accent fill.
   - A rectangle smaller than 8×8 px is treated as a click and ignored.
   - Dragging again replaces the rectangle.
4. On release, a **comment box** opens beside the rectangle. It sits on the right, or on the left or below when there is no room, and is never clipped by the page area. It has:
   - a text field (focused, multi-line; Enter sends, Shift+Enter is a new line);
   - **Send to thread**;
   - a Cancel (×).
5. Esc or Cancel closes the box and leaves selection mode back to the live page. So does a click outside the rectangle and box.

**Why a freeze frame** **[call]**:
- It needs no script running in the page while the user drags, and Ark's UI never has to sit inside or over a native view.
- What gets cropped is exactly what the user saw when they selected.
- Cost: animations and live updates pause during selection. That is acceptable for pointing at a static problem.

### 5.4 Sending

- **Send to thread** goes to the thread currently open in that project, the one the thread tab shows.
- With no thread open (the thread tab shows `New thread` or the project name), the button is disabled, with the hint "Open a thread to send this." Opening a thread from the sidebar meanwhile enables it without losing the comment.
- An empty comment cannot be sent **[call]**. The picture alone does not say what is wrong.
- Sending works while the team's turn is running, exactly as the thread composer does today (the conductor already accepts a message mid-turn). Every rule `conductor.send` applies to a normal message applies here too.
- **On success:**
  - the box closes and the view goes back to live;
  - a small "Sent to # `<thread title>`" note shows in the address bar for a few seconds;
  - Ark does **not** switch to the thread tab (the user decides when to look).
- **On failure:** the box stays open with the text intact, and the error shows inside the box.

### 5.5 What the message looks like

The text the conductor receives is the user's comment, a blank line, then a short block **[call]**:

```
<user's comment>

From the browser: http://localhost:5173/pricing
Element: div#plan-pro.card.pricing-card · main>section.grid>div:nth-of-type(2) · "Pro plan €12/month Everything in Free, plus…"
```

- One image is attached: the cropped area as `area-<yyyyMMdd-HHmmss>.png`. It shows in the transcript and reaches the agents like any attached image.
- If the PNG would exceed 5 MB, it is scaled down until it fits **[call]**.
- If the element could not be read (the page changed, or the script failed), the `Element:` line is left out and the message still sends.
- **Page text must not act as Ark syntax** **[call, after the builder check]**. The send path parses `#word` into thread tags (`mergeTags`, `src/shared/tokens.ts`) and, mid-turn, `@id` into the agent who answers (`mentionOf`, `threads/rules.ts`). Both match only a `#` or `@` at the start or after whitespace. So in every page-derived string (address, element facts, text excerpt), a `#` or `@` in that position gets a U+2060 word joiner inserted before it. It is invisible and the agent still reads the text, but neither parser matches it. The CSS path is joined with `>` and no spaces (`main>section.grid>#plan-pro`), which is valid CSS and has no token positions. The user's own comment is untouched: their `#tag` and `@agent` work as usual. One pure function does this, with unit tests that run its output through `mergeTags` and `mentionOf`.

## 6. Main process

### 6.1 The view (`src/main/services/browser/` **[call]**)

Each project's browser view is a `WebContentsView` added to the main window's content view, with:
- `webPreferences`: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **no preload**, `webSecurity: true`;
- its own session partition `persist:ark-browser` **[call]**, so a dev server's login or local storage survives a restart and is kept apart from Ark's own session.

The session denies:
- every permission request (camera, notifications, geolocation…);
- every download.

Navigation is checked in main, on `will-navigate`, `will-redirect` and `will-frame-navigate`, and in `setWindowOpenHandler`:
- a local address is allowed. For `window.open`, it loads in the same view: no new windows;
- an `http`/`https` non-local address is cancelled and opened with `shell.openExternal`;
- anything else is cancelled silently (`file:`, `javascript:`, custom schemes).

Subframes (iframes) to non-local addresses are blocked, not opened externally **[call]**. Otherwise a page with an ad iframe would fire `openExternal` on load.

**Only navigations the user started open externally** **[call, after the builder check]**:
- A click on a link or a form submit counts as started by the user (Electron's `isUserInitiated` / `hasUserGesture`, or `window.open` from a click).
- A navigation nobody asked for is blocked: a server redirect, `location = …` on load, or a meta refresh to a non-local address. An example is a dev app that sends itself to a hosted login on every load.
- When one is blocked, the page area shows a bar with an **Open in your browser** button: "This page tried to open `<host>`, which isn't local."
- Without this rule, every load and every Retry would open a new tab in the user's browser.

**Requests the page makes** (scripts, styles, fonts, images, fetch/XHR to remote hosts such as CDNs, Supabase or Stripe) are **allowed** **[call, after the builder check]**. "Local only" applies to what the browser shows as the page, not to what the page loads. Blocking them would break most real dev pages. The page still cannot reach Ark (§2), and the verification does not claim the browser is offline.

**Self-signed certificates** **[call, after the builder check]**: Vite's basicSsl, `next dev --experimental-https` and similar serve local https with a self-signed certificate, which Chromium refuses. On the `persist:ark-browser` session only, a certificate error is accepted when the URL is a local address, and refused for anything else (handled with the session's certificate check, or `app.on('certificate-error')` filtered to that session's web contents). Loopback traffic stays on the machine, so the usual reason for the check does not apply. Tests cover: local accepted, non-local refused, and Ark's own session untouched.

**Keys while the page has focus** **[call, after the builder check]**: a focused view takes the keyboard, so main handles the view's `before-input-event`:
- **Ctrl+R and F5** reload the page. Today Ark has no application menu set, so Electron's default menu would reload Ark's own window and kill every terminal, including the dev server. Main swallows them and reloads the view.
- **Ctrl+`, Ctrl+Shift+S, and Esc during selection** go to Ark: main forwards them to the renderer.
- **Every other key** stays with the page.

The renderer sends the view's bounds (from a placeholder element's `getBoundingClientRect`, on resize and layout change) and whether it is visible. Main clamps the bounds to the window's content area.

### 6.2 Capture and crop

- **Capture.** `webContents.capturePage()` of the visible page, returned to the renderer as PNG bytes for the freeze frame.
- **Crop.** Done from that same capture, so the picture matches what the user saw. Coordinates are scaled by the capture's device pixel ratio.

  The builder chooses where to crop: main, with `nativeImage.crop`, or the renderer, with a canvas. Either way, the attachment reaches `threads:send` as an `Upload`.

### 6.3 Element description

When the user releases the drag, main runs a small fixed script in the page with `executeJavaScriptInIsolatedWorld`. The page's own scripts cannot see it or tamper with its globals. The script receives the rectangle in CSS pixels and:
1. starts from `document.elementFromPoint` at the rectangle's centre;
2. walks up to the first element whose bounding box contains the whole rectangle (or `body`);
3. returns:
   - `tag`;
   - `id`;
   - up to 4 class names;
   - a short CSS path, at most 5 levels, using `id` when present and `:nth-of-type` otherwise;
   - the element's `innerText`, collapsed to single spaces and cut to 120 characters.

Main validates the result's shape and caps every string again before it reaches the renderer. Every string is page content: the cap is the defence.

Cross-origin iframes are not entered. The description stops at the frame element.

### 6.4 IPC (narrow, typed)

Indicative channels **[call]**; the builder may merge or rename them, within the `browser:*` domain:
- `browser:open(projectId)` and `browser:close(projectId)`;
- `browser:navigate(projectId, url)`, which validates `url` with the shared local-address function and refuses otherwise;
- `browser:back`, `browser:forward` and `browser:reload(projectId)`;
- `browser:layout(projectId, bounds, visible)`;
- `browser:capture(projectId)` → PNG bytes;
- `browser:describe(projectId, rect)` → element description, or nothing;
- events to the renderer: address changed, title changed, loading started or stopped, load failed, can-go-back/forward.

Sending reuses `threads:send` from the renderer. No new send path.

## 7. Renderer

- A module-level browser store per project, like `editor/tabs-store.ts` and the terminal store. It holds:
  - whether the tab is open;
  - the current address and title;
  - the loading state;
  - the selection state;
  - the comment draft.

  It survives leaving the Threads area.
- The browser tab joins the tab strip's per-project order. The builder decides whether it becomes a special entry in `tabs-store.ts` or the strip merges two sources. The thread tab still comes first.
- Tab label, address bar, freeze-frame canvas, rectangle and comment box are React components styled from the brand tokens.

## 8. Build order **[call]**

1. Local-address rule, browser view in main with navigation and permission lockdown, tab and address bar. Exit: browse a local dev server inside Ark; non-local addresses are refused or opened outside.
2. Freeze-frame selection, comment box, capture and crop, element description, send. Exit: a comment with picture and element lands in the open thread.

Each step: typecheck, lint, tests and build green; then a CDP check in the built app.

## 9. Verification

- **Unit tests:**
  - the local-address function: hosts, ports, schemes, `.localhost`, `127.x`, `[::1]`, look-alikes such as `localhost.evil.com`, `127.0.0.1.nip.io`, user-info tricks like `http://localhost@evil.com`, and LAN IPs;
  - the element-description shape check and caps;
  - message text formatting;
  - the crop maths with a device pixel ratio;
  - the page-text neutraliser: `#` and `@` in page strings produce no tags and no mention, the user's comment keeps both;
  - the certificate rule.
- **CDP check in the built app** (recipe in handoff `seq: 7`), against a small local HTTP server started by the test driver in the scratchpad. The driver checks:
  - open the tab, navigate, back and forward;
  - a non-local link opens externally and does not navigate;
  - select, comment and send to an open thread: the transcript gets the text, the `From the browser` block and the image;
  - with no thread open, Send is disabled;
  - Esc cancels;
  - project switch and coming back keep the page;
  - an Ark menu that overlaps the page area is visible (overlay rule);
  - a redirect to a non-local address on load opens nothing and shows the bar;
  - Ctrl+R with the page focused reloads the page, and the terminals are still alive.
- **Security check** in the same run: from the page, `window.ark`, `require` and `process` are undefined; `window.open('https://example.com')` opens no Ark window.

## 10. Left to the builder

- Where the crop happens (main or renderer canvas).
- How the browser tab enters the tab strip's order.
- The exact IPC names and event shapes, within §6.4's intent.
- The globe icon and the exact sizes, inside the brand rules.
- How the view's bounds track layout changes (ResizeObserver or similar).
- How the "an overlay is open" signal is wired.
