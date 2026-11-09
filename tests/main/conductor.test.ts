import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { AgentDef } from '@shared/agent-file';
import type { Thread, ThreadMessage } from '@shared/thread';
import type { ImageInput } from '@shared/attachments';
import type { ChatEvent, TokenCount, TurnResult, UsageWindow } from '@shared/types';
import { SEED_AGENTS } from '../fixtures/catalog-agents';
import { IT_SERVICES_AGENTS } from '../../src/main/services/it-services';
import { NOTES } from '../../src/main/services/threads/protocol';
import { Conductor } from '../../src/main/services/threads/conductor';
import { ThreadStore } from '../../src/main/services/threads/store';
import type { CheckResult } from '../../src/main/services/threads/workspace';

type Reply = string | Error | { text: string; tokens: TokenCount; contextWindow: number; contextUsed?: number };

/** A fake AgentRunner: replies come from a per-agent queue; a turn with nothing queued stays pending. */
function fakeRunner() {
  let n = 0;
  const agentOf = new Map<string, string>();
  const queues = new Map<string, Reply[]>();
  const pending = new Map<string, { resolve: (r: TurnResult) => void; reject: (e: Error) => void }>();
  const deliver = (agent: string) => {
    const q = queues.get(agent) ?? [];
    for (const [chatId, p] of pending) {
      if (agentOf.get(chatId) !== agent || !q.length) continue;
      const x = q.shift()!;
      pending.delete(chatId);
      if (x instanceof Error) p.reject(x);
      else if (typeof x === 'string') p.resolve({ text: x, model: 'haiku', tokens: { input: 10, cached: 0, output: 5 }, contextWindow: 1000 });
      else p.resolve({ model: 'haiku', ...x });
    }
  };
  const listeners = new Set<(chatId: string, e: ChatEvent) => void>();
  const r = {
    started: [] as AgentDef[],
    starts: [] as { id: string; dir: string; permissions: string }[],
    answers: [] as [string, string, boolean][],
    turns: [] as { agent: string; chatId: string; text: string; images?: ImageInput[] }[],
    stopped: [] as string[],
    gate: undefined as Promise<void> | undefined, // when set, startAgent waits for it
    reports: { engine: 'claude' as 'claude' | 'codex', rerouted: false }, // what startAgent says about the engine
    startAgent: async (agent: AgentDef, dir: string, permissions?: string) => {
      r.started.push(agent);
      r.starts.push({ id: agent.id, dir, permissions: permissions ?? 'read-only' });
      await r.gate;
      const chatId = `c${++n}`;
      agentOf.set(chatId, agent.id);
      return { chatId, engine: r.reports.engine, model: 'haiku', ...(r.reports.rerouted ? { rerouted: true as const } : {}) };
    },
    turn: (chatId: string, text: string, _timeout?: number, _message?: string, images?: ImageInput[]) =>
      new Promise<TurnResult>((resolve, reject) => {
        const agent = agentOf.get(chatId)!;
        r.turns.push({ agent, chatId, text, images });
        pending.set(chatId, { resolve, reject });
        deliver(agent);
      }),
    stop: (chatId: string) => {
      r.stopped.push(chatId);
      pending.get(chatId)?.reject(new Error('stopped'));
      pending.delete(chatId);
    },
    answer: (chatId: string, id: string, allow: boolean) => void r.answers.push([chatId, id, allow]),
    onEvent: (cb: (chatId: string, e: ChatEvent) => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    emit: (chatId: string, e: ChatEvent) => listeners.forEach((cb) => cb(chatId, e)),
    reply: (agent: string, ...replies: Reply[]) => {
      queues.set(agent, [...(queues.get(agent) ?? []), ...replies]);
      deliver(agent);
    },
  };
  return r;
}

/** A fake Workspace: records every call; runChecks returns the queued results, or all passing. */
function fakeWorkspace() {
  let n = 0;
  const w = {
    calls: [] as unknown[][],
    headResult: 'abcdef0123456789' as string | undefined,
    checks: [] as string[],
    results: [] as CheckResult[][],
    diffText: 'diff --git a/x b/x',
    commitError: undefined as Error | undefined, // thrown once by the next commitAll
    head: async (dir: string) => (w.calls.push(['head', dir]), w.headResult),
    notRoots: [] as string[], // folders inside a repository that are not its top folder
    isRepoRoot: async (dir: string) => !w.notRoots.includes(dir),
    addWorktree: async (repo: string, path: string, branch: string) => void w.calls.push(['addWorktree', repo, path, branch]),
    commitAll: async (dir: string, message: string) => {
      w.calls.push(['commitAll', dir, message]);
      const e = w.commitError;
      w.commitError = undefined;
      if (e) throw e;
      return `${++n}`.padStart(12, 's');
    },
    diff: async (dir: string, base: string) => (w.calls.push(['diff', dir, base]), w.diffText),
    log: async () => '',
    projectChecks: () => w.checks,
    runChecks: async (dir: string, scripts: string[]) => {
      w.calls.push(['runChecks', dir, scripts]);
      return w.results.shift() ?? scripts.map((script) => ({ script, ok: true, tail: '' }));
    },
  };
  return w;
}

const catalog = { get: (id: string) => SEED_AGENTS.find((a) => a.id === id), list: () => ({ agents: SEED_AGENTS, invalid: [] }) };
const ark = (o: object, text = 'ok') => `${text}\n\n\`\`\`ark\n${JSON.stringify(o)}\n\`\`\``;
const TEAM = ark({ team: [{ agent: 'planner', reason: 'plans' }, { agent: 'seo', reason: 'ranks' }], leftOut: 'no marketing' });
const tick = () => new Promise((r) => setTimeout(r, 0));

let root: string;
let store: ThreadStore;
let runner: ReturnType<typeof fakeRunner>;
let ws: ReturnType<typeof fakeWorkspace>;
let worktrees: string;
let c: Conductor;
let windows: () => { fiveHour?: UsageWindow } | undefined;
let projectId: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ark-conductor-'));
  mkdirSync(join(root, 'app'));
  store = new ThreadStore(join(root, 'data'));
  projectId = store.addProject(join(root, 'app')).id;
  runner = fakeRunner();
  ws = fakeWorkspace();
  worktrees = join(root, 'wt');
  windows = () => undefined;
  c = new Conductor({ store, catalog, runner, workspace: ws, worktrees, windows: () => windows() });
});
afterEach(() => {
  c.stopAll();
  rmSync(root, { recursive: true, force: true });
});

/** Resolves once no thread is running (its loop has settled). */
async function idle() {
  for (let i = 0; i < 200; i++) {
    await tick();
    if (store.threads().every((t) => t.status !== 'running')) return;
  }
  throw new Error('a loop is still running');
}
/** Resolves once `n` turns have been sent to the runner. */
async function turns(n: number) {
  for (let i = 0; i < 200 && runner.turns.length < n; i++) await tick();
  expect(runner.turns).toHaveLength(n);
}
const thread = (id: string) => store.get(id) as Thread;
const last = (id: string) => store.messages(id).at(-1) as ThreadMessage;

/** A thread past the team phase: PM proposed planner + seo, the user approved. */
async function planning(first = 'Build a landing page') {
  runner.reply('project-manager', TEAM);
  const t = c.create(projectId, first);
  await idle();
  c.approveTeam(t.id, ['planner', 'seo']);
  return t;
}

test('create runs the manager with the catalog and waits on its team card', async () => {
  runner.reply('project-manager', TEAM);
  const t = c.create(projectId, 'Build a landing page\nwith a form');
  expect(t.title).toBe('Build a landing page');
  await idle();
  expect(runner.turns[0].text).toContain('[User] Build a landing page');
  expect(runner.turns[0].text).toContain('Catalog:');
  expect(runner.started[0].prompt).toContain('# Working in an Ark thread');
  expect(thread(t.id).status).toBe('waiting');
  const m = last(t.id);
  expect(m.kind === 'agent' && m.control?.kind).toBe('team');
});

