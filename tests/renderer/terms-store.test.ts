import { beforeEach, expect, test, vi } from 'vitest';
import type { RootRef } from '@shared/files';
import type { ShellOption } from '@shared/terminal';

/** xterm, as far as the store uses it. */
class FakeTerminal {
  written: string[] = [];
  opened = 0;
  disposed = false;
  cols = 80;
  rows = 24;
  selection = '';
  data?: (d: string) => void;
  keys?: (e: Partial<KeyboardEvent>) => boolean;
  write = (s: string) => void this.written.push(s);
  open = () => void this.opened++;
  loadAddon = () => {};
  onData = (cb: (d: string) => void) => (this.data = cb);
  onResize = () => {};
  attachCustomKeyEventHandler = (cb: (e: Partial<KeyboardEvent>) => boolean) => (this.keys = cb);
  getSelection = () => this.selection;
  hasSelection = () => this.selection !== '';
  clearSelection = () => (this.selection = '');
  dispose = () => (this.disposed = true);
}
const xterms: FakeTerminal[] = [];
vi.mock('../../src/renderer/terminal/xterm', () => ({
  loadXterm: async () => ({
    Terminal: class extends FakeTerminal {
      constructor() {
        super();
        xterms.push(this);
      }
    },
    FitAddon: class {
      fit = () => {};
    },
  }),
}));

let nextId = 0;
let gate: Promise<void> = Promise.resolve();
let emitData: (id: string, chunk: string) => void = () => {};
let emitExit: (id: string, code: number) => void = () => {};
const terminal = {
  shells: vi.fn(async (): Promise<ShellOption[]> => [{ id: 'powershell', name: 'PowerShell' }]),
  create: vi.fn(async () => {
    const id = `id-${++nextId}`;
    await gate;
    return id;
  }),
  write: vi.fn(async () => {}),
  resize: vi.fn(async () => {}),
  kill: vi.fn(async () => {}),
  onData: vi.fn((cb: typeof emitData) => ((emitData = cb), () => {})),
  onExit: vi.fn((cb: typeof emitExit) => ((emitExit = cb), () => {})),
};
const copied: string[] = [];
vi.stubGlobal('window', { ark: { terminal }, addEventListener: () => {} });
vi.stubGlobal('document', { documentElement: {}, createElement: () => ({ className: '', remove: () => {} }) });
vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000000' }));
vi.stubGlobal('navigator', { clipboard: { writeText: async (s: string) => void copied.push(s) } });

const store = await import('../../src/renderer/terminal/terms-store');
const root: RootRef = { kind: 'project', id: '0b5d6a3e-1f2a-4c3b-9d8e-7f6a5b4c3d2e' };
const PS: ShellOption = { id: 'powershell', name: 'PowerShell' };
const BASH: ShellOption = { id: 'gitbash', name: 'Git Bash' };
let P = 'p0';
let n = 0;

beforeEach(() => {
  P = `p${++n}`; // a fresh project per test: the store is module-level
  gate = Promise.resolve();
  vi.clearAllMocks();
});

test('data that arrives before create resolves is written once the terminal exists', async () => {
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const made = store.create(P, root, PS);
  await vi.waitFor(() => expect(terminal.create).toHaveBeenCalled());
  emitData(`id-${nextId}`, 'banner');
  release();
  await made;
  expect(xterms.at(-1)!.written).toEqual(['banner']);
  emitData(`id-${nextId}`, 'more');
  expect(xterms.at(-1)!.written).toEqual(['banner', 'more']);
});

test('output for an id with no create in flight is dropped, not held', async () => {
  // a terminal closed while main still had output in flight: nobody will ever claim it
  emitData(`id-${nextId + 1}`, 'stale');
  await store.create(P, root, PS); // gets id-(nextId + 1)
  expect(xterms.at(-1)!.written).toEqual([]);
});

test('held output nobody claimed is freed once the creates in flight are done', async () => {
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const made = store.create(P, root, PS);
  await vi.waitFor(() => expect(terminal.create).toHaveBeenCalled());
  emitData(`id-${nextId + 1}`, 'stale'); // not the id being created
  release();
  await made;
  gate = Promise.resolve();
  await store.create(P, root, PS); // gets that id
  expect(xterms.at(-1)!.written).toEqual([]);
});

test('toggling during the first create starts only one PowerShell, and the view says it is starting', async () => {
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  store.toggle(P, root);
  expect(store.termsOf(P).starting).toBe(true);
  store.toggle(P, root);
  store.toggle(P, root);
  release();
  await vi.waitFor(() => expect(store.termsOf(P).terms).toHaveLength(1));
  expect(terminal.create).toHaveBeenCalledTimes(1);
  expect(store.termsOf(P).starting).toBe(false);
});

test('a write longer than 64 KB is sent in order in chunks of at most 65 536', async () => {
  await store.create(P, root, PS);
  const input = 'abcd'.repeat(50_000);
  xterms.at(-1)!.data!(input);
  const sent = terminal.write.mock.calls.map((c) => (c as unknown as [string, string])[1]);
  expect(sent.map((s) => s.length)).toEqual([65536, 65536, 65536, 3392]);
  expect(sent.join('')).toBe(input);
});

