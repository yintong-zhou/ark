import { useSyncExternalStore } from 'react';
import { toAddress, type BrowserKey, type BrowserState } from '@shared/browser';
import { readable } from '../errors';
import { dropBrowserTab, focusBrowserTab } from '../editor/tabs-store';

/**
 * Each project's browser tab, kept at module level so the address and state outlive the pane (the view itself lives in
 * main until `closeBrowser`).
 */
export type BrowserView = { open: boolean; state: BrowserState; address: string; error?: string };

const BLANK: BrowserState = { url: '', title: '', loading: false, canBack: false, canForward: false };
const EMPTY: BrowserView = { open: false, state: BLANK, address: '' };

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