test('create without a manager in the catalog throws', () => {
  const none = { get: () => undefined, list: () => ({ agents: [], invalid: [] }) };
  expect(() => new Conductor({ store, catalog: none, runner, workspace: ws, worktrees, windows: () => undefined }).create(projectId, 'x')).toThrow(
    'Add thread roles in Agents, or fix the project-manager profile if it has errors',
  );
});

test('deleting a thread protects running turns and worktrees and stops idle sessions', async () => {
  const t = c.create(projectId, 'Test');
  await turns(1);
  const trash = async (path: string) => rmSync(path, { recursive: true });
  await expect(c.remove(t.id, trash)).rejects.toThrow('Pause the thread');
  c.pause(t.id);
  const paused = thread(t.id);
  store.save({ ...paused, build: { worktree: 'wt', branch: 'b', plan: '', phases: [], current: 0 } });
  await expect(c.remove(t.id, trash)).rejects.toThrow('Remove the thread worktree');
  store.save(paused);
  await c.remove(t.id, trash);
  expect(store.get(t.id)).toBeUndefined();
});

test('removing a project pauses running threads and keeps them for reimport', async () => {
  const t = c.create(projectId, 'Test');
  await turns(1);
  const dir = store.projects()[0].dir;
  c.removeProject(projectId);
  expect(store.projects()).toEqual([]);
  expect(thread(t.id).status).toBe('idle');
  expect(runner.stopped).toContain(runner.turns[0].chatId);
  expect(store.addProject(dir).id).toBe(projectId);
  expect(store.get(t.id)).toBeDefined();
});

test('IT Services team participates in planning, username mentions and assigned tasks without build access', async () => {
  const ids = IT_SERVICES_AGENTS.map((a) => a.id);
  runner.reply('project-manager', ark({ team: ids.map((agent) => ({ agent, reason: 'Relevant specialist' })) }));
  const t = c.create(projectId, 'Plan an IT service');
  await idle();
  expect(runner.turns[0].text).toContain('frontend_dev: Gon - Frontend dev');
  c.approveTeam(t.id, ids);
  runner.reply('project-manager', ark({ next: 'dev_manager' }), ark({ ask: 'Continue?' }));
  runner.reply('dev_manager', 'Objective: implement the approved service. Owner: @frontend_dev.');
  await idle();
  c.saveTask(t.id, null, { title: 'Plan the interface', status: 'todo', agent: 'frontend_dev' });
  c.send(t.id, '@frontend_dev which API contract is needed?');
  runner.reply('frontend_dev', ark({ ask: 'Which API is approved?' }));
  await idle();
  expect(thread(t.id)).toMatchObject({ phase: 'planning', status: 'waiting', waitingOn: 'frontend_dev' });
  expect(thread(t.id).team).toEqual(['project-manager', ...ids]);
  expect(runner.turns.at(-1)).toMatchObject({ agent: 'frontend_dev', text: expect.stringContaining('Plan the interface') });
  expect(runner.started.at(-1)?.prompt).toContain('Your username is @frontend_dev');
  expect(runner.starts.filter((s) => ids.includes(s.id)).every((s) => s.permissions === 'read-only')).toBe(true);
  expect(ws.calls).toEqual([]); // advisory roles never create a worktree or start a build
});

test('approve then planning: manager gives the floor, member replies, floor returns to manager', async () => {
  const t = await planning();
  runner.reply('project-manager', ark({ next: 'planner' }), ark({ ask: 'Which colour?' }));
  runner.reply('planner', 'I suggest three sections.');
  await idle();
  expect(runner.turns.map((x) => x.agent)).toEqual(['project-manager', 'project-manager', 'planner', 'project-manager']);
  expect(store.messages(t.id).some((m) => m.kind === 'note' && m.text === 'Team approved: Project manager, Planner, SEO.')).toBe(true);
  expect(thread(t.id)).toMatchObject({ status: 'waiting', waitingOn: 'project-manager', phase: 'planning' });
  expect(thread(t.id).speaking).toBeUndefined();
});

test("the member's second turn only gets what it has not seen", async () => {
  await planning('Build a landing page');
  runner.reply('project-manager', ark({ next: 'planner' }), ark({ next: 'planner' }), ark({ ask: 'Ok?' }));
  runner.reply('planner', 'first answer', 'second answer');
  await idle();
  const planner = runner.turns.filter((x) => x.agent === 'planner');
  expect(planner).toHaveLength(2);
  expect(planner[0].text).toContain('[User] Build a landing page');
  expect(planner[0].text).toContain('[Ark] Team: project-manager (Project manager)');
  expect(planner[1].text).not.toContain('[User] Build a landing page');
  expect(planner[1].text).not.toContain('Team:');
  expect(planner[1].text).not.toContain('first answer');
  expect(planner[1].chatId).toBe(planner[0].chatId);
});

test('plan reply writes plan.md and waits; startDeveloper moves to build', async () => {
  const t = await planning();
  await expect(c.startDeveloper(t.id)).rejects.toThrow('The developer can start only once the plan is ready');
  runner.reply('project-manager', ark({ next: 'planner' }));
  runner.reply('planner', ark({ plan: true }, '# Plan\n## Phase 1: Setup'));
  await idle();
  expect(thread(t.id).status).toBe('waiting');
  expect(thread(t.id).waitingOn).toBeUndefined();
  const plan = join(root, 'data', 'threads', t.id, 'plan.md');
  expect(existsSync(plan) && readFileSync(plan, 'utf8')).toBe('# Plan\n## Phase 1: Setup');
  await c.startDeveloper(t.id);
  expect(thread(t.id).phase).toBe('build');
});

test('user message during a turn routes the next speaker', async () => {
  const t = await planning();
  await turns(2); // PM's planning turn is pending
  c.send(t.id, '@seo what about keywords?');
  runner.reply('project-manager', ark({ next: 'planner' }));
  runner.reply('seo', ark({ ask: 'Which market?' }));
  await idle();
  expect(runner.turns.map((x) => x.agent)).toEqual(['project-manager', 'project-manager', 'seo']);
  expect(thread(t.id)).toMatchObject({ status: 'waiting', waitingOn: 'seo' });
});

test('a user message during a turn that ends in an ask still routes the next speaker', async () => {
  const t = await planning();
  await turns(2);
  c.send(t.id, '@seo what about keywords?');
  runner.reply('project-manager', ark({ ask: 'Which colour?' }));
  runner.reply('seo', 'Use these keywords.', ark({ ask: 'Ok?' }));
  runner.reply('project-manager', ark({ ask: 'Done?' }));
  await idle();
  expect(runner.turns.map((x) => x.agent).slice(0, 3)).toEqual(['project-manager', 'project-manager', 'seo']);
});

test('pause stops the turn and the loop', async () => {
  const t = await planning();
  await turns(2);
  const before = store.messages(t.id).length;
  c.pause(t.id);
  expect(thread(t.id)).toMatchObject({ status: 'idle' });
  expect(thread(t.id).speaking).toBeUndefined();
  expect(runner.stopped).toEqual([runner.turns[1].chatId]);
  runner.reply('project-manager', ark({ next: 'planner' }));
  for (let i = 0; i < 10; i++) await tick();
  expect(store.messages(t.id)).toHaveLength(before);
  expect(runner.turns).toHaveLength(2);
  expect(thread(t.id).status).toBe('idle');
});

const tierOf = (i: number) => runner.started[i].tier;

test('a hard turn runs in a fresh session one tier up, then the member goes back to its own', async () => {
  const t = await planning();
  runner.reply('project-manager', ark({ next: 'planner' }), ark({ next: 'planner', hard: true }), ark({ next: 'planner' }), ark({ ask: 'Done?' }));
  runner.reply('planner', 'one', 'two', 'three');
  await idle();
  const planners = runner.started.map((a, i) => [a.id, i] as const).filter(([id]) => id === 'planner').map(([, i]) => i);
  expect(planners.map(tierOf)).toEqual(['standard', 'heavy', 'standard']);
  const chats = runner.turns.filter((x) => x.agent === 'planner').map((x) => x.chatId);
  expect(runner.stopped).toEqual(expect.arrayContaining([chats[0], chats[1]]));
  expect(thread(t.id).status).toBe('waiting');
});

