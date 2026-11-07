/** Git view model and the parser for `git status --porcelain=v2 -z`. Pure: main parses, the renderer groups and labels. */

/** One changed path. `x` is the index char, `y` the worktree char; untracked is `?`/`?`. */
export type GitEntry = { rel: string; x: string; y: string; orig?: string; conflict: boolean };

/** `branch` is null when detached, `oid` before the first commit. */
export type GitStatus = {
  branch: string | null;
  oid: string | null;
  upstream?: string;
  ahead: number;
  behind: number;
  merging: boolean;
  entries: GitEntry[];
  truncated: boolean;
};

export type GitSide = 'staged' | 'changes';

export type ShowResult = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'large'; size: number } | { kind: 'missing' };

/** The text after the first `n` spaces: keeps spaces inside the path (split with a limit would drop it). */
const after = (s: string, n: number): string => {
  let i = -1;
  for (let k = 0; k < n; k++) i = s.indexOf(' ', i + 1);
  return s.slice(i + 1);
};

/** Space-separated fields before the path: `1` has 8, `2` has 9, `u` has 10, `?` has 1. */
const FIELDS: Record<string, number> = { '1': 8, '2': 9, u: 10, '?': 1 };

export function parseStatus(out: string, max = 5000): Omit<GitStatus, 'merging'> {
  const s: Omit<GitStatus, 'merging'> = { branch: null, oid: null, ahead: 0, behind: 0, entries: [], truncated: false };
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('# ')) {
      const [key, ...v] = t.slice(2).split(' ');
      if (key === 'branch.oid') s.oid = v[0] === '(initial)' ? null : v[0];
      else if (key === 'branch.head') s.branch = v[0] === '(detached)' ? null : v.join(' ');
      else if (key === 'branch.upstream') s.upstream = v.join(' ');
      else if (key === 'branch.ab') {
        s.ahead = Number(v[0].slice(1));
        s.behind = Number(v[1].slice(1));
      }
      continue;
    }
    const n = FIELDS[t[0]];
    if (!n || t[1] !== ' ') continue; // `!` ignored lines and unknown headers
    if (s.entries.length >= max) {
      s.truncated = true;
      break;
    }
    const rel = after(t, n);
    if (t[0] === '?') s.entries.push({ rel, x: '?', y: '?', conflict: false });
    else {
      const e: GitEntry = { rel, x: t[2], y: t[3], conflict: t[0] === 'u' };
      if (t[0] === '2') e.orig = tokens[++i]; // a rename/copy is followed by its original path
      s.entries.push(e);
    }
  }
  return s;
}

/** A file shows under Staged and Changes at once when both sides changed; conflicts stand alone. */
export function groups(entries: GitEntry[]): { conflicts: GitEntry[]; staged: GitEntry[]; changes: GitEntry[] } {
  const rest = entries.filter((e) => !e.conflict);
  return {
    conflicts: entries.filter((e) => e.conflict),
    staged: rest.filter((e) => e.x !== '.' && e.x !== '?'),
    changes: rest.filter((e) => e.y !== '.'),
  };
}

/** One letter per row: M modified (T too), A added (C too), D, R, U untracked, ! conflict. */
export function letter(e: GitEntry, side: GitSide | 'tree'): string {
  const ch = (c: string): string => (c === '?' ? 'U' : c === 'T' ? 'M' : c === 'C' ? 'A' : c);
  if (side === 'staged') return ch(e.x);
  if (side === 'changes') return ch(e.y);
  if (e.conflict) return '!';
  return ch(e.y !== '.' ? e.y : e.x);
}

/** Every ancestor folder of every entry, so the tree can mark folders that hold changes. */
export function changedDirs(entries: GitEntry[]): Set<string> {
  const dirs = new Set<string>();
  for (const { rel } of entries) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return dirs;
}
