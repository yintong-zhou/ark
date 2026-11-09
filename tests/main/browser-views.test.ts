import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BrowserViews } from '../../src/main/services/browser/views';

const fake = vi.hoisted(() => {
  const image = {
    isEmpty: vi.fn(() => false),
    toDataURL: vi.fn(() => 'data:image/png;base64,frame'),
    toPNG: vi.fn(() => Buffer.from('png')),
    getSize: vi.fn(() => ({ width: 1600, height: 1200 })),
    crop: vi.fn(),
    resize: vi.fn(),
  };
  const wc = {
    session: {}, on: vi.fn(), setWindowOpenHandler: vi.fn(), close: vi.fn(),
    isDestroyed: vi.fn(() => false), getURL: vi.fn(() => 'http://localhost:5173/'),
    getTitle: () => 'Preview', isLoading: () => false, getZoomFactor: vi.fn(() => 1),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    capturePage: vi.fn(async () => image), executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined),
  };
  const view = { webContents: wc, setVisible: vi.fn(), setBounds: vi.fn() };
  return { image, wc, view };
});
vi.mock('electron', () => ({ WebContentsView: vi.fn(function () { return fake.view; }) }));
vi.mock('../../src/main/services/browser/session', () => ({ lockDown: vi.fn(), PARTITION: 'test' }));

const win = {
  isDestroyed: () => false,
  getContentBounds: () => ({ width: 1200, height: 900 }),
  contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  webContents: { getZoomFactor: vi.fn(() => 1) },
};
const bounds = { x: 10, y: 20, width: 800, height: 600 };
const rect = { x: 10, y: 20, width: 100, height: 80 };
let views: BrowserViews;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.wc.capturePage.mockReset().mockResolvedValue(fake.image);
  fake.wc.getURL.mockReturnValue('http://localhost:5173/');
  fake.wc.getZoomFactor.mockReturnValue(1);
  win.webContents.getZoomFactor.mockReturnValue(1);
  fake.image.isEmpty.mockReturnValue(false);
  fake.image.toPNG.mockReturnValue(Buffer.from('png'));
  fake.image.crop.mockReturnValue(fake.image);
  views = new BrowserViews({ win: win as unknown as Electron.BrowserWindow, send: vi.fn(), openExternal: vi.fn() });
  views.open('project');
  views.layout('project', bounds);
});
afterEach(() => vi.useRealTimers());

test('capture returns the image with its own URL and CSS size', async () => {
  expect(await views.capture('project')).toEqual({ id: 1, frame: 'data:image/png;base64,frame', url: 'http://localhost:5173/', width: 800, height: 600 });
});

test('a crop uses the captured bounds after layout changes, and omits the changed page description', async () => {
  const capture = await views.capture('project');
  views.layout('project', { ...bounds, width: 400, height: 300 });
  const picked = await views.pick('project', capture.id, rect);
  expect(fake.image.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 200, height: 160 });
  expect(picked).toEqual({ image: Buffer.from('png') });
  expect(fake.wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
});

test('a crop omits the element when the page has navigated since capture', async () => {
  const capture = await views.capture('project');
  fake.wc.getURL.mockReturnValue('http://localhost:5173/another-page');
  expect(await views.pick('project', capture.id, rect)).toEqual({ image: Buffer.from('png') });
  expect(fake.wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
});

test('reloading the same address also invalidates the element description', async () => {
  const capture = await views.capture('project');
  fake.wc.on.mock.calls.find(([event]) => event === 'did-navigate')![1]();
  expect(await views.pick('project', capture.id, rect)).toEqual({ image: Buffer.from('png') });
  expect(fake.wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
});

test('a replaced capture and malformed capture IDs cannot crop another image', async () => {
  const old = await views.capture('project');
  const current = await views.capture('project');
  for (const id of [old.id, null, String(current.id), NaN, {}]) {
    await expect(views.pick('project', id, rect)).rejects.toThrow('the page capture is gone');
  }
  expect(fake.image.crop).not.toHaveBeenCalled();
  await expect(views.pick('project', current.id, rect)).resolves.toEqual({ image: Buffer.from('png') });
});

test('empty captures and empty crops cannot become attachments', async () => {
  fake.image.isEmpty.mockReturnValue(true);
  await expect(views.capture('project')).rejects.toThrow('capture is empty');
  fake.image.isEmpty.mockReturnValue(false);
  const capture = await views.capture('project');
  fake.image.toPNG.mockReturnValue(Buffer.alloc(0));
  await expect(views.pick('project', capture.id, rect)).rejects.toThrow('selected area is empty');
});

test.each(['resize', 'navigation', 'reload', 'zoom', 'close', 'replace'] as const)('a capture interrupted by %s is discarded', async (action) => {
  let resolve!: (image: typeof fake.image) => void;
  fake.wc.capturePage.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const pending = views.capture('project');
  if (action === 'resize') views.layout('project', { ...bounds, width: 600 });
  if (action === 'navigation') fake.wc.getURL.mockReturnValue('http://localhost:5173/another-page');
  if (action === 'reload') fake.wc.on.mock.calls.find(([event]) => event === 'did-navigate')![1]();
  if (action === 'zoom') win.webContents.getZoomFactor.mockReturnValue(1.25);
  if (action === 'close') views.close('project');
  if (action === 'replace') await views.capture('project');
  resolve(fake.image);
  await expect(pending).rejects.toThrow('page changed while capturing');
});
