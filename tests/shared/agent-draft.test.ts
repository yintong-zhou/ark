import { expect, test } from 'vitest';
import { parseAgentFile } from '@shared/agent-file';
import { DRAFTER, DRAFTER_PROMPT, extractAgentFile, extractPrompt, PROMPT_WRITER, promptRequest } from '@shared/agent-draft';

const FILE = '---\nname: Notes\ndescription: d\nengine: auto\ntier: light\nskills: []\npermissions: read-only\n---\nYou write notes.';

test('extractAgentFile strips fences and preamble', () => {
  expect(extractAgentFile('```markdown\n' + FILE + '\n```')).toBe(FILE);
  expect(extractAgentFile('Here you go:\n\n' + FILE)).toBe(FILE);
  expect(extractAgentFile(FILE)).toBe(FILE);
});

test('returns undefined without frontmatter', () => {
  expect(extractAgentFile('I cannot do that.')).toBeUndefined();
  expect(extractAgentFile('a --- b')).toBeUndefined(); // only a line that is exactly --- counts
});

test('the drafter is a light, read-only, skill-less agent', () => {
  expect(DRAFTER).toMatchObject({ id: 'ark-drafter', name: 'Agent drafter', engine: { kind: 'auto' }, tier: 'light', skills: [], permissions: 'read-only' });
  expect(parseAgentFile(extractAgentFile(FILE)!, 'notes').ok).toBe(true);
});

test('the drafter is asked for an alias and a role, and its file parses with them', () => {
  expect(DRAFTER_PROMPT).toContain('alias: <');
  expect(DRAFTER_PROMPT).toContain('role: <');
  const file = extractAgentFile('---\nname: Forge - Backend dev\nalias: Forge\nrole: Backend dev\ndescription: Writes the server code.\nengine: auto\ntier: heavy\nskills: []\npermissions: build\n---\nYou are Forge.');
  const r = parseAgentFile(file!, 'forge-backend-dev');
  expect(r.ok && [r.agent.alias, r.agent.role]).toEqual(['Forge', 'Backend dev']);
});


test('extractPrompt drops a fence around the whole reply and keeps fences inside the prompt', () => {
  expect(extractPrompt('```\nYou are Forge.\n```')).toBe('You are Forge.');
  const inner = 'You are Forge.\n\nRun:\n```\nnpm test\n```\nDone.';
  expect(extractPrompt(`  ${inner}  `)).toBe(inner);
  expect(extractPrompt('  \n ')).toBeUndefined();
});

test('the prompt writer is a light, read-only agent', () => {
  expect(PROMPT_WRITER).toMatchObject({ id: 'ark-prompt-writer', tier: 'light', skills: [], permissions: 'read-only' });
});

test('promptRequest lists the fields, and asks to improve only when a prompt exists', () => {
  const brief = { name: 'Forge - Backend dev', alias: 'Forge', role: 'Backend dev', description: 'Writes the API.', permissions: 'build' as const, skills: ['tdd'] };
  const fresh = promptRequest(brief);
  expect(fresh).toContain('Name: Forge');
  expect(fresh).toContain('Role: Backend dev');
  expect(fresh).toContain('Can change files: yes');
  expect(fresh).toContain('Skills: tdd');
  expect(fresh).toContain('no prompt yet');
  const improve = promptRequest({ ...brief, description: '', skills: [], permissions: 'read-only', prompt: 'You are Forge.' });
  expect(improve).not.toContain('Task:');
  expect(improve).toContain('Skills: none');
  expect(improve).toContain('Can change files: no');
  expect(improve).toContain('Prompt to improve:\nYou are Forge.');
});
