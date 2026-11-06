import { useEffect, useState } from 'react';
import { formatSize, kindOf, type Attachment, type Upload } from '@shared/attachments';
import { CloseIcon } from './Icons';

/** The bytes of files the user picked, in the shape the IPC takes. */
export const toUploads = (files: File[]): Promise<Upload[]> =>
  Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));

/** A picture as a data URL, once it has loaded. */
function useDataUrl(load: () => Promise<string>, key: unknown): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    load().then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
    // `load` is a new function every render; `key` says when the picture really changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

const readAsUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** Files waiting in the composer: a thumbnail for a picture, a 📄 for the rest, and a way to take each back out. */
export function Staged({ files, onRemove }: { files: File[]; onRemove: (f: File) => void }) {
  return (
    <ul className="flex flex-wrap gap-1 px-1 pt-1">
      {files.map((f) => (
        <li key={`${f.name}:${f.size}:${f.lastModified}`} className="relative">
          {kindOf(f.name)?.kind === 'image' ? <Thumb file={f} /> : (
            <span className="flex h-4 items-center gap-1 rounded-sm bg-raised pl-1 pr-4 text-meta text-neutral-light">
              <span aria-hidden>📄</span>
              <span className="max-w-[160px] truncate">{f.name}</span>
              <span className="text-muted">{formatSize(f.size)}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(f)}
            aria-label={`Remove ${f.name}`}
            title="Remove"
            className="absolute -right-[4px] -top-[4px] flex size-[18px] items-center justify-center rounded-full bg-primary text-muted hover:text-secondary [&_svg]:size-[12px]"
          >
            <CloseIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thumb({ file }: { file: File }) {
  const url = useDataUrl(() => readAsUrl(file), file);
  return <span className="block size-5 overflow-hidden rounded-sm bg-raised">{url && <img src={url} alt={file.name} className="size-full object-cover" />}</span>;
}

/** The files of a sent message: pictures show as they are, the rest as a named 📄. */
export function Sent({ threadId, list }: { threadId: string; list: Attachment[] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {list.map((a) => (
        <li key={a.file}>
          {a.kind === 'image' ? <Picture threadId={threadId} a={a} /> : (
            <span className="inline-flex h-4 items-center gap-1 rounded-sm bg-raised px-1 text-meta text-neutral-light">
              <span aria-hidden>📄</span>
              <span className="max-w-[240px] truncate">{a.name}</span>
              <span className="text-muted">{formatSize(a.size)}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Picture({ threadId, a }: { threadId: string; a: Attachment }) {
  const url = useDataUrl(async () => {
    const i = await window.ark.threads.attachment(threadId, a.file);
    return `data:${i.mime};base64,${i.data}`;
  }, a.file);
  return (
    <span className="block h-[160px] min-w-5 overflow-hidden rounded-sm bg-raised">
      {url && <img src={url} alt={a.name} title={a.name} className="h-full w-auto max-w-[320px] object-cover" />}
    </span>
  );
}
