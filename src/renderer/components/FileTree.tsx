import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { joinRel, parentOf, type FileEntry, type RootRef } from '@shared/files';
import { expand, toggle, useTree } from '../files/tree-store';
import { Menu, type MenuItem } from './Menu';

type Props = {
  root: RootRef;
  /** The root folder's display name (the first row). */
  name: string;
  onOpen: (rel: string) => void;
  /** Runs a file action; a refusal shows in the pane's problem line. */
  attempt: (call: () => Promise<unknown>) => Promise<void>;
};

/** An inline name field: where a new entry goes, or which entry is being renamed. */
type Edit = { kind: 'file' | 'dir'; dir: string } | { kind: 'rename'; rel: string; name: string };

const INDENT = 12;
const ROW = 'group flex h-3 w-full items-center gap-[4px] rounded-xs pr-1 text-left';

/** The Files view: a lazy tree of a project folder or a thread worktree. */
export function FileTree({ root, name, onOpen, attempt }: Props) {
  const tree = useTree(root);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] }>();
  const [edit, setEdit] = useState<Edit>();
  const [selected, setSelected] = useState<string>();

  const startNew = (kind: 'file' | 'dir', dir: string) => {
    if (dir) expand(root, dir);
    setEdit({ kind, dir });
  };
  const commit = (value: string) => {
    const e = edit;
    setEdit(undefined);
    const v = value.trim();
    if (!e || !v) return;
    if (e.kind === 'rename') {
      if (v !== e.name) void attempt(() => window.ark.files.rename(root, e.rel, joinRel(parentOf(e.rel), v)));
    } else void attempt(async () => {
      const rel = joinRel(e.dir, v);
      await window.ark.files.create(root, rel, e.kind);
      if (e.kind === 'file') onOpen(rel);
    });
  };
  const open = (ev: MouseEvent, rel: string, entry?: FileEntry) => {
    ev.preventDefault();
    setSelected(rel);
    const isDir = !entry || entry.kind === 'dir';
    const items: MenuItem[] = [];
    if (isDir) items.push({ label: 'New file', onClick: () => startNew('file', rel) }, { label: 'New folder', onClick: () => startNew('dir', rel) });
    if (entry) {
      items.push({ label: 'Rename', onClick: () => setEdit({ kind: 'rename', rel, name: entry.name }) });
      items.push({
        label: 'Delete',
        danger: true,
        onClick: () => {
          if (confirm(`Move "${entry.name}" to the Recycle Bin?`)) void attempt(() => window.ark.files.remove(root, rel));
        },
      });
    }
    items.push({ label: 'Reveal in Explorer', onClick: () => void attempt(() => window.ark.files.reveal(root, rel)) });
    if (entry) items.push({ label: 'Copy relative path', onClick: () => void navigator.clipboard.writeText(rel) });
    setMenu({ at: { x: ev.clientX, y: ev.clientY }, items });
  };

  const field = (depth: number, initial: string) => (
    <NameField key="edit" depth={depth} initial={initial} onDone={commit} onCancel={() => setEdit(undefined)} />
  );

  const rows = (dir: string, depth: number): ReactNode[] => {
    const l = tree.listings.get(dir);
    if (!l) return tree.expanded.has(dir) ? [<p key={`${dir}…`} style={{ paddingLeft: depth * INDENT + 24 }} className="h-3 text-meta text-muted">Loading…</p>] : [];
    const out: ReactNode[] = [];
    if (edit && edit.kind !== 'rename' && edit.dir === dir) out.push(field(depth, ''));
    for (const e of l.entries) {
      const rel = joinRel(dir, e.name);
      if (edit?.kind === 'rename' && edit.rel === rel) {
        out.push(field(depth, e.name));
        continue;
      }
      const isDir = e.kind === 'dir';
      const isOpen = isDir && tree.expanded.has(rel);
      out.push(
        <button
          key={rel}
          title={rel}
          onClick={() => {
            setSelected(rel);
            if (isDir) toggle(root, rel);
            else onOpen(rel);
          }}
          onContextMenu={(ev) => open(ev, rel, e)}
          style={{ paddingLeft: depth * INDENT + 4 }}
          className={`${ROW} ${selected === rel ? 'bg-raised text-secondary' : 'text-muted hover:bg-raised/50 hover:text-secondary'}`}
        >
          <span aria-hidden className="flex w-2 shrink-0 justify-center text-meta">{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
          <span className={`min-w-0 flex-1 truncate ${e.kind === 'link' ? 'italic' : ''}`}>{e.name}</span>
        </button>,
      );
      if (isOpen) out.push(...rows(rel, depth + 1));
    }
    if (l.truncated) out.push(<p key={`${dir}+`} style={{ paddingLeft: depth * INDENT + 24 }} className="h-3 text-meta text-muted">Showing first 5000 entries</p>);
    return out;
  };

  return (
    <div className="flex flex-col">
      <div onContextMenu={(ev) => open(ev, '')} className={`${ROW} pl-[4px] text-secondary`}>
        <span aria-hidden className="flex w-2 shrink-0 justify-center text-meta">▾</span>
        <span title={name} className="min-w-0 flex-1 truncate font-heading">{name}</span>
        <button title="New file" aria-label="New file" onClick={() => startNew('file', '')} className="px-[4px] text-muted hover:text-secondary">+</button>
        <button title="New folder" aria-label="New folder" onClick={() => startNew('dir', '')} className="px-[4px] text-muted hover:text-secondary">⊞</button>
      </div>
      {tree.error ? <p className="px-1 py-1 text-meta text-muted">{tree.error}</p> : rows('', 1)}
      {menu && <Menu items={menu.items} at={menu.at} onClose={() => setMenu(undefined)} />}
    </div>
  );
}

function NameField({ depth, initial, onDone, onCancel }: { depth: number; initial: string; onDone: (v: string) => void; onCancel: () => void }) {
  const finished = useRef(false); // Enter or Escape, then the blur that follows: act once
  const once = (f: () => void) => {
    if (finished.current) return;
    finished.current = true;
    f();
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value;
    if (e.key === 'Enter') once(() => onDone(v));
    if (e.key === 'Escape') once(onCancel);
  };
  return (
    <input
      autoFocus
      defaultValue={initial}
      aria-label="Name"
      onKeyDown={key}
      onBlur={(e) => {
        const v = e.currentTarget.value;
        once(() => onDone(v));
      }}
      onFocus={(e) => e.currentTarget.setSelectionRange(0, initial.lastIndexOf('.') > 0 ? initial.lastIndexOf('.') : initial.length)}
      style={{ marginLeft: depth * INDENT + 20 }}
      className="h-3 rounded-xs border border-raised bg-content px-[4px] text-body text-neutral-light outline-none focus:border-neutral-light/40"
    />
  );
}
