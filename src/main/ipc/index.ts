import { mkdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { DRAFTER, extractAgentFile } from '@shared/agent-draft';
import { checkUploads, kindOf, type Upload } from '@shared/attachments';
import { cleanBounds } from '@shared/browser';
import { AGENT_ID_RE, agentId as slug, parseAgentFile, splitFrontmatter, validateAgent } from '@shared/agent-file';
import { rootKey, UUID_RE } from '@shared/files';
import type { ShellOption } from '@shared/terminal';
import type { Reaction } from '@shared/thread';
import type { SkillInfo } from '@shared/types';
import type { AgentRunner } from '../services/agent-runner';
import { importAgent, importableAgents, type Catalog } from '../services/catalog';
import { engineStatus, mergeEngines, readEngines, validateEngines, writeEngines } from '../services/engines/config';
import { BrowserViews } from '../services/browser/views';
import { run } from '../services/exec';
import { normEntry, normRel, normRels, resolveInside, rootDir, rootRef } from '../services/files/guard';
import { createEntry, listDir, readText, renameEntry, statFile, trashEntry, writeText } from '../services/files/ops';
import { RootWatcher } from '../services/files/watch';
import * as git from '../services/git/repo';
import { checkMergeable, gitRoot } from '../services/git/rules';
import { pruneWorktrees, removeWorktree, worktreeRows, type WorktreeDeps } from '../services/git/worktrees';
import type { HistoryStore } from '../services/history';
import { listShells, termData, Terminals, termSize, type Shell } from '../services/terminals';
import { readHandoffThresholds, writeHandoffThreshold, readView, writeView } from '../services/settings';
import type { SkillEntry } from '../services/skills';
import {
  connectStatusline,
  disconnectStatusline,
  statuslineStatus,
  type StatuslinePaths,
} from '../services/statusline';
import type { Conductor } from '../services/threads/conductor';
import type { ThreadStore } from '../services/threads/store';
import type { UsageService } from '../services/usage';

type Deps = {
  win: BrowserWindow;
  usage: UsageService;
  history: HistoryStore;
  statusline: Promise<StatuslinePaths>;
  userData: string;
  catalog: Catalog;
  runner: AgentRunner;
  store: ThreadStore;
  conductor: Conductor;
  skills: () => SkillEntry[];
  claudeConfigDir: () => string;
  tempDir: string;
};

const ID = AGENT_ID_RE;
const UUID = UUID_RE;

function agentId(v: unknown): string {
  if (typeof v !== 'string' || !ID.test(v)) throw new Error('invalid agent id');
  return v;
}

function chatId(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new Error('invalid chat id');
  return v;
}

function uuid(v: unknown, what: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new Error(`invalid ${what} id`);
  return v;
}

// A message the user typed: 1..100 000 characters (chat and thread messages alike).
function messageText(v: unknown): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 100_000) throw new Error('invalid message');
  return v;
}

// Files a user attached: at most a few, each a kind Ark takes and a size it can pass on. Bytes may arrive as an ArrayBuffer.
function uploads(v: unknown): Upload[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error('invalid files');
  const files = v.map((f): Upload => {
    const o = f as { name?: unknown; bytes?: unknown } | null;
    const bytes = o?.bytes instanceof ArrayBuffer ? new Uint8Array(o.bytes) : o?.bytes;
    if (typeof o?.name !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('invalid files');
    return { name: basename(o.name), bytes };
  });
  const problem = checkUploads(files.map((f) => ({ name: f.name, size: f.bytes.byteLength })));
  if (problem) throw new Error(problem);
  return files;
}

function agentIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 20 || !v.every((x) => typeof x === 'string' && ID.test(x))) {
    throw new Error('invalid agent ids');
  }
  return v as string[];
}

function seq(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('invalid message number');
  return v;
}

function reaction(v: unknown): Reaction {
  if (v !== '👍' && v !== '👎') throw new Error('invalid reaction');
  return v;
}

function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new Error('Invalid answer');
  return v;
}

// A branch name or a worktree path from the renderer: main checks it against git's own lists, this only bounds it.
function branchArg(v: unknown): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 255 || v.includes('\0')) throw new Error('Invalid branch name');
  return v;
}

