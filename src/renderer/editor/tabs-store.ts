import { useSyncExternalStore } from 'react';
import type { editor } from 'monaco-editor';
import { afterSave, diskChanged, keepMine, saveBase, tabKey, touches, type FileTab } from '@shared/editor-tabs';
import { rootKey, type ReadResult, type RootRef } from '@shared/files';
import { readable } from '../errors';
import { loadMonaco } from './monaco';

/**
 * Open files, kept at module level so tabs, unsaved edits and scroll positions survive leaving the Threads area
 * (spec §5.5). Each project has its own tab order; the thread tab is `active: null`.
 */
export type Doc = {
  tab: FileTab;
  name: string;
  /** Present for text files; binary and large files show a placeholder instead. */
  model?: editor.ITextModel;
  placeholder?: { kind: 'binary' } | { kind: 'large'; size: number };
  view?: editor.ICodeEditorViewState | null;
  /** The model version that matches the disk: dirty is any other version. */
  saved?: number;
  error?: string;
};
export type TabsView = { docs: Doc[]; active: string | null };

const docs = new Map<string, Doc>();
const order = new Map<string, { keys: string[]; active: string | null }>();
const snaps = new Map<string, TabsView>();
const listeners = new Set<() => void>();
const EMPTY: TabsView = { docs: [], active: null };

function emit() {
  snaps.clear();
  listeners.forEach((l) => l());
}

// Unsaved tabs hold the page: closing the window or reloading it asks first (main's will-prevent-unload).
window.addEventListener('beforeunload', (e) => {
  if ([...docs.values()].some((d) => d.tab.dirty)) e.preventDefault();
});

const update = (key: string, change: (d: Doc) => Doc) => {
  const d = docs.get(key);
  if (d) {
    docs.set(key, change(d));
    emit();
  }
};
const setTab = (key: string, tab: FileTab) => update(key, (d) => ({ ...d, tab }));
const of = (projectId: string) => order.get(projectId) ?? { keys: [], active: null };

/** Puts a read result into a doc: a model for text (reusing the existing one), a placeholder otherwise. */
async function fill(d: Doc, r: ReadResult): Promise<Doc> {
  if (r.kind !== 'text') {
    d.model?.dispose();
    return { ...d, model: undefined, saved: undefined, placeholder: r, tab: { ...d.tab, dirty: false, bar: undefined, mtimeMs: null } };
  }
  const monaco = await loadMonaco();
  let model = d.model;
  if (!model) {
    const uri = monaco.Uri.from({ scheme: 'ark', path: `/${d.tab.root.kind}/${d.tab.root.id}/${d.tab.rel}` });
    model = monaco.editor.createModel(r.text, undefined, uri); // the language comes from the extension
    const key = d.tab.key;
    model.onDidChangeContent(() => {
      const cur = docs.get(key);
      if (!cur?.model) return;
      const dirty = cur.model.getAlternativeVersionId() !== cur.saved;
      if (dirty !== cur.tab.dirty) setTab(key, { ...cur.tab, dirty });
    });
  } else if (model.getValue() !== r.text) {
    // An edit, not setValue: the user's undo history survives a reload.
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: r.text }], () => null);
  }
  return {
    ...d,
    model,
    placeholder: undefined,
    error: undefined,
    saved: model.getAlternativeVersionId(),
    tab: { ...d.tab, dirty: false, bar: undefined, force: false, mtimeMs: r.mtimeMs, bom: r.bom, readonly: r.readonly },
  };
}

export async function open(projectId: string, root: RootRef, rel: string): Promise<void> {
  listen();
  const key = tabKey(root, rel);
  if (!docs.has(key)) {
    const r = await window.ark.files.read(root, rel);
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const first = ![...docs.values()].some((d) => rootKey(d.tab.root) === rootKey(root));
    const tab: FileTab = { key, root, rel, dirty: false, mtimeMs: null, bom: false, readonly: false, force: false };
    docs.set(key, await fill({ tab, name }, r));
    if (first) void window.ark.files.watch(root).catch(() => {});
  }
  const o = of(projectId);
  order.set(projectId, { keys: o.keys.includes(key) ? o.keys : [...o.keys, key], active: key });
  emit();
}

export function activate(projectId: string, key: string | null): void {
  const o = of(projectId);
  if (o.active === key) return;
  order.set(projectId, { ...o, active: key });
  emit();
}

