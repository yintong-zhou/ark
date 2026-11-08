import { useSyncExternalStore } from 'react';
import { areaName, browserMessage, toAddress, type BrowserKey, type BrowserState, type Picked, type Rect } from '@shared/browser';
import { readable } from '../errors';
import { dropBrowserTab, focusBrowserTab } from '../editor/tabs-store';

/**
 * Each project's browser tab, kept at module level so the address and state outlive the pane (the view itself lives in
 * main until `closeBrowser`).
 */
export type Selection = { frame: string; rect?: Rect; picked?: Picked; sending?: boolean; error?: string };
export type BrowserView = { open: boolean; state: BrowserState; address: string; error?: string; draft: string; sel?: Selection; sent?: string };

const BLANK: BrowserState = { url: '', title: '', loading: false, canBack: false, canForward: false };
const EMPTY: BrowserView = { open: false, state: BLANK, address: '', draft: '' };

const views = new Map<string, BrowserView>();
const listeners = new Set<() => void>();
const keyListeners = new Set<(projectId: string, k: BrowserKey) => void>();

const get = (projectId: string) => views.get(projectId) ?? EMPTY;
function set(projectId: string, change: Partial<BrowserView>) {
  views.set(projectId, { ...get(projectId), ...change });
  listeners.forEach((l) => l());
}

let subscribed = false;
/** One subscription to main for every project, made with the first use. */
function listen() {
  if (subscribed) return;
  subscribed = true;
  window.ark.browser.onState((projectId, state) => {
    const cur = get(projectId);
    // the field follows the page after every navigation, links clicked inside it included
    set(projectId, { state, ...(state.url !== cur.state.url ? { address: state.url } : {}) });
  });
  window.ark.browser.onKey((projectId, k) => keyListeners.forEach((cb) => cb(projectId, k)));
}

export function useBrowser(projectId: string | undefined): BrowserView {
  return useSyncExternalStore(
    (l) => {
      listen();
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => (projectId ? get(projectId) : EMPTY),
  );
}

export async function openBrowser(projectId: string): Promise<void> {
  listen();
  try {
    const state = await window.ark.browser.open(projectId);
    const cur = get(projectId);
    set(projectId, { open: true, state, address: cur.open ? cur.address : state.url, error: undefined });
  } catch (e) {
    set(projectId, { error: readable(e) });
  }
  focusBrowserTab(projectId);
}

export async function closeBrowser(projectId: string): Promise<void> {
  views.delete(projectId);
  listeners.forEach((l) => l());
  dropBrowserTab(projectId);
  await window.ark.browser.close(projectId).catch(() => {});
}

export function setAddress(projectId: string, text: string): void {
  set(projectId, { address: text });
}

export async function go(projectId: string): Promise<void> {
  const url = toAddress(get(projectId).address);
  if (!url) {
    set(projectId, { error: 'Only local addresses (localhost, 127.0.0.1) open here.' });
    return;
  }
  set(projectId, { error: undefined });
  try {
    await window.ark.browser.navigate(projectId, url);
  } catch (e) {
    set(projectId, { error: readable(e) });
  }
}

export function onBrowserKey(cb: (projectId: string, k: BrowserKey) => void): () => void {
  listen();
  keyListeners.add(cb);
  return () => void keyListeners.delete(cb);
}

function setSel(projectId: string, change: Partial<Selection> | undefined) {
  const cur = get(projectId).sel;
  if (!change) set(projectId, { sel: undefined });
  else if (cur) set(projectId, { sel: { ...cur, ...change } });
}

/** Capture the page, then the pane shows it as a freeze frame (spec §5.3). */
export async function startSelect(projectId: string): Promise<void> {
  if (get(projectId).sel) return;
  try {
    set(projectId, { error: undefined, sel: { frame: await window.ark.browser.capture(projectId) } });
  } catch (e) {
    set(projectId, { error: readable(e) });
  }
}

/** `rect` is in the placeholder's CSS px; a newer drag wins over a pick still in flight. */
export async function pickArea(projectId: string, rect: Rect): Promise<void> {
  setSel(projectId, { rect, picked: undefined, error: undefined });
  try {
    const picked = await window.ark.browser.pick(projectId, rect);
    if (get(projectId).sel?.rect === rect) setSel(projectId, { picked });
  } catch (e) {
    if (get(projectId).sel?.rect === rect) setSel(projectId, { error: readable(e) });
  }
}

/** Back to the live page; the comment stays in `draft`. */
export function cancelSelect(projectId: string): void {
  setSel(projectId, undefined);
}

export function setDraft(projectId: string, text: string): void {
  set(projectId, { draft: text });
}

export async function sendArea(projectId: string, thread: { id: string; title: string }): Promise<void> {
  const { sel, draft, state } = get(projectId);
  if (!sel?.picked || sel.sending || !draft.trim()) return;
  setSel(projectId, { sending: true, error: undefined });
  try {
    const files = [{ name: areaName(new Date()), bytes: sel.picked.image }];
    await window.ark.threads.send(thread.id, browserMessage(draft, state.url, sel.picked.element), files);
  } catch (e) {
    setSel(projectId, { sending: false, error: readable(e) });
    return;
  }
  const sent = `Sent to # ${thread.title}`;
  set(projectId, { sel: undefined, draft: '', sent });
  setTimeout(() => {
    if (views.has(projectId) && get(projectId).sent === sent) set(projectId, { sent: undefined });
  }, 4000);
}
