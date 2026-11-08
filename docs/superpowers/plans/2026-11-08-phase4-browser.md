# Phase 4: Built-in browser with area selection, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser tab in the main pane shows the project's local dev server. The user drags a rectangle over the page, writes a comment and sends it to the open thread, with a cropped image and a short element description.

**Architecture:**
- **Shared.** `src/shared/browser.ts` holds every pure rule, so both processes use it and vitest covers it:
  - the local-address check;
  - the navigation verdict;
  - the certificate verdict;
  - the page-text neutraliser;
  - the element caps;
  - the message text;
  - the crop maths.
- **Main.** `src/main/services/browser/` owns one `WebContentsView` per project:
  - `session.ts` locks down the `persist:ark-browser` partition;
  - `describe.ts` is the in-page script that describes the element;
  - `views.ts` is the `BrowserViews` class (views, navigation policy, keys, capture and pick).

  IPC handlers go in `ipc/index.ts` under `browser:*`.
- **Renderer.**
  - `browser/browser-store.ts` is a module-level store per project, and `browser/overlay.ts` is the "an overlay is open" counter.
  - `components/BrowserPane.tsx` has the address bar, the page placeholder and the notices. `components/BrowserSelect.tsx` has the freeze frame, the rectangle and the comment box.
  - The browser tab joins `editor/tabs-store.ts`'s per-project order under the key `BROWSER_TAB`.
  - Sending reuses `window.ark.threads.send`.

**Tech Stack:** Electron 45 (`WebContentsView`, `session`, `webRequest`), React 19, Tailwind 4, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-08-phase4-browser-design.md`. Read it whole; section numbers below refer to it.

## Global Constraints

- No new dependency. Electron 45 as in `package.json`.
- Ark's main window keeps `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, its CSP (`src/renderer/index.html`), and its denial of navigation and popups (`src/main/index.ts`). The CSP is not changed: the freeze frame is a `data:` URL, which `img-src 'self' data:` already allows.
- Browser views have:
  - `webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: 'persist:ark-browser' }`;
  - **no preload**.
- Local address (spec §4): `http:`/`https:` with a host that is `localhost`, ends in `.localhost`, is an IPv4 address in `127.0.0.0/8`, or is `[::1]`. Any port. Nothing else.
- Every `browser:*` payload is validated in main:
  - project ids with the existing `uuid(v, 'project')`;
  - URLs with `isLocalUrl`;
  - rectangles and bounds with `cleanRect` and `cleanBounds`.
- Page-derived strings are capped:
  - `tag` 32, `id` 64, at most 4 classes of 64 each, `path` 300 characters with at most 5 levels, `text` 120;
  - every string passes `neutralize` before it reaches a message.
- Attachments obey `src/shared/attachments.ts`: the PNG is at most `IMAGE_MAX_BYTES` (5 MB).
- Copy, verbatim (English):
  - `Browser` (tab label before an address);
  - `Select`;
  - `Send to thread`;
  - `Only local addresses (localhost, 127.0.0.1) open here.`;
  - `Start your dev server in the terminal (Ctrl+\`), then enter its address, for example localhost:5173.`;
  - `Can't reach <address>. Is the dev server running?` and `Retry`;
  - `This page tried to open <host>, which isn't local.` and `Open in your browser`;
  - `Drag over the area to comment on. Esc to cancel.`;
  - `Open a thread to send this.`;
  - `Sent to # <thread title>`;
  - `From the browser: ` and `Element: `.
- Shortcuts (spec §5.3, §6.1):
  - Ctrl+Shift+S selects while the browser tab is active;
  - with the page focused, Ctrl+R and F5 reload the page, Ctrl+` and Ctrl+Shift+S go to Ark, and Ctrl+W is swallowed **[call: the default menu's Ctrl+W would close Ark's window]**.
- Brand: Accent `#00A896` for the rectangle, Select (active) and Send. Classes come from `src/renderer/components/ui.ts`.
- Working rules:
  - commits go through `git commit -F <file>`, the file written without a BOM;
  - never write to `~/.claude`, `~/.codex` or `%APPDATA%\ark`;
  - the test app runs with `--user-data-dir` in the scratchpad, with `ark-profile` in the name;
  - stop it by filtering `*ark-profile*` in `Win32_Process`;
  - `npm run test:live` is not run.
- Every task ends with `npm run typecheck`, `npm run lint` and `npm test` green.

## Review Focus

These are the conditions most likely to bite a user that no unit test can reach. Each one is pinned by a check in Task 7 (the CDP run), named there.