test('names count per shell per project', async () => {
  await store.create(P, root, PS);
  await store.create(P, root, PS);
  await store.create(P, root, BASH);
  const other = `${P}-other`;
  await store.create(other, root, PS);
  expect(store.termsOf(P).terms.map((t) => t.name)).toEqual(['PowerShell 1', 'PowerShell 2', 'Git Bash 1']);
  expect(store.termsOf(other).terms.map((t) => t.name)).toEqual(['PowerShell 1']);
  expect(store.termsOf(P).active).toBe(store.termsOf(P).terms[2].id);
});

test('exit marks the term and writes the notice', async () => {
  await store.create(P, root, PS);
  const id = store.termsOf(P).terms[0].id;
  emitExit(id, 2);
  expect(store.termsOf(P).terms[0].exited).toBe(2);
  expect(xterms.at(-1)!.written.at(-1)).toContain('Process exited (code 2)');
});

test('closing an exited terminal does not call kill', async () => {
  await store.create(P, root, PS);
  const id = store.termsOf(P).terms[0].id;
  emitExit(id, 0);
  store.closeTerm(P, id);
  expect(terminal.kill).not.toHaveBeenCalled();
  expect(xterms.at(-1)!.disposed).toBe(true);
  expect(store.termsOf(P).terms).toEqual([]);
});

test('closing a live terminal kills it and activates its neighbour', async () => {
  await store.create(P, root, PS);
  await store.create(P, root, PS);
  const [a, b] = store.termsOf(P).terms.map((t) => t.id);
  store.closeTerm(P, b);
  expect(terminal.kill).toHaveBeenCalledWith(b);
  expect(store.termsOf(P).active).toBe(a);
});

test('toggle on a project with no terminals opens the panel and creates PowerShell', async () => {
  store.toggle(P, root);
  expect(store.termsOf(P).open).toBe(true);
  await vi.waitFor(() => expect(store.termsOf(P).terms.map((t) => t.name)).toEqual(['PowerShell 1']));
  expect(terminal.create).toHaveBeenCalledWith(root, 'powershell', 80, 24);
  store.toggle(P, root);
  expect(store.termsOf(P).open).toBe(false);
  store.toggle(P, root);
  expect(terminal.create).toHaveBeenCalledTimes(1); // reopening keeps the one it has
});

test('creating a chosen shell reveals the panel and uses the selected root without starting a default shell', async () => {
  const worktree: RootRef = { kind: 'thread', id: 'b05a1af8-a773-4af8-b501-ad1c61107f52' };
  await store.create(P, worktree, BASH);
  expect(store.termsOf(P).open).toBe(true);
  expect(store.termsOf(P).terms.map((t) => t.name)).toEqual(['Git Bash 1']);
  expect(terminal.create).toHaveBeenCalledExactlyOnceWith(worktree, 'gitbash', 80, 24);
  store.toggle(P, worktree);
  expect(store.termsOf(P).open).toBe(false);
  await store.create(P, worktree, PS);
  expect(store.termsOf(P).open).toBe(true);
  expect(store.termsOf(P).terms).toHaveLength(2);
});

test('hiding the panel while a chosen shell starts keeps it hidden after creation completes', async () => {
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const made = store.create(P, root, BASH);
  expect(store.termsOf(P).open).toBe(true);
  store.toggle(P, root);
  release();
  await made;
  expect(store.termsOf(P).open).toBe(false);
  expect(store.termsOf(P).terms.map((t) => t.name)).toEqual(['Git Bash 1']);
});

test('a failed create shows its message and leaves no terminal', async () => {
  terminal.create.mockRejectedValueOnce(new Error('Worktree not found'));
  await store.create(P, root, PS);
  expect(store.termsOf(P).error).toBe('Worktree not found');
  expect(store.termsOf(P).terms).toEqual([]);
  expect(xterms.at(-1)!.disposed).toBe(true);
  await store.create(P, root, PS);
  expect(store.termsOf(P).error).toBeUndefined();
});

test('Ctrl+C copies a selection instead of reaching the shell, and Ctrl+V and Ctrl+` are left to the page', async () => {
  await store.create(P, root, PS);
  const x = xterms.at(-1)!;
  const key = (e: Partial<KeyboardEvent>) => x.keys!({ type: 'keydown', ctrlKey: true, ...e });
  expect(key({ key: 'c', code: 'KeyC' })).toBe(true); // no selection: ^C goes to the shell
  x.selection = 'hello';
  expect(key({ key: 'c', code: 'KeyC' })).toBe(false);
  expect(copied.at(-1)).toBe('hello');
  expect(x.selection).toBe('');
  expect(key({ key: 'v', code: 'KeyV' })).toBe(false);
  expect(key({ key: '\\', code: 'Backquote' })).toBe(false);
  expect(key({ key: 'a', code: 'KeyA' })).toBe(true);
});

test('panel height clamps to 0.15..0.85', () => {
  expect(store.panelHeight()).toBe(0.35);
  store.setPanelHeight(0.05);
  expect(store.panelHeight()).toBe(0.15);
  store.setPanelHeight(0.99);
  expect(store.panelHeight()).toBe(0.85);
  store.setPanelHeight(0.5);
  expect(store.panelHeight()).toBe(0.5);
});