function pathArg(v: unknown): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 1024 || v.includes('\0')) throw new Error('Invalid path');
  return v;
}

function projectDir(v: unknown): string {
  if (typeof v !== 'string' || !isAbsolute(v)) throw new Error('invalid project folder');
  let isDir = false;
  try {
    isDir = statSync(v).isDirectory();
  } catch {
    // missing: handled below
  }
  if (!isDir) throw new Error('invalid project folder');
  return v;
}

export function registerIpc({ win, usage, history, statusline, userData, catalog, runner, store, conductor, skills, claudeConfigDir, tempDir }: Deps): void {
  // Only Ark's own window may call in; payloads are validated per channel.
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (e.sender !== win.webContents) throw new Error('unknown sender');
      return fn(...args);
    });

  handle('usage:get', () => usage.ready());
  handle('usage:refresh', () => usage.refresh());
  handle('history:get', () => history.days());
  handle('statusline:status', async () => statuslineStatus(await statusline));
  handle('statusline:connect', async () => connectStatusline(await statusline));
  handle('statusline:disconnect', async () => disconnectStatusline(await statusline));
  handle('settings:get-view', () => readView(userData));
  handle('settings:set-view', (v) => {
    if (v !== 'compact' && v !== 'detailed') throw new Error('invalid view');
    writeView(userData, v);
  });

  handle('settings:get-handoff-thresholds', () => readHandoffThresholds(userData));
  handle('settings:set-handoff-threshold', (engine, percent) => {
    if ((engine !== 'claude' && engine !== 'codex') || typeof percent !== 'number') throw new Error('invalid handoff threshold');
    writeHandoffThreshold(userData, engine, percent);
  });

  handle('catalog:list', () => catalog.list());
  handle('catalog:add-it-services', () => catalog.addItServices());
  handle('catalog:importable', () => importableAgents(claudeConfigDir()));
  handle('catalog:save', (a) => {
    const r = validateAgent(a);
    if (!r.ok) throw new Error(r.error);
    catalog.save({ ...r.agent, id: agentId(r.agent.id) });
  });
  handle('catalog:remove', (id) => catalog.remove(agentId(id)));
  handle('catalog:import', (path) => {
    // Only a file Ark itself listed as importable, never an arbitrary path.
    const ok = typeof path === 'string' && importableAgents(claudeConfigDir()).some((i) => resolve(i.path) === resolve(path));
    if (!ok) throw new Error('not an importable agent');
    return importAgent(path as string);
  });
  handle('catalog:draft', async (description) => {
    if (typeof description !== 'string' || description.length < 1 || description.length > 2000) throw new Error('invalid description');
    const names = skills().map((s) => s.name);
    // An empty folder of Ark's own: the shared temp dir may hold other software's CLAUDE.md or .claude/.
    const dir = join(tempDir, 'ark', 'drafter');
    mkdirSync(dir, { recursive: true });
    const reply = await runner.oneShot(DRAFTER, dir, 'Skills available: ' + names.join(', ') + '\n\nThe agent I need: ' + description);
    const file = extractAgentFile(reply);
    const name = file ? splitFrontmatter(file)?.data.name : undefined;
    const r = file ? parseAgentFile(file, slug(typeof name === 'string' ? name : '')) : undefined;
    if (!r?.ok) throw new Error('The draft was not a valid agent file: ' + (r ? r.error : 'no agent file in the reply'));
    return { ...r.agent, skills: r.agent.skills.filter((s) => names.includes(s)) }; // drop skills the drafter made up
  });
  handle('skills:list', (): SkillInfo[] => skills().map(({ name, source, description }) => ({ name, source, description })));
  handle('engines:status', () => engineStatus(readEngines(userData)));
  handle('engines:save', (c) => writeEngines(userData, mergeEngines(readEngines(userData), validateEngines(c))));

  handle('chat:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  // Chats this window started: a reload (Ctrl+R) drops the renderer's state, so they would be orphans.
  const chats = new Set<string>();
  // A new page in the main frame, once beforeunload has let it go: `did-start-loading` fired before that, so a reload
  // cancelled at the unsaved-changes dialog still killed every terminal and chat under the page that stayed.
  win.webContents.on('did-start-navigation', (e) => {
    if (!e.isMainFrame || e.isSameDocument) return;
    for (const id of chats) {
      try {
        runner.stop(id);
      } catch (err) {
        console.error('stop on reload failed', err);
      }
    }
    chats.clear();
    watcher.closeAll();
    terms?.killAll(); // the page that showed them is gone
    views.destroyAll();
  });
  handle('chat:start', async (id, dir) => {
    const started = await runner.start(agentId(id), projectDir(dir));
    chats.add(started.chatId);
    return started;
  });
  handle('chat:send', (id, text) => runner.send(chatId(id), messageText(text)));
  handle('chat:stop', (id) => {
    const cid = chatId(id);
    chats.delete(cid);
    return runner.stop(cid);
  });

  handle('projects:list', () => store.projects());
  handle('projects:add', (dir) => store.addProject(projectDir(dir)));
  handle('projects:git-init', async (id) => {
    const pid = uuid(id, 'project');
    const p = store.projects().find((x) => x.id === pid);
    if (!p) throw new Error('Unknown project');
    if (!(await run('git', ['-C', p.dir, 'init'])).ok) throw new Error('git init failed');
    return store.setGit(pid);
  });

  handle('threads:list', () => store.threads());
  handle('threads:open', (id) => {
    const tid = uuid(id, 'thread');
    const thread = store.get(tid);
    if (!thread) throw new Error('Unknown thread');
    return { thread, messages: store.messages(tid) };
  });
  // A message may be only files: an empty text is then fine.
  const textOrFiles = (text: unknown, files: Upload[]) => (files.length > 0 && text === '' ? '' : messageText(text));
  handle('threads:create', (projectId, text, files) => {
    const f = uploads(files);
    return conductor.create(uuid(projectId, 'project'), textOrFiles(text, f), f);
  });
  handle('threads:send', (id, text, files) => {
    const f = uploads(files);
    conductor.send(uuid(id, 'thread'), textOrFiles(text, f), f);
  });
  handle('threads:attachment', (id, file) => {
    const k = typeof file === 'string' ? kindOf(file) : undefined;
    if (k?.kind !== 'image') throw new Error('Unknown attachment');
    return { mime: k.mime, data: store.readFile(uuid(id, 'thread'), file as string).toString('base64') };
  });
  handle('threads:approve-team', (id, ids) => conductor.approveTeam(uuid(id, 'thread'), agentIds(ids)));
  handle('threads:react', (id, n, emoji) => conductor.react(uuid(id, 'thread'), seq(n), reaction(emoji)));
  handle('threads:start-developer', (id) => conductor.startDeveloper(uuid(id, 'thread')));
  handle('threads:answer', (id, n, allow) => conductor.answer(uuid(id, 'thread'), seq(n), bool(allow)));
  handle('threads:pause', (id) => conductor.pause(uuid(id, 'thread')));
  handle('threads:save-task', (id, taskId, task) => conductor.saveTask(uuid(id, 'thread'), taskId === null ? null : uuid(taskId, 'task'), task));
  handle('threads:remove-task', (id, taskId) => conductor.removeTask(uuid(id, 'thread'), uuid(taskId, 'task')));

  // Files: the renderer names a root and a rel path; the folder and every path check are decided here.
  const dirOf = (r: unknown) => rootDir(rootRef(r), store);
  const kind = (v: unknown) => {
    if (v !== 'file' && v !== 'dir') throw new Error('Invalid kind');
    return v;
  };
  handle('files:list', (r, rel) => listDir(dirOf(r), normRel(rel)));
  handle('files:read', (r, rel) => readText(dirOf(r), normRel(rel)));
  handle('files:stat', (r, rel) => statFile(dirOf(r), normRel(rel)));
  handle('files:write', (r, rel, text, base, bom) => {
    if (typeof text !== 'string' || text.length > 50_000_000) throw new Error('Invalid text');
    if (base !== null && (typeof base !== 'number' || !Number.isFinite(base))) throw new Error('Invalid version');
    return writeText(dirOf(r), normEntry(rel), text, base, bool(bom));
  });
  handle('files:create', (r, rel, k) => createEntry(dirOf(r), normEntry(rel), kind(k)));
  handle('files:rename', (r, from, to) => renameEntry(dirOf(r), normEntry(from), normEntry(to)));
  handle('files:remove', (r, rel) => trashEntry(dirOf(r), normEntry(rel), (abs) => shell.trashItem(abs)));
  handle('files:reveal', (r, rel) => shell.showItemInFolder(resolveInside(dirOf(r), normRel(rel))));
  const watcher = new RootWatcher((key, rels) => {
    if (!win.isDestroyed()) win.webContents.send('files:changed', key, rels);
  });
  handle('files:watch', (r) => {
    const ref = rootRef(r);
    watcher.watch(rootKey(ref), rootDir(ref, store));
  });
  handle('files:unwatch', (r) => watcher.unwatch(rootKey(rootRef(r))));
  app.on('before-quit', () => watcher.closeAll());

  // Git: the same roots as files; the write actions wait for a running thread (see gitRoot).
  const gitDir = (r: unknown, write = false) => gitRoot(rootRef(r), store, write);
  handle('git:status', (r) => git.status(gitDir(r)));
  handle('git:show', (r, rel, side) => {
    const dir = gitDir(r);
    if (side !== 'head' && side !== 'index') throw new Error('Invalid side');
    return git.show(dir, normEntry(rel), side);
  });
  handle('git:stage', async (r, rels) => {
    const dir = gitDir(r, true);
    await git.stage(dir, normRels(rels));
    return git.status(dir);
  });
  handle('git:unstage', async (r, rels) => {
    const dir = gitDir(r, true);
    await git.unstage(dir, normRels(rels));
    return git.status(dir);
  });
  handle('git:discard', async (r, rels) => {
    const dir = gitDir(r, true);
    await git.discard(dir, normRels(rels), (abs) => shell.trashItem(abs));
    return git.status(dir);
  });
  handle('git:commit', async (r, message, all) => {
    const dir = gitDir(r, true);
    if (typeof message !== 'string' || message.length > 100_000) throw new Error('Invalid message');
    await git.commit(dir, message, bool(all));
    return git.status(dir);
  });
  handle('git:merge-abort', async (r) => {
    const dir = gitDir(r, true);
    await git.mergeAbort(dir);
    return git.status(dir);
  });

  // Branches and sync: a switch, create, delete or sync on a thread's worktree waits for a running thread too.
  handle('git:branches', (r) => git.branches(gitDir(r)));
  handle('git:switch', async (r, name, track) => {
    const dir = gitDir(r, true);
    await git.switchBranch(dir, branchArg(name), bool(track));
    return git.status(dir);
  });
  handle('git:create-branch', async (r, name) => {
    const dir = gitDir(r, true);
    await git.createBranch(dir, branchArg(name));
    return git.status(dir);
  });
  handle('git:delete-branch', async (r, name, force) => {
    const dir = gitDir(r, true);
    const result = await git.deleteBranch(dir, branchArg(name), bool(force));
    return { status: await git.status(dir), unmerged: result === 'unmerged' };
  });
  for (const [channel, sync] of [['git:fetch', git.fetch], ['git:pull', git.pull], ['git:push', git.push]] as const) {
    handle(channel, async (r) => {
      const dir = gitDir(r, true);
      await sync(dir);
      return git.status(dir);
    });
  }

  // Worktrees and thread merge: named by project or thread id; main finds the folder and checks every path.
  const projectFolder = (id: unknown) => rootDir({ kind: 'project', id: uuid(id, 'project') }, store);
  const threadOf = (id: unknown) => {
    const t = store.get(uuid(id, 'thread'));
    if (!t) throw new Error('Unknown thread');
    return t;
  };
  const wtDeps: WorktreeDeps = { threads: () => store.threads(), watcher, removed: (tid) => conductor.worktreeRemoved(tid) };
  handle('git:worktrees', (id) => worktreeRows(projectFolder(id), wtDeps));
  handle('git:remove-worktree', (id, path) => {
    const dir = projectFolder(id);
    return removeWorktree(dir, pathArg(path), wtDeps);
  });
  handle('git:prune-worktrees', (id) => pruneWorktrees(projectFolder(id), wtDeps));
  handle('git:thread-branch', (id) => {
    const t = threadOf(id);
    return t.build ? git.threadBranch(projectFolder(t.projectId), t.build.branch) : null;
  });
  handle('git:merge-thread', async (id) => {
    const t = threadOf(id);
    const branch = checkMergeable(t);
    const dir = projectFolder(t.projectId);
    const merged = (await git.mergeBranch(dir, branch)) === 'merged';
    return { merged, status: await git.status(dir) }; // the project's status: a conflict is resolved there
  });

  // Terminals: node-pty loads on the first one, so a broken native module is an error in the panel, not a dead app.
  let shellList: Promise<Shell[]> | undefined; // PATH doesn't change under a running app
  const shellsNow = () => (shellList ??= listShells());
  let terms: Terminals | undefined;
  const termId = (v: unknown) => uuid(v, 'terminal');
  handle('terminal:shells', async (): Promise<ShellOption[]> => (await shellsNow()).map(({ id, name }) => ({ id, name })));
  handle('terminal:create', async (r, shellId, cols, rows) => {
    const cwd = dirOf(r);
    const shell = (await shellsNow()).find((s) => s.id === shellId);
    if (!shell) throw new Error('Unknown shell');
    const [c, w] = [termSize(cols), termSize(rows)];
    return (await termsReady()).create(shell, cwd, c, w);
  });
  let loading: Promise<Terminals> | undefined; // one service even when two terminals open at once
  const termsReady = () =>
    (loading ??= import('node-pty').then(
      (pty) =>
        (terms = new Terminals((file, args, opts) => pty.spawn(file, args, opts), {
          data: (id, chunk) => !win.isDestroyed() && win.webContents.send('terminal:data', id, chunk),
          exit: (id, code) => !win.isDestroyed() && win.webContents.send('terminal:exit', id, code),
        })),
    ));
  const live = () => {
    if (!terms) throw new Error('Unknown terminal');
    return terms;
  };
  handle('terminal:write', (id, data) => live().write(termId(id), termData(data)));
  handle('terminal:resize', (id, cols, rows) => live().resize(termId(id), termSize(cols), termSize(rows)));
  handle('terminal:kill', (id) => terms?.kill(termId(id)));
  app.on('before-quit', () => terms?.killAll());

  // Browser: one locked-down view per project, named by project id; the page in it never reaches these handlers.
  const views = new BrowserViews({
    win,
    send: (c, id, p) => !win.isDestroyed() && win.webContents.send(c, id, p),
    openExternal: (u) => void shell.openExternal(u).catch((err) => console.error('openExternal failed', err)),
  });
  const pid = (v: unknown) => uuid(v, 'project');
  handle('browser:open', (id) => views.open(pid(id)));
  handle('browser:close', (id) => views.close(pid(id)));
  handle('browser:navigate', (id, url) => {
    const p = pid(id);
    if (typeof url !== 'string' || url.length > 2048) throw new Error('Invalid address');
    views.navigate(p, url); // refuses anything but a local address
  });
  handle('browser:back', (id) => views.back(pid(id)));
  handle('browser:forward', (id) => views.forward(pid(id)));
  handle('browser:reload', (id) => views.reload(pid(id)));
  handle('browser:layout', (id, bounds) => {
    const p = pid(id);
    const b = cleanBounds(bounds);
    if (b === undefined) throw new Error('Invalid bounds');
    views.layout(p, b);
  });
  handle('browser:capture', (id) => views.capture(pid(id)));
  handle('browser:pick', (id, captureId, rect) => views.pick(pid(id), captureId, rect)); // ID and rect checked against this capture
  handle('browser:open-blocked', (id) => views.openBlocked(pid(id)));

  usage.onChanged((s) => {
    if (!win.isDestroyed()) win.webContents.send('usage:changed', s);
  });
  runner.onEvent((id, e) => {
    if (!win.isDestroyed()) win.webContents.send('chat:event', id, e);
  });
}
