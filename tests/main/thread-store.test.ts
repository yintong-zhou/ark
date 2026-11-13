import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { NewMessage } from '@shared/thread';
import { ThreadStore } from '../../src/main/services/threads/store';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ark-threads-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const dir = (name: string, git = false) => {
  const d = join(root, name);
  mkdirSync(join(d, git ? '.git' : '.'), { recursive: true });
  return d;
};
const note = (text: string): NewMessage => ({ kind: 'note', text });

test('addProject dedupes by folder and detects git', () => {
  const s = new ThreadStore(root);
  const p = s.addProject(dir('app', true));
  expect(p).toMatchObject({ name: 'app', git: true });
  expect(s.addProject(dir('app', true)).id).toBe(p.id);
  expect(s.addProject(dir('plain')).git).toBe(false);
  expect(s.projects()).toHaveLength(2);
  expect(new ThreadStore(root).projects()).toHaveLength(2); // persisted
  mkdirSync(join(dir('plain'), '.git'));
  expect(s.setGit(s.projects()[1].id).git).toBe(true);
});

test('create rejects an unknown project', () => {
  expect(() => new ThreadStore(root).create('nope', 't')).toThrow('Unknown project');
});

test('removing a project preserves its threads and folder and restores them on reimport', () => {
  const s = new ThreadStore(root);
  const project = s.addProject(dir('app'));
  const thread = s.create(project.id, 'T');
  s.removeProject(project.id);
  expect(s.projects()).toEqual([]);
  expect(() => s.removeProject(project.id)).toThrow('Unknown project');
  expect(existsSync(project.dir)).toBe(true);
  expect(s.get(thread.id)?.projectId).toBe(project.id);
  const other = s.addProject(dir('other'));
  s.setGit(other.id);
  expect(new ThreadStore(root).projects().map((p) => p.id)).toEqual([other.id]);
  expect(s.addProject(project.dir).id).toBe(project.id);
  expect(s.projects()).toHaveLength(2);
});

test('removing a project with a running thread is refused', () => {
  const s = new ThreadStore(root);
  const project = s.addProject(dir('app'));
  const thread = s.create(project.id, 'T');
  s.save({ ...thread, status: 'running' });
  expect(() => s.removeProject(project.id)).toThrow('Pause');
  expect(s.projects()).toHaveLength(1);
});

test('append numbers messages from 1 and survives a new store instance', () => {
  const s = new ThreadStore(root);
  const t = s.create(s.addProject(dir('app')).id, 'T');
  expect(t).toMatchObject({ phase: 'team', status: 'idle', agentTurns: 0, team: [], cursors: {} });
  expect(s.append(t.id, note('a')).seq).toBe(1);
  expect(s.append(t.id, note('b')).seq).toBe(2);
  expect(new ThreadStore(root).append(t.id, note('c')).seq).toBe(3);
  expect(s.messages(t.id).map((m) => m.seq)).toEqual([1, 2, 3]);
  expect(() => s.messages('../x')).toThrow('Unknown thread');
});

test('messages skips a corrupt line', () => {
  const s = new ThreadStore(root);
  const t = s.create(s.addProject(dir('app')).id, 'T');
  s.append(t.id, note('a'));
  appendFileSync(join(root, 'threads', t.id, 'messages.jsonl'), 'garbage{\nnull\n7\n"x"\n');
  s.append(t.id, note('b'));
  expect(s.messages(t.id).map((m) => m.kind === 'note' && m.text)).toEqual(['a', 'b']);
});

test('recover turns running into idle, clears speaking and cursors, and adds the note', () => {
  const s = new ThreadStore(root);
  const t = s.create(s.addProject(dir('app')).id, 'T');
  s.save({ ...t, status: 'running', speaking: 'planner', cursors: { planner: 3 } });
  const idle = s.create(t.projectId, 'idle');
  s.recover();
  const r = new ThreadStore(root).get(t.id)!;
  expect(r.status).toBe('idle');
  expect(r.speaking).toBeUndefined();
  expect(r.cursors).toEqual({});
  expect(s.messages(t.id).at(-1)).toMatchObject({ kind: 'note', text: 'Ark was closed during a turn. Send a message to continue.' });
  expect(s.messages(idle.id)).toEqual([]);
});

test('recover clears pending approvals', () => {
  const s = new ThreadStore(root);
  const t = s.create(s.addProject(dir('app')).id, 'T');
  s.save({ ...t, status: 'running', approvals: [4, 5] });
  s.recover();
  expect(new ThreadStore(root).get(t.id)!.approvals).toBeUndefined();
});

test('threads are listed newest first', () => {
  const s = new ThreadStore(root);
  const p = s.addProject(dir('app'));
  const a = s.create(p.id, 'a');
  const b = s.create(p.id, 'b');
  s.save({ ...a, createdAt: 1000 });
  s.save({ ...b, createdAt: 2000 });
  expect(s.threads().map((t) => t.title)).toEqual(['b', 'a']);
});

