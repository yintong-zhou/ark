// Rules for the built-in browser. Pure, so main and renderer agree and tests need no Electron.

export type Rect = { x: number; y: number; width: number; height: number };
export type NavVerdict = 'allow' | 'external' | 'blocked' | 'ignore';

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
