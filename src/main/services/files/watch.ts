import { watch, type FSWatcher } from 'node:fs';

type Entry = { watcher: FSWatcher; refs: number; rels: Set<string>; all: boolean; timer?: NodeJS.Timeout };

/**
 * One recursive fs.watch per root, shared by everyone who watches it. Changes are collected for `delayMs` and sent
 * as '/'-separated rel paths; `null` means the platform gave no name (everything may have changed). `.git` is ignored.
 */
export class RootWatcher {
  private readonly roots = new Map<string, Entry>();

  constructor(private readonly send: (key: string, rels: string[] | null) => void, private readonly delayMs = 150) {}

  watch(key: string, dir: string): void {
    const had = this.roots.get(key);
    if (had) {
      had.refs++;
      return;
    }
    const watcher = watch(dir, { recursive: true });
    const e: Entry = { watcher, refs: 1, rels: new Set(), all: false };
    watcher.on('change', (_type, name) => {
      const rel = name == null ? null : String(name).replace(/\\/g, '/');
      if (rel === '.git' || rel?.startsWith('.git/')) return;
      if (rel === null) e.all = true;
      else e.rels.add(rel);
      e.timer ??= setTimeout(() => this.flush(key, e), this.delayMs);
    });
    watcher.on('error', () => this.close(key)); // the folder went away
    this.roots.set(key, e);
  }

  unwatch(key: string): void {
    const e = this.roots.get(key);
    if (e && --e.refs <= 0) this.close(key);
  }

  closeAll(): void {
    for (const key of [...this.roots.keys()]) this.close(key);
  }

  private flush(key: string, e: Entry): void {
    e.timer = undefined;
    if (this.roots.get(key) !== e) return;
    const rels = e.all ? null : [...e.rels];
    e.rels.clear();
    e.all = false;
    this.send(key, rels);
  }

  private close(key: string): void {
    const e = this.roots.get(key);
    if (!e) return;
    clearTimeout(e.timer);
    e.watcher.close();
    this.roots.delete(key);
  }
}
