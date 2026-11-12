import { useState } from 'react';
import type { AgentDef } from '@shared/agent-file';
import { TASK_LABELS } from '@shared/tasks';
import type { TaskInput, TaskStatus, Thread, ThreadTask } from '@shared/thread';
import { readable } from '../errors';
import { EditIcon, TrashIcon } from './Icons';
import { Select } from './Select';
import { BUTTON, BUTTON_INSET, CTA, ICON_BUTTON, INPUT } from './ui';

/** The user's board: editing a card never starts or interrupts a turn. */
export function TaskBoard({ thread, agents }: { thread: Thread; agents: AgentDef[] }) {
  const [editing, setEditing] = useState<ThreadTask>();
  const [title, setTitle] = useState('');
  const [agent, setAgent] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const tasks = thread.tasks ?? [];
  const team = agents.filter((a) => thread.team.includes(a.id));
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const clear = () => {
    setEditing(undefined);
    setTitle('');
    setAgent('');
    setStatus('todo');
  };
  const run = async (call: () => Promise<void>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await call();
      return true;
    } catch (e) {
      setProblem(readable(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = (task: ThreadTask, next: TaskInput) => run(() => window.ark.threads.saveTask(thread.id, task.id, next));

  return (
    <section aria-label="Task board" className="min-h-0 flex-1 overflow-auto p-2 lg:p-3">
      <p className="mb-2 text-meta text-muted">Assignment helps the team plan its work. It does not start an agent.</p>
      <form
        aria-label={editing ? 'Edit task' : 'New task'}
        className="mb-3 flex flex-wrap items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => window.ark.threads.saveTask(thread.id, editing?.id ?? null, {
            title, status, ...(agent ? { agent } : {}),
          })).then((ok) => { if (ok) clear(); });
        }}
      >
        <label className="flex min-w-[160px] flex-1 flex-col gap-[4px] text-meta text-muted">
          Task title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required disabled={busy} className={INPUT} />
        </label>
        <label className="flex flex-col gap-[4px] text-meta text-muted">
          Assigned agent
          <Select label="Assigned agent" value={agent} onChange={setAgent} disabled={busy} className="w-full" options={[{ value: '', label: 'Unassigned' }, ...(agent && !team.some((a) => a.id === agent) ? [{ value: agent, label: `${name(agent)} (unavailable)`, disabled: true }] : []), ...team.map((a) => ({ value: a.id, label: a.name }))]} />
        </label>
        <label className="flex flex-col gap-[4px] text-meta text-muted">
          Task status
          <Select label="Task status" value={status} onChange={(v) => setStatus(v as TaskStatus)} disabled={busy} className="w-full" options={Object.entries(TASK_LABELS).map(([value, label]) => ({ value, label }))} />
        </label>
        <button type="submit" disabled={busy || !title.trim()} className={CTA}>{editing ? 'Save task' : 'Add task'}</button>
        {editing && <button type="button" onClick={clear} disabled={busy} className={BUTTON}>Cancel edit</button>}
      </form>
      {problem && <p role="alert" className="mb-2 text-muted">{problem}</p>}
      <div className="overflow-x-auto pb-1">
      <div className="grid min-w-[640px] grid-cols-3 gap-2">
        {(Object.keys(TASK_LABELS) as TaskStatus[]).map((column) => {
          const cards = tasks.filter((t) => t.status === column);
          return (
            <section key={column} aria-label={TASK_LABELS[column]} className="min-w-0 rounded-lg border border-divider bg-primary/40 p-1.5">
              <h2 className="mb-2 font-heading text-secondary">{TASK_LABELS[column]} <span className="text-meta text-muted">{cards.length}</span></h2>
              <ul className="flex flex-col gap-1">
                {cards.map((task) => (
                  <li key={task.id} className="surface-card rounded-md bg-sidebar p-1.5">
                    <p className="whitespace-pre-wrap break-words text-secondary">{task.title}</p>
                    <p className="my-1 text-meta text-muted">{task.agent ? name(task.agent) : 'Unassigned'}</p>
                    <Select label={`Status of ${task.title}`} value={task.status} disabled={busy || editing?.id === task.id} onChange={(v) => void save(task, { title: task.title, agent: task.agent, status: v as TaskStatus })} className="mb-1 w-full" options={Object.entries(TASK_LABELS).map(([value, label]) => ({ value, label }))} />
                    <div className="flex flex-wrap gap-1">
                      {removing === task.id ? (
                        <>
                          <span className="w-full text-meta text-muted">Delete this task?</span>
                          <button disabled={busy} className={BUTTON_INSET} onClick={() => {
                            void run(() => window.ark.threads.removeTask(thread.id, task.id)).then((ok) => {
                              if (!ok) return;
                              if (editing?.id === task.id) clear();
                              setRemoving(undefined);
                            });
                          }}>Delete task</button>
                          <button disabled={busy} className={BUTTON_INSET} onClick={() => setRemoving(undefined)}>Keep task</button>
                        </>
                      ) : (
                        <>
                          <button disabled={busy} className={ICON_BUTTON} title="Edit task" aria-label={`Edit ${task.title}`} onClick={() => {
                            setEditing(task); setTitle(task.title); setAgent(task.agent ?? ''); setStatus(task.status);
                          }}><EditIcon /></button>
                          <button disabled={busy} className={ICON_BUTTON} title="Delete task" aria-label={`Delete ${task.title}`} onClick={() => setRemoving(task.id)}><TrashIcon /></button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {!cards.length && <p className="text-meta text-muted">No tasks</p>}
            </section>
          );
        })}
      </div>
      </div>
    </section>
  );
}
