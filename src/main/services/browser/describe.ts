import type { Rect } from '../../../shared/browser';

// The main tsconfig has no DOM lib; this is the page side of the contract, erased at build time.
type El = {
  tagName: string;
  id: string;
  classList: ArrayLike<string>;
  innerText?: string;
  parentElement: El | null;
  children: ArrayLike<El>;
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number };
};
declare const document: { body: El; elementFromPoint(x: number, y: number): El | null };

/**
 * Runs INSIDE the previewed page (main sends it as source text), so it must stay self-contained:
 * plain ES2020, no imports or module-level symbols used in the body. Finds the smallest element that
 * wholly contains the selection and describes it; main caps and cleans the result with `cleanElement`.
 */
export function pageDescribe(r: Rect): unknown {
  const doc = document;
  const body = doc.body;
  let el: El | null = doc.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  if (!el) return null;
  while (el && el !== body) {
    const b = el.getBoundingClientRect();
    if (b.left <= r.x && b.top <= r.y && b.right >= r.x + r.width && b.bottom >= r.y + r.height) break;
    el = el.parentElement;
  }
  if (!el) el = body;
  const target: El = el;

  const segment = (n: El): string => {
    const tag = n.tagName.toLowerCase();
    if (n.id) return `#${n.id}`;
    let s = tag;
    if (n.classList[0]) s += `.${n.classList[0]}`;
    const sibs = n.parentElement ? Array.from(n.parentElement.children).filter((c: El) => c.tagName === n.tagName) : [];
    if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(n) + 1})`;
    return s;
  };

  const segs: string[] = [];
  if (target === body) segs.push('body');
  else {
    // The element always gets its segment; an ancestor with an id ends the climb. Body is never included.
    for (let n: El | null = target; n && n !== body && segs.length < 5; n = n.parentElement) {
      segs.unshift(segment(n));
      if (n !== target && n.id) break;
    }
  }

  return {
    tag: target.tagName.toLowerCase(),
    id: target.id || undefined,
    classes: Array.from(target.classList).slice(0, 4),
    path: segs.join('>'),
    text: (target.innerText || '').slice(0, 500),
  };
}

/** Source text for `executeJavaScriptInIsolatedWorld`. */
export function describeScript(r: Rect): string {
  return `(${pageDescribe.toString()})(${JSON.stringify(r)})`;
}
