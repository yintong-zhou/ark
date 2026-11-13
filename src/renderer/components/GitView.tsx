import { useCallback, useState, type ReactNode } from 'react';
import { rootKey, type RootRef } from '@shared/files';
import type { Thread } from '@shared/thread';
import { commitState, GIT_BUSY, groups, letter, type GitEntry, type GitSide, type GitStatus } from '@shared/git';
import { act, refresh, useGit } from '../git/status-store';
import { BranchMenu, ThreadBranchSection, WorktreesSection } from './GitSections';
import { EntryIcon } from './EntryIcon';
import { confirmAction } from './Confirm';
import { ArrowIcon, DiscardIcon, FetchIcon, FileIcon, GitBranchIcon, MinusIcon, PlusIcon, PullIcon, PushIcon, RefreshIcon } from './Icons';
import { GitDivergence } from './GitDivergence';
import { Menu, type MenuItem } from './Menu';
import { BUTTON_INSET, FIELD } from './ui';

type Props = {
  root: RootRef;
  projectId: string;
  /** The thread whose worktree `root` is; unset on the project root. */
  thread?: Thread;
  /** The root is a thread worktree whose turn is running: every write action waits. */
  busyThread: boolean;
  onOpenFile: (rel: string) => void;
  /** A Staged or Changes row opens its diff; a conflict row opens the file. */
  onOpenDiff: (rel: string, side: GitSide) => void;
  /** Runs an action; a refusal shows in the pane's problem line. */
  attempt: (call: () => Promise<unknown>) => Promise<void>;
  /** A worktree row's Show: opens that thread. */
  onShowThread: (id: string) => void;
  /** A thread merge stopped on a conflict, which now sits in the project. */
  onConflict: () => void;
};

/** A 20px icon action inside a 24px row, its icon drawn at 16px. */
const ACTION = 'flex size-[20px] shrink-0 items-center justify-center rounded-xs text-muted hover:text-secondary disabled:opacity-40 [&_svg]:size-2';
/** Hover actions stay reachable from the keyboard. */
const REVEAL = 'flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100';

// An untracked nested repository comes as `dir/`: its name is the folder's, not an empty string.
const trimmed = (rel: string) => rel.replace(/\/$/, '');
const nameOf = (rel: string) => trimmed(rel).slice(trimmed(rel).lastIndexOf('/') + 1);
const folderOf = (rel: string) => trimmed(rel).slice(0, Math.max(0, trimmed(rel).lastIndexOf('/')));

type Act = (call: () => Promise<GitStatus>) => void;
type Sync = 'fetch' | 'pull' | 'push';

/** The commit message each root's box holds, kept across switching the view or the root. */
const drafts = new Map<string, string>();

