import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ID_RE } from '@shared/agent-file';
import type { ImageInput } from '@shared/attachments';
import { writeAtomic } from './files';

export const IMAGE_MAX = 512 * 1024;
const invalid = 'Use a PNG, JPEG or WebP image';
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
type Mime = keyof typeof extensions;

function mimeOf(bytes: Buffer): Mime | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

export function imageOf(bytes: Buffer): ImageInput {
  if (bytes.length > IMAGE_MAX) throw new Error('The image is larger than 512 KB');
  const mime = mimeOf(bytes);
  if (!mime) throw new Error(invalid);
  return { mime, data: bytes.toString('base64') };
}

export function checkImage(v: unknown): { mime: Mime; bytes: Buffer } {
  if (!v || typeof v !== 'object') throw new Error(invalid);
  const { mime, data } = v as Record<string, unknown>;
  if (typeof data !== 'string' || typeof mime !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error(invalid);
  if (data.length > Math.ceil(IMAGE_MAX / 3) * 4) throw new Error('The image is larger than 512 KB');
  const bytes = Buffer.from(data, 'base64');
  const found = imageOf(bytes).mime;
  if (found !== mime) throw new Error(invalid);
  return { mime: found as Mime, bytes };
}

export class Avatars {
  constructor(private readonly dir: string) {}

  private paths(id: string): string[] {
    if (!AGENT_ID_RE.test(id)) throw new Error('Unsafe agent id');
    return Object.values(extensions).map((ext) => join(this.dir, `${id}.${ext}`));
  }

  read(id: string): ImageInput | null {
    for (const path of this.paths(id)) {
      try { return imageOf(readFileSync(path)); } catch { /* missing or invalid image */ }
    }
    return null;
  }

  write(id: string, image: unknown): void {
    const paths = this.paths(id);
    const { mime, bytes } = checkImage(image);
    mkdirSync(this.dir, { recursive: true });
    const target = join(this.dir, `${id}.${extensions[mime]}`);
    writeAtomic(target, bytes);
    for (const path of paths) if (path !== target) rmSync(path, { force: true });
  }

  remove(id: string): void {
    for (const path of this.paths(id)) rmSync(path, { force: true });
  }
}