1. **Leaving the Threads area** (Usage, Agents) with the browser tab active. The native view must disappear, not float over the other screen. Check R1.
2. **Resizing the window or dragging the terminal divider** while the browser tab is active. The view tracks its placeholder and never covers the tab strip or the terminal. Check R2.
3. **Reloading Ark itself** (Ctrl+R with Ark focused) with a browser open. Every view is destroyed, and no orphan native view sits over the fresh UI. Check R3.
4. **Stopping the dev server, then Reload**. The page area shows `Can't reach …` (not Chromium's error page), and Retry recovers once the server is back. Check R4.
5. **Switching thread in the sidebar while the comment box is open**. The draft survives, and Send goes to the newly shown thread. Check R5.

---

### Task 1: Local-address and navigation rules

**Files:**
- Create: `src/shared/browser.ts`
- Test: `tests/shared/browser.test.ts`

**Interfaces:**
- Produces (exact):
  ```ts
  export type Rect = { x: number; y: number; width: number; height: number };
  export type NavVerdict = 'allow' | 'external' | 'blocked' | 'ignore';
  export const USER_GESTURE_MS = 1000;
  export function isLocalHost(hostname: string): boolean;   // URL.hostname form: 'localhost', '127.0.0.1', '[::1]'
  export function isLocalUrl(url: string): boolean;         // parses with URL; false on parse error
  export function toAddress(input: string): string | undefined; // trims, adds 'http://' when no scheme, returns URL.href if local
  export function navVerdict(url: string, userStarted: boolean): NavVerdict;
  export function certVerdict(hostname: string): 0 | -3;     // 0 = trust, -3 = Chromium decides
  ```

- [ ] **Step 1: Write the failing tests** in `tests/shared/browser.test.ts`:

  ```ts
  describe('isLocalUrl', () => {
    it.each([
      'http://localhost:5173/', 'https://localhost/', 'http://app.localhost:3000/x',
      'http://127.0.0.1:8080/', 'http://127.5.6.7/', 'http://[::1]:3000/', 'http://127.1/',
    ])('accepts %s', (u) => expect(isLocalUrl(u)).toBe(true));
    it.each([
      'http://localhost.evil.com/', 'http://127.0.0.1.nip.io/', 'http://localhost@evil.com/',
      'http://192.168.1.10:5173/', 'http://0.0.0.0:3000/', 'http://10.0.0.1/', 'file:///C:/x.html',
      'javascript:alert(1)', 'ftp://localhost/', 'not a url', 'http://[::2]/',
    ])('refuses %s', (u) => expect(isLocalUrl(u)).toBe(false));
  });
  describe('toAddress', () => {
    it('adds http:// and normalises', () => expect(toAddress(' localhost:3000 ')).toBe('http://localhost:3000/'));
    it('keeps https', () => expect(toAddress('https://localhost:8443/a')).toBe('https://localhost:8443/a'));
    it('refuses non-local', () => expect(toAddress('example.com')).toBeUndefined());
    it('refuses empty', () => expect(toAddress('  ')).toBeUndefined());
  });
  describe('navVerdict', () => {
    it('allows local', () => expect(navVerdict('http://localhost:5173/a', false)).toBe('allow'));
    it('opens a clicked non-local link outside', () => expect(navVerdict('https://github.com/', true)).toBe('external'));
    it('blocks a non-local navigation nobody started', () => expect(navVerdict('https://auth.example.com/', false)).toBe('blocked'));
    it.each(['file:///C:/x', 'javascript:void 0', 'mailto:a@b.c', 'about:blank'])('ignores %s', (u) =>
      expect(navVerdict(u, true)).toBe('ignore'));
  });
  describe('certVerdict', () => {
    it('trusts local hosts', () => expect(certVerdict('localhost')).toBe(0));
    it('trusts 127.x', () => expect(certVerdict('127.0.0.1')).toBe(0));
    it('leaves others to Chromium', () => expect(certVerdict('example.com')).toBe(-3));
  });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/shared/browser.test.ts`
  Expected: FAIL, because `src/shared/browser.ts` does not exist.

- [ ] **Step 3: Implement the five functions** in `src/shared/browser.ts`.
  - `isLocalHost` decides on the hostname the WHATWG `URL` produced. The parser already turns `127.1` into `127.0.0.1` and keeps the brackets on IPv6.
  - IPv4 means four dot-separated decimal octets, the first `127`.
  - `certVerdict` is `isLocalHost(h) ? 0 : -3`. Certificate hostnames have no brackets, so `::1` is also local there.

- [ ] **Step 4: Run them and see them pass**

  Run: `npx vitest run tests/shared/browser.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(browser): local-address and navigation rules`.

---

### Task 2: Message text, element caps and crop maths

**Files:**
- Modify: `src/shared/browser.ts`
- Test: `tests/shared/browser.test.ts` and `tests/main/browser-message.test.ts`. The second sits in `tests/main` because it imports `mentionOf` from `src/main/services/threads/rules.ts`.

**Interfaces:**
- Consumes: `Rect` from Task 1.
- Produces (exact):
  ```ts
  export type ElementInfo = { tag: string; id?: string; classes: string[]; path: string; text: string };
  export const MIN_SELECTION = 8;
  export function neutralize(s: string): string;              // inserts U+2060 before a '#'/'@' at start or after whitespace
  export function cleanElement(v: unknown): ElementInfo | undefined; // shape check + caps (Global Constraints)
  export function browserMessage(comment: string, url: string, el?: ElementInfo): string;
  export function cleanRect(v: unknown, view: { width: number; height: number }): Rect | undefined;
  export function cleanBounds(v: unknown): Rect | null | undefined; // null = hidden; undefined = invalid
  export function imageBox(sel: Rect, view: { width: number; height: number }, image: { width: number; height: number }): Rect;
  export function areaName(d: Date): string;                  // 'area-yyyyMMdd-HHmmss.png', local time
  ```

- [ ] **Step 1: Write the failing tests.**

  In `tests/main/browser-message.test.ts`:
  ```ts
  it('page text makes no tags and no mention', () => {
    const s = neutralize('#sale ends soon, ask @developer');
    expect(mergeTags([], s)).toEqual([]);
    expect(mentionOf(s, ['developer'])).toBeUndefined();
    expect(s.replace(/\u2060/g, '')).toBe('#sale ends soon, ask @developer');
  });
  it("the user's own tags and mentions still work", () => {
    const el = { tag: 'div', classes: [], path: 'main>#plan', text: 'Ask @developer #promo' };
    const m = browserMessage('fix this #ui @designer', 'http://localhost:5173/', el);
    expect(mergeTags([], m)).toEqual(['ui']);
    expect(mentionOf(m, ['designer', 'developer'])).toBe('designer');
  });
  ```

  In `tests/shared/browser.test.ts`:
  ```ts
  it('formats the message', () => {
    const el = { tag: 'div', id: 'plan-pro', classes: ['card', 'pricing-card'], path: 'main>section.grid>div:nth-of-type(2)', text: 'Pro plan €12/month' };
    expect(browserMessage('  misaligned  ', 'http://localhost:5173/pricing', el)).toBe(
      'misaligned\n\nFrom the browser: http://localhost:5173/pricing\nElement: div#plan-pro.card.pricing-card · main>section.grid>div:nth-of-type(2) · "Pro plan €12/month"');
  });
  it('leaves out the Element line without an element, and the quote without text', () => {
    expect(browserMessage('x', 'http://localhost/')).toBe('x\n\nFrom the browser: http://localhost/');
    expect(browserMessage('x', 'http://localhost/', { tag: 'img', classes: [], path: 'body>img', text: '' }))
      .toBe('x\n\nFrom the browser: http://localhost/\nElement: img · body>img');
  });
  it('caps page strings', () => {
    const e = cleanElement({ tag: 'div'.repeat(20), id: 'i'.repeat(100), classes: ['a', 'b', 'c', 'd', 'e', 'x'.repeat(99)], path: 'p'.repeat(500), text: 't'.repeat(500) })!;
    expect([e.tag.length, e.id!.length, e.classes.length, e.path.length, e.text.length]).toEqual([32, 64, 4, 300, 120]);
  });
  it('refuses a bad shape', () => {
    expect(cleanElement(null)).toBeUndefined();
    expect(cleanElement({ tag: 1, classes: [], path: '', text: '' })).toBeUndefined();
    expect(cleanElement({ tag: 'div', classes: 'a', path: '', text: '' })).toBeUndefined();
  });
  it('collapses whitespace in text', () => expect(cleanElement({ tag: 'p', classes: [], path: 'p', text: ' a \n\t b ' })!.text).toBe('a b'));
  it('validates a selection rect', () => {
    const view = { width: 800, height: 600 };
    expect(cleanRect({ x: 10, y: 10, width: 100, height: 50 }, view)).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(cleanRect({ x: 10, y: 10, width: 7, height: 50 }, view)).toBeUndefined();   // under MIN_SELECTION
    expect(cleanRect({ x: 750, y: 10, width: 100, height: 50 }, view)).toBeUndefined(); // past the view
    expect(cleanRect({ x: NaN, y: 0, width: 10, height: 10 }, view)).toBeUndefined();
  });
  it('validates bounds', () => {
    expect(cleanBounds(null)).toBeNull();
    expect(cleanBounds({ x: 0, y: 64, width: 900, height: 500 })).toEqual({ x: 0, y: 64, width: 900, height: 500 });
    expect(cleanBounds({ x: -1, y: 0, width: 10, height: 10 })).toBeUndefined();
    expect(cleanBounds({ x: 0, y: 0, width: 20000, height: 10 })).toBeUndefined();
  });
  it('maps a selection to image pixels at 150%', () =>
    expect(imageBox({ x: 10, y: 20, width: 100, height: 40 }, { width: 800, height: 600 }, { width: 1200, height: 900 }))
      .toEqual({ x: 15, y: 30, width: 150, height: 60 }));
  it('clamps to the image', () =>
    expect(imageBox({ x: 790, y: 590, width: 10, height: 10 }, { width: 800, height: 600 }, { width: 799, height: 599 }))
      .toEqual({ x: 789, y: 589, width: 10, height: 10 }));
  it('names the area', () => expect(areaName(new Date(2026, 10, 8, 9, 5, 7))).toBe('area-20261108-090507.png'));
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/shared/browser.test.ts tests/main/browser-message.test.ts`
  Expected: FAIL, because the functions are not exported.

- [ ] **Step 3: Implement them in `src/shared/browser.ts`.**
  - `neutralize` is `s.replace(/(^|\s)([#@])/gu, '$1\u2060$2')`.
  - `browserMessage` builds the element part as `tag` + `#id` + `.class`…, then ` · path`, then ` · "text"` when text is non-empty. It runs `neutralize` on the url line and on the element part, never on the comment.
  - `cleanBounds` accepts finite numbers with `x, y ≥ 0`, `width, height ≥ 0`, each `≤ 10000`.
  - `cleanRect` accepts finite numbers, `width, height ≥ MIN_SELECTION`, inside `view`.
  - `imageBox` scales by `image/view` per axis, rounds, then clamps so the box stays inside the image with a width and height of at least 1.

- [ ] **Step 4: Run them and see them pass**

  Run: `npx vitest run tests/shared/browser.test.ts tests/main/browser-message.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(browser): message text, element caps and crop maths`.

---

### Task 3: The in-page element script

**Files:**
- Create: `src/main/services/browser/describe.ts`
- Test: `tests/main/browser-describe.test.ts`

**Interfaces:**
- Consumes: `Rect` (Task 1).
- Produces:
  ```ts
  export function pageDescribe(r: Rect): unknown;   // runs IN THE PAGE; self-contained (references nothing outside its body)
  export function describeScript(r: Rect): string;  // `(${pageDescribe.toString()})(${JSON.stringify(r)})`
  ```

  The raw result is shaped like `ElementInfo`. Main passes it through `cleanElement` (Task 2).

- [ ] **Step 1: Write the failing tests.**

  Build a tiny fake DOM in the test: nodes with `tagName`, `id`, `classList` (an array works), `innerText`, `parentElement`, `children`, and `getBoundingClientRect()`. The fake `document` has `body` and `elementFromPoint(x, y)`.

  Run the script with `vm.runInNewContext(describeScript(r), { document })`. This proves the function needs no outer reference.
  ```ts
  it('walks up to the first element that contains the whole rectangle', () => {
    // body > main > section.grid > div#plan-pro.card (rect 0,0,200,100) > span (rect 10,10,50,20)
    // elementFromPoint returns the span; selection { x: 5, y: 5, width: 150, height: 60 }
    const out = vm.runInNewContext(describeScript({ x: 5, y: 5, width: 150, height: 60 }), { document: dom });
    expect(out).toMatchObject({ tag: 'div', id: 'plan-pro', classes: ['card'], path: 'main>section.grid>#plan-pro' });
  });
  it('uses :nth-of-type without an id', () => {
    // the second of two <div>s under section.grid, no id → path ends 'div:nth-of-type(2)'
  });
  it('stops at 5 levels', () => { /* nesting 8 deep → path has 5 '>'-separated segments, deepest last */ });
  it('falls back to body', () => { /* nothing contains the rect → tag 'body' */ });
  it('returns null when elementFromPoint finds nothing', () => { /* → null */ });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run tests/main/browser-describe.test.ts`
  Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement `pageDescribe`.**
  - Start from `document.elementFromPoint(centre)`, then walk `parentElement` until the bounding box contains the rectangle (or `body`).
  - Return `{ tag: tagName.toLowerCase(), id, classes: first 4, path, text: innerText.slice(0, 500) }`. The final caps happen in `cleanElement`.
  - Path segments, nearest to the element first, at most 5: `#id` when the node has one (and stop climbing there), else `tag` plus `.class` (the first class), plus `:nth-of-type(n)` when siblings share the tag. Join them with `>`.
  - Keep it plain ES2020 with no helpers outside the function. The electron-vite main build doesn't minify, so `toString()` stays runnable. Task 7 also proves it in the real page.

- [ ] **Step 4: Run them and see them pass**

  Run: `npx vitest run tests/main/browser-describe.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(browser): in-page element description`.

---

### Task 4: Browser views in main, session lockdown, IPC and preload

**Files:**
- Create: `src/main/services/browser/session.ts`, `src/main/services/browser/views.ts`
- Modify:
  - `src/main/ipc/index.ts`, for the handlers and for destroying all views on Ark's own main-frame navigation, next to the existing `did-start-navigation` listener;
  - `src/main/index.ts`, if `BrowserViews` needs `shell` wiring through `registerIpc` deps;
  - `src/shared/types.ts`, for `ArkApi.browser`;
  - `src/preload/index.ts`.
- Test: `tests/main/browser-session.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `isLocalUrl`, `navVerdict`, `certVerdict`, `USER_GESTURE_MS`;
  - from Task 2: `cleanRect`, `cleanBounds`, `cleanElement`, `imageBox`, `ElementInfo`, `Rect`;
  - from Task 3: `describeScript`;
  - `IMAGE_MAX_BYTES` from `@shared/attachments`.
- Produces, in `src/shared/browser.ts`:
  ```ts
  export type BrowserState = {
    url: string; title: string; loading: boolean; canBack: boolean; canForward: boolean;
    failed?: { url: string; reason: string }; blocked?: { host: string };
  };
  export type BrowserKey = 'terminal' | 'select';
  export type Picked = { image: Uint8Array; element?: ElementInfo };
  ```
- Produces, in `src/main/services/browser/session.ts`:
  ```ts
  export const PARTITION = 'persist:ark-browser';
  export function lockDown(ses: Electron.Session): void; // idempotent
  ```
- Produces `ArkApi.browser`, with channels `browser:<name>`:
  ```ts
  browser: {
    open(projectId: string): Promise<BrowserState>;
    close(projectId: string): Promise<void>;
    navigate(projectId: string, url: string): Promise<void>;
    back(projectId: string): Promise<void>;
    forward(projectId: string): Promise<void>;
    reload(projectId: string): Promise<void>;
    layout(projectId: string, bounds: Rect | null): Promise<void>;   // null = hide
    capture(projectId: string): Promise<string>;                      // PNG data URL of the visible page
    pick(projectId: string, rect: Rect): Promise<Picked>;             // crop of the LAST capture + element
    openBlocked(projectId: string): Promise<void>;                    // opens the last blocked URL externally
    onState(cb: (projectId: string, s: BrowserState) => void): () => void;
    onKey(cb: (projectId: string, k: BrowserKey) => void): () => void;
  };
  ```

- [ ] **Step 1: Write the failing test** `tests/main/browser-session.test.ts`.
  - Call `lockDown` on a fake session object that records the handlers it receives.
  - Then assert:
    - the permission request handler answers `false`;
    - the permission check handler returns `false`;
    - the `will-download` listener calls `preventDefault`;
    - `setCertificateVerifyProc` calls back `0` for `{ hostname: 'localhost' }` and `-3` for `{ hostname: 'example.com' }`;
    - the `webRequest.onBeforeRequest` filter cancels `{ resourceType: 'subFrame', url: 'https://ads.example.com/' }` and `{ resourceType: 'mainFrame', url: 'https://evil.com/' }`, and lets through `{ resourceType: 'mainFrame', url: 'http://localhost:5173/' }`, `{ resourceType: 'script', url: 'https://cdn.example.com/x.js' }` and `{ resourceType: 'subFrame', url: 'http://localhost:5173/frame' }`;
    - a second `lockDown` call on the same session registers nothing new.

- [ ] **Step 2: Run it and see it fail**

  Run: `npx vitest run tests/main/browser-session.test.ts`
  Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement `lockDown`.**
  - It installs the handlers above.
  - The `mainFrame` cancel is the safety net behind the navigation policy, so nothing non-local ever loads as the page.
  - Remember sessions already locked in a `WeakSet`.

- [ ] **Step 4: Run it and see it pass**

  Run: `npx vitest run tests/main/browser-session.test.ts`
  Expected: PASS.

- [ ] **Step 5: Implement `BrowserViews` in `views.ts`.**

  Constructor:
  ```ts
  new BrowserViews({ win, send: (channel: 'browser:state' | 'browser:key', projectId: string, payload: unknown) => void, openExternal: (url: string) => void })
  ```
  Its methods mirror `ArkApi.browser` without the `on*` methods, plus `destroyAll(): void`.

  **Views.**
  - `open` creates the `WebContentsView` if missing, with the Global Constraints' `webPreferences` and `lockDown(view.webContents.session)`.
  - It adds the view to `win.contentView` hidden (`setVisible(false)`) and returns the current `BrowserState`.
  - `close` removes the view and calls `webContents.close()`. `destroyAll` does that for every view.

  **Layout.**
  - `layout(id, null)` hides the view.
  - `layout(id, bounds)` multiplies the bounds by `win.webContents.getZoomFactor()`, clamps them to `win.getContentBounds()` size, calls `setBounds` and shows the view.
  - It keeps the last bounds, in renderer CSS px, for `cleanRect` in `pick`.

  **Navigation policy.**
  - Track the last user input: `webContents.on('input-event')`, for `mouseDown` and `keyDown`, records `Date.now()`.
  - `userStarted` is `Date.now() - last <= USER_GESTURE_MS`. First check the Electron 45 typings for a gesture flag on `will-navigate` or `will-frame-navigate` details, and prefer it if one exists.
  - Apply `navVerdict` on `will-navigate` (main frame) and on `will-redirect`. A redirect always counts as `userStarted = false`.
    - `allow` passes.
    - `external`: `preventDefault`, then `openExternal(url)`.
    - `blocked`: `preventDefault`, remember the URL for `openBlocked`, and set `state.blocked = { host }`.
    - `ignore`: `preventDefault`.
  - In `setWindowOpenHandler`, always `{ action: 'deny' }`.
    - `allow` → `webContents.loadURL(url)`.
    - `external` and `blocked` act as above.
  - `navigate` throws `Only local addresses (localhost, 127.0.0.1) open here.` unless `isLocalUrl`. It clears `blocked` and `failed`.

  **State.** Push `browser:state` on `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `did-start-loading` and `did-stop-loading`.
  - `canBack` and `canForward` come from `webContents.navigationHistory`.
  - `did-fail-load` with `isMainFrame` and an `errorCode` other than `-3` (aborted) sets `failed = { url: validatedURL, reason: errorDescription }`.
  - A successful `did-navigate` clears `failed`.

  **Keys.** On `before-input-event` with `type === 'keyDown'`:
  - Ctrl+R or F5: `preventDefault` and reload the view.
  - Ctrl+W: `preventDefault`.
  - Ctrl+` (`input.code === 'Backquote'`): `preventDefault`, then send `browser:key` with `'terminal'`.
  - Ctrl+Shift+S: `preventDefault`, then send `browser:key` with `'select'`.

  **Capture.** `capture` calls `webContents.capturePage()`, keeps the `NativeImage` per project, and returns `toDataURL()`.

  **Pick.**
  1. Validate `rect` with `cleanRect` against the last bounds.
  2. Crop the kept capture at `imageBox(rect, lastBounds, image.getSize())`.
  3. While `toPNG().byteLength > IMAGE_MAX_BYTES`, resize to 75% width.
  4. Run `executeJavaScriptInIsolatedWorld(999, [{ code: describeScript(pageRect) }])`, where `pageRect` is `rect` divided by the view's `getZoomFactor()`.
  5. Pass the result through `cleanElement`. Any throw means `element: undefined`.
  6. Return `{ image: png, element }`. Without a kept capture, throw `Select again: the page capture is gone.`

- [ ] **Step 6: Wire IPC, types and preload.**
  - In `ipc/index.ts`, construct `BrowserViews` with `send: (c, id, p) => !win.isDestroyed() && win.webContents.send(c, id, p)` and `openExternal: (u) => void shell.openExternal(u)`.
  - Register `browser:*` handlers with the existing `handle` and validators: `uuid(id, 'project')`, `typeof url === 'string' && url.length <= 2048`, `cleanBounds` (undefined → throw `Invalid bounds`) and `cleanRect`.
  - In the existing `did-start-navigation` listener for Ark's main frame, also call `views.destroyAll()`.
  - Add `ArkApi.browser` to `src/shared/types.ts` and the matching `browser` group to `src/preload/index.ts`. The `onState` and `onKey` listeners follow the `terminal.onData` pattern.

- [ ] **Step 7: Run the checks**

  Run: `npm run typecheck`, then `npm run lint`, then `npm test`
  Expected: all green.

- [ ] **Step 8: Commit** `feat(browser): views, session lockdown and IPC in main`.

---

### Task 5: Browser tab, address bar and the overlay rule

**Files:**
- Create: `src/renderer/browser/browser-store.ts`, `src/renderer/browser/overlay.ts`, `src/renderer/components/BrowserPane.tsx`
- Modify:
  - `src/renderer/editor/tabs-store.ts`: `BROWSER_TAB`, and `keys` in `TabsView`;
  - `src/renderer/components/TabStrip.tsx`: the browser tab and the globe button;
  - `src/renderer/components/Icons.tsx`: `GlobeIcon`;
  - `src/renderer/components/Menu.tsx` and `src/renderer/components/GitSections.tsx` (`BranchMenu`): call `useOverlay()`;
  - `src/renderer/pages/Threads.tsx`.

**Interfaces:**
- Consumes: `ArkApi.browser` (Task 4); `toAddress`, `BrowserState`, `Rect` (Tasks 1, 2 and 4).
- Produces, in `tabs-store.ts`:
  ```ts
  export const BROWSER_TAB = 'browser';         // never collides: file tab keys contain '\n'
  export type TabsView = { docs: Doc[]; active: string | null; keys: string[] }; // keys = full order incl. BROWSER_TAB
  export function focusBrowserTab(projectId: string): void;
  export function dropBrowserTab(projectId: string): void; // removes it from the order, picks the next active like close()
  ```
- Produces, in `overlay.ts`:
  ```ts
  export function useOverlay(): void;          // counts while the calling component is mounted
  export function useOverlayOpen(): boolean;
  ```
- Produces, in `browser-store.ts` (Task 6 extends it):
  ```ts
  export type BrowserView = { open: boolean; state: BrowserState; address: string; error?: string };
  export function useBrowser(projectId: string | undefined): BrowserView;
  export function openBrowser(projectId: string): Promise<void>;   // main open + focusBrowserTab
  export function closeBrowser(projectId: string): Promise<void>;  // main close + dropBrowserTab
  export function setAddress(projectId: string, text: string): void;
  export function go(projectId: string): Promise<void>;            // toAddress → error copy, or navigate
  export function onBrowserKey(cb: (projectId: string, k: BrowserKey) => void): () => void;
  ```

- [ ] **Step 1: Tabs.**
  - `tabsOf` keeps `docs` as today and adds `keys` (the project's order, keeping `BROWSER_TAB`).
  - `TabStrip` maps `tabs.keys`. `BROWSER_TAB` renders a tab labelled by host and port (`new URL(state.url).host`, or `Browser` before an address), with a close button calling `closeBrowser`. Other keys render the file tab as today.
  - A globe button sits before the terminal button: `aria-label="Browser"`, `title="Browser"`, calling `openBrowser`.

- [ ] **Step 2: Store.**
  - One `onState` subscription, made lazily as in `terms-store.ts`, updates `state`. When `state.url` changes, the address field follows it.
  - `go` uses `toAddress`. On `undefined` it sets `error` to the refusal copy and does not call main. On success it clears `error` and calls `navigate`.

- [ ] **Step 3: Pane.** `BrowserPane({ projectId })` has:
  - **Address bar** (`h-4`): back, forward and reload `ICON_BUTTON`s, disabled per `canBack`, `canForward` and `url`. Then the field (`INPUT`; Enter → `go`), then **Select**, wired in Task 6.
  - **Messages** under the field: the `error` copy; `state.blocked` as a bar with its copy and an `Open in your browser` button (→ `openBlocked`).
  - **Placeholder** `div` filling the rest. A `ResizeObserver` plus a window `resize` listener send `layout(projectId, rect)` from its `getBoundingClientRect()`.
  - **Send `layout(projectId, null)`** on unmount, when `useOverlayOpen()` is true, before any address, and while `state.failed` is set.
  - **Text in the placeholder**: before an address, the hint copy. On `failed`, `Can't reach <failed.url>. Is the dev server running?` with `Retry` (→ `reload`).
  - **On overlay open**: request `capture` first, show it as an `<img>` in the placeholder, then hide the view, so nothing jumps.

- [ ] **Step 4: Overlay.**
  - `Menu` and `BranchMenu` call `useOverlay()` at the top. Both mount only while open.
  - Grep `src/renderer` for other `fixed`/`absolute z-*` popups that can overlap the main pane: `EmojiPicker` and the Composer's mention list sit in the thread view, never visible with the browser tab. Add `useOverlay()` to any other one found.

- [ ] **Step 5: Threads page.**
  - When `tabs.active === BROWSER_TAB`, render `<BrowserPane key={project.id} projectId={project.id} … />` in the main column (Task 6 adds the thread props).
  - Change the team panel's condition to `thread && tabs.active === null`.
  - Extend the existing capture-phase `keydown` handler: if `e.ctrlKey && e.shiftKey && e.code === 'KeyS'` and the browser tab is active, call `startSelect` (Task 6; leave a call site).
  - Subscribe to `onBrowserKey`: `'terminal'` → `toggleTerminal(projectId, root)`, `'select'` → `startSelect`.

- [ ] **Step 6: Run the checks**

  Run: `npm run typecheck`, then `npm run lint`, then `npm test`
  Expected: all green.

- [ ] **Step 7: Commit** `feat(browser): browser tab, address bar and overlay rule`.

---

### Task 6: Selection, comment box and send

**Files:**
- Create: `src/renderer/components/BrowserSelect.tsx`
- Modify: `src/renderer/browser/browser-store.ts`, `src/renderer/components/BrowserPane.tsx`, `src/renderer/pages/Threads.tsx`

**Interfaces:**
- Consumes:
  - `capture` and `pick` (Task 4);
  - `browserMessage`, `areaName`, `MIN_SELECTION`, `Picked`, `Rect` (Tasks 2 and 4);
  - `window.ark.threads.send(id, text, files)`.
- Produces, extending `browser-store.ts`:
  ```ts
  export type Selection = { frame: string; rect?: Rect; picked?: Picked; sending?: boolean; error?: string };
  export type BrowserView = { open: boolean; state: BrowserState; address: string; error?: string; draft: string; sel?: Selection; sent?: string };
  export function startSelect(projectId: string): Promise<void>;  // capture → sel = { frame }
  export function pickArea(projectId: string, rect: Rect): Promise<void>; // sel.rect = rect; sel.picked = await pick(...)
  export function cancelSelect(projectId: string): void;          // sel = undefined (draft kept)
  export function setDraft(projectId: string, text: string): void;
  export function sendArea(projectId: string, thread: { id: string; title: string }): Promise<void>;
  ```

- [ ] **Step 1: Store.**
  - `startSelect` captures, then sets `sel`. While `sel` is set, the pane sends `layout(null)`.
  - `sendArea` sets `sending`, then calls `threads.send(thread.id, browserMessage(draft, state.url, picked.element), [{ name: areaName(new Date()), bytes: picked.image }])`.
  - **On success:** clear `sel` and `draft`, and set `sent = 'Sent to # ' + title`. Clear `sent` after 4 s.
  - **On failure:** keep everything and set `sel.error = readable(e)`.

- [ ] **Step 2: `BrowserSelect`** is rendered in the placeholder's place while `sel` is set.
  - **Frame.** The `<img src={sel.frame}>` fills the placeholder at its CSS size, with a crosshair cursor and the thin bar copy at the top.
  - **Drag.** Pointer drag draws the rectangle: `border-2 border-dashed border-accent bg-accent/10`. A release smaller than `MIN_SELECTION` on either side is ignored. A new drag replaces the rectangle and the picked result. Release → `pickArea`.
  - **Comment box**, beside the rectangle:
    - placed on the right if it fits, else on the left, else below; clamped inside the placeholder;
    - holds a focused textarea bound to `draft` (Enter sends, Shift+Enter adds a new line), `Send to thread` (`CTA`) and a `×` (`ICON_BUTTON`);
    - **Send** is disabled while `!thread`, `!draft.trim()`, `!picked` or `sending`;
    - with no thread, the box shows `Open a thread to send this.`;
    - `sel.error` shows inside the box.
  - **Cancel.** Esc, `×`, or a pointer-down outside the rectangle and box calls `cancelSelect`.

- [ ] **Step 3: Pane and page.**
  - Wire **Select** to `startSelect`, Accent while `sel` is set.
  - Show `sent` as a muted note in the address bar.
  - `Threads.tsx` passes `thread={thread ? { id: thread.id, title: thread.title } : undefined}` to `BrowserPane`. This is the thread the thread tab shows (`undefined` while drafting or with none open), so switching thread retargets Send.

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck`, then `npm run lint`, then `npm test`
  Expected: all green.

- [ ] **Step 5: Commit** `feat(browser): area selection and send to thread`.

---

### Task 7: CDP check in the built app, README

The controller runs this task, using the recipe in handoff `seq: 7`.

**Files:**
- Modify: `README.md`, with a new `## Browser` section after `## Git`.
- Scratchpad only: the driver and a tiny HTTP server (`node:http`). Nothing is committed.

- [ ] **Step 1: Build and start.**
  - Build with `npm run build`.
  - Start the built app with `--user-data-dir=<scratchpad>/ark-profile-p4` and `--remote-debugging-port`.
  - Add a scratch git repo as the project, and create one thread so a thread exists. Creating a thread spends tokens on the project manager's first answer, so ask the user first, or reuse a thread fixture by copying a `threads` folder into the test profile **[call: prefer the fixture]**.
- [ ] **Step 2: Start the scratch server on `127.0.0.1:<port>`**, serving:
  - `/` with a `.grid` of cards, one `#plan-pro`;
  - a link to `https://example.com`;
  - `/redirect`, which answers `302` to `https://example.com/`;
  - `/auto`, which runs `location = 'https://example.com'` on load;
  - `/popup`, which calls `window.open('https://example.com')` without a gesture;
  - `/sec`, which reports `typeof window.ark`, `typeof require` and `typeof process` in its title.
- [ ] **Step 3: Drive each scenario and record pass or fail.**
  - Navigate; back, forward and reload work.
  - `example.com` typed in the field shows the refusal copy.
  - Clicking the external link opens nothing inside Ark (stub `shell.openExternal` is not possible, so assert the view's URL is unchanged and the address field still shows the local page).
  - `/redirect` and `/auto` show the blocked bar, and the view stays local.
  - `/popup` opens no window: `BrowserWindow.getAllWindows().length` stays 1, through `Runtime.evaluate` on the main process if it is exposed; otherwise count CDP targets.
  - `/sec`: all three are `undefined`.
  - Select, drag over `#plan-pro`, type and Send. The thread transcript gets the comment, `From the browser: http://127.0.0.1:<port>/`, an `Element: div#plan-pro…` line and an `area-*.png` attachment.
  - With no thread open, Send is disabled and shows the copy.
  - Esc cancels the selection.
  - Ctrl+R with the page focused reloads the page, and an open terminal is still alive.
  - The FileTree context menu opened near the main pane is visible, because the overlay rule swaps in the frame.
  - **R1**: go to Usage, and the view is hidden. Use a screenshot of the window, or assert the view's `isVisible()` through the main process.
  - **R2**: resize the window and drag the terminal divider. The view's bounds equal the placeholder's.
  - **R3**: Ctrl+R in Ark, and no browser view remains (count CDP `page` targets with the dev-server URL: 0).
  - **R4**: stop the server, then Reload, and see `Can't reach …`. Restart the server, then Retry, and the page is back.
  - **R5**: open the comment box, type, then switch thread in the sidebar. The draft is still there, and Send lands in the second thread.
- [ ] **Step 4: Fix and recheck.** For any failure, fix it in the owning task's files, re-run the checks, and commit `fix(browser): …`.
- [ ] **Step 5: README.**
  - Write `## Browser`: how to open it (globe button), local addresses only, Select and Send to thread, what the message carries, external links, the blocked bar, Ctrl+Shift+S, and Ctrl+R in the page.
  - Then run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
- [ ] **Step 6: Commit** `docs: README browser section`.