export function close(projectId: string, key: string): void {
  const d = docs.get(key);
  if (!d) return;
  if (d.tab.dirty && !confirm(`Discard unsaved changes to ${d.name}?`)) return;
  d.model?.dispose();
  docs.delete(key);
  const o = of(projectId);
  const i = o.keys.indexOf(key);
  const keys = o.keys.filter((k) => k !== key);
  order.set(projectId, { keys, active: o.active === key ? (keys[Math.min(i, keys.length - 1)] ?? null) : o.active });
  if (![...docs.values()].some((x) => rootKey(x.tab.root) === rootKey(d.tab.root))) void window.ark.files.unwatch(d.tab.root).catch(() => {});
  emit();
}

/** Saves run one after another per file: a second Ctrl+S waits for the first, so it sends the version that one wrote. */
const saving = new Map<string, Promise<void>>();

export function save(key: string): Promise<void> {
  const next = (saving.get(key) ?? Promise.resolve()).then(() => saveNow(key));
  saving.set(key, next);
  void next.finally(() => saving.get(key) === next && saving.delete(key));
  return next;
}

async function saveNow(key: string): Promise<void> {
  const d = docs.get(key);
  if (!d?.model || d.tab.readonly) return;
  const version = d.model.getAlternativeVersionId();
  try {
    const r = await window.ark.files.write(d.tab.root, d.tab.rel, d.model.getValue(), saveBase(d.tab), d.tab.bom);
    update(key, (cur) => {
      if (r.conflict) return { ...cur, tab: afterSave(cur.tab, r), error: undefined };
      const tab = afterSave(cur.tab, r);
      // typing while the save was in flight keeps the tab dirty
      return { ...cur, saved: version, error: undefined, tab: { ...tab, dirty: cur.model?.getAlternativeVersionId() !== version } };
    });
  } catch (e) {
    update(key, (cur) => ({ ...cur, error: `Couldn't save: ${readable(e)}` }));
  }
}

/**
 * Loads the disk version into the tab. `auto` is the watcher's reload of a clean tab: if the user typed while the file
 * was being read, their edits stay and the tab gets the changed bar instead. The Reload button replaces on purpose.
 */
export async function reload(key: string, auto = false): Promise<void> {
  const d = docs.get(key);
  if (!d) return;
  const before = d.model?.getAlternativeVersionId();
  try {
    const r = await window.ark.files.read(d.tab.root, d.tab.rel);
    const cur = docs.get(key);
    if (!cur) return;
    if (auto && cur.model && cur.model.getAlternativeVersionId() !== before) {
      setTab(key, { ...cur.tab, bar: 'changed', force: false });
      return;
    }
    docs.set(key, await fill(cur, r));
    emit();
  } catch (e) {
    update(key, (cur) => ({ ...cur, error: `Couldn't reload: ${readable(e)}` }));
  }
}

export const keep = (key: string): void => {
  const d = docs.get(key);
  if (d) setTab(key, keepMine(d.tab));
};

/** Remembers where the user was in a file, so coming back to its tab restores it. */
export const remember = (key: string, view: editor.ICodeEditorViewState | null): void => {
  const d = docs.get(key);
  if (d) d.view = view; // no emit: nothing on screen changes
};

let subscribed = false;
/** One watcher subscription for every open file, made with the first tab or the first component, whichever comes first. */
function listen() {
  if (!subscribed) {
    subscribed = true;
    window.ark.files.onChanged((rk, rels) => {
      for (const d of [...docs.values()]) {
        if (rootKey(d.tab.root) !== rk || !touches(rels, d.tab.rel)) continue;
        void window.ark.files.stat(d.tab.root, d.tab.rel).then(
          (disk) => {
            const cur = docs.get(d.tab.key);
            if (!cur) return;
            const r = diskChanged(cur.tab, disk);
            if (r.reload) void reload(cur.tab.key, true);
            else if (r.tab !== cur.tab) setTab(cur.tab.key, r.tab);
          },
          () => {}, // the root itself is gone: the next save reports it
        );
      }
    });
  }
}

function subscribe(l: () => void) {
  listen();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** A project's tabs as they are now; the same object until something changes. */
export function tabsOf(projectId: string | undefined): TabsView {
  if (!projectId) return EMPTY;
  let s = snaps.get(projectId);
  if (!s) {
    const o = of(projectId);
    s = { docs: o.keys.map((k) => docs.get(k)).filter((d): d is Doc => !!d), active: o.active };
    snaps.set(projectId, s);
  }
  return s;
}

export function useTabs(projectId: string | undefined): TabsView {
  return useSyncExternalStore(subscribe, () => tabsOf(projectId));
}
