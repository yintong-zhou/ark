import { WebContentsView, type BrowserWindow, type NativeImage } from 'electron';
import { IMAGE_MAX_BYTES } from '../../../shared/attachments';
import {
  cleanElement,
  cleanRect,
  imageBox,
  isLocalUrl,
  keyAction,
  navVerdict,
  USER_GESTURE_MS,
  viewBounds,
  type BrowserCapture,
  type BrowserKey,
  type BrowserState,
  type NavVerdict,
  type Picked,
  type Rect,
} from '../../../shared/browser';
import { describeScript } from './describe';
import { lockDown, PARTITION } from './session';

type Deps = {
  win: BrowserWindow;
  send: (channel: 'browser:state' | 'browser:key', projectId: string, payload: unknown) => void;
  openExternal: (url: string) => void;
};

type Entry = {
  view: WebContentsView;
  /** Last layout, in the renderer's CSS px (what selections are measured in). */
  bounds?: Rect;
  /** The last capture, which a pick crops so the picture matches what the user saw. */
  shot?: { id: number; image: NativeImage; bounds: Rect; url: string; scale: number; navigation: number };
  captureId?: number;
  navigation: number;
  /** When the user last pressed a key or a mouse button in the page. */
  lastInput: number;
  failed?: BrowserState['failed'];
  blocked?: BrowserState['blocked'];
  blockedUrl?: string;
};

/**
 * One WebContentsView per project showing the user's local dev server. The page is untrusted: no preload, its own
 * locked-down session, and every navigation goes through `navVerdict`. Ark's IPC only answers Ark's own window.
 */
export class BrowserViews {
  private readonly views = new Map<string, Entry>();
  private captureId = 0;

  constructor(private readonly deps: Deps) {}