test('a paused hard turn leaves no bumped session behind', async () => {
  const t = await planning();
  runner.reply('project-manager', ark({ next: 'planner', hard: true }));
  await until(() => runner.turns.some((x) => x.agent === 'planner')); // the hard turn is pending
  c.pause(t.id);
  runner.reply('planner', 'back');
  runner.reply('project-manager', ark({ ask: 'Done?' }));
  c.send(t.id, '@planner hello');
  await idle();
  expect(runner.started.filter((a) => a.id === 'planner').map((a) => a.tier)).toEqual(['heavy', 'standard']);
});

test('engine error then retry', async () => {
  const t = await planning('Build a landing page');
  runner.reply('project-manager', ark({ next: 'planner' }));
  runner.reply('planner', new Error('exit code 1'));
  await idle();
  expect(last(t.id)).toMatchObject({ kind: 'note', text: 'Planner stopped: exit code 1' });
  expect(thread(t.id).status).toBe('error');
  const failed = runner.turns.at(-1)!.chatId;
  expect(runner.stopped).toContain(failed);
  runner.reply('planner', ark({ ask: 'Better?' }));
  c.send(t.id, '@planner try again');
  await idle();
  const retry = runner.turns.at(-1)!;
  expect(retry.agent).toBe('planner');
  expect(retry.chatId).not.toBe(failed);
  expect(retry.text).toContain('[User] Build a landing page');
  expect(retry.text).toContain('[User] @planner try again');
  expect(thread(t.id)).toMatchObject({ status: 'waiting', waitingOn: 'planner' });
});

test('fresh session replays from the handoff', async () => {
  runner.reply('project-manager', { text: TEAM, tokens: { input: 600, cached: 0, output: 5 }, contextWindow: 1000 }, 'My handoff: team proposed.');
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  expect(runner.turns[1]).toMatchObject({ agent: 'project-manager', text: expect.stringContaining('[Ark] Your session is getting long.') });
  expect(runner.stopped).toEqual([runner.turns[0].chatId]);
  expect(thread(t.id).handoffs['project-manager'].seq).toBe(1); // the last message in that turn's input
  runner.reply('project-manager', ark({ ask: 'Ready?' }));
  c.approveTeam(t.id, ['planner']);
  await idle();
  const fresh = runner.turns[2];
  expect(fresh.chatId).not.toBe(runner.turns[0].chatId);
  expect(fresh.text.startsWith('[Ark] You are continuing this thread in a fresh session.')).toBe(true);
  expect(fresh.text).toContain('My handoff: team proposed.');
  expect(fresh.text).toContain('[Ark] Team approved: Project manager, Planner.');
  expect(fresh.text).not.toContain('[User] Build a landing page');
});

test('a message sent during an agent turn reaches that agent next time', async () => {
  const t = await planning();
  await turns(2); // PM's planning turn is pending
  c.send(t.id, 'Use blue, please');
  runner.reply('project-manager', ark({ ask: 'Which font?' }), ark({ ask: 'Anything else?' }));
  await idle();
  const pm = runner.turns.filter((x) => x.agent === 'project-manager');
  expect(pm).toHaveLength(3);
  expect(pm[1].text).not.toContain('[User] Use blue, please');
  expect(pm[2].text).toContain('[User] Use blue, please');
  expect(pm[2].chatId).toBe(pm[1].chatId);
});

test('a failed handoff drops the session and keeps the reply step', async () => {
  runner.reply('project-manager', { text: TEAM, tokens: { input: 600, cached: 0, output: 5 }, contextWindow: 1000 }, new Error('exit code 1'));
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  expect(last(t.id)).toMatchObject({ kind: 'note', text: 'Project manager could not write a handoff: exit code 1' });
  expect(thread(t.id)).toMatchObject({ status: 'waiting', phase: 'team', handoffs: {} });
  expect(runner.stopped).toEqual([runner.turns[0].chatId]);
  runner.reply('project-manager', ark({ ask: 'Ready?' }));
  c.approveTeam(t.id, ['planner']);
  await idle();
  expect(runner.turns[2].chatId).not.toBe(runner.turns[0].chatId);
  expect(runner.turns[2].text).toContain('[User] Build a landing page'); // no handoff: replays from the start
});

test('stopAll stops a pending turn and saves the thread idle', async () => {
  const t = await planning();
  await turns(2);
  c.stopAll();
  expect(runner.stopped).toEqual(expect.arrayContaining(runner.started.map((_, i) => `c${i + 1}`)));
  expect(thread(t.id).status).toBe('idle');
  runner.reply('project-manager', ark({ next: 'planner' }));
  for (let i = 0; i < 10; i++) await tick();
  expect(runner.turns).toHaveLength(2);
  expect(last(t.id).kind).toBe('note'); // "Team approved", nothing after it
});

test('pause during startAgent stops the session it started', async () => {
  let open!: () => void;
  runner.gate = new Promise((r) => (open = r));
  const t = c.create(projectId, 'Build a landing page');
  c.pause(t.id);
  expect(thread(t.id).status).toBe('idle');
  open();
  for (let i = 0; i < 10; i++) await tick();
  expect(runner.stopped).toEqual(['c1']);
  expect(runner.turns).toHaveLength(0);
});

test('react records and does not start a turn', async () => {
  runner.reply('project-manager', TEAM);
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  const seen: ThreadMessage[] = [];
  c.onUpdate((u) => seen.push(...u.added));
  const target = last(t.id).seq;
  c.react(t.id, target, '👍');
  for (let i = 0; i < 5; i++) await tick();
  expect(last(t.id)).toMatchObject({ kind: 'reaction', target, emoji: '👍' });
  expect(seen).toEqual([last(t.id)]);
  expect(runner.turns).toHaveLength(1);
  expect(() => c.react(t.id, 1, '👍')).toThrow(); // seq 1 is the user's message
});

test('approveTeam outside the team phase throws', async () => {
  const t = await planning();
  await turns(2);
  expect(() => c.approveTeam(t.id, ['planner'])).toThrow();
  c.pause(t.id);
  expect(() => c.approveTeam(t.id, ['planner'])).toThrow();
});

test('approveTeam rejects an unknown agent', async () => {
  runner.reply('project-manager', TEAM);
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  expect(() => c.approveTeam(t.id, ['planner', 'ghost'])).toThrow('Unknown agent: ghost');
  expect(thread(t.id).phase).toBe('team');
});

test('a fresh manager in the team phase gets the catalog again, once', async () => {
  const t = c.create(projectId, 'Build a landing page');
  await turns(1); // the manager's first turn is pending
  expect(runner.turns[0].text.split('Catalog:')).toHaveLength(2);
  c.pause(t.id); // the session is gone
  runner.reply('project-manager', TEAM);
  c.send(t.id, 'Keep it small');
  await idle();
  expect(runner.turns[1].chatId).not.toBe(runner.turns[0].chatId);
  expect(runner.turns[1].text).toContain('Propose the team');
  expect(runner.turns[1].text.split('Catalog:')).toHaveLength(2);
  expect(thread(t.id).status).toBe('waiting');
  // the session is live now: the next message does not repeat it
  runner.reply('project-manager', TEAM);
  c.send(t.id, 'Add a tester');
  await idle();
  expect(runner.turns[2].chatId).toBe(runner.turns[1].chatId);
  expect(runner.turns[2].text).not.toContain('Catalog:');
});

test('a team pick outside the catalog gets one correction, and the good proposal waits as the card', async () => {
  const bad = ark({ team: [{ agent: 'planner', reason: 'plans' }, { agent: 'ghost', reason: 'boo' }], leftOut: '' });
  runner.reply('project-manager', bad, TEAM);
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  expect(runner.turns).toHaveLength(2);
  expect(runner.turns[1].text).toContain('unknown agent: ghost');
  expect(thread(t.id)).toMatchObject({ status: 'waiting', phase: 'team' });
  const m = last(t.id);
  expect(m.kind === 'agent' && m.control).toMatchObject({ kind: 'team', picks: [{ agent: 'planner' }, { agent: 'seo' }] });
  c.approveTeam(t.id, ['planner', 'seo']); // the card can be approved
  expect(thread(t.id).phase).toBe('planning');
});

