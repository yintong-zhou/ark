import { useEffect, useRef, useState } from 'react';
import { rootKey, type RootRef } from '@shared/files';
import type { GitBranches, GitStatus, ThreadGit, WorktreeRow } from '@shared/git';
import type { Thread } from '@shared/thread';
import { useOverlay } from '../browser/overlay';
import { confirmAction } from './Confirm';
import { act } from '../git/status-store';
import { BUTTON_INSET, FIELD_INSET } from './ui';
import { GitDivergence } from './GitDivergence';

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
  useOverlay();
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

  const remove = async (branch: string) => {
    if (!await confirmAction(`Delete branch ${branch}?`)) return;
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
      if (result.unmerged && await confirmAction('Not merged. Delete anyway?')) await del(true);
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
            <button key={b.name} role="menuitem" title={b.worktree ? `In use at ${b.worktree}` : b.name} disabled={locked || !!b.worktree} onClick={() => remove(b.name)} className={ITEM}>
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {b.worktree && <span className="shrink-0 text-meta text-muted">In worktree</span>}
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
                  title={b.worktree && !b.current ? `In use at ${b.worktree}` : b.name}
                  aria-current={b.name === current || undefined}
                  disabled={locked || (!!b.worktree && !b.current)}
                  onClick={() => (b.name === current ? onClose() : go(() => git.switchBranch(root, b.name, false)))}
                  className={ITEM}
                >
                  <span aria-hidden className="w-2 shrink-0 text-muted">{b.name === current ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.worktree && !b.current && <span className="shrink-0 text-meta text-muted">In worktree</span>}
                  {b.upstream && <GitDivergence ahead={b.ahead} behind={b.behind} />}
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

/** A small text action inside a 24px row. */
const LINK = 'shrink-0 rounded-xs px-[4px] text-meta text-muted hover:text-secondary disabled:opacity-40';
const ROW = 'flex h-3 items-center gap-[4px] pl-[4px] pr-1';
const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;

/** Confirms removing a worktree (never the main one); the branch stays. */
const confirmRemove = (path: string, branch: string | undefined) =>
  confirmAction(`Remove worktree ${folderName(path)}? The branch ${branch ?? 'HEAD'} stays.`);

type SectionProps = {
  /** Runs an action; a refusal shows in the pane's problem line. */
  attempt: (call: () => Promise<unknown>) => Promise<void>;
};

/** The project's worktrees (main first), collapsed until opened. Each action returns the fresh list. */
export function WorktreesSection({ projectId, attempt, onShowThread }: SectionProps & { projectId: string; onShowThread: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<WorktreeRow[]>();
  const [busy, setBusy] = useState(false);
  const git = window.ark.git;

  const run = (call: () => Promise<WorktreeRow[]>) => {
    setBusy(true);
    void attempt(async () => {
      try {
        setRows(await call());
      } catch (e) {
        // a refusal can still have changed the list (a worktree removed but its folder held open): show it as it is
        await git.worktrees(projectId).then(setRows, () => {});
        throw e;
      }
    }).finally(() => setBusy(false));
  };
  const toggle = () => {
    setOpen(!open);
    if (!open) run(() => git.worktrees(projectId)); // loads each time it opens
  };

  return (
    <section>
      <div className={ROW}>
        <button aria-expanded={open} onClick={toggle} className="section flex flex-1 items-center gap-[4px] text-left">
          <span aria-hidden className="w-2 shrink-0">{open ? '▾' : '▸'}</span>Worktrees
        </button>
        <button disabled={busy} onClick={() => run(() => git.pruneWorktrees(projectId))} className={LINK}>Prune</button>
      </div>
      {open &&
        rows?.map((w, i) => (
          <div key={w.path} title={w.path} className={`${ROW} text-muted`}>
            <span className="min-w-0 truncate text-secondary">{w.branch ?? 'detached'}</span>
            <span className="min-w-0 truncate text-meta">{folderName(w.path)}</span>
            {w.thread && <span className="min-w-0 truncate text-meta">#{w.thread.title}</span>}
            <span className="ml-auto flex shrink-0">
              {w.thread && <button disabled={busy} onClick={() => onShowThread(w.thread!.id)} className={LINK}>Show</button>}
              {i > 0 && (
                <button
                  disabled={busy || (w.thread !== undefined && !w.thread.done)}
                  onClick={async () => { if (await confirmRemove(w.path, w.branch)) run(() => git.removeWorktree(projectId, w.path)); }}
                  className={LINK}
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        ))}
    </section>
  );
}

/** The open thread's branch: what it holds, merging it into the project's branch, and removing its worktree. */
export function ThreadBranchSection({ thread, attempt, onConflict }: SectionProps & { thread: Thread; onConflict: () => void }) {
  const [info, setInfo] = useState<ThreadGit | null>();
  const [merged, setMerged] = useState(false);
  const [busy, setBusy] = useState(false);
  const git = window.ark.git;
  const build = thread.build;
  const running = thread.status === 'running';

  useEffect(() => {
    let alive = true;
    void attempt(async () => {
      const b = await git.threadState(thread.id);
      if (alive) setInfo(b);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads when the thread's turn starts or ends
  }, [thread.id, thread.status]);

  if (!build || !info) return null;
  const { into } = info;

  const merge = async () => {
    if (!into || !await confirmAction(`Merge ${info.branch} into ${into}?`)) return;
    setBusy(true);
    const result = { merged: false };
    void attempt(async () => {
      // the merge lands in the project's folder: its view takes the returned status, conflicts included
      await act({ kind: 'project', id: thread.projectId }, async () => {
        const r = await git.mergeThread(thread.id, into, info.stamp); // refused if anything moved since this was read
        result.merged = r.merged;
        return r.status;
      });
      if (!result.merged) return onConflict();
      setMerged(true);
      setInfo(await git.threadState(thread.id));
    }).finally(() => setBusy(false));
  };
  const remove = async () => {
    if (!await confirmRemove(build.worktree, build.branch)) return;
    setBusy(true);
    void attempt(() => git.removeWorktree(thread.projectId, build.worktree)).finally(() => setBusy(false));
  };

  return (
    <section className="flex flex-col gap-[4px]">
      <h3 className="section px-[4px] pt-2">Thread branch</h3>
      <p className="truncate px-[4px] text-secondary" title={info.branch}>{into ? `${info.branch} → ${into}` : info.branch}</p>
      <p className="px-[4px] text-meta text-muted">
        {!into ? 'Check out a branch in the project first'
          : merged && info.ahead === 0 ? 'Merged'
          : info.ahead === 0 ? 'Nothing to merge'
          : `${info.ahead} ${info.ahead === 1 ? 'commit' : 'commits'} to merge`}
      </p>
      {/* the buttons wrap in a narrow sidebar; a long branch name truncates inside its button, whole in the title */}
      <div className="flex flex-wrap gap-1 px-[4px]">
        <button
          title={into ? `Merge into ${into}` : undefined}
          disabled={busy || running || thread.phase !== 'done' || !into || info.ahead === 0}
          onClick={merge}
          className={`${BUTTON_INSET} max-w-full`}
        >
          <span className="min-w-0 truncate">{into ? `Merge into ${into}` : 'Merge'}</span>
        </button>
        <button disabled={busy || running || thread.phase !== 'done'} onClick={remove} className={BUTTON_INSET}>Remove worktree</button>
      </div>
    </section>
  );
}