  open(id: string): BrowserState {
    let e = this.views.get(id);
    if (!e) {
      const view = new WebContentsView({
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: PARTITION },
      });
      lockDown(view.webContents.session);
      e = { view, lastInput: 0, navigation: 0 };
      this.views.set(id, e);
      this.wire(id, e);
      view.setVisible(false);
      this.deps.win.contentView.addChildView(view);
    }
    return this.state(e);
  }

  close(id: string): void {
    const e = this.views.get(id);
    if (!e) return;
    this.views.delete(id);
    if (!this.deps.win.isDestroyed()) this.deps.win.contentView.removeChildView(e.view);
    if (!e.view.webContents.isDestroyed()) e.view.webContents.close();
  }

  destroyAll(): void {
    for (const id of [...this.views.keys()]) this.close(id);
  }

  navigate(id: string, url: string): void {
    if (!isLocalUrl(url)) throw new Error('Only local addresses (localhost, 127.0.0.1) open here.');
    const e = this.get(id);
    e.failed = e.blocked = e.blockedUrl = undefined;
    this.push(id, e);
    this.load(e, url);
  }

  back(id: string): void {
    const h = this.get(id).view.webContents.navigationHistory;
    if (h.canGoBack()) h.goBack();
  }

  forward(id: string): void {
    const h = this.get(id).view.webContents.navigationHistory;
    if (h.canGoForward()) h.goForward();
  }

  reload(id: string): void {
    this.get(id).view.webContents.reload();
  }

  /** null hides the view; bounds are the placeholder's CSS px in Ark's page, so they scale by Ark's zoom. */
  layout(id: string, bounds: Rect | null): void {
    const e = this.get(id);
    if (!bounds) {
      e.view.setVisible(false); // the last bounds stay: a pick runs while the freeze frame hides the view
      return;
    }
    const { css, dip } = viewBounds(bounds, this.deps.win.getContentBounds(), this.deps.win.webContents.getZoomFactor());
    e.view.setBounds(dip);
    e.bounds = css;
    e.view.setVisible(true);
  }

  async capture(id: string): Promise<BrowserCapture> {
    const e = this.get(id);
    const wc = e.view.webContents;
    if (!e.bounds || e.bounds.width <= 0 || e.bounds.height <= 0 || e.failed) throw new Error('The page is not ready to capture.');
    const bounds = { ...e.bounds };
    const url = wc.getURL();
    const navigation = e.navigation;
    const scale = this.deps.win.webContents.getZoomFactor() / wc.getZoomFactor();
    const captureId = (e.captureId = ++this.captureId);
    e.shot = undefined;
    const image = await wc.capturePage();
    if (this.views.get(id) !== e || e.captureId !== captureId || e.navigation !== navigation || e.failed || wc.getURL() !== url ||
        e.bounds.width !== bounds.width || e.bounds.height !== bounds.height ||
        this.deps.win.webContents.getZoomFactor() / wc.getZoomFactor() !== scale) {
      throw new Error('The page changed while capturing. Select the area again.');
    }
    if (image.isEmpty()) throw new Error('The page capture is empty. Select the area again.');
    e.shot = { id: captureId, image, bounds, url, scale, navigation };
    return { id: captureId, frame: image.toDataURL(), url, width: bounds.width, height: bounds.height };
  }

  /** Crops the last capture at a selection (renderer CSS px over the view) and describes the element under it. */
  async pick(id: string, captureId: unknown, raw: unknown): Promise<Picked> {
    const e = this.get(id);
    const shot = e.shot;
    if (!shot || shot.id !== captureId) throw new Error('Select again: the page capture is gone.');
    const rect = cleanRect(raw, shot.bounds);
    if (!rect) throw new Error('Invalid selection');
    let img = shot.image.crop(imageBox(rect, shot.bounds, shot.image.getSize()));
    let png = img.toPNG();
    if (!png.byteLength) throw new Error('The selected area is empty. Select the area again.');
    while (png.byteLength > IMAGE_MAX_BYTES) {
      img = img.resize({ width: Math.max(1, Math.round(img.getSize().width * 0.75)) });
      png = img.toPNG();
    }
    const wc = e.view.webContents;
    // Ark CSS px -> screen DIP (Ark's zoom) -> page CSS px (the page's zoom).
    const k = shot.scale;
    const pageRect = { x: rect.x * k, y: rect.y * k, width: rect.width * k, height: rect.height * k };
    let element: Picked['element'];
    try {
      // A page stuck in a loop never answers; the picture still goes.
      if (e.navigation !== shot.navigation || wc.getURL() !== shot.url || e.bounds?.width !== shot.bounds.width || e.bounds?.height !== shot.bounds.height ||
          this.deps.win.webContents.getZoomFactor() / wc.getZoomFactor() !== k) return { image: png };
      const result = await Promise.race([
        wc.executeJavaScriptInIsolatedWorld(999, [{ code: describeScript(pageRect) }]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      if (e.navigation === shot.navigation && wc.getURL() === shot.url) element = cleanElement(result);
    } catch {
      element = undefined;
    }
    return { image: png, ...(element ? { element } : {}) };
  }

  openBlocked(id: string): void {
    const e = this.get(id);
    if (!e.blockedUrl) return;
    this.deps.openExternal(e.blockedUrl);
    e.blocked = e.blockedUrl = undefined;
    this.push(id, e);
  }

  private get(id: string): Entry {
    const e = this.views.get(id);
    if (!e) throw new Error('The browser is not open');
    return e;
  }

  private load(e: Entry, url: string): void {
    e.view.webContents.loadURL(url).catch(() => {}); // a failure arrives as did-fail-load
  }

  private state(e: Entry): BrowserState {
    const wc = e.view.webContents;
    return {
      url: wc.getURL(),
      title: wc.getTitle().slice(0, 200),
      loading: wc.isLoading(),
      canBack: wc.navigationHistory.canGoBack(),
      canForward: wc.navigationHistory.canGoForward(),
      ...(e.failed ? { failed: e.failed } : {}),
      ...(e.blocked ? { blocked: e.blocked } : {}),
    };
  }

  private push(id: string, e: Entry): void {
    if (this.views.get(id) !== e || e.view.webContents.isDestroyed()) return;
    this.deps.send('browser:state', id, this.state(e));
  }

  /** A navigation the policy refused: external goes to the user's browser, blocked waits for them on a bar. */
  private refuse(id: string, e: Entry, url: string, v: NavVerdict): void {
    if (v === 'external') {
      e.lastInput = 0; // one gesture, one tab in the user's browser
      this.deps.openExternal(url);
    } else if (v === 'blocked') {
      e.blockedUrl = url;
      e.blocked = { host: new URL(url).hostname };
      this.push(id, e);
    }
  }

  private wire(id: string, e: Entry): void {
    const wc = e.view.webContents;
    const push = () => this.push(id, e);
    const key = (k: BrowserKey) => this.deps.send('browser:key', id, k);

    // Electron 45 has no user-gesture flag on navigations: a click or key press just before counts as the user's.
    wc.on('input-event', (_ev, input) => {
      if (input.type === 'mouseDown' || input.type === 'rawKeyDown' || input.type === 'keyDown') e.lastInput = Date.now();
    });
    const userStarted = () => Date.now() - e.lastInput <= USER_GESTURE_MS;
    const check = (ev: { preventDefault(): void }, url: string, user: boolean) => {
      const v = navVerdict(url, user);
      if (v === 'allow') return;
      ev.preventDefault();
      this.refuse(id, e, url, v);
    };
    // Subframes are left to the session's request filter: blocked, never opened externally.
    wc.on('will-navigate', (ev) => ev.isMainFrame && check(ev, ev.url, userStarted()));
    wc.on('will-redirect', (ev) => ev.isMainFrame && check(ev, ev.url, false)); // nobody clicks a redirect
    wc.setWindowOpenHandler(({ url }) => {
      const v = navVerdict(url, userStarted());
      if (v === 'allow') this.load(e, url);
      else this.refuse(id, e, url, v);
      return { action: 'deny' };
    });

    wc.on('did-navigate', () => {
      e.navigation++;
      e.failed = undefined;
      e.blocked = e.blockedUrl = undefined;
      push();
    });
    wc.on('did-navigate-in-page', (_ev, _url, isMainFrame) => {
      if (isMainFrame) e.navigation++;
      push();
    });
    wc.on('page-title-updated', push);
    wc.on('did-start-loading', push);
    wc.on('did-stop-loading', push);
    wc.on('did-fail-load', (_ev, code, reason, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3: aborted, e.g. by a newer navigation
      e.failed = { url, reason };
      push();
    });

    // A focused view takes the keyboard; without these, the default menu would reload or close Ark itself.
    wc.on('before-input-event', (ev, input) => {
      if (input.type !== 'keyDown') return;
      const a = keyAction(input);
      if (!a) return;
      ev.preventDefault();
      if (a === 'reload') wc.reload();
      else if (a !== 'swallow') {
        this.deps.win.webContents.focus(); // DOM focus alone leaves the keyboard with the page
        key(a);
      }
    });
  }
}