test('writePlan writes plan.md and returns its path', () => {
  const s = new ThreadStore(root);
  const t = s.create(s.addProject(dir('app')).id, 'T');
  expect(s.writePlan(t.id, '# plan')).toBe(join(root, 'threads', t.id, 'plan.md'));
});

test('append after a torn last line keeps the new message and the right seq', () => {
  const s = new ThreadStore(root);
  const t = s.create(s.addProject(dir('app')).id, 'T');
  writeFileSync(join(root, 'threads', t.id, 'messages.jsonl'), '{"seq":1,"kind":"note","text":"a","at":1}\n{"seq":2,"ki');
  expect(s.append(t.id, note('b')).seq).toBe(2);
  expect(s.messages(t.id).map((m) => m.kind === 'note' && m.text)).toEqual(['a', 'b']);
});

test('recover keeps going when one thread is broken', () => {
  const s = new ThreadStore(root);
  const p = s.addProject(dir('app'));
  const bad = s.create(p.id, 'bad');
  const good = s.create(p.id, 'good');
  s.save({ ...bad, status: 'running' });
  s.save({ ...good, status: 'running' });
  mkdirSync(join(root, 'threads', bad.id, 'messages.jsonl')); // reading it as a file fails
  expect(() => s.recover()).not.toThrow();
  expect(s.get(good.id)!.status).toBe('idle');
  expect(s.get(bad.id)!.status).toBe('running');
});

test('saveFile keeps an upload under the thread and readFile refuses anything else', () => {
  const s = new ThreadStore(root);
  const t = s.create(s.addProject(dir('app')).id, 'T');
  const a = s.saveFile(t.id, { name: 'My shot (1).png', bytes: new Uint8Array([1, 2, 3]) });
  expect(a).toMatchObject({ name: 'My shot (1).png', kind: 'image', mime: 'image/png', size: 3 });
  expect(a.file).toMatch(/^[0-9a-f]{8}-My_shot_1_\.png$/);
  expect([...s.readFile(t.id, a.file)]).toEqual([1, 2, 3]);
  for (const bad of ['../thread.json', 'thread.json', '12345678-../x', 'a/b']) expect(() => s.readFile(t.id, bad)).toThrow('Unknown attachment');
  expect(() => s.saveFile(t.id, { name: 'x.exe', bytes: new Uint8Array(1) })).toThrow("isn't supported");
});

test('an old mid-build thread gets one note and is saved upgraded', () => {
  const store = new ThreadStore(root);
  const projectId = store.addProject(dir('app')).id;
  const t = store.create(projectId, 'T');
  store.save({ ...t, phase: 'build', status: 'idle', team: ['project-manager', 'developer'], build: { worktree: 'w', branch: 'b', plan: 'p', phases: [], current: 0 } });
  store.recover();
  store.recover();
  expect(store.messages(t.id).filter((m) => m.kind === 'note')).toHaveLength(1);
  expect(store.get(t.id)).toMatchObject({ team: ['head-of-staff', 'developer'], roles: { builders: [] } });
});

test('a finished thread interrupted during a follow-up keeps the message, its build history and its phase', () => {
  const store = new ThreadStore(root);
  const t = store.create(store.addProject(dir('app')).id, 'T');
  const phase = { title: 'A', text: 'a', step: 'done' as const, rounds: 0, notes: 0, open: 0 };
  const build = { worktree: 'w', branch: 'b', plan: 'p2', phases: [phase], current: 0, cycle: 2, previous: [{ plan: 'p1', phases: [phase] }] };
  store.save({ ...t, phase: 'done', status: 'running', speaking: 'head-of-staff', team: ['head-of-staff'], roles: { builders: [] }, build });
  store.append(t.id, { kind: 'phase', index: 0, cycle: 2 });
  const asked = store.append(t.id, { kind: 'user', text: 'Also a footer?' });
  store.recover();
  const again = new ThreadStore(root);
  expect(again.get(t.id)).toMatchObject({ phase: 'done', status: 'idle', build });
  expect(again.messages(t.id)).toContainEqual(asked);
  expect(again.messages(t.id)).toContainEqual(expect.objectContaining({ kind: 'phase', index: 0, cycle: 2 }));
});

test('a legacy finished thread is upgraded without a note and stays finished', () => {
  const store = new ThreadStore(root);
  const t = store.create(store.addProject(dir('app')).id, 'T');
  store.save({ ...t, phase: 'done', status: 'idle', team: ['project-manager', 'developer'], cursors: { 'project-manager': 4 }, build: { worktree: 'w', branch: 'b', plan: 'p', phases: [], current: 0, removed: true } });
  store.recover();
  expect(store.messages(t.id)).toEqual([]);
  expect(store.get(t.id)).toMatchObject({ phase: 'done', team: ['head-of-staff', 'developer'], cursors: { 'head-of-staff': 4 }, build: { removed: true } });
});
