import { useState, type ReactNode } from 'react';
import { rootKey, type RootRef } from '@shared/files';
import { GIT_BUSY, groups, letter, type GitEntry, type GitSide, type GitStatus } from '@shared/git';
import { act, useGit } from '../git/status-store';
import { BranchMenu } from './GitSections';
import { DiscardIcon, FetchIcon, FileIcon, MinusIcon, PlusIcon, PullIcon, PushIcon } from './Icons';
import { BUTTON_INSET, CTA, FIELD } from './ui';

type Props = {
  root: RootRef;
  /** The root is a thread worktree whose turn is running: every write action waits. */
  busyThread: boolean;
  onOpenFile: (rel: string) => void;
  /** A Staged or Changes row opens its diff; a conflict row opens the file. */
  onOpenDiff: (rel: string, side: GitSide) => void;
  /** Runs an action; a refusal shows in the pane's problem line. */
  attempt: (call: () => Promise<unknown>) => Promise<void>;
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
export function GitView({ root, busyThread, onOpenFile, onOpenDiff, attempt }: Props) {
  const { status, error, busy } = useGit(root, true);
  const key = rootKey(root);
  const [message, setMessage] = useState(() => drafts.get(key) ?? '');
  const [syncing, setSyncing] = useState<Sync>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  if (!status) return <p className="px-[4px] text-meta text-muted">{error ?? 'Loading…'}</p>;

  const git = window.ark.git;
  const locked = busyThread || busy; // one action at a time
  const run: Act = (call) => void attempt(() => act(root, call));
  const discard = (rels: string[], question: string) => {
    if (confirm(question)) run(() => git.discard(root, rels));
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
  const syncButton = (kind: Sync, title: string, icon: ReactNode) => (
    <button title={title} aria-label={title} disabled={locked} onClick={() => sync(kind)} className={ACTION}>
      <span className={`flex ${syncing === kind ? 'motion-safe:animate-spin' : ''}`}>{icon}</span>
    </button>
  );

  const { conflicts, staged, changes } = groups(status.entries);
  // Nothing commits while a conflict is open. A merge commits its index as is, even with no diff left and no message
  // (Git's own then); otherwise Commit takes the staged changes, or with none stages everything (Commit all).
  const all = !status.merging && staged.length === 0 && conflicts.length === 0;
  const canCommit =
    !locked && conflicts.length === 0 && (status.merging || (staged.length + changes.length > 0 && message.trim() !== ''));
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
        <button title={e.rel} onClick={() => (side === 'conflict' ? onOpenFile(e.rel) : onOpenDiff(e.rel, side))} className="flex min-w-0 flex-1 items-baseline gap-[4px] pl-[4px] text-left">
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
        <div className="group flex items-center gap-[4px] pb-[4px] pl-[4px] pr-1 pt-2">
          <h3 className="section flex-1">
            {title} <span className="text-meta">{list.length}</span>
          </h3>
          <span className={REVEAL}>{actions}</span>
        </div>
        {list.map((e) => row(e, side))}
      </section>
    );

  const rels = (list: GitEntry[]) => list.map((e) => e.rel);
  const stageAll = (list: GitEntry[]) => (
    // `[]` would also stage open conflicts (markers and all), so while any exist only the group's files go
    <button title="Stage all" aria-label="Stage all" disabled={locked} onClick={() => run(() => git.stage(root, conflicts.length ? rels(list) : []))} className={ACTION}>
      <PlusIcon />
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-3 items-center gap-1 px-[4px] text-secondary">
        <button
          title="Branches"
          aria-haspopup="menu"
          aria-expanded={menu !== undefined}
          // a press on the button must not also close the menu through its outside click, or the click would reopen it
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu(menu ? undefined : { x: r.left, y: r.bottom + 4 });
          }}
          className="min-w-0 truncate rounded-xs font-heading hover:text-neutral-light"
        >
          {status.branch ?? `detached at ${status.oid?.slice(0, 7) ?? ''}`}
        </button>
        {status.upstream && <span className="shrink-0 text-meta text-muted">↑{status.ahead} ↓{status.behind}</span>}
        <span className="ml-auto flex shrink-0">
          {syncButton('fetch', 'Fetch', <FetchIcon />)}
          {syncButton('pull', 'Pull', <PullIcon />)}
          {syncButton('push', 'Push', <PushIcon />)}
        </span>
      </div>
      {menu && <BranchMenu root={root} status={status} locked={locked} attempt={attempt} at={menu} onClose={() => setMenu(undefined)} />}
      {error && <p className="px-[4px] text-meta text-muted">{error}</p>}
      {busyThread && <p className="px-[4px] text-meta text-muted">{GIT_BUSY}</p>}
      <textarea
        aria-label="Commit message"
        placeholder="Message (Ctrl+Enter to commit)"
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
        className={`${FIELD} max-h-[150px] min-h-[62px] w-full resize-none field-sizing-content disabled:opacity-60`}
      />
      <button onClick={commit} disabled={!canCommit} className={`${CTA} w-full justify-center`}>{all ? 'Commit all' : 'Commit'}</button>
      <p className="px-[4px] text-meta text-muted">Runs without Git hooks. Use the terminal to run them.</p>
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
    </div>
  );
}
