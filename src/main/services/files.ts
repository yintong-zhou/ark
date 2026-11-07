import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Writes `file` through a temp file and a rename, so a reader never sees half a file. The temp name is fresh and
 * opened exclusively ('wx'): an existing file or a planted symlink with that name is refused, never followed.
 */
export function writeAtomic(file: string, data: string | Uint8Array): void {
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, data, { flag: 'wx' });
  try {
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
