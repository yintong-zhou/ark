import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserKey, BrowserState } from '@shared/browser';
import type { ThreadUpdate } from '@shared/thread';
import type { ArkApi, ChatEvent, UsageState } from '@shared/types';

// The renderer gets these typed functions only, never ipcRenderer itself.
const api: ArkApi = {
  window: {
    onConfirmUnload: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('window:confirm-unload', listener);
      return () => ipcRenderer.removeListener('window:confirm-unload', listener);
    },
    confirmUnloadResult: (answer) => ipcRenderer.send('window:confirm-unload-result', answer),
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
    refresh: () => ipcRenderer.invoke('usage:refresh'),
    onChanged: (cb) => {
      const listener = (_e: unknown, s: UsageState) => cb(s);
      ipcRenderer.on('usage:changed', listener);
      return () => {
        ipcRenderer.removeListener('usage:changed', listener);
      };
    },
  },
  history: { get: () => ipcRenderer.invoke('history:get') },
  statusline: {
    status: () => ipcRenderer.invoke('statusline:status'),
    connect: () => ipcRenderer.invoke('statusline:connect'),
    disconnect: () => ipcRenderer.invoke('statusline:disconnect'),
  },
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get-theme'),
    setTheme: (t) => ipcRenderer.invoke('settings:set-theme', t),
    titleBar: (light) => ipcRenderer.invoke('settings:title-bar', light),
    getView: () => ipcRenderer.invoke('settings:get-view'),
    setView: (v) => ipcRenderer.invoke('settings:set-view', v),
    getHandoffThresholds: () => ipcRenderer.invoke('settings:get-handoff-thresholds'),
    setHandoffThreshold: (engine, percent) => ipcRenderer.invoke('settings:set-handoff-threshold', engine, percent),
  },
  catalog: {
    list: () => ipcRenderer.invoke('catalog:list'),
    teams: () => ipcRenderer.invoke('catalog:teams'),
    addTeam: (id) => ipcRenderer.invoke('catalog:add-team', id),
    agentTeams: () => ipcRenderer.invoke('catalog:agent-teams'),
    saveAgentTeams: (t) => ipcRenderer.invoke('catalog:save-agent-teams', t),
    updateTeam: (id) => ipcRenderer.invoke('catalog:update-team', id),
    save: (a, image) => ipcRenderer.invoke('catalog:save', a, image),
    pickImage: () => ipcRenderer.invoke('catalog:pick-image'),
    image: (id) => ipcRenderer.invoke('catalog:image', id),
    remove: (id) => ipcRenderer.invoke('catalog:remove', id),
    importable: () => ipcRenderer.invoke('catalog:importable'),
    import: (path) => ipcRenderer.invoke('catalog:import', path),
    draft: (d) => ipcRenderer.invoke('catalog:draft', d),
  },
  head: { get: () => ipcRenderer.invoke('head:get'), save: (settings) => ipcRenderer.invoke('head:save', settings) },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    import: () => ipcRenderer.invoke('skills:import'),
    replace: () => ipcRenderer.invoke('skills:replace'),
    remove: (name) => ipcRenderer.invoke('skills:remove', name),
  },
  engines: {
    status: () => ipcRenderer.invoke('engines:status'),
    codexModels: () => ipcRenderer.invoke('engines:codex-models'),
    save: (c) => ipcRenderer.invoke('engines:save', c),
  },
  chat: {
    pickFolder: () => ipcRenderer.invoke('chat:pick-folder'),
    start: (agentId, projectDir, mode) => ipcRenderer.invoke('chat:start', agentId, projectDir, mode),
    send: (chatId, text) => ipcRenderer.invoke('chat:send', chatId, text),
    stop: (chatId) => ipcRenderer.invoke('chat:stop', chatId),
    onEvent: (cb) => {
      const listener = (_e: unknown, chatId: string, ev: ChatEvent) => cb(chatId, ev);
      ipcRenderer.on('chat:event', listener);
      return () => {
        ipcRenderer.removeListener('chat:event', listener);
      };
    },
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: (dir) => ipcRenderer.invoke('projects:add', dir),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    gitInit: (id) => ipcRenderer.invoke('projects:git-init', id),
  },
  threads: {
    list: () => ipcRenderer.invoke('threads:list'),
    remove: (id) => ipcRenderer.invoke('threads:remove', id),
    open: (id) => ipcRenderer.invoke('threads:open', id),
    create: (projectId, text, files, mode) => ipcRenderer.invoke('threads:create', projectId, text, files, mode),
    setPermissionMode: (id, mode) => ipcRenderer.invoke('threads:set-permission-mode', id, mode),
    send: (id, text, files) => ipcRenderer.invoke('threads:send', id, text, files),
    attachment: (id, file) => ipcRenderer.invoke('threads:attachment', id, file),
    approveTeam: (id, agentIds) => ipcRenderer.invoke('threads:approve-team', id, agentIds),
    react: (id, seq, emoji) => ipcRenderer.invoke('threads:react', id, seq, emoji),
    startDeveloper: (id) => ipcRenderer.invoke('threads:start-developer', id),
    answer: (id, seq, allow) => ipcRenderer.invoke('threads:answer', id, seq, allow),
    pause: (id) => ipcRenderer.invoke('threads:pause', id),
    saveTask: (id, taskId, task) => ipcRenderer.invoke('threads:save-task', id, taskId, task),
    removeTask: (id, taskId) => ipcRenderer.invoke('threads:remove-task', id, taskId),
    onUpdate: (cb) => {
      const listener = (_e: unknown, u: ThreadUpdate) => cb(u);
      ipcRenderer.on('threads:update', listener);
      return () => {
        ipcRenderer.removeListener('threads:update', listener);
      };
    },
  },
  files: {
    list: (root, rel) => ipcRenderer.invoke('files:list', root, rel),
    read: (root, rel) => ipcRenderer.invoke('files:read', root, rel),
    stat: (root, rel) => ipcRenderer.invoke('files:stat', root, rel),
    write: (root, rel, text, base, bom) => ipcRenderer.invoke('files:write', root, rel, text, base, bom),
    create: (root, rel, kind) => ipcRenderer.invoke('files:create', root, rel, kind),
    rename: (root, from, to) => ipcRenderer.invoke('files:rename', root, from, to),
    remove: (root, rel) => ipcRenderer.invoke('files:remove', root, rel),
    reveal: (root, rel) => ipcRenderer.invoke('files:reveal', root, rel),
    watch: (root) => ipcRenderer.invoke('files:watch', root),
    unwatch: (root) => ipcRenderer.invoke('files:unwatch', root),
    onChanged: (cb) => {
      const listener = (_e: unknown, key: string, rels: string[] | null) => cb(key, rels);
      ipcRenderer.on('files:changed', listener);
      return () => {
        ipcRenderer.removeListener('files:changed', listener);
      };
    },
  },
  git: {
    status: (root) => ipcRenderer.invoke('git:status', root),
    show: (root, rel, side) => ipcRenderer.invoke('git:show', root, rel, side),
    stage: (root, rels) => ipcRenderer.invoke('git:stage', root, rels),
    unstage: (root, rels) => ipcRenderer.invoke('git:unstage', root, rels),
    discard: (root, rels) => ipcRenderer.invoke('git:discard', root, rels),
    commit: (root, message, all) => ipcRenderer.invoke('git:commit', root, message, all),
    mergeAbort: (root) => ipcRenderer.invoke('git:merge-abort', root),
    branches: (root) => ipcRenderer.invoke('git:branches', root),
    switchBranch: (root, name, track) => ipcRenderer.invoke('git:switch', root, name, track),
    createBranch: (root, name) => ipcRenderer.invoke('git:create-branch', root, name),
    deleteBranch: (root, name, force) => ipcRenderer.invoke('git:delete-branch', root, name, force),
    fetch: (root) => ipcRenderer.invoke('git:fetch', root),
    pull: (root) => ipcRenderer.invoke('git:pull', root),
    push: (root) => ipcRenderer.invoke('git:push', root),
    worktrees: (projectId) => ipcRenderer.invoke('git:worktrees', projectId),
    removeWorktree: (projectId, path) => ipcRenderer.invoke('git:remove-worktree', projectId, path),
    pruneWorktrees: (projectId) => ipcRenderer.invoke('git:prune-worktrees', projectId),
    threadBranch: (threadId) => ipcRenderer.invoke('git:thread-branch', threadId),
    mergeThread: (threadId) => ipcRenderer.invoke('git:merge-thread', threadId),
  },
  terminal: {
    shells: () => ipcRenderer.invoke('terminal:shells'),
    create: (root, shell, cols, rows) => ipcRenderer.invoke('terminal:create', root, shell, cols, rows),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    onData: (cb) => {
      const listener = (_e: unknown, id: string, chunk: string) => cb(id, chunk);
      ipcRenderer.on('terminal:data', listener);
      return () => {
        ipcRenderer.removeListener('terminal:data', listener);
      };
    },
    onExit: (cb) => {
      const listener = (_e: unknown, id: string, code: number) => cb(id, code);
      ipcRenderer.on('terminal:exit', listener);
      return () => {
        ipcRenderer.removeListener('terminal:exit', listener);
      };
    },
  },
  browser: {
    open: (projectId) => ipcRenderer.invoke('browser:open', projectId),
    close: (projectId) => ipcRenderer.invoke('browser:close', projectId),
    navigate: (projectId, url) => ipcRenderer.invoke('browser:navigate', projectId, url),
    back: (projectId) => ipcRenderer.invoke('browser:back', projectId),
    forward: (projectId) => ipcRenderer.invoke('browser:forward', projectId),
    reload: (projectId) => ipcRenderer.invoke('browser:reload', projectId),
    layout: (projectId, bounds) => ipcRenderer.invoke('browser:layout', projectId, bounds),
    capture: (projectId) => ipcRenderer.invoke('browser:capture', projectId),
    pick: (projectId, captureId, rect) => ipcRenderer.invoke('browser:pick', projectId, captureId, rect),
    openBlocked: (projectId) => ipcRenderer.invoke('browser:open-blocked', projectId),
    onState: (cb) => {
      const listener = (_e: unknown, projectId: string, s: BrowserState) => cb(projectId, s);
      ipcRenderer.on('browser:state', listener);
      return () => {
        ipcRenderer.removeListener('browser:state', listener);
      };
    },
    onKey: (cb) => {
      const listener = (_e: unknown, projectId: string, k: BrowserKey) => cb(projectId, k);
      ipcRenderer.on('browser:key', listener);
      return () => {
        ipcRenderer.removeListener('browser:key', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('ark', api);
