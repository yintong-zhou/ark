import { expect, test } from 'vitest';
import type { AgentDef } from '@shared/agent-file';
import { CODE_REVIEWER, DEVELOPER, MANAGER, SECURITY_REVIEWER, type ThreadMessage } from '@shared/thread';
import { DEVELOPER_PROTOCOL, MANAGER_PROTOCOL, MEMBER_PROTOCOL, NOTES, REVIEWER_PROTOCOL, formatForAgent, parsePhases, parseReply, withProtocol } from '../../src/main/services/threads/protocol';

const block = (o: unknown) => 'Text.\n\n```ark\n' + JSON.stringify(o) + '\n```';

test('no block: body only', () => expect(parseReply('hello')).toEqual({ body: 'hello' }));
test('next', () => expect(parseReply(block({ next: 'planner' }))).toEqual({ body: 'Text.', control: { kind: 'next', agent: 'planner' } }));
test('team defaults leftOut', () => expect(parseReply(block({ team: [{ agent: 'seo', reason: 'r' }] })).control)
  .toEqual({ kind: 'team', picks: [{ agent: 'seo', reason: 'r' }], leftOut: '' }));
test('ask defaults choices', () => expect(parseReply(block({ ask: 'Q?' })).control).toEqual({ kind: 'ask', question: 'Q?', choices: [] }));
test('ask trims choices', () => expect(parseReply(block({ ask: 'Q?', choices: [' a ', 'b'] })).control)
  .toEqual({ kind: 'ask', question: 'Q?', choices: ['a', 'b'] }));
test('plan', () => expect(parseReply(block({ plan: true })).control).toEqual({ kind: 'plan' }));
test('last block wins and both are removed from the body', () => {
  const r = parseReply(block({ next: 'a' }) + '\n' + block({ next: 'b' }));
  expect(r.control).toEqual({ kind: 'next', agent: 'b' });
  expect(r.body).not.toContain('```ark');
});
test.each([
  ['```ark\nnot json\n```', 'ark block: not valid JSON'],
  ['```ark\n[1]\n```', 'ark block: not valid JSON'],
  [block({ next: 'a', ask: 'q' }), 'ark block: use exactly one of team, next, ask, plan, review'],
  [block({}), 'ark block: use exactly one of team, next, ask, plan, review'],
  [block({ team: [] }), 'ark block: team needs at least one pick'],
  [block({ team: [{ agent: 'a', reason: '' }] }), 'ark block: each pick needs an agent and a reason'],
  [block({ next: '' }), 'ark block: next must be an agent id'],
  [block({ ask: '' }), 'ark block: ask must be a question'],
  [block({ ask: 'q', choices: ['1', '2', '3', '4', '5'] }), 'ark block: at most 4 choices'],
  [block({ ask: 'q', choices: ['  '] }), 'ark block: choices must be 1 to 60 characters'],
  [block({ ask: 'q', choices: ['x'.repeat(61)] }), 'ark block: choices must be 1 to 60 characters'],
  [block({ plan: false }), 'ark block: plan must be true'],
])('invalid %s', (text, error) => expect(parseReply(text).error).toBe(error));
test('an invalid block is still removed from the body', () => expect(parseReply(block({ plan: 1 }))).toMatchObject({ body: 'Text.' }));

const t = { input: 1, cached: 0, output: 1 };
const m = (seq: number, rest: object) => ({ seq, at: seq, ...rest }) as ThreadMessage;
const all: ThreadMessage[] = [
  m(1, { kind: 'user', text: 'hi' }),
  m(2, { kind: 'agent', agent: 'planner', text: 'p', model: 'x', tokens: t }),
  m(3, { kind: 'agent', agent: MANAGER, text: 'm', model: 'x', tokens: t }),
  m(4, { kind: 'reaction', target: 2, emoji: '👍' }),
  m(5, { kind: 'note', text: 'n' }),
];
const names = { planner: 'Planner', [MANAGER]: 'Project manager' };

test('formatForAgent skips own messages and labels the rest', () => {
  expect(formatForAgent(all.slice(0), all, names, MANAGER)).toBe('[User] hi\n\n[Planner] p\n\n[User reacted 👍 to Planner: "p"]\n\n[Ark] n');
});
test('formatForAgent shows an ask and cuts long reaction quotes', () => {
  const long = 'y'.repeat(100);
  const msgs = [
    m(1, { kind: 'agent', agent: 'planner', text: long, model: 'x', tokens: t, control: { kind: 'ask', question: 'Q?', choices: [] } }),
    m(2, { kind: 'reaction', target: 1, emoji: '👎' }),
  ];
  expect(formatForAgent(msgs, msgs, names, MANAGER))
    .toBe(`[Planner] ${long}\n(asked the user: Q?)\n\n[User reacted 👎 to Planner: "${'y'.repeat(80)}…"]`);
});

