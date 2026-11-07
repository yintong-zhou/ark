import { useEffect, useRef, useState } from 'react';
import { rootKey, type RootRef } from '@shared/files';
import type { GitBranches, GitStatus } from '@shared/git';
import { act } from '../git/status-store';
import { FIELD_INSET } from './ui';

type Props = {
  root: RootRef;
  status: GitStatus;
  /** Another action is running (or the thread is): every item waits. */
  locked: boolean;
  /** Runs an action; a refusal shows in the pane's problem line. */
  attempt: (call: () => Promise<unknown>) => Promise<void>;
  at: { x: number; y: number };
  onClose: () => void;
};

const ITEM = 'flex h-3 w-full items-center gap-1 px-2 text-left text-neutral-light hover:bg-primary/40 focus:bg-primary/40 focus:outline-none disabled:opacity-60';
const WIDTH = 240;
const HEIGHT = 320;

/**
 * The branch popup: switch, create and delete. Like `Menu` (Raised, Escape or a click outside closes it) but it holds
 * a field and a second list, so it is its own component. Escape inside the field or the delete list goes back first.
 */
export function BranchMenu({ root, status, locked, attempt, at, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'delete'>('list');
  const [data, setData] = useState<GitBranches>();
  const [name, setName] = useState('');
  const git = window.ark.git;
  const current = status.branch;

  useEffect(() => {
    let alive = true;
    void attempt(async () => {
      try {
        const b = await git.branches(root);
        if (alive) setData(b);
      } catch (e) {
        onClose(); // nothing to show; the refusal lands on the problem line
        throw e;
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per open; the key names the root
  }, [rootKey(root)]);

  useEffect(() => {
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mode === 'list') onClose();
      else setMode('list');
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [mode, onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [mode]);

  /** Closes the menu and runs the write; a refusal lands on the pane's problem line. */
  const go = (call: () => Promise<GitStatus>) => {
    onClose();
    void attempt(() => act(root, call));
  };

  const remove = (branch: string) => {
    if (!confirm(`Delete branch ${branch}?`)) return;
    onClose();
    const result = { unmerged: false };
    const del = (force: boolean) =>
      act(root, async () => {
        const r = await git.deleteBranch(root, branch, force);
        result.unmerged = r.unmerged;
        return r.status;
      });
    void attempt(async () => {
      await del(false);
      if (result.unmerged && confirm('Not merged. Delete anyway?')) await del(true);
    });
  };

  const deletable = data?.local.filter((b) => b.name !== current) ?? [];
  const create = name.trim();

  return (
    <div
      ref={ref}
      role="menu"
      // keep it on screen near the right and bottom edges
      style={{ left: Math.min(at.x, window.innerWidth - WIDTH - 8), top: Math.max(8, Math.min(at.y, window.innerHeight - HEIGHT - 16)), width: WIDTH, maxHeight: HEIGHT }}
      className="fixed z-50 overflow-y-auto rounded-sm bg-raised py-[4px] shadow-lg"
    >
      {mode === 'create' && (
        <div className="px-1 py-[4px]">
          <input
            aria-label="Branch name"
            placeholder="Branch name"
            value={name}
            disabled={locked}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create !== '' && go(() => git.createBranch(root, create))}
            className={`${FIELD_INSET} w-full placeholder:text-muted`}
          />
        </div>
      )}
      {mode === 'delete' && (
        <>
          <p className="section flex h-3 items-center px-2">Delete branch…</p>
          {deletable.map((b) => (
            <button key={b.name} role="menuitem" title={b.name} disabled={locked} onClick={() => remove(b.name)} className={ITEM}>
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
            </button>
          ))}
        </>
      )}
      {mode === 'list' && (
        <>
          <button role="menuitem" disabled={locked} onClick={() => setMode('create')} className={ITEM}>Create branch…</button>
          {data ? (
            <>
              <div className="my-[4px] border-t border-divider" />
              {data.local.map((b) => (
                <button
                  key={b.name}
                  role="menuitem"
                  title={b.name}
                  aria-current={b.name === current || undefined}
                  disabled={locked}
                  onClick={() => (b.name === current ? onClose() : go(() => git.switchBranch(root, b.name, false)))}
                  className={ITEM}
                >
                  <span aria-hidden className="w-2 shrink-0 text-muted">{b.name === current ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.upstream && <span className="shrink-0 text-meta text-muted">↑{b.ahead} ↓{b.behind}</span>}
                </button>
              ))}
              {data.remote.length > 0 && <p className="section flex h-3 items-center px-2">Remote</p>}
              {data.remote.map((r) => (
                <button key={r} role="menuitem" title={r} disabled={locked} onClick={() => go(() => git.switchBranch(root, r, true))} className={ITEM}>
                  <span aria-hidden className="w-2 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{r}</span>
                </button>
              ))}
              <div className="my-[4px] border-t border-divider" />
              <button role="menuitem" disabled={locked || deletable.length === 0} onClick={() => setMode('delete')} className={ITEM}>Delete branch…</button>
            </>
          ) : (
            <p className="flex h-3 items-center px-2 text-muted">Loading…</p>
          )}
        </>
      )}
    </div>
  );
}