test('two bad teams in a row wait for the user with no card to approve', async () => {
  const bad = ark({ team: [{ agent: 'ghost', reason: 'boo' }], leftOut: '' });
  runner.reply('project-manager', bad, bad);
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  expect(runner.turns).toHaveLength(2);
  expect(thread(t.id).status).toBe('waiting');
  expect(last(t.id)).toMatchObject({ kind: 'note', text: expect.stringContaining('did not give Ark a valid instruction') });
  expect(store.messages(t.id).filter((m) => m.kind === 'agent').every((m) => m.kind === 'agent' && !m.control)).toBe(true);
});

test('the handoff trigger reads the last request, not the turn total', async () => {
  const big = { text: TEAM, tokens: { input: 9000, cached: 0, output: 5 }, contextWindow: 1000 };
  runner.reply('project-manager', { ...big, contextUsed: 100 }); // summed usage is 9x the window, the last request is 10%
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  expect(runner.turns).toHaveLength(1);
  expect(thread(t.id).handoffs).toEqual({});
  runner.reply('project-manager', { ...big, contextUsed: 600 }, 'My handoff.');
  c.send(t.id, 'Smaller, please');
  await idle();
  expect(runner.turns[2]).toMatchObject({ text: expect.stringContaining('[Ark] Your session is getting long.') });
});

test('files and tags travel with a message: images reach the agent as images, text files are pasted in', async () => {
  const t = await planning();
  runner.reply('project-manager', ark({ ask: 'Which one?' }));
  await idle(); // the thread waits on the user
  runner.reply('project-manager', ark({ ask: 'Thanks. Which colour?' }));
  c.send(t.id, 'Fix this #bug please', [
    { name: 'shot.png', bytes: new Uint8Array([9, 9]) },
    { name: 'notes.md', bytes: new TextEncoder().encode('# Hello') },
  ]);
  await idle();
  const turn = runner.turns.at(-1)!;
  expect(turn.text).toContain('[User] Fix this #bug please');
  expect(turn.text).toContain('(attached image: shot.png)');
  expect(turn.text).toContain('--- notes.md ---\n# Hello\n--- end of notes.md ---');
  expect(turn.images).toEqual([{ mime: 'image/png', data: Buffer.from([9, 9]).toString('base64') }]);
  expect(thread(t.id).tags).toEqual(['bug']);
  const sent = store.messages(t.id).find((m) => m.kind === 'user' && m.attachments);
  expect(sent?.kind === 'user' && sent.attachments?.map((a) => a.name)).toEqual(['shot.png', 'notes.md']);
});

test('a tag written during a turn is not lost when the turn saves', async () => {
  const t = await planning();
  await turns(2);
  c.send(t.id, 'make it #urgent');
  expect(thread(t.id).tags).toEqual(['urgent']);
  runner.reply('project-manager', ark({ ask: 'Which colour?' }), ark({ ask: 'And the font?' }));
  await idle();
  expect(thread(t.id).tags).toEqual(['urgent']);
});

test('create takes tags from the first message, and a first message that is only a file', async () => {
  runner.reply('project-manager', TEAM, TEAM);
  const a = c.create(projectId, 'Landing #web #ui');
  await idle();
  expect(thread(a.id).tags).toEqual(['web', 'ui']);
  const b = c.create(projectId, '', [{ name: 'mock.png', bytes: new Uint8Array([1]) }]);
  await idle();
  expect(b.title).toBe('mock.png');
  expect(runner.turns.at(-1)?.images).toHaveLength(1);
});

// ---- Build phase (step 3) ----

const PLAN = '# Plan\n## Phase 1: Setup\nCreate the app.';
const PLAN2 = `${PLAN}\n## Phase 2: API\nAdd the API.`;
const PASS = ark({ review: 'pass' });
const CHANGES = (...findings: string[]) => ark({ review: 'changes', findings });

/** A planning thread whose planner just wrote the plan: the thread waits on the plan card. */
async function planned(plan = PLAN) {
  const t = await planning();
  runner.reply('project-manager', ark({ next: 'planner' }));
  runner.reply('planner', ark({ plan: true }, plan));
  await idle();
  return t;
}
/** Resolves once `ok()` holds. */
async function until(ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}
const agentsOf = (from = 0) => runner.turns.slice(from).map((x) => x.agent);
const notes = (id: string) => store.messages(id).flatMap((m) => (m.kind === 'note' ? [m.text] : []));
const devTurns = () => runner.turns.filter((x) => x.agent === 'developer');

test('a plan without phase headings gets one correction and is not written', async () => {
  const t = await planning();
  runner.reply('project-manager', ark({ next: 'planner' }));
  runner.reply('planner', ark({ plan: true }, '# Plan\nJust build it.'), ark({ plan: true }, PLAN));
  await idle();
  const planner = runner.turns.filter((x) => x.agent === 'planner');
  expect(planner).toHaveLength(2);
  expect(planner[1].text).toContain('ark block: plan has no "## Phase N: <title>" headings');
  const first = store.messages(t.id).find((m) => m.kind === 'agent' && m.agent === 'planner');
  expect(first?.kind === 'agent' && first.control).toBeUndefined();
  expect(readFileSync(join(root, 'data', 'threads', t.id, 'plan.md'), 'utf8')).toBe(PLAN);
  expect(thread(t.id).status).toBe('waiting');
});

test('startDeveloper refuses a project without a commit and leaves the thread in planning', async () => {
  const { id } = await planned();
  ws.headResult = undefined;
  await expect(c.startDeveloper(id)).rejects.toThrow('The project needs a Git repository with at least one commit');
  expect(store.get(id)!.phase).toBe('planning');
});

test('startDeveloper refuses a project folder inside another repository and leaves the thread in planning', async () => {
  const { id } = await planned();
  ws.notRoots.push(join(root, 'app'));
  await expect(c.startDeveloper(id)).rejects.toThrow('The project folder must be the root of its Git repository');
  expect(thread(id).phase).toBe('planning');
  expect(ws.calls.some((x) => x[0] === 'addWorktree')).toBe(false);
});

test('a leftover worktree folder that is not a repository root is not taken for a made worktree', async () => {
  const { id } = await planned();
  const wt = join(worktrees, id.slice(0, 8));
  mkdirSync(wt, { recursive: true });
  ws.notRoots.push(wt);
  await c.startDeveloper(id);
  expect(ws.calls.filter((x) => x[0] === 'addWorktree')).toHaveLength(1);
});

test('a second startDeveloper while one is in flight is rejected', async () => {
  const { id } = await planned();
  const first = c.startDeveloper(id);
  await expect(c.startDeveloper(id)).rejects.toThrow('The developer is already starting');
  await first;
  expect(thread(id).phase).toBe('build');
});

