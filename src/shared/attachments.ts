// Files and images a user adds to a message: what is accepted, and how much.
// Kinds come from the file extension only; the renderer's own claim about a type is never trusted.
// ponytail: no content sniffing, so a renamed file passes as its new kind. Check magic bytes if that ever matters.

export const ATTACH_MAX_FILES = 5;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // the largest image the engines take
export const TEXT_MAX_BYTES = 200 * 1024; // text goes into the prompt as it is, so it stays small

export type AttachmentKind = 'image' | 'text';
/** An attachment as the transcript keeps it: `file` is the name inside the thread's files folder. */
export type Attachment = { name: string; file: string; kind: AttachmentKind; mime: string; size: number };
/** A file as the renderer sends it. */
export type Upload = { name: string; bytes: Uint8Array };
/** An image as an engine takes it: base64 data and its type. */
export type ImageInput = { mime: string; data: string };

const IMAGE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
// No `env`: those files hold secrets, and everything attached goes to a model.
const TEXT = new Set([
  'txt', 'md', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml', 'toml', 'ini', 'xml', 'html', 'css', 'scss',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'rb', 'php', 'sh', 'ps1', 'sql',
]);

/** What a file name says about its kind, or nothing when Ark does not take it. */
export function kindOf(name: string): { kind: AttachmentKind; mime: string } | undefined {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase();
  if (!ext) return undefined;
  if (IMAGE[ext]) return { kind: 'image', mime: IMAGE[ext] };
  return TEXT.has(ext) ? { kind: 'text', mime: 'text/plain' } : undefined;
}

export const formatSize = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** The first reason these files cannot be attached, written for the user; undefined when they can. */
export function checkUploads(files: { name: string; size: number }[]): string | undefined {
  if (files.length > ATTACH_MAX_FILES) return `Attach up to ${ATTACH_MAX_FILES} files at a time.`;
  for (const f of files) {
    const k = kindOf(f.name);
    if (!k) return `${f.name} isn't supported. Attach images (png, jpg, gif, webp) or text and code files.`;
    const max = k.kind === 'image' ? IMAGE_MAX_BYTES : TEXT_MAX_BYTES;
    if (f.size > max) return `${f.name} is too large: ${formatSize(f.size)}, the limit is ${formatSize(max)}.`;
  }
  return undefined;
}

/** The value of an <input type="file" accept>: every extension Ark takes. */
export const ACCEPT = [...Object.keys(IMAGE), ...TEXT].map((e) => '.' + e).join(',');
