import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { Avatars } from './services/avatars';
import { claudeAuth, createClaudeAdapter } from './services/adapters/claude';
import { createCodexAdapter } from './services/adapters/codex';
import { createOpencodeAdapter } from './services/adapters/opencode';
import { findGitBash, which } from './services/exec';
import { claudeLimited } from '@shared/agent-problems';
import { AgentRunner } from './services/agent-runner';
import { Catalog } from './services/catalog';
import { startClaudeSession } from './services/engines/claude-session';
import { codexModels, startCodexSession } from './services/engines/codex-session';
import { engineStatus, readEngines } from './services/engines/config';
import { visibleModels } from './services/engines/models';
import { cleanEnv } from './services/engines/isolation';
import { readHead } from './services/settings';
import { HistoryStore } from './services/history';
import { indexSkills, personalSkills } from './services/skills';
import { readHandoffThresholds } from './services/settings';
import type { StatuslinePaths } from './services/statusline';
import { Conductor } from './services/threads/conductor';
import { threadGit } from './services/git/repo';
import { threadGitLines } from '@shared/git';
import type { Thread } from '@shared/thread';
import { ThreadStore } from './services/threads/store';
import { workspace } from './services/threads/workspace';
import { UsageService } from './services/usage';

type WinState = { x: number; y: number; width: number; height: number; maximized: boolean };

/** The window as the user left it; null when there is none, it is malformed, or its screen is gone. */
function readWinState(file: string): WinState | null {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as WinState;
    if (![s.x, s.y, s.width, s.height].every(Number.isFinite) || s.width < 960 || s.height < 600) return null;
    const onScreen = screen.getAllDisplays().some((d) => s.x < d.bounds.x + d.bounds.width - 40 && s.x + s.width > d.bounds.x + 40 && s.y >= d.bounds.y - 10 && s.y < d.bounds.y + d.bounds.height - 40);
    return onScreen ? { ...s, maximized: s.maximized === true } : null;
  } catch {
    return null;
  }
}

