// Rules for the built-in browser. Pure, so main and renderer agree and tests need no Electron.

export type Rect = { x: number; y: number; width: number; height: number };
export type NavVerdict = 'allow' | 'external' | 'blocked' | 'ignore';

/** What the browser tab shows about its view; `blocked` is a non-local page nobody asked for. */
export type BrowserState = {
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  failed?: { url: string; reason: string };
  blocked?: { host: string };
};
/** Shortcuts the focused page hands back to Ark. */
export type BrowserKey = 'terminal' | 'select';
/** A crop of the last capture (PNG) and what the page says is under it. */
export type Picked = { image: Uint8Array; element?: ElementInfo };

/** How long after a click or key press a navigation still counts as the user's. */
export const USER_GESTURE_MS = 1000;

/** `hostname` as URL produces it (127.1 is already 127.0.0.1, IPv6 keeps its brackets). */
export function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

const isWeb = (u: URL) => u.protocol === 'http:' || u.protocol === 'https:';

/** Only http(s) to this machine; a userinfo trick like localhost@evil.com has the real host evil.com. */
export function isLocalUrl(url: string): boolean {
  const u = parse(url);
  return !!u && isWeb(u) && isLocalHost(u.hostname);
}

/** What the user typed, as a local URL; undefined when it is empty or not local. */
export function toAddress(input: string): string | undefined {
  const t = input.trim();
  if (!t) return undefined;
  const u = parse(/^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `http://${t}`);
  return u && isLocalUrl(u.href) ? u.href : undefined;
}

/** allow: local. external: the user clicked a non-local link, so hand it to their browser. blocked: nobody asked. */
export function navVerdict(url: string, userStarted: boolean): NavVerdict {
  const u = parse(url);
  if (!u || !isWeb(u)) return 'ignore';
  if (isLocalHost(u.hostname)) return 'allow';
  return userStarted ? 'external' : 'blocked';
}

/** Electron certificate-error callback codes: 0 trusts, -3 lets Chromium decide. */
export function certVerdict(hostname: string): 0 | -3 {
  // Certificate hostnames carry no brackets.
  return isLocalHost(hostname === '::1' ? '[::1]' : hostname) ? 0 : -3;
}

export type ElementInfo = { tag: string; id?: string; classes: string[]; path: string; text: string };

/** Smallest selection side, in view pixels, worth sending. */
export const MIN_SELECTION = 8;

/** Page text must not turn into #tags or @mentions in a thread: a word joiner breaks the token, the text stays readable. */
export function neutralize(s: string): string {
  return s.replace(/(^|\s)([#@])/gu, '$1⁠$2');
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Shape check and caps for what the page script reports about the clicked element. */
export function cleanElement(v: unknown): ElementInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.tag !== 'string' || typeof o.path !== 'string' || typeof o.text !== 'string') return undefined;
  if (!Array.isArray(o.classes) || !o.classes.every((c) => typeof c === 'string')) return undefined;
  if (o.id !== undefined && typeof o.id !== 'string') return undefined;
  const id = str(o.id, 64);
  return {
    tag: o.tag.slice(0, 32),
    ...(id ? { id } : {}),
    classes: (o.classes as string[]).slice(0, 4).map((c) => c.slice(0, 64)),
    path: o.path.split('>').slice(-5).join('>').slice(0, 300),
    text: o.text.replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}

/** The text a thread gets: the user's comment as typed, then where it came from. */
export function browserMessage(comment: string, url: string, el?: ElementInfo): string {
  let out = `${comment.trim()}\n\n${neutralize(`From the browser: ${url}`)}`;
  if (el) {
    const sel = el.tag + (el.id ? `#${el.id}` : '') + el.classes.map((c) => `.${c}`).join('');
    out += `\n${neutralize(`Element: ${sel} · ${el.path}${el.text ? ` · "${el.text}"` : ''}`)}`;
  }
  return out;
}

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const asRect = (v: unknown): Rect | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const { x, y, width, height } = v as Record<string, unknown>;
  return num(x) && num(y) && num(width) && num(height) ? { x, y, width, height } : undefined;
};

/** A selection from the page overlay: big enough and wholly inside the view. */
export function cleanRect(v: unknown, view: { width: number; height: number }): Rect | undefined {
  const r = asRect(v);
  if (!r || r.x < 0 || r.y < 0 || r.width < MIN_SELECTION || r.height < MIN_SELECTION) return undefined;
  return r.x + r.width <= view.width && r.y + r.height <= view.height ? r : undefined;
}

/** Where the renderer wants the view: null hides it, undefined is not a valid request. */
export function cleanBounds(v: unknown): Rect | null | undefined {
  if (v === null) return null;
  const r = asRect(v);
  if (!r) return undefined;
  return Object.values(r).every((n) => n >= 0 && n <= 10000) ? r : undefined;
}

/**
 * The view's place for a layout request. `css` stays in the renderer's CSS px, unrounded, so a selection the renderer
 * clamps to its placeholder still passes `cleanRect`; `dip` is what `setBounds` gets. Both stay inside the window.
 */
export function viewBounds(b: Rect, content: { width: number; height: number }, zoom: number): { css: Rect; dip: Rect } {
  const [cw, ch] = [content.width / zoom, content.height / zoom];
  const x = Math.min(b.x, cw);
  const y = Math.min(b.y, ch);
  const css = { x, y, width: Math.min(b.width, cw - x), height: Math.min(b.height, ch - y) };
  const dx = Math.min(Math.round(x * zoom), content.width);
  const dy = Math.min(Math.round(y * zoom), content.height);
  const dip = {
    x: dx,
    y: dy,
    width: Math.min(Math.round(css.width * zoom), content.width - dx),
    height: Math.min(Math.round(css.height * zoom), content.height - dy),
  };
  return { css, dip };
}

/** A view-space selection in the pixels of a capture (scaled by display zoom), kept inside the image. */
export function imageBox(
  sel: Rect,
  view: { width: number; height: number },
  image: { width: number; height: number },
): Rect {
  const sx = image.width / view.width;
  const sy = image.height / view.height;
  const x = Math.min(Math.max(Math.round(sel.x * sx), 0), image.width - 1);
  const y = Math.min(Math.max(Math.round(sel.y * sy), 0), image.height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(sel.width * sx), image.width - x)),
    height: Math.max(1, Math.min(Math.round(sel.height * sy), image.height - y)),
  };
}

/** File name for a cropped area, local time. */
export function areaName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `area-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}
