import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { kindOf, type Attachment, type Upload } from '@shared/attachments';
import type { NewMessage, Project, Thread, ThreadMessage } from '@shared/thread';
import { writeAtomic } from '../files';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A stored attachment: 8 hex digits, a dash, then a plain file name. Nothing that could leave the folder matches.
const STORED = /^[0-9a-f]{8}-[\w.-]{1,120}$/;

/** Projects and threads on disk under `root` (spec §11): projects.json, threads/<id>/{thread.json,messages.jsonl,plan.md}. */
export class ThreadStore {
  private readonly lastSeq = new Map<string, number>();

  constructor(private readonly root: string) {}

  private dir(id: string): string {
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Unknown thread');
    return join(this.root, 'threads', id);
  }

  private allProjects(): (Project & { archived?: boolean })[] {
    try {
      const p = JSON.parse(readFileSync(join(this.root, 'projects.json'), 'utf8'));
      return Array.isArray(p) ? p : [];
    } catch {
      return []; // missing or unreadable file: no projects
    }
  }

  projects(): Project[] {
    return this.allProjects().filter((p) => !p.archived);
  }

  private saveProjects(ps: (Project & { archived?: boolean })[]): void {
    mkdirSync(this.root, { recursive: true });
    writeAtomic(join(this.root, 'projects.json'), JSON.stringify(ps, null, 2));
  }

  addProject(dir: string): Project {
    const d = resolve(dir);
    const ps = this.allProjects();
    const found = ps.find((p) => p.dir === d);
    if (found) {
      if (found.archived) {
        delete found.archived;
        this.saveProjects(ps);
      }
      return found;
    }
    const p: Project = { id: randomUUID(), name: basename(d), dir: d, git: existsSync(join(d, '.git')) };
    this.saveProjects([...ps, p]);
    return p;
  }

  removeProject(id: string): void {
    const ps = this.allProjects();
    if (!ps.some((p) => p.id === id)) throw new Error('Unknown project');
    const p = ps.find((p) => p.id === id && !p.archived);
    if (!p) throw new Error('Unknown project');
    if (this.threads().some((t) => t.projectId === id && t.status === 'running')) throw new Error('Pause the project\'s running threads before removing it');
    p.archived = true;
    this.saveProjects(ps);
  }

  async removeThread(id: string, trash: (path: string) => Promise<void>): Promise<void> {
    if (!this.get(id)) throw new Error('Unknown thread');
    await trash(this.dir(id));
    this.lastSeq.delete(id);
  }

  setGit(id: string): Project {
    const ps = this.allProjects();
    const p = ps.find((x) => x.id === id && !x.archived);
    if (!p) throw new Error('Unknown project');
    p.git = existsSync(join(p.dir, '.git'));
    this.saveProjects(ps);
    return p;
  }

  /** Newest first. A thread folder with a missing or broken thread.json is skipped. */
  threads(): Thread[] {
    let ids: string[];
    try {
      ids = readdirSync(join(this.root, 'threads'));
    } catch {
      return [];
    }
    return ids
      .filter((id) => UUID.test(id))
      .map((id) => this.get(id))
      .filter((t): t is Thread => !!t)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Thread | undefined {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), 'thread.json'), 'utf8'));
    } catch {
      return undefined;
    }
  }

  create(projectId: string, title: string): Thread {
    if (!this.projects().some((p) => p.id === projectId)) throw new Error('Unknown project');
    const t: Thread = {
      id: randomUUID(), projectId, title, createdAt: Date.now(),
      phase: 'team', status: 'idle', team: [], agentTurns: 0,
      retried: false, summarizing: false, cursors: {}, handoffs: {},
    };
    this.save(t);
    return t;
  }

  save(t: Thread): void {
    const d = this.dir(t.id);
    mkdirSync(d, { recursive: true });
    writeAtomic(join(d, 'thread.json'), JSON.stringify(t, null, 2));
  }

  /** The transcript in order. Lines that don't parse are skipped. */
  messages(id: string): ThreadMessage[] {
    let raw: string;
    try {
      raw = readFileSync(join(this.dir(id), 'messages.jsonl'), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const out: ThreadMessage[] = [];
    for (const line of raw.split('\n')) {
      try {
        const m = line.trim() ? JSON.parse(line) : undefined;
        if (m && typeof m === 'object' && typeof m.seq === 'number') out.push(m);
      } catch {
        // a torn or corrupt line must not hide the rest
      }
    }
    return out;
  }

  append(id: string, m: NewMessage): ThreadMessage {
    const d = this.dir(id);
    const file = join(d, 'messages.jsonl');
    let last = this.lastSeq.get(id);
    let prefix = '';
    if (last === undefined) {
      last = this.messages(id).reduce((n, x) => Math.max(n, x.seq), 0);
      // a torn last line (no '\n', from a crash) must not swallow this message
      try {
        const raw = readFileSync(file, 'utf8');
        if (raw && !raw.endsWith('\n')) prefix = '\n';
      } catch {
        // no file yet
      }
    }
    const msg = { ...m, seq: last + 1, at: Date.now() } as ThreadMessage;
    mkdirSync(d, { recursive: true });
    appendFileSync(file, prefix + JSON.stringify(msg) + '\n');
    this.lastSeq.set(id, msg.seq);
    return msg;
  }

  /** Keeps an uploaded file under the thread's files folder and describes it for the transcript. */
  saveFile(id: string, f: Upload): Attachment {
    const k = kindOf(f.name);
    if (!k) throw new Error(`${f.name} isn't supported`);
    const dir = join(this.dir(id), 'files');
    mkdirSync(dir, { recursive: true });
    const file = `${randomUUID().slice(0, 8)}-${f.name.replace(/[^\w.-]+/g, '_').slice(-100)}`;
    writeFileSync(join(dir, file), f.bytes);
    return { name: f.name, file, kind: k.kind, mime: k.mime, size: f.bytes.byteLength };
  }

  /** The bytes of a stored attachment. Only names this store made are accepted. */
  readFile(id: string, file: string): Buffer {
    if (!STORED.test(file)) throw new Error('Unknown attachment');
    return readFileSync(join(this.dir(id), 'files', file));
  }

  writePlan(id: string, text: string): string {
    const d = this.dir(id);
    mkdirSync(d, { recursive: true });
    const file = join(d, 'plan.md');
    writeAtomic(file, text);
    return file;
  }

  /** After a crash or close: a thread left `running` has no live sessions any more. */
  recover(): void {
    for (const t of this.threads()) {
      if (t.status !== 'running') continue;
      try {
        // note first: if save then fails, the thread stays running and is recovered on the next start
        this.append(t.id, { kind: 'note', text: 'Ark was closed during a turn. Send a message to continue.' });
        this.save({ ...t, status: 'idle', speaking: undefined, cursors: {}, approvals: undefined }); // JSON drops the undefined keys
      } catch {
        // one unreadable thread must not stop the others (or app start)
      }
    }
  }
}
