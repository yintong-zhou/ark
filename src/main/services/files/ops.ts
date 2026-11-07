import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DirListing, FileEntry, ReadResult, WriteResult } from '@shared/files';
import { writeAtomic } from '../files';
import { resolveInside } from './guard';

/** File operations for the explorer and editor. `dir` is a root's folder; `rel` is already normalised (guard.normRel). */

const MAX_READ = 5 * 1024 * 1024;
const MAX_LIST = 5000;
const SNIFF = 8192;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function listDir(dir: string, rel: string): DirListing {
  const all: FileEntry[] = readdirSync(resolveInside(dir, rel), { withFileTypes: true })
    .filter((d) => d.name !== '.git')
    .map((d) => ({ name: d.name, kind: d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'link' : 'file' }));
  all.sort((a, b) =>
    (a.kind === 'dir') !== (b.kind === 'dir') ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return { entries: all.slice(0, MAX_LIST), truncated: all.length > MAX_LIST };
}

/** True when the first bytes hold a NUL: a binary file, not text. */
function looksBinary(abs: string): boolean {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(SNIFF);
    return buf.subarray(0, readSync(fd, buf, 0, SNIFF, 0)).includes(0);
  } finally {
    closeSync(fd);
  }
}

export function readText(dir: string, rel: string): ReadResult {
  const abs = resolveInside(dir, rel);
  const st = statSync(abs);
  if (st.size > MAX_READ) return { kind: 'large', size: st.size };
  if (looksBinary(abs)) return { kind: 'binary' };
  let bytes = readFileSync(abs);
  const bom = bytes.subarray(0, 3).equals(BOM);
  if (bom) bytes = bytes.subarray(3);
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), mtimeMs: st.mtimeMs, bom, readonly: false };
  } catch {
    // Not UTF-8: shown, but saving it back would replace the bytes it could not decode.
    return { kind: 'text', text: new TextDecoder('utf-8').decode(bytes), mtimeMs: st.mtimeMs, bom, readonly: true };
  }
}

export function statFile(dir: string, rel: string): { mtimeMs: number } | null {
  const abs = resolveInside(dir, rel);
  try {
    const st = statSync(abs);
    return st.isFile() ? { mtimeMs: st.mtimeMs } : null;
  } catch {
    return null;
  }
}

/**
 * Writes `text` unless the file changed since `base` (its mtime when the editor read it). A null base overwrites,
 * or recreates a deleted file. A file missing under a number base is a conflict too: someone removed it.
 */
export function writeText(dir: string, rel: string, text: string, base: number | null, bom: boolean): WriteResult {
  const abs = resolveInside(dir, rel);
  if (base !== null && statFile(dir, rel)?.mtimeMs !== base) return { conflict: true };
  mkdirSync(dirname(abs), { recursive: true });
  const body = Buffer.from(text, 'utf8');
  writeAtomic(abs, bom ? Buffer.concat([BOM, body]) : body);
  return { conflict: false, mtimeMs: statSync(abs).mtimeMs };
}

export function createEntry(dir: string, rel: string, kind: 'file' | 'dir'): void {
  const abs = resolveInside(dir, rel);
  if (existsSync(abs)) throw new Error('Already exists');
  if (kind === 'dir') mkdirSync(abs, { recursive: true });
  else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '', { flag: 'wx' });
  }
}

export function renameEntry(dir: string, from: string, to: string): void {
  const src = resolveInside(dir, from);
  const dst = resolveInside(dir, to);
  if (existsSync(dst)) throw new Error('Already exists');
  renameSync(src, dst);
}

export async function trashEntry(dir: string, rel: string, trash: (abs: string) => Promise<void>): Promise<void> {
  await trash(resolveInside(dir, rel));
}