const agent = (id: string): AgentDef => ({ id, name: id, description: 'd', engine: { kind: 'auto' }, tier: 'light', skills: [], permissions: 'read-only', prompt: 'Base.' });
const ASK = '\n\nSession policy: Ask for approval. The user confirms the team and starts the developer after the plan.';
test('withProtocol appends the manager protocol only to the manager', () => {
  expect(withProtocol(agent(MANAGER)).prompt).toBe('Base.\n\n' + MANAGER_PROTOCOL + ASK);
  expect(withProtocol(agent('planner')).prompt).toBe('Base.\n\n' + MEMBER_PROTOCOL + ASK);
  expect(withProtocol(agent('planner'), 'planning', 'auto').prompt).toContain('Permission mode: auto.');
});
test('NOTES', () => {
  expect(NOTES.budget).toContain('20 agent turns');
  expect(NOTES.roster([{ id: 'a', name: 'A' }])).toBe('Team: a (A).');
});

test('formatForAgent names an image and pastes a text file in', () => {
  const attachments = [
    { name: 'shot.png', file: 'a-shot.png', kind: 'image' as const, mime: 'image/png', size: 2 },
    { name: 'notes.md', file: 'b-notes.md', kind: 'text' as const, mime: 'text/plain', size: 7 },
    { name: 'gone.txt', file: 'c-gone.txt', kind: 'text' as const, mime: 'text/plain', size: 1 },
  ];
  const m: ThreadMessage = { seq: 1, at: 1, kind: 'user', text: 'look', attachments };
  const read = (a: { file: string }) => (a.file === 'b-notes.md' ? '# Hello' : undefined);
  expect(formatForAgent([m], [m], {}, MANAGER, read)).toBe(
    '[User] look\n(attached image: shot.png)\n--- notes.md ---\n# Hello\n--- end of notes.md ---\n(attached file gone.txt could not be read)',
  );
});

