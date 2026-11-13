import { useEffect, useState } from 'react';
import { threadGitActions, threadGitLines, type ThreadGit as State, type ThreadGitAction } from '@shared/git';
import type { Thread } from '@shared/thread';
import { readable } from '../errors';
import { confirmAction } from './Confirm';
import { BUTTON_INSET, FIELD_INSET } from './ui';

/**
 * A finished thread's branch in its conversation: what is left to commit, merge and push, and one explicit button per
 * action, each naming its source and target. Nothing runs without the user's click and confirmation; main reads the
 * state again, compares it with the one shown here (`stamp`) and refuses when it moved.
 */
export function ThreadGit({ thread, onProblem, requested }: { thread: Thread; onProblem: (text: string | undefined) => void; requested?: ThreadGitAction['kind'] }) {
  const [state, setState] = useState<State | null>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(thread.title);
  const git = window.ark.git;

  const load = async () => {
    try {
      setState(await git.threadState(thread.id));
    } catch (e) {
      setState(null);
      onProblem(readable(e));
    }
  };
  useEffect(() => {
    let alive = true;
    git.threadState(thread.id).then(
      (s) => alive && setState(s),
      (e) => alive && (setState(null), onProblem(readable(e))),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads when the thread's turn or phase changes
  }, [thread.id, thread.status, thread.phase]);

  if (!state) return null;
  const run = async (a: ThreadGitAction) => {
    const ask = a.kind === 'commit' ? `${a.label} with the message "${message.trim()}"?`
      : a.kind === 'merge' ? `${a.label}? The merge commit goes on ${state.into} in the project folder.`
      : `${a.label}? Ark never force-pushes.`;
    if (!await confirmAction(ask)) return;
    setBusy(true);
    onProblem(undefined);
    try {
      if (a.kind === 'commit') setState(await git.commitThread(thread.id, state.stamp, message.trim()));
      else if (a.kind === 'push') setState(await git.pushThread(thread.id, state.stamp));
      else {
        const r = await git.mergeThread(thread.id, state.into!, state.stamp);
        if (!r.merged) onProblem(`Merging ${state.branch} into ${state.into} stopped on conflicts in the project. Resolve them in the project's Git view, or abort the merge there.`);
        await load();
      }
    } catch (e) {
      onProblem(readable(e));
      await load(); // show what is true now, after a refusal
    } finally {
      setBusy(false);
    }
  };
  return <ThreadGitPanel state={state} phase={thread.phase} busy={busy} message={message} onMessage={setMessage} onAction={(a) => void run(a)} requested={requested} />;
}

export function ThreadGitPanel({ state, phase, busy, message, onMessage, onAction, requested }: {
  state: State; phase: string; busy: boolean; message: string; onMessage: (v: string) => void; onAction: (a: ThreadGitAction) => void; requested?: ThreadGitAction['kind'];
}) {
  const actions = threadGitActions(state, phase).filter((a) => !requested || a.kind === requested);
  return (
    <section aria-label="Git actions for this thread" className="mx-2 mb-1 flex flex-col gap-[4px] rounded-md bg-raised p-1 text-meta text-muted lg:mx-3">
      <ul className="flex flex-col">
        {threadGitLines(state).map((l) => <li key={l}>{l}</li>)}
      </ul>
      {!actions.length && <p>{requested ? `No ${requested} action is available for the current Git state.` : 'Nothing to commit, merge or push.'}</p>}
      {actions.map((a) => (
        <div key={a.kind} className="flex flex-wrap items-center gap-1">
          {a.kind === 'commit' && (
            <input aria-label="Commit message" value={message} onChange={(e) => onMessage(e.target.value)} className={`${FIELD_INSET} min-w-[160px] flex-1`} />
          )}
          <button type="button" onClick={() => onAction(a)} className={`${BUTTON_INSET} max-w-full`} disabled={busy || !!a.blocked || (a.kind === 'commit' && !message.trim())}>{a.label}</button>
          {a.blocked && <span>{a.blocked}</span>}
        </div>
      ))}
    </section>
  );
}
