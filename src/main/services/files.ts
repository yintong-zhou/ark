import { renameSync, writeFileSync } from 'node:fs';

/** Writes `file` through a temp file and a rename, so a reader never sees half a file. */
export function writeAtomic(file: string, data: string | Uint8Array): void {
  writeFileSync(file + '.tmp', data);
  renameSync(file + '.tmp', file);
}
