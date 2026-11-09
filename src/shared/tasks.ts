import { AGENT_ID_RE } from './agent-file';
import type { TaskInput, ThreadTask } from './thread';

export const TASK_LABELS = { todo: 'To do', doing: 'In progress', done: 'Done' } as const;

/** Validate the entire card at the IPC boundary; assignments are checked against the thread in main. */
export function taskInput(value: unknown): TaskInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid task');
  const { title, status, agent } = value as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || title.includes('\0')) {
    throw new Error('Task title must be 1 to 200 characters');
  }
  if (status !== 'todo' && status !== 'doing' && status !== 'done') throw new Error('Invalid task status');
  if (agent !== undefined && (typeof agent !== 'string' || !AGENT_ID_RE.test(agent))) {
    throw new Error('Invalid task agent');
  }
  return { title: title.trim(), status, ...(agent === undefined ? {} : { agent }) };
}

/** Included on every turn, including fresh build sessions and sessions resumed after a handoff. */
export function taskBoardText(tasks: ThreadTask[], names: Record<string, string>): string {
  if (!tasks.length) return '[Ark] Current task board: no tasks. This replaces any earlier board.';
  return '[Ark] Current task board (replaces earlier boards; managed by the user; assignment does not change turn order):\n' + tasks.map((t) =>
    `- ${JSON.stringify(t.title)} | ${TASK_LABELS[t.status]} | ${t.agent ? `${names[t.agent] ?? t.agent} (@${t.agent})` : 'Unassigned'}`,
  ).join('\n');
}
