import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { UUID_RE, type RootRef } from '@shared/files';
import type { Project, Thread } from '@shared/thread';

/** Validates a rel path from the renderer: '/'-separated, no '..', no drive, not absolute. '' is the root. */
export function normRel(v: unknown): string {
  if (typeof v !== 'string' || v.length > 1024 || v.includes('\0')) throw new Error('Invalid path');
  const rel = v.replace(/\\/g, '/').replace(/\/+$/, '');
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..')) throw new Error('Invalid path');
  return rel;
}

/** A rel path that names an entry, never the root: what write, create, rename and delete take. */
export function normEntry(v: unknown): string {
  const rel = normRel(v);
  if (!rel) throw new Error('Invalid path');
  return rel;
}

/** A list of entries (at most 5000): what the Git actions take. An empty list is valid; Git reads it as "all". */
export function normRels(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 5000) throw new Error('Invalid path');
  return v.map(normEntry);
}

const same =(a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * The absolute path of `rel` under `root`, refused when its real location (symlinks and junctions followed) is
 * outside the root. A path that does not exist yet is judged by its nearest existing parent.
 */
export function resolveInside(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const base = realpathSync.native(root);
  let p = abs;
  while (!existsSync(p)) p = dirname(p);
  const real = realpathSync.native(p);
  const inside = same(real, base) || same(real.slice(0, base.length + 1), base.endsWith(sep) ? base : base + sep);
  if (!inside) throw new Error('Path is outside the folder');
  return abs;
}

export function rootRef(v: unknown): RootRef {
  const o = v as { kind?: unknown; id?: unknown } | null;
  if (!o || typeof o !== 'object' || (o.kind !== 'project' && o.kind !== 'thread') || typeof o.id !== 'string' || !UUID_RE.test(o.id)) {
    throw new Error('Invalid folder');
  }
  return { kind: o.kind, id: o.id };
}

export type RootStore = { projects(): Project[]; get(id: string): Thread | undefined };

/** The folder a root names: the project's dir, or the thread's worktree while it exists (and wasn't removed). */
export function rootDir(ref: RootRef, store: RootStore): string {
  if (ref.kind === 'project') {
    const p = store.projects().find((x) => x.id === ref.id);
    if (!p) throw new Error('Unknown project');
    return p.dir;
  }
  const t = store.get(ref.id);
  if (!t) throw new Error('Unknown thread');
  const wt = t.build?.removed ? undefined : t.build?.worktree; // a folder at that path now isn't the worktree any more
  let ok = false;
  try {
    ok = !!wt && statSync(wt).isDirectory();
  } catch {
    // gone: refused below
  }
  if (!ok) throw new Error('Worktree not found');
  return wt as string;
}
