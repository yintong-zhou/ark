/** Files the explorer and editor work on. The renderer names a root and a rel path; main resolves both. */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A project folder, or a thread's build worktree. */
export type RootRef = { kind: 'project'; id: string } | { kind: 'thread'; id: string };

export const rootKey = (r: RootRef): string => `${r.kind}:${r.id}`;

export type FileEntry = { name: string; kind: 'dir' | 'file' | 'link' };
export type DirListing = { entries: FileEntry[]; truncated: boolean };
export type ReadResult =
  | { kind: 'text'; text: string; mtimeMs: number; bom: boolean; readonly: boolean }
  | { kind: 'binary' }
  | { kind: 'large'; size: number };
export type WriteResult = { conflict: true } | { conflict: false; mtimeMs: number };

/** 'a/b/c.ts' → 'a/b'; 'c.ts' → ''. */
export const parentOf = (rel: string): string => rel.slice(0, Math.max(0, rel.lastIndexOf('/')));

export const joinRel = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