/** The Git view: the branch, the commit box and the changed files of one root, grouped like VS Code. */
export function GitView({ root, projectId, thread, busyThread, onOpenFile, onOpenDiff, attempt, onShowThread, onConflict }: Props) {
  const { status, error, busy } = useGit(root, true);
  const key = rootKey(root);
  const [message, setMessage] = useState(() => drafts.get(key) ?? '');
  const [syncing, setSyncing] = useState<Sync>();
  const [menu, setMenu] = useState<{ kind: 'branches' | 'actions'; x: number; y: number }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const [collapsed, setCollapsed] = useState<Partial<Record<GitSide | 'conflict', boolean>>>({});
  if (!status) return <p className="px-[4px] text-meta text-muted">{error ?? 'Loading…'}</p>;

  const git = window.ark.git;
  const locked = busyThread || busy; // one action at a time
  const run: Act = (call) => void attempt(() => act(root, call));
  const discard = async (rels: string[], question: string) => {
    if (await confirmAction(question)) run(() => git.discard(root, rels));
  };
  const edit = (text: string) => {
    setMessage(text);
    if (text) drafts.set(key, text);
    else drafts.delete(key);
  };
  const sync = (kind: Sync) => {
    setSyncing(kind);
    void attempt(() => act(root, () => git[kind](root))).finally(() => setSyncing(undefined));
  };
  const { conflicts, staged, changes } = groups(status.entries);
  // Nothing commits while a conflict is open. A merge commits its index as is, even with no diff left and no message
  // (Git's own then); otherwise Commit takes the staged changes, or with none stages everything (Commit all).
  const { all, canCommit, stageFirst, canStage } = commitState(status, message, locked);
  const commit = () => {
    if (!canCommit) return;
    void attempt(async () => {
      await act(root, () => git.commit(root, message, all));
      edit('');
    });
  };

  const row = (e: GitEntry, side: GitSide | 'conflict') => {
    const l = letter(e, side === 'conflict' ? 'tree' : side);
    return (
      <div key={`${side}:${e.rel}`} className="group flex h-3 items-center gap-[4px] rounded-xs pr-1 text-muted hover:bg-raised/50 hover:text-secondary">
        <button title={e.rel} onClick={() => (side === 'conflict' ? onOpenFile(e.rel) : onOpenDiff(e.rel, side))} className="flex min-w-0 flex-1 items-center gap-[4px] pl-[4px] text-left">
          <EntryIcon name={nameOf(e.rel)} folder={e.rel.endsWith('/')} />
          <span className="truncate">{nameOf(e.rel)}</span>
          <span className="truncate text-meta text-muted">{folderOf(e.rel)}</span>
        </button>
        <span className={REVEAL}>
          {l !== 'D' && (
            <button title="Open file" aria-label={`Open ${e.rel}`} onClick={() => onOpenFile(e.rel)} className={ACTION}>
              <FileIcon />
            </button>
          )}
          {side === 'changes' && (
            <button title="Discard changes" aria-label={`Discard ${e.rel}`} disabled={locked} onClick={() => discard([e.rel], e.x === '?' ? `Move ${e.rel.endsWith('/') ? 'folder ' : ''}${nameOf(e.rel)} to the Recycle Bin?` : `Discard changes to ${nameOf(e.rel)}? This can't be undone.`)} className={ACTION}>
              <DiscardIcon />
            </button>
          )}
          {side === 'staged' ? (
            <button title="Unstage" aria-label={`Unstage ${e.rel}`} disabled={locked} onClick={() => run(() => git.unstage(root, [e.rel]))} className={ACTION}>
              <MinusIcon />
            </button>
          ) : (
            <button title="Stage" aria-label={`Stage ${e.rel}`} disabled={locked} onClick={() => run(() => git.stage(root, [e.rel]))} className={ACTION}>
              <PlusIcon />
            </button>
          )}
        </span>
        <span className={`w-1 shrink-0 text-center text-meta ${l === '!' ? 'text-secondary' : 'text-muted'}`}>{l}</span>
      </div>
    );
  };

  const group = (title: string, list: GitEntry[], side: GitSide | 'conflict', actions: ReactNode) =>
    list.length > 0 && (
      <section key={side}>
        <div className="group flex h-4 items-center gap-[4px] pl-[4px] pr-1">
          <h3 className="min-w-0 flex-1">
            <button
              aria-expanded={!collapsed[side]}
              aria-controls={`git-group-${side}`}
              onClick={() => setCollapsed((prev) => ({ ...prev, [side]: !prev[side] }))}
              className="section flex w-full items-center gap-[4px] rounded-xs text-left hover:text-secondary"
            >
              <span aria-hidden className="w-2 shrink-0 text-center">{collapsed[side] ? '▸' : '▾'}</span>
              <span className="truncate">{title}</span>
              <span className="ml-auto rounded-full bg-raised px-1 text-meta text-secondary">{list.length}</span>
            </button>
          </h3>
          <span className={REVEAL}>{actions}</span>
        </div>
        <div id={`git-group-${side}`} hidden={!!collapsed[side]}>{list.map((e) => row(e, side))}</div>
      </section>
    );

  const rels = (list: GitEntry[]) => list.map((e) => e.rel);
  const stageAll = (list: GitEntry[]) => (
    // `[]` would also stage open conflicts (markers and all), so while any exist only the group's files go
    <button title="Stage all" aria-label="Stage all" disabled={locked} onClick={() => run(() => git.stage(root, conflicts.length ? rels(list) : []))} className={ACTION}>
      <PlusIcon />
    </button>
  );
  const stageChanges = () => run(() => git.stage(root, conflicts.length ? rels(changes) : []));
  const actions: MenuItem[] = [
    { label: all ? 'Commit all' : 'Commit', shortcut: 'Ctrl+Enter', onClick: canCommit ? commit : undefined },
    { label: 'Stage all', icon: <PlusIcon />, separator: true, onClick: canStage ? stageChanges : undefined },
    { label: 'Unstage all', icon: <MinusIcon />, onClick: !locked && staged.length > 0 ? () => run(() => git.unstage(root, [])) : undefined },
    { label: status.upstream ? 'Push' : 'Publish branch', icon: <PushIcon />, separator: true, onClick: !locked && status.branch ? () => sync('push') : undefined },
    { label: 'Pull', icon: <PullIcon />, onClick: !locked && !!status.upstream && !status.merging ? () => sync('pull') : undefined },
    { label: 'Fetch', icon: <FetchIcon />, onClick: !locked ? () => sync('fetch') : undefined },
  ];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-3 items-center gap-1 px-[4px] text-secondary">
        <button
          aria-label="Branches"
          title={`Branches: ${status.branch ?? 'Detached HEAD'}`}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === 'branches'}
          // a press on the button must not also close the menu through its outside click, or the click would reopen it
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu(menu?.kind === 'branches' ? undefined : { kind: 'branches', x: r.left, y: r.bottom + 4 });
          }}
          className="flex min-w-0 flex-1 items-center gap-[4px] rounded-xs font-heading hover:text-neutral-light [&_svg]:size-2"
        >
          <span className="shrink-0"><GitBranchIcon /></span>
          <span className="truncate">{status.branch ?? `detached at ${status.oid?.slice(0, 7) ?? ''}`}</span>
          <span aria-hidden className="shrink-0 text-meta text-muted">▾</span>
        </button>
        <button title="Refresh Git" aria-label="Refresh Git" disabled={busy} onClick={() => void refresh(root)} className={ACTION}>
          <span className={`flex ${busy ? 'motion-safe:animate-spin' : ''}`}><RefreshIcon /></span>
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-1 border-b border-divider px-[4px] pb-1 text-meta text-muted">
        <span className="flex min-w-0 flex-1 items-center gap-[4px]" title={status.upstream ?? 'Push to publish this branch'}>
          {status.upstream && <span className="shrink-0 [&_svg]:size-[12px]"><ArrowIcon dir="forward" /></span>}
          <span className="truncate">{status.upstream ?? 'No upstream'}</span>
        </span>
        {status.upstream && <GitDivergence ahead={status.ahead} behind={status.behind} />}
      </div>
      {menu?.kind === 'branches' && <BranchMenu root={root} status={status} locked={locked} attempt={attempt} at={menu} onClose={closeMenu} />}
      {menu?.kind === 'actions' && <Menu items={actions} at={menu} onClose={closeMenu} width={240} label="Git actions" />}
      {error && <p role="alert" className="px-[4px] text-meta text-muted">{error}</p>}
      {busyThread && <p className="px-[4px] text-meta text-muted">{GIT_BUSY}</p>}
      <textarea
        aria-label="Commit message"
        placeholder="Message"
        title="Commit message (Ctrl+Enter to commit)"
        value={message}
        disabled={locked}
        rows={2}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={`${FIELD} max-h-[150px] min-h-[72px] w-full resize-none field-sizing-content px-1 disabled:opacity-60`}
      />
      <div className={`flex h-4 w-full shrink-0 overflow-hidden rounded-sm border border-raised ${!stageFirst && canCommit ? 'bg-accent text-primary' : 'bg-raised text-secondary'}`}>
        <button
          onClick={stageFirst ? stageChanges : commit}
          disabled={stageFirst ? !canStage : !canCommit}
          title={stageFirst ? 'Stage all changes' : 'Commit staged changes (Ctrl+Enter)'}
          className="flex min-w-0 flex-1 items-center justify-center gap-[4px] px-1 text-body enabled:hover:brightness-110 disabled:opacity-40 [&_svg]:size-2"
        >
          {stageFirst && <PlusIcon />}
          {stageFirst ? 'Stage all' : 'Commit'}
        </button>
        <button
          aria-label="Git actions"
          title="Git actions"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === 'actions'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu(menu?.kind === 'actions' ? undefined : { kind: 'actions', x: r.right - 240, y: r.bottom + 4 });
          }}
          className="flex w-4 shrink-0 items-center justify-center border-l border-primary/20 hover:bg-primary/10"
        >
          <span aria-hidden>▾</span>
        </button>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-1 px-[4px] text-meta text-muted">
        <span role="status">{syncing ? `${syncing === 'fetch' ? 'Fetching' : syncing === 'pull' ? 'Pulling' : 'Pushing'}...` : `${status.entries.length}${status.truncated ? '+' : ''} ${status.entries.length === 1 ? 'changed file' : 'changed files'}`}</span>
        <span title="Git hooks do not run here. Use the terminal to run them.">No hooks</span>
      </div>
      {status.merging && (
        <div className="flex flex-col gap-1 rounded-sm bg-raised p-1">
          <p className="text-meta text-secondary">{status.mergeHead ? `Merging ${status.mergeHead}.` : 'Merging.'} Fix the conflicts, stage them, then commit.</p>
          <button onClick={() => run(() => git.mergeAbort(root))} disabled={locked} className={`${BUTTON_INSET} self-start`}>Abort merge</button>
        </div>
      )}
      {status.entries.length === 0 && <p className="px-[4px] text-muted">No changes</p>}
      <div className="flex flex-col">
        {group('Merge conflicts', conflicts, 'conflict', stageAll(conflicts))}
        {group('Staged changes', staged, 'staged',
          <button title="Unstage all" aria-label="Unstage all" disabled={locked} onClick={() => run(() => git.unstage(root, []))} className={ACTION}>
            <MinusIcon />
          </button>,
        )}
        {group('Changes', changes, 'changes', <>
          <button title="Discard all" aria-label="Discard all" disabled={locked} onClick={() => discard([], `Discard changes to ${changes.length} files? New files go to the Recycle Bin; the rest can't be undone.`)} className={ACTION}>
            <DiscardIcon />
          </button>
          {stageAll(changes)}
        </>)}
        {status.truncated && <p className="h-3 px-[4px] text-meta text-muted">Showing first 5000 changes</p>}
      </div>
      {thread?.build && !thread.build.removed && <ThreadBranchSection thread={thread} attempt={attempt} onConflict={onConflict} />}
      {root.kind === 'project' && <WorktreesSection projectId={projectId} attempt={attempt} onShowThread={onShowThread} />}
    </div>
  );
}
