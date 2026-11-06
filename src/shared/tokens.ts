// The two tags a user types in a message: @ names an agent, # puts a label on the thread.
// `@` and `#` must start the text or follow whitespace, so e-mails and issue links are left alone.

export const MAX_TAGS = 12;

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; id: string; text: string }
  | { kind: 'tag'; tag: string; text: string };

// A mention is @ and an agent id; a tag is # and a word that starts with a letter ("#12" is not a tag).
const TOKEN = /(?<!\S)(?:@([\w-]+)|#(\p{L}[\p{L}\p{N}_-]{0,23}))/gu;

/** The text cut into plain runs, @mentions and #tags, in order. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    out.push(m[1] ? { kind: 'mention', id: m[1], text: m[0] } : { kind: 'tag', tag: m[2].toLowerCase(), text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/** The thread's tags after this message: the old ones, then the new ones, without repeats. */
export function mergeTags(have: string[] | undefined, text: string): string[] {
  const added = tokenize(text).flatMap((t) => (t.kind === 'tag' ? [t.tag] : []));
  return [...new Set([...(have ?? []), ...added])].slice(0, MAX_TAGS);
}

/** The @ or # the caret is in, with what has been typed after it; undefined when the caret is not in one. */
export function activeToken(text: string, caret: number): { trigger: '@' | '#'; query: string; start: number } | undefined {
  const m = /(?<!\S)(?:@([\w-]*)|#([\p{L}\p{N}_-]*))$/u.exec(text.slice(0, caret));
  return m ? { trigger: m[0][0] as '@' | '#', query: m[1] ?? m[2], start: m.index } : undefined;
}