function createWindow(userData: string): BrowserWindow {
  const file = join(userData, 'window-state.json');
  const saved = readWinState(file);
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : {}),
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0E1013',
    show: false,
    autoHideMenuBar: true,
    // The app draws its own 32px title bar in Primary; Windows paints only the window buttons over it.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0E1013', symbolColor: '#DEE1E6', height: 32 },
    // Packaged builds take the icon from the exe (electron-builder.yml); dev needs it here.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'resources', 'icon.ico') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // On a screen with a different scale than the primary one, the constructor mis-sizes the window: set the bounds again.
  if (saved) win.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
  if (saved?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  // Saved when a move or resize ends, not only on close, so a killed process still leaves the last size.
  const remember = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    try {
      writeFileSync(file, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch { /* the size is just not remembered */ }
  };
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  win.on('close', remember);
  // Local content only: no popups, no navigation away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

async function statuslinePaths(userData: string): Promise<StatuslinePaths> {
  const auth = await claudeAuth();
  return {
    claudeSettings: join(auth?.configDir ?? join(homedir(), '.claude'), 'settings.json'),
    userData,
    wrapperSource: app.isPackaged
      ? join(process.resourcesPath, 'statusline-wrapper.cjs')
      : join(app.getAppPath(), 'resources', 'statusline-wrapper.cjs'),
    // Without Node on PATH, Ark's own executable runs the wrapper in Node mode.
    runner: (await which('node')) ? { kind: 'node' } : { kind: 'electron', exe: process.execPath },
    shell: await findGitBash(),
  };
}

// One Ark at a time: a second one would delete the first one's live session folders on start.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) app.quit();

app.whenReady().then(() => {
  if (!isPrimary) return;
  const userData = app.getPath('userData');
  const history = new HistoryStore(join(userData, 'history.jsonl'));
  const usage = new UsageService(
    [
      createClaudeAdapter({ dropDir: join(userData, 'claude', 'sessions') }),
      createCodexAdapter({ sessionsDir: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions') }),
      createOpencodeAdapter(),
    ],
    history,
  );
  const catalog = new Catalog(join(userData, 'agents'));
  // The Claude config dir comes from the CLI (it may be moved); until it answers, ~/.claude is used.
  let claudeConfigDir = join(homedir(), '.claude');
  void claudeAuth().then((a) => {
    if (a?.configDir) claudeConfigDir = a.configDir;
  });
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const skillRoots = { claudeConfigDir, home: homedir(), codexHome, ark: join(userData, 'skills') };
  const skills = () => indexSkills(skillRoots);
  // A crash can leave session folders behind; no chat has started yet, so none of them is live.
  try {
    rmSync(join(app.getPath('temp'), 'ark', 'sessions'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // best effort: it is only temp
  }
  const runner = new AgentRunner({
    catalog,
    skills,
    personalSkills: () => personalSkills(skillRoots),
    engines: () => engineStatus(readEngines(userData)),
    config: () => readEngines(userData),
    tempDir: app.getPath('temp'),
    codexHome,
    env: () => cleanEnv(process.env),
    startClaude: startClaudeSession,
    startCodex: startCodexSession,
    claudeLimited: () => claudeLimited(usage.get().agents.find((a) => a.id === 'claude'), Date.now() / 1000),
    codexModels: (exe) => codexModels(exe, cleanEnv(process.env)),
  });
  runner.onEvent((_, e) => {
    if (e.type === 'limits') usage.apply({ agent: e.engine, windows: e.windows });
  });
  const store = new ThreadStore(userData);
  store.recover();
  // The summary reads the thread branch's Git state (read-only) to offer the next steps; the user runs them.
  const gitState = async (t: Thread) => {
    const p = store.projects().find((x) => x.id === t.projectId);
    return p && t.build && !t.build.removed ? threadGitLines(await threadGit(p.dir, t.build.worktree, t.build.branch)) : undefined;
  };
  const conductor = new Conductor({ store, catalog, head: () => readHead(userData), runner, workspace, handoffThreshold: (engine) => readHandoffThresholds(userData)[engine], worktrees: join(userData, 'worktrees'), windows: (e) => usage.get().agents.find((a) => a.id === e), gitState });
  const win = createWindow(userData);
  conductor.onUpdate((u) => {
    if (!win.isDestroyed()) win.webContents.send('threads:update', u);
  });
  app.on('second-instance', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  // Handlers are registered synchronously, before the page can call them; the paths resolve in the background.
  registerIpc({
    win,
    usage,
    history,
    statusline: statuslinePaths(userData),
    userData,
    catalog,
    avatars: new Avatars(join(userData, 'avatars')),
    codexModels: async () => {
      try {
        const codex = (await engineStatus(readEngines(userData))).find((engine) => engine.id === 'codex');
        return codex?.installed && codex.path ? visibleModels(await codexModels(codex.path, cleanEnv(process.env))) : [];
      } catch {
        return [];
      }
    },
    runner,
    store,
    conductor,
    skills,
    claudeConfigDir: () => claudeConfigDir,
    tempDir: app.getPath('temp'),
  });
  // The renderer owns the confirmation, but beforeunload remains the final guard for unsaved edits.
  let closing = false;
  let pending: 'close' | 'reload' | undefined;
  let allowUnload = false;
  win.on('close', () => { closing = true; });
  win.webContents.on('did-finish-load', () => { allowUnload = false; closing = false; });
  win.webContents.on('will-prevent-unload', (e) => {
    if (allowUnload) {
      allowUnload = false;
      e.preventDefault(); // Electron interprets this as allowing unload.
      return;
    }
    if (!pending) {
      pending = closing ? 'close' : 'reload';
      win.webContents.send('window:confirm-unload');
    }
    closing = false;
  });
  ipcMain.on('window:confirm-unload-result', (event, answer: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !pending || typeof answer !== 'boolean') return;
    const action = pending;
    pending = undefined;
    if (!answer || win.isDestroyed()) return;
    allowUnload = true;
    if (action === 'close') win.close();
    else win.webContents.reload();
  });
  app.on('before-quit', () => {
    // Engines first, and one failure must not skip the other.
    for (const stop of [() => conductor.stopAll(), () => runner.stopAll(), () => usage.stop()]) {
      try {
        stop();
      } catch (err) {
        console.error('shutdown step failed', err);
      }
    }
  });
  usage.start().catch((err) => console.error('usage start failed', err));
});

app.on('window-all-closed', () => app.quit());