test('parsePhases finds Phase, Fase and dash headings', () => {
  const md = '# Plan\nintro\n## Phase 1: Setup\na\n## Fase 2 - API\nb\n## Notes\nc';
  expect(parsePhases(md)).toEqual([
    { title: 'Setup', text: '## Phase 1: Setup\na' },
    { title: 'API', text: '## Fase 2 - API\nb\n## Notes\nc' },
  ]);
  expect(parsePhases('## Phase 1 \u2014 API')[0].title).toBe('API');
});
test('parsePhases counts only headings at the level of the first phase: numbered sub-headings stay in their phase', () => {
  const md = '# Plan\n## Phase 1: Setup\n### Step 1: init\nx\n### Task 2: config\ny\n## Phase 2: API\n### Step 1: routes\nz';
  expect(parsePhases(md)).toEqual([
    { title: 'Setup', text: '## Phase 1: Setup\n### Step 1: init\nx\n### Task 2: config\ny' },
    { title: 'API', text: '## Phase 2: API\n### Step 1: routes\nz' },
  ]);
  expect(parsePhases('### Phase 1: A\na\n### Phase 2: B\nb').map((p) => p.title)).toEqual(['A', 'B']);
});
test('parsePhases ignores a numbered sub-heading before the first phase', () => {
  const md = '# Plan\n### Step 1: read the code\nx\n## Phase 1: Setup\na\n## Phase 2: API\nb';
  expect(parsePhases(md).map((p) => p.title)).toEqual(['Setup', 'API']);
});
test('parsePhases is empty for a plan without numbered headings', () => expect(parsePhases('# Plan\n## Setup\nx')).toEqual([]));
test('parseReply reads a review pass and a review with findings', () => {
  expect(parseReply(block({ review: 'pass' })).control).toEqual({ kind: 'review', pass: true, findings: [] });
  expect(parseReply(block({ review: 'changes', findings: ['null check'] })).control).toEqual({ kind: 'review', pass: false, findings: ['null check'] });
});
test('next carries hard only for true', () => {
  expect(parseReply(block({ next: 'planner', hard: true })).control).toEqual({ kind: 'next', agent: 'planner', hard: true });
  expect(parseReply(block({ next: 'planner', hard: 'yes' })).control).toEqual({ kind: 'next', agent: 'planner' });
});
test.each([
  [{ review: 'changes', findings: [] }],
  [{ review: 'changes' }],
  [{ review: 'changes', findings: Array(21).fill('a') }],
  [{ review: 'changes', findings: [''] }],
  [{ review: 'changes', findings: ['x'.repeat(2001)] }],
  [{ review: 'maybe' }],
])('parseReply rejects bad review %j', (o) => expect(parseReply(block(o)).error).toMatch(/1 to 20 findings/));
test('withProtocol gives build roles their build prompt only in the build phase', () => {
  expect(withProtocol(agent(DEVELOPER), 'build').prompt).toBe('Base.\n\n' + DEVELOPER_PROTOCOL + ASK);
  expect(withProtocol(agent(CODE_REVIEWER), 'build').prompt).toBe('Base.\n\n' + REVIEWER_PROTOCOL + ASK);
  expect(withProtocol(agent(SECURITY_REVIEWER), 'build').prompt).toBe('Base.\n\n' + REVIEWER_PROTOCOL + ASK);
  expect(withProtocol(agent(MANAGER), 'build').prompt).toBe('Base.\n\n' + MANAGER_PROTOCOL + ASK);
  expect(withProtocol(agent(DEVELOPER), 'planning').prompt).toBe('Base.\n\n' + MEMBER_PROTOCOL + ASK);
});
test("formatForAgent shows a reviewer's findings", () => {
  const r = (control: object) => [m(1, { kind: 'agent', agent: 'planner', text: 'r', model: 'x', tokens: t, control })];
  const fail = r({ kind: 'review', pass: false, findings: ['a', 'b'] });
  const pass = r({ kind: 'review', pass: true, findings: [] });
  expect(formatForAgent(fail, fail, names, MANAGER)).toBe('[Planner] r\n(findings:\n- a\n- b)');
  expect(formatForAgent(pass, pass, names, MANAGER)).toBe('[Planner] r\n(review: pass)');
});
test('NOTES.review cuts a long diff and points to the worktree', () => {
  const n = NOTES.review({ kind: 'code', phase: 'P', diff: 'x'.repeat(100_001), worktree: 'W' });
  expect(n).toContain('x'.repeat(100_000));
  expect(n).not.toContain('x'.repeat(100_001));
  expect(n).toContain('read the changed files in W');
  expect(NOTES.review({ kind: 'security', phase: 'P', diff: '', worktree: 'W' })).toContain('(no changes in this phase)');
});
test('NOTES.develop asks for npm ci only when node_modules is missing', () => {
  const o = { plan: 'plan.md', index: 1, total: 3, phase: 'PHASE TEXT', done: ['Setup done'], branch: 'ark/x', worktree: 'W', deps: false };
  const n = NOTES.develop(o);
  expect(n).toContain('phase 2/3');
  for (const s of ['plan.md', 'PHASE TEXT', 'Setup done', 'ark/x']) expect(n).toContain(s);
  expect(n).not.toContain('npm ci');
  expect(NOTES.develop({ ...o, deps: true })).toContain('npm ci');
});
test('NOTES.checksFailed, blocked and summary carry their data', () => {
  const failed = NOTES.checksFailed([{ script: 'lint', ok: false, tail: 'BOOM' }, { script: 'test', ok: true, tail: 'FINE' }]);
  expect(failed).toContain('lint');
  expect(failed).toContain('BOOM');
  expect(failed).not.toContain('FINE');
  expect(NOTES.blocked({ phase: 'P', points: ['one', 'two'] })).toContain('- one\n- two');
  const s = NOTES.summary({ branch: 'ark/x', phases: [{ title: 'Setup', notes: 2, commit: 'abc' }], tokens: ['Dev: 10'], windows: [] });
  for (const x of ['ark/x', 'Setup', 'abc', 'Dev: 10']) expect(s).toContain(x);
});

test('the summary lists the window movement', () => {
  const o = { branch: 'ark/x', phases: [], tokens: [] };
  expect(NOTES.summary({ ...o, windows: ['Claude 5h 41% → 44%'] })).toContain('Usage windows (including your other sessions):\n- Claude 5h 41% → 44%');
  expect(NOTES.summary({ ...o, windows: [] })).not.toContain('Usage windows');
});
