import { expect, test } from 'vitest';
import { parseAgentFile } from '@shared/agent-file';
import { DRAFTER, extractAgentFile } from '@shared/agent-draft';

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
