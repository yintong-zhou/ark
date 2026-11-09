import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BrowserCapture, BrowserState } from '@shared/browser';
import type { ArkApi } from '@shared/types';

// Read the hook's snapshot without mounting a renderer; main's state events still use the real store.
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: (cb: () => void) => () => void, snapshot: () => unknown) => {
    subscribe(() => {})();
    return snapshot();
  },
}));
vi.mock('../../src/renderer/editor/tabs-store', () => ({ focusBrowserTab: vi.fn(), dropBrowserTab: vi.fn() }));

const live: BrowserState = { url: 'http://localhost:5173/', title: 'Preview', loading: false, canBack: false, canForward: false };
let nextCapture = 0;
const frame = (): BrowserCapture => ({ id: ++nextCapture, frame: 'data:image/png;base64,frame', url: live.url, width: 800, height: 600 });
const capture = vi.fn<() => Promise<BrowserCapture>>();
const pick = vi.fn(async () => ({ image: new Uint8Array([1, 2, 3]) }));
const send = vi.fn<ArkApi['threads']['send']>(async () => {});
let onState: (id: string, state: BrowserState) => void;
vi.stubGlobal('window', {
  requestAnimationFrame: (cb: () => void) => { cb(); return 0; },
  ark: {
    browser: {
      open: async () => live,
      capture,
      pick,
      close: async () => {},
      onState: (cb: typeof onState) => { onState = cb; },
      onKey: () => {},
    },
    threads: { send },
  },
});
const store = await import('../../src/renderer/browser/browser-store');
let id = 0;
let projectId: string;
beforeEach(async () => {
  capture.mockReset().mockImplementation(async () => frame());
  pick.mockClear();
  send.mockClear();
  projectId = `browser-${++id}`;
  await store.openBrowser(projectId);
  store.setDraft(projectId, 'Keep this comment');
  await store.startSelect(projectId);
});
afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

test.each([
  { ...live, failed: { url: live.url, reason: 'Connection refused' } },
  { ...live, url: '' },
])('an unavailable page cancels selection and preserves the draft', (state) => {
  expect(store.useBrowser(projectId).sel).toBeDefined();
  onState(projectId, state);
  expect(store.useBrowser(projectId).sel).toBeUndefined();
  expect(store.useBrowser(projectId).draft).toBe('Keep this comment');
  onState(projectId, live);
  expect(store.useBrowser(projectId).sel).toBeUndefined();
});

test('ordinary state updates keep the selection and draft', () => {
  const selection = store.useBrowser(projectId).sel;
  onState(projectId, { ...live, title: 'Updated preview' });
  expect(store.useBrowser(projectId).sel).toBe(selection);
  expect(store.useBrowser(projectId).draft).toBe('Keep this comment');
});

test('sending uses the captured address even after the page navigates', async () => {
  vi.useFakeTimers();
  const captured = store.useBrowser(projectId).sel!;
  const rect = { x: 10, y: 20, width: 100, height: 80 };
  await store.pickArea(projectId, rect);
  expect(pick).toHaveBeenCalledWith(projectId, captured.id, rect);
  onState(projectId, { ...live, url: 'http://localhost:5173/another-page' });
  await store.sendArea(projectId, { id: 'thread', title: 'Preview' });
  expect(send).toHaveBeenCalledWith('thread', expect.stringContaining(`From the browser: ${live.url}`), expect.any(Array));
  expect(send.mock.calls[0][1]).not.toContain('another-page');
});

test('only one capture starts while another is pending', async () => {
  store.cancelSelect(projectId);
  const gate = deferred<BrowserCapture>();
  capture.mockClear().mockReturnValueOnce(gate.promise);
  const pending = store.startSelect(projectId);
  await store.startSelect(projectId);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(store.useBrowser(projectId).capturing).toBe(true);
  const result = frame();
  gate.resolve(result);
  await pending;
  expect(store.useBrowser(projectId).sel).toBe(result);
  expect(store.useBrowser(projectId).capturing).toBe(false);
});

test.each(['cancel', 'failure', 'close'] as const)('a capture finishing after %s cannot reopen selection', async (action) => {
  store.cancelSelect(projectId);
  const gate = deferred<BrowserCapture>();
  capture.mockReturnValueOnce(gate.promise);
  const pending = store.startSelect(projectId);
  if (action === 'cancel') store.cancelSelect(projectId);
  if (action === 'failure') {
    onState(projectId, { ...live, failed: { url: live.url, reason: 'Connection refused' } });
    onState(projectId, live);
  }
  if (action === 'close') {
    await store.closeBrowser(projectId);
    onState(projectId, live); // an already queued event must not recreate the browser
  }
  gate.resolve(frame());
  await pending;
  expect(store.useBrowser(projectId).sel).toBeUndefined();
  expect(store.useBrowser(projectId).capturing).toBeFalsy();
  if (action === 'close') expect(store.useBrowser(projectId).open).toBe(false);
  else expect(store.useBrowser(projectId).draft).toBe('Keep this comment');
});

test('a cancelled capture failing after a new capture cannot replace it with an error', async () => {
  store.cancelSelect(projectId);
  const old = deferred<BrowserCapture>();
  capture.mockReturnValueOnce(old.promise);
  const pending = store.startSelect(projectId);
  store.cancelSelect(projectId);
  await store.startSelect(projectId);
  const selected = store.useBrowser(projectId).sel;
  old.reject(new Error('old capture failed'));
  await pending;
  expect(store.useBrowser(projectId).sel).toBe(selected);
  expect(store.useBrowser(projectId).error).toBeUndefined();
});

test('a capture can be retried after its error bar is cleared', async () => {
  store.cancelSelect(projectId);
  capture.mockRejectedValueOnce(new Error('capture failed'));
  await store.startSelect(projectId);
  expect(store.useBrowser(projectId).error).toBe('capture failed');
  await store.startSelect(projectId);
  expect(store.useBrowser(projectId).sel).toBeDefined();
  expect(store.useBrowser(projectId).error).toBeUndefined();
});

test('cancelling while retry waits for layout prevents the capture from starting', async () => {
  store.cancelSelect(projectId);
  capture.mockRejectedValueOnce(new Error('capture failed'));
  await store.startSelect(projectId);
  capture.mockClear();
  const pending = store.startSelect(projectId);
  store.cancelSelect(projectId);
  await pending;
  expect(capture).not.toHaveBeenCalled();
  expect(store.useBrowser(projectId).capturing).toBe(false);
});
