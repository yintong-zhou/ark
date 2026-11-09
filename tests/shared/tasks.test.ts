import { expect, test } from 'vitest';
import { taskBoardText, taskInput } from '../../src/shared/tasks';

test('task input trims the title and copies only known fields', () => {
  expect(taskInput({ title: '  Fix layout  ', status: 'doing', agent: 'developer', extra: 'ignored' }))
    .toEqual({ title: 'Fix layout', status: 'doing', agent: 'developer' });
  expect(taskInput({ title: 'Unassigned', status: 'todo' })).toEqual({ title: 'Unassigned', status: 'todo' });
});

test.each([
  null, [], 'task', {},
  { title: ' ', status: 'todo' },
  { title: 'x'.repeat(201), status: 'todo' },
  { title: 'a\0b', status: 'todo' },
  { title: 'x', status: 'unknown' },
  { title: 'x', status: 'todo', agent: null },
  { title: 'x', status: 'todo', agent: '../developer' },
])('rejects invalid task payload %j', (value) => expect(() => taskInput(value)).toThrow());

test('agent board includes status and assignment, quotes titles and handles an empty board', () => {
  expect(taskBoardText([], {})).toContain('no tasks');
  const text = taskBoardText([
    { id: 'a', title: 'Fix\nlayout', status: 'doing', agent: 'developer' },
    { id: 'b', title: 'Check', status: 'done' },
  ], { developer: 'Developer' });
  expect(text).toContain('"Fix\\nlayout" | In progress | Developer (@developer)');
  expect(text).toContain('"Check" | Done | Unassigned');
});