test('startDeveloper creates the worktree, commits the plan, adds missing roles and starts phase 1', async () => {
  const { id } = await planned();
  const projectDir = join(root, 'app');
  await c.startDeveloper(id);
  expect(ws.calls.find((x) => x[0] === 'addWorktree')).toEqual(['addWorktree', projectDir, join(worktrees, id.slice(0, 8)), expect.stringMatching(/^ark\//)]);
  const wt = join(worktrees, id.slice(0, 8));
  const date = new Date().toLocaleDateString('sv-SE');
  expect(readFileSync(join(wt, 'docs', 'plans', `${date}-build-a-landing-page.md`), 'utf8')).toBe(PLAN);
  expect(ws.calls).toContainEqual(['commitAll', wt, 'docs: plan for Build a landing page']);
  expect(notes(id)).toContainEqual(expect.stringMatching(
    /^Building on branch ark\/build-a-landing-page-[\w-]{8} from abcdef0\. Uncommitted changes in the project are not included\. Added to the team: Developer, Code reviewer, Security reviewer\.$/));
  expect(store.get(id)!.team).toEqual(expect.arrayContaining(['developer', 'code-reviewer', 'security-reviewer']));
  await until(() => runner.turns.at(-1)?.agent === 'developer');
  expect(runner.started.at(-1)!.id).toBe('developer');
  expect(thread(id)).toMatchObject({ phase: 'build', status: 'running', speaking: 'developer' });
  expect(thread(id).build).toMatchObject({ worktree: wt, current: 0, phases: [{ title: 'Setup', step: 'develop', base: 'abcdef0123456789' }] });
});

test('startDeveloper refuses a developer without build permissions', async () => {
  const { id } = await planned();
  const readOnly = { get: (a: string) => (a === 'developer' ? { ...catalog.get(a)!, permissions: 'read-only' as const } : catalog.get(a)), list: catalog.list };
  const c2 = new Conductor({ store, catalog: readOnly, runner, workspace: ws, worktrees, windows: () => undefined });
  await expect(c2.startDeveloper(id)).rejects.toThrow('The developer agent needs permissions: build');
  expect(thread(id).phase).toBe('planning');
});

test('a phase runs develop, checks, code review, security review, then the summary', async () => {
  const { id } = await planned();
  ws.checks = ['typecheck', 'test'];
  const from = runner.turns.length;
  runner.reply('developer', 'Built the app.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'All done: branch ready.');
  await c.startDeveloper(id);
  await idle();
  expect(agentsOf(from)).toEqual(['developer', 'code-reviewer', 'security-reviewer', 'project-manager']);
  const [dev, code, sec, pm] = runner.turns.slice(from);
  expect(dev.text).toContain('[Ark] You start phase 1/1.');
  expect(dev.text).not.toContain('[User]');
  expect(code.text).toContain('Do a code review of this phase.');
  expect(code.text).toContain('diff --git a/x b/x');
  expect(sec.text).toContain('Do a security review of this phase.');
  expect(pm.text).toContain('The build is finished.');
  expect(pm.text).toContain('- Setup: 0 review notes, commit sssssss');
  expect(pm.text).toContain('Developer (haiku): 10 in / 5 out');
  const wt = join(worktrees, id.slice(0, 8));
  expect(ws.calls).toContainEqual(['commitAll', wt, 'ark: phase 1 - Setup']);
  expect(ws.calls).toContainEqual(['runChecks', wt, ['typecheck', 'test']]);
  expect(store.messages(id).some((m) => m.kind === 'phase' && m.index === 0)).toBe(true);
  expect(notes(id)).toContain('Checks passed: typecheck, test.');
  expect(thread(id)).toMatchObject({ phase: 'done', status: 'idle' });
  expect(thread(id).build!.phases[0]).toMatchObject({ step: 'done', checks: ['typecheck', 'test'], commit: 'sssssssssss2' });
});

test('a project without checks says so', async () => {
  const { id } = await planned();
  runner.reply('developer', 'Built.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  expect(notes(id)).toContain('No checks found in package.json.');
});

test('red checks send the developer back in the same session with the failure tail', async () => {
  const { id } = await planned();
  ws.checks = ['test'];
  ws.results.push([{ script: 'test', ok: false, tail: '1 failed: expected 2' }]);
  runner.reply('developer', 'v1', 'v2');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  const dev = devTurns();
  expect(dev).toHaveLength(2);
  expect(dev[1].chatId).toBe(dev[0].chatId);
  expect(dev[1].text).toContain('These checks failed');
  expect(dev[1].text).toContain('1 failed: expected 2');
  expect(notes(id)).toContain('Checks failed: test.');
  expect(thread(id).phase).toBe('done');
});

test('review findings reach the developer after both reviews, in its next turn', async () => {
  const { id } = await planned();
  const from = runner.turns.length;
  runner.reply('developer', 'v1', 'v2');
  runner.reply('code-reviewer', CHANGES('Rename x to count'), PASS);
  runner.reply('security-reviewer', CHANGES('Escape the input'), PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  expect(agentsOf(from)).toEqual(['developer', 'code-reviewer', 'security-reviewer', 'developer', 'code-reviewer', 'security-reviewer', 'project-manager']);
  const dev = devTurns();
  expect(dev[1].chatId).toBe(dev[0].chatId);
  expect(dev[1].text).toContain('Rename x to count');
  expect(dev[1].text).toContain('Escape the input');
  expect(dev[1].text).toContain('The reviewers asked for changes');
  expect(thread(id).build!.phases[0]).toMatchObject({ notes: 2, rounds: 1, step: 'done' });
});

/** A one-phase build whose code reviewer never agrees: blocked after two rounds, the manager asked the user. */
async function blocked() {
  const t = await planned();
  runner.reply('developer', 'v1', 'v2', 'v3');
  runner.reply('code-reviewer', CHANGES('Add tests'), CHANGES('Add more tests'), CHANGES('Still no tests'));
  runner.reply('security-reviewer', PASS, PASS, PASS);
  runner.reply('project-manager', ark({ ask: 'The tests are still open. Skip them?' }));
  await c.startDeveloper(t.id);
  await idle();
  return t;
}

test('two rounds without agreement give the manager a blocked note and the thread waits', async () => {
  const { id } = await blocked();
  expect(devTurns()).toHaveLength(3);
  const pm = runner.turns.at(-1)!;
  expect(pm.agent).toBe('project-manager');
  expect(pm.text).toContain('Phase "Setup" is blocked after 2 rounds.');
  expect(pm.text).toContain('- Still no tests');
  expect(thread(id)).toMatchObject({ status: 'waiting', waitingOn: 'project-manager', phase: 'build' });
  expect(thread(id).build!.phases[0].step).toBe('blocked');
});

test('the user reply unblocks the phase', async () => {
  const { id } = await blocked();
  const dev0 = devTurns()[0].chatId;
  runner.reply('developer', 'Skipped the tests.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  c.send(id, 'Yes, skip them');
  await idle();
  const dev = devTurns().at(-1)!;
  expect(dev.chatId).toBe(dev0);
  expect(dev.text).toContain('[User] Yes, skip them');
  expect(dev.text).toContain('The user replied (above). Continue the phase.');
  expect(thread(id)).toMatchObject({ phase: 'done', status: 'idle' });
});

test('red checks after two rounds block on the failed scripts', async () => {
  const { id } = await planned();
  ws.checks = ['lint', 'test'];
  const red = [{ script: 'lint', ok: true, tail: '' }, { script: 'test', ok: false, tail: 'boom' }];
  ws.results.push(red, red, red);
  runner.reply('developer', 'v1', 'v2', 'v3');
  runner.reply('project-manager', ark({ ask: 'Tests keep failing. How to continue?' }));
  await c.startDeveloper(id);
  await idle();
  expect(runner.turns.at(-1)!.text).toMatch(/blocked after 2 rounds\. Open points:\n- test\n/);
  expect(thread(id)).toMatchObject({ status: 'waiting', waitingOn: 'project-manager' });
});

test('reviewer sessions are stopped after their reply; the developer session at phase end', async () => {
  const { id } = await planned(PLAN2);
  runner.reply('developer', 'phase 1', 'phase 2');
  runner.reply('code-reviewer', PASS, PASS);
  runner.reply('security-reviewer', PASS, PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  const reviews = runner.turns.filter((x) => x.agent.endsWith('-reviewer')).map((x) => x.chatId);
  expect(new Set(reviews).size).toBe(4);
  expect(runner.stopped).toEqual(expect.arrayContaining(reviews));
  const dev = devTurns();
  expect(dev[1].chatId).not.toBe(dev[0].chatId);
  expect(dev[1].text).toContain('You start phase 2/2.');
  expect(dev[1].text).toContain('Earlier phases:\n- Setup');
  expect(runner.stopped).toEqual(expect.arrayContaining([dev[0].chatId, dev[1].chatId]));
  expect(thread(id).phase).toBe('done');
});

test('only the developer starts with build permissions; reviewers in the worktree and the manager in the project read-only', async () => {
  const { id } = await planned();
  runner.reply('developer', 'Built.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  const wt = join(worktrees, id.slice(0, 8));
  const byId = (a: string) => runner.starts.filter((s) => s.id === a);
  expect(byId('developer')).toEqual([{ id: 'developer', dir: wt, permissions: 'build' }]);
  expect(byId('code-reviewer')).toEqual([{ id: 'code-reviewer', dir: wt, permissions: 'read-only' }]);
  expect(byId('security-reviewer')).toEqual([{ id: 'security-reviewer', dir: wt, permissions: 'read-only' }]);
  expect(byId('project-manager').every((s) => s.dir === join(root, 'app') && s.permissions === 'read-only')).toBe(true);
  expect(byId('planner')).toEqual([{ id: 'planner', dir: join(root, 'app'), permissions: 'read-only' }]);
  expect(runner.started.find((a) => a.id === 'developer')!.prompt).toContain('You are the developer.');
});

/** A build whose developer turn is pending; returns the thread id and the developer's chat. */
async function developing() {
  const { id } = await planned();
  await c.startDeveloper(id);
  await until(() => devTurns().length === 1);
  return { id, devChat: devTurns()[0].chatId };
}

test('an approval event adds a card and answer reaches the runner', async () => {
  const { id, devChat } = await developing();
  runner.emit(devChat, { type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci' });
  const card = store.messages(id).findLast((m) => m.kind === 'approval')!;
  expect(card).toMatchObject({ kind: 'approval', agent: 'developer', tool: 'Bash', detail: 'npm ci' });
  expect(store.get(id)!.approvals).toEqual([card.seq]);
  c.answer(id, card.seq, true);
  expect(runner.answers).toEqual([[devChat, 'r1', true]]);
  expect(store.get(id)!.approvals).toEqual([]);
  expect(last(id)).toMatchObject({ kind: 'decision', target: card.seq, allow: true });
  expect(() => c.answer(id, card.seq, true)).toThrow('This request is no longer pending');
});

test('an approval from a chat no thread owns is ignored', async () => {
  const { id } = await developing();
  const before = store.messages(id).length;
  runner.emit('nobody', { type: 'approval', id: 'r1', tool: 'Bash', detail: 'rm -rf /' });
  expect(store.messages(id)).toHaveLength(before);
});

test('answering after the turn ended throws "This request is no longer pending"', async () => {
  const { id, devChat } = await developing();
  runner.emit(devChat, { type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci' });
  const card = store.messages(id).findLast((m) => m.kind === 'approval')!;
  runner.reply('developer', 'Done.');
  await until(() => runner.turns.at(-1)?.agent === 'code-reviewer');
  expect(store.get(id)!.approvals).toEqual([]);
  expect(() => c.answer(id, card.seq, true)).toThrow('This request is no longer pending');
  expect(runner.answers).toEqual([]);
});

test('pause drops pending approvals', async () => {
  const { id, devChat } = await developing();
  runner.emit(devChat, { type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci' });
  const card = store.messages(id).findLast((m) => m.kind === 'approval')!;
  c.pause(id);
  expect(thread(id)).toMatchObject({ status: 'idle', approvals: [] });
  expect(runner.stopped).toContain(devChat);
  expect(() => c.answer(id, card.seq, false)).toThrow('This request is no longer pending');
});

test('a message during a running build turn does not redirect the turn', async () => {
  const { id, devChat } = await developing();
  ws.checks = ['test'];
  ws.results.push([{ script: 'test', ok: false, tail: 'red' }]);
  c.send(id, 'Use tabs, please');
  for (let i = 0; i < 5; i++) await tick();
  expect(runner.stopped).not.toContain(devChat);
  expect(thread(id)).toMatchObject({ status: 'running', speaking: 'developer' });
  expect(devTurns()).toHaveLength(1);
  runner.reply('developer', 'v1', 'v2');
  await until(() => devTurns().length === 2);
  expect(devTurns()[1].chatId).toBe(devChat);
  expect(devTurns()[1].text).toContain('[User] Use tabs, please');
});

test('the developer stopping marks the thread in error; a message resumes the phase in a fresh session', async () => {
  const { id, devChat } = await developing();
  runner.reply('developer', new Error('timed out'));
  await idle();
  expect(last(id)).toMatchObject({ kind: 'note', text: 'Developer stopped: timed out' });
  expect(thread(id).status).toBe('error');
  expect(runner.stopped).toContain(devChat);
  runner.reply('developer', 'Back on it.');
  c.send(id, 'Try again');
  await until(() => devTurns().length === 2);
  const retry = devTurns()[1];
  expect(retry.chatId).not.toBe(devChat);
  expect(retry.text).toContain('You start phase 1/1.');
  expect(retry.text).toContain('[User] Try again');
  expect(retry.text).toContain('The user replied (above).');
});

test('a start that failed after the worktree was made resumes in it on the next try', async () => {
  const { id } = await planned();
  ws.commitError = new Error('Please tell me who you are');
  await expect(c.startDeveloper(id)).rejects.toThrow('Please tell me who you are');
  expect(thread(id).phase).toBe('planning');
  await c.startDeveloper(id);
  expect(thread(id).phase).toBe('build');
  expect(ws.calls.filter((x) => x[0] === 'addWorktree')).toHaveLength(1);
  expect(ws.calls.filter((x) => x[0] === 'commitAll')).toHaveLength(2);
});

test('a git failure after a developer turn is noted as the build, not the developer, and keeps its session', async () => {
  const { id, devChat } = await developing();
  ws.commitError = new Error('pre-commit hook failed');
  runner.reply('developer', 'Done.');
  await idle();
  expect(last(id)).toMatchObject({ kind: 'note', text: 'The build stopped: pre-commit hook failed' });
  expect(thread(id).status).toBe('error');
  expect(runner.stopped).not.toContain(devChat);
});

/** Writes the project's Claude settings into the thread's worktree, as a project or a developer would. */
const claudeSettings = (id: string, o: object) => {
  const dir = join(worktrees, id.slice(0, 8), '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(o));
  return join(dir, 'settings.json');
};

test('startDeveloper refuses a worktree whose Claude settings skip the card, once, and starts no session', async () => {
  const { id } = await planned();
  const file = claudeSettings(id, { permissions: { allow: ['Bash(*)'] } });
  const started = runner.started.length;
  const notesBefore = notes(id).length;
  await expect(c.startDeveloper(id)).rejects.toThrow(file); // the error is what the user sees: no second copy as a note
  expect(notes(id)).toHaveLength(notesBefore);
  expect(thread(id).phase).toBe('planning');
  expect(runner.started).toHaveLength(started);
  expect(ws.calls.some((x) => x[0] === 'commitAll')).toBe(false);
});

test('a new developer session is refused while the worktree settings add hooks; the build resumes once they are gone', async () => {
  const { id } = await planned(PLAN2);
  runner.reply('code-reviewer', PASS, PASS);
  runner.reply('project-manager', 'Done.');
  runner.reply('developer', 'phase 1');
  await c.startDeveloper(id);
  await until(() => runner.turns.at(-1)?.agent === 'security-reviewer'); // the review's settings check has passed
  const file = claudeSettings(id, { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo ok' }] }] } }); // written while it ran
  runner.reply('security-reviewer', PASS, PASS);
  await idle();
  expect(notes(id).at(-1)).toBe(`The build stopped: ${file} sets hooks, which would act without an approval card. Remove them on the build branch, then try again.`);
  expect(thread(id)).toMatchObject({ status: 'error', build: { current: 1 } });
  expect(thread(id).build!.phases[1].base).toBe('abcdef0123456789'); // a resume has the phase's diff base
  expect(devTurns()).toHaveLength(1);
  expect(runner.started.filter((a) => a.id === 'developer')).toHaveLength(1);
  rmSync(file);
  runner.reply('developer', 'phase 2');
  c.send(id, 'Removed the hook');
  await idle();
  expect(devTurns()[1].text).toContain('You start phase 2/2.');
  expect(thread(id).phase).toBe('done');
});

test('a review is refused while the worktree settings hold a hook, so the last phase is checked too', async () => {
  const { id } = await developing();
  const file = claudeSettings(id, { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo ok' }] }] } }); // the developer wrote it in this phase
  runner.reply('developer', 'v1');
  await idle();
  expect(notes(id).at(-1)).toBe(`The build stopped: ${file} sets hooks, which would act without an approval card. Remove them on the build branch, then try again.`);
  expect(thread(id).status).toBe('error');
  expect(runner.started.some((a) => a.id === 'code-reviewer')).toBe(false);
  rmSync(file);
  runner.reply('developer', 'Removed the hook.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  c.send(id, 'Removed the hook');
  await idle();
  expect(thread(id).phase).toBe('done');
});

test('a message to a finished build gets a note and reaches nobody', async () => {
  const { id } = await planned();
  runner.reply('developer', 'Built.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  const turnsBefore = runner.turns.length;
  c.send(id, 'One more thing');
  await idle();
  expect(notes(id).at(-1)).toBe('The build is finished; start a new thread to continue.');
  expect(runner.turns).toHaveLength(turnsBefore);
  expect(thread(id)).toMatchObject({ phase: 'done', status: 'idle' });
});

test('a message during the summary turn gets the same note', async () => {
  const { id } = await planned();
  runner.reply('developer', 'Built.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  await c.startDeveloper(id);
  await until(() => runner.turns.at(-1)?.agent === 'project-manager');
  c.send(id, 'Too late');
  expect(notes(id).at(-1)).toBe('The build is finished; start a new thread to continue.');
  runner.reply('project-manager', 'Done.');
  await idle();
  expect(thread(id).phase).toBe('done');
});

// A user message written during the build always reaches the developer (spec §8.2): never only the transcript.
const userTurn = (text: string, msg: string) => {
  expect(text).toContain(`[User] ${msg}`);
  expect(text).toContain('The user replied (above). Continue the phase.');
};

test('pause during review then resume: the developer reads the message, then checks and both reviews run again', async () => {
  const { id, devChat } = await developing();
  const from = runner.turns.length - 1;
  runner.reply('developer', 'v1');
  await until(() => runner.turns.at(-1)?.agent === 'code-reviewer');
  c.pause(id);
  expect(thread(id).status).toBe('idle');
  runner.reply('developer', 'Switched to X.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  c.send(id, 'Use X instead');
  await idle();
  expect(agentsOf(from)).toEqual(['developer', 'code-reviewer', 'developer', 'code-reviewer', 'security-reviewer', 'project-manager']);
  expect(devTurns()[1].chatId).toBe(devChat);
  userTurn(devTurns()[1].text, 'Use X instead');
  expect(ws.calls.filter((x) => x[0] === 'runChecks')).toHaveLength(2);
  expect(thread(id)).toMatchObject({ phase: 'done', build: { phases: [{ rounds: 0, step: 'done' }] } });
});

test('a message during a review that passes reaches the developer before the phase ends', async () => {
  const { id, devChat } = await developing();
  const from = runner.turns.length - 1;
  runner.reply('developer', 'v1');
  await until(() => runner.turns.at(-1)?.agent === 'code-reviewer');
  c.send(id, 'Also add a footer');
  runner.reply('developer', 'Added the footer.');
  runner.reply('code-reviewer', PASS, PASS);
  runner.reply('security-reviewer', PASS, PASS);
  runner.reply('project-manager', 'Done.');
  await idle();
  expect(agentsOf(from)).toEqual(['developer', 'code-reviewer', 'security-reviewer', 'developer', 'code-reviewer', 'security-reviewer', 'project-manager']);
  expect(devTurns()[1].chatId).toBe(devChat);
  userTurn(devTurns()[1].text, 'Also add a footer');
  expect(thread(id)).toMatchObject({ phase: 'done', build: { phases: [{ rounds: 0, step: 'done' }] } });
});

test('a message during a developer turn whose checks and reviews pass still reaches the developer', async () => {
  const { id } = await developing();
  c.send(id, 'Keep it short');
  runner.reply('developer', 'v1', 'Shortened.');
  runner.reply('code-reviewer', PASS, PASS);
  runner.reply('security-reviewer', PASS, PASS);
  runner.reply('project-manager', 'Done.');
  await idle();
  expect(devTurns()).toHaveLength(2);
  userTurn(devTurns()[1].text, 'Keep it short');
  expect(thread(id).phase).toBe('done');
});

test('a message sent during Start developer reaches the first developer turn, without the planning transcript', async () => {
  const { id } = await planned();
  runner.reply('developer', 'Built.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  const start = c.startDeveloper(id);
  c.send(id, 'Use pnpm, not npm');
  await start;
  await idle();
  expect(devTurns()).toHaveLength(1);
  userTurn(devTurns()[0].text, 'Use pnpm, not npm');
  expect(devTurns()[0].text).toContain('You start phase 1/1.');
  expect(devTurns()[0].text).not.toContain('[User] Build a landing page');
  expect(thread(id).phase).toBe('done');
});

test('a turn records how the windows moved', async () => {
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  const at = (usedPct: number) => ({ fiveHour: { usedPct, resetsAt, minutes: 300 } });
  windows = () => at(41);
  runner.reply('project-manager', TEAM);
  const origTurn = runner.turn;
  runner.turn = (...a: Parameters<typeof origTurn>) => {
    const p = origTurn(...a);
    windows = () => at(44); // the usage moves while the turn runs
    return p;
  };
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  expect(thread(t.id).windows?.claude?.fiveHour).toEqual({ from: 41, to: 44, resetsAt });
});

test('a rerouted session leaves a note before the reply', async () => {
  runner.reports = { engine: 'codex', rerouted: true };
  runner.reply('project-manager', TEAM);
  const t = c.create(projectId, 'Build a landing page');
  await idle();
  const msgs = store.messages(t.id);
  const i = msgs.findIndex((m) => m.kind === 'note' && m.text === NOTES.rerouted('Project manager'));
  expect(i).toBeGreaterThan(-1);
  expect(msgs[i + 1].kind).toBe('agent');
});

/** Windows at `pct` (live), and a planner that is `planner` with `patch` applied, for the routing tests. */
const hot = (pct: number) => ({ fiveHour: { usedPct: pct, resetsAt: Math.floor(Date.now() / 1000) + 3600, minutes: 300 } });
function withPlanner(patch: Partial<AgentDef>) {
  c.stopAll();
  const cat = { ...catalog, get: (id: string) => (id === 'planner' ? { ...SEED_AGENTS.find((a) => a.id === 'planner')!, ...patch } : catalog.get(id)) };
  c = new Conductor({ store, catalog: cat, runner, workspace: ws, worktrees, windows: () => windows() });
}
const plannerStarts = () => runner.started.filter((a) => a.id === 'planner').length;
const plannerChats = () => runner.turns.filter((x) => x.agent === 'planner').map((x) => x.chatId);
const twoPlannerTurns = () => {
  runner.reply('project-manager', ark({ next: 'planner' }), ark({ next: 'planner' }), ark({ ask: 'Done?' }));
  runner.reply('planner', 'one', 'two');
};

test('a live Claude session of an auto agent moves to Codex once Claude is at 90%', async () => {
  await planning();
  const orig = runner.turn;
  runner.turn = (...a: Parameters<typeof orig>) => {
    const p = orig(...a);
    if (runner.turns.at(-1)!.agent === 'planner') windows = () => hot(95); // Claude fills up while the planner is live
    return p;
  };
  twoPlannerTurns();
  await idle();
  expect(plannerStarts()).toBe(2);
  expect(runner.stopped).toContain(plannerChats()[0]);
});

test('a rerouted session goes back once Claude is under 90%', async () => {
  await planning();
  let pct = 95;
  windows = () => hot(pct);
  runner.reports = { engine: 'codex', rerouted: true };
  const orig = runner.turn;
  runner.turn = (...a: Parameters<typeof orig>) => {
    const p = orig(...a);
    if (runner.turns.at(-1)!.agent === 'planner') {
      pct = 40;
      runner.reports = { engine: 'claude', rerouted: false };
    }
    return p;
  };
  twoPlannerTurns();
  await idle();
  expect(plannerStarts()).toBe(2);
  expect(runner.stopped).toContain(plannerChats()[0]);
});

test.each([
  ['model-pinned', { engine: { kind: 'model', engine: 'claude', model: 'opus' } } as Partial<AgentDef>],
  ['heavy', { tier: 'heavy' } as Partial<AgentDef>],
])('a %s agent keeps its session at 90%%', async (_n, patch) => {
  withPlanner(patch);
  await planning();
  windows = () => hot(95);
  twoPlannerTurns();
  await idle();
  expect(plannerStarts()).toBe(1);
});

test.each([
  ['heavy', { tier: 'heavy' } as Partial<AgentDef>],
  ['model-pinned', { engine: { kind: 'model', engine: 'claude', model: 'opus' } } as Partial<AgentDef>],
])('a hard turn on a %s agent keeps its session', async (_n, patch) => {
  withPlanner(patch);
  await planning();
  runner.reply('project-manager', ark({ next: 'planner' }), ark({ next: 'planner', hard: true }), ark({ ask: 'Done?' }));
  runner.reply('planner', 'one', 'two');
  await idle();
  expect(plannerStarts()).toBe(1);
});

test('a live build session is not restarted by the 90% switch', async () => {
  const { id } = await planned();
  c.stopAll();
  const dev = { ...SEED_AGENTS.find((a) => a.id === 'developer')!, engine: { kind: 'auto' as const }, tier: 'standard' as const };
  c = new Conductor({ store, catalog: { ...catalog, get: (a: string) => (a === 'developer' ? dev : catalog.get(a)) }, runner, workspace: ws, worktrees, windows: () => windows() });
  ws.checks = ['test'];
  ws.results.push([{ script: 'test', ok: false, tail: '1 failed' }]);
  windows = () => hot(95);
  runner.reply('developer', 'v1', 'v2');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  expect(runner.started.filter((a) => a.id === 'developer')).toHaveLength(1);
});

test('an auto agent that cannot move to Codex keeps its session', async () => {
  await planning();
  windows = () => hot(95); // startAgent reports engine claude, not rerouted
  twoPlannerTurns();
  await idle();
  expect(plannerStarts()).toBe(1);
});

test('worktreeRemoved marks the build and emits', async () => {
  const { id } = await planned();
  runner.reply('developer', 'Built.');
  runner.reply('code-reviewer', PASS);
  runner.reply('security-reviewer', PASS);
  runner.reply('project-manager', 'Done.');
  await c.startDeveloper(id);
  await idle();
  expect(thread(id).phase).toBe('done');
  expect(thread(id).build?.removed).toBeUndefined();
  const updates: Thread[] = [];
  c.onUpdate((u) => updates.push(u.thread));
  c.worktreeRemoved(id);
  expect(thread(id).build?.removed).toBe(true);
  expect(thread(id).build?.worktree).toBeTruthy(); // the path stays: the thread still names where it was
  expect(updates).toHaveLength(1);
  expect(updates[0].build?.removed).toBe(true);
});

test('worktreeRemoved does nothing for a thread without a build', async () => {
  const t = await planning();
  const updates: Thread[] = [];
  c.onUpdate((u) => updates.push(u.thread));
  c.worktreeRemoved(t.id);
  expect(thread(t.id).build).toBeUndefined();
  expect(updates).toHaveLength(0);
});

test('task CRUD persists and emits without starting or changing the thread', () => {
  const t = store.create(projectId, 'Board');
  store.save({ ...t, team: ['project-manager', 'planner'] });
  const updates: Thread[] = [];
  c.onUpdate((u) => updates.push(u.thread));
  c.saveTask(t.id, null, { title: '  Draft plan  ', status: 'todo', agent: 'planner' });
  const task = thread(t.id).tasks![0];
  expect(task).toMatchObject({ title: 'Draft plan', status: 'todo', agent: 'planner' });
  expect(new ThreadStore(join(root, 'data')).get(t.id)!.tasks).toEqual([task]);
  c.saveTask(t.id, task.id, { title: 'Updated plan', status: 'done' });
  expect(thread(t.id).tasks).toEqual([{ id: task.id, title: 'Updated plan', status: 'done' }]);
  c.removeTask(t.id, task.id);
  expect(thread(t.id).tasks).toEqual([]);
  expect(updates.map((u) => u.tasks?.length)).toEqual([1, 1, 0]);
  expect(thread(t.id).status).toBe('idle');
  expect(runner.started).toHaveLength(0);
  expect(store.messages(t.id)).toEqual([]);
});

test('task mutations refuse bad input, agents outside the team, unknown tasks and excess cards', () => {
  const t = store.create(projectId, 'Board');
  expect(() => c.saveTask(t.id, null, { title: 'x', status: 'todo', agent: 'planner' })).toThrow('team');
  expect(() => c.saveTask(t.id, null, { title: 'x', status: 'todo', agent: 'missing' })).toThrow('team');
  expect(() => c.saveTask(t.id, null, { title: '', status: 'todo' })).toThrow('title');
  expect(() => c.saveTask(t.id, 'missing', { title: 'x', status: 'todo' })).toThrow('Unknown task');
  expect(() => c.removeTask(t.id, 'missing')).toThrow('Unknown task');
  store.save({ ...t, tasks: Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, title: 'x', status: 'todo' })) });
  expect(() => c.saveTask(t.id, null, { title: 'x', status: 'todo' })).toThrow('100 tasks');
  c.saveTask(t.id, '0', { title: 'still editable', status: 'doing' });
  expect(thread(t.id).tasks).toHaveLength(100);
});

test('task edits during a running turn survive its saves and reach the next live turn', async () => {
  const t = await planning();
  await turns(2); // manager is working on the approved team
  c.saveTask(t.id, null, { title: 'Review layout', status: 'doing', agent: 'planner' });
  const task = thread(t.id).tasks![0];
  runner.reply('project-manager', ark({ next: 'planner' }));
  await turns(3);
  expect(thread(t.id).tasks).toEqual([task]);
  expect(runner.turns[2].text).toContain('"Review layout" | In progress | Planner (@planner)');
  c.removeTask(t.id, task.id);
  runner.reply('planner', 'Reviewed.');
  await turns(4);
  expect(thread(t.id).tasks).toEqual([]);
  expect(runner.turns[3].text).not.toContain('Review layout');
  expect(runner.turns[3].text).toContain('Current task board: no tasks');
});

test('fresh build sessions receive the current task board even when the transcript is skipped', async () => {
  const { id } = await planned();
  c.saveTask(id, null, { title: 'Follow the plan', status: 'todo' });
  await c.startDeveloper(id);
  await turns(4);
  expect(runner.turns.find((x) => x.agent === 'developer')?.text).toContain('"Follow the plan" | To do | Unassigned');
});

test('task edits and pending approvals survive each other during a developer turn', async () => {
  const { id, devChat } = await developing();
  runner.emit(devChat, { type: 'approval', id: 'r1', tool: 'Bash', detail: 'npm ci' });
  const card = store.messages(id).findLast((m) => m.kind === 'approval')!;
  c.saveTask(id, null, { title: 'Check layout', status: 'todo', agent: 'developer' });
  const task = thread(id).tasks![0];
  expect(thread(id)).toMatchObject({ status: 'running', speaking: 'developer', approvals: [card.seq] });
  c.answer(id, card.seq, true);
  expect(thread(id).tasks).toEqual([task]);
  expect(runner.answers).toEqual([[devChat, 'r1', true]]);

  runner.emit(devChat, { type: 'approval', id: 'r2', tool: 'Bash', detail: 'npm test' });
  const next = store.messages(id).findLast((m) => m.kind === 'approval')!;
  c.saveTask(id, task.id, { title: 'Check layout', status: 'doing', agent: 'developer' });
  c.removeTask(id, task.id);
  expect(thread(id).approvals).toEqual([next.seq]);
  expect(runner.stopped).not.toContain(devChat);
  runner.reply('developer', 'Built.');
  await until(() => runner.turns.at(-1)?.agent === 'code-reviewer');
  expect(thread(id)).toMatchObject({ tasks: [], approvals: [] });
  expect(runner.turns.at(-1)?.text).toContain('Current task board: no tasks');
});
