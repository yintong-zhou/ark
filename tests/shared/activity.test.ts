import { expect, test } from 'vitest';
import { activityLabel, claudeAction, codexAction, elapsed } from '@shared/activity';

test('claudeAction maps the tools Ark allows to a category', () => {
  expect(claudeAction('Read')).toBe('reading');
  expect(claudeAction('Glob')).toBe('searching');
  expect(claudeAction('Grep')).toBe('searching');
  for (const t of ['Edit', 'Write', 'NotebookEdit']) expect(claudeAction(t)).toBe('editing');
  for (const t of ['Bash', 'PowerShell']) expect(claudeAction(t)).toBe('running');
  expect(claudeAction('Skill')).toBe('other');
  expect(claudeAction('SomethingNew')).toBe('other');
});

test('codexAction maps item types, and says nothing for messages', () => {
  expect(codexAction('reasoning')).toBe('thinking');
  expect(codexAction('commandExecution')).toBe('running');
  expect(codexAction('fileChange')).toBe('editing');
  expect(codexAction('webSearch')).toBe('searching');
  expect(codexAction('mcpToolCall')).toBe('other');
  expect(codexAction('agentMessage')).toBeUndefined();
  expect(codexAction('userMessage')).toBeUndefined();
});

test('activityLabel reads in plain English and an open approval wins', () => {
  expect(activityLabel('thinking', false)).toBe('Thinking');
  expect(activityLabel('reading', false)).toBe('Reading files');
  expect(activityLabel('searching', false)).toBe('Searching');
  expect(activityLabel('editing', false)).toBe('Editing code');
  expect(activityLabel('running', false)).toBe('Running a command');
  expect(activityLabel('other', false)).toBe('Working');
  expect(activityLabel(undefined, false)).toBe('Working');
  expect(activityLabel('editing', true)).toBe('Waiting for approval');
  expect(activityLabel(undefined, true)).toBe('Waiting for approval');
});

test('elapsed is m:ss, with hours from one hour, and never negative', () => {
  expect(elapsed(42_000)).toBe('0:42');
  expect(elapsed(3_725_000)).toBe('1:02:05');
  expect(elapsed(-5)).toBe('0:00');
});
