import { useSyncExternalStore } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { RootRef } from '@shared/files';
import type { ShellId, ShellOption } from '@shared/terminal';
import { readable } from '../errors';
import { loadXterm } from './xterm';

/**
 * The bottom panel's terminals, kept at module level so the shells, their scrollback and the panel survive leaving
 * the Threads area (spec §5.5). Each xterm draws into its own detached <div>, which the panel attaches while shown.
 */
export type Term = { id: string; name: string; el: HTMLDivElement; xterm: Terminal; fit: FitAddon; exited?: number };
/** `starting`: a terminal is being created (the panel says so instead of staying blank). */
export type TermsView = { terms: Term[]; active: string | null; open: boolean; starting: boolean; error?: string };

type Proj = { ids: string[]; active: string | null; open: boolean; starting: number; error?: string; counts: Partial<Record<ShellId, number>> };

const POWERSHELL: ShellOption = { id: 'powershell', name: 'PowerShell' };
const MAX_WRITE = 65_536; // main refuses more per call

const terms = new Map<string, Term>();
const opened = new WeakSet<Term['xterm']>();
const projects = new Map<string, Proj>();
// Output or an exit can beat the create reply (cmd.exe prints its banner at once): held until the term exists. Only
// while a create is in flight, and freed when none is: output for a terminal already closed is never claimed.
const early = new Map<string, { data: string[]; exit?: number }>();
let creating = 0;
const held = (id: string) => {
  let h = early.get(id);
  if (!h) early.set(id, (h = { data: [] }));
  return h;
};
const snaps = new Map<string, TermsView>();
const listeners = new Set<() => void>();
let height = 0.35;
const EMPTY: TermsView = { terms: [], active: null, open: false, starting: false };

function emit() {
  snaps.clear();
  listeners.forEach((l) => l());
}

const proj = (projectId: string): Proj => {
  let p = projects.get(projectId);
  if (!p) projects.set(projectId, (p = { ids: [], active: null, open: false, starting: 0, counts: {} }));
  return p;
};

function exited(id: string, code: number) {
  const t = terms.get(id);
  if (!t) return;
  t.xterm.write(`\r\n\x1b[2m[Process exited (code ${code})]\x1b[0m\r\n`);
  terms.set(id, { ...t, exited: code });
  emit();
}

let subscribed = false;
function listen() {
  if (subscribed) return;
  subscribed = true;
  window.ark.terminal.onData((id, chunk) => {
    const t = terms.get(id);
    if (t) t.xterm.write(chunk);
    else if (creating > 0) held(id).data.push(chunk);
  });
  window.ark.terminal.onExit((id, code) => {
    if (terms.has(id)) exited(id, code);
    else if (creating > 0) held(id).exit = code;
  });
}

/** The brand's colours from index.css, read at runtime like Monaco's theme. */
function theme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
  return { background: v('primary'), foreground: v('neutral-light'), cursor: v('secondary') };
}

/** Ctrl+C copies a selection (else it is ^C for the shell); Ctrl+V and Ctrl+` belong to the page. */
const keys = (x: Terminal) => (e: KeyboardEvent) => {
  if (e.type !== 'keydown' || !e.ctrlKey) return true;
  if (e.code === 'KeyC' && x.hasSelection()) {
    void navigator.clipboard.writeText(x.getSelection());
    x.clearSelection();
    return false;
  }
  return e.code !== 'KeyV' && e.code !== 'Backquote';
};

export async function create(projectId: string, root: RootRef, shell: ShellOption): Promise<void> {
  listen();
  const p = proj(projectId);
  const n = (p.counts[shell.id] ?? 0) + 1;
  p.counts[shell.id] = n;
  creating++;
  projects.set(projectId, { ...p, starting: p.starting + 1 });
  emit();
  let xterm: Terminal | undefined;
  try {
    const { Terminal, FitAddon } = await loadXterm();
    const x = (xterm = new Terminal({ scrollback: 5000, fontFamily: "'Cascadia Mono', Consolas, monospace", fontSize: 13, theme: theme() }));
    const fit = new FitAddon();
    x.loadAddon(fit);
    const id = await window.ark.terminal.create(root, shell.id, x.cols || 80, x.rows || 24);
    const el = document.createElement('div');
    el.className = 'h-full w-full';
    terms.set(id, { id, name: `${shell.name} ${n}`, el, xterm: x, fit });
    x.onData((d) => {
      for (let i = 0; i < d.length; i += MAX_WRITE) void window.ark.terminal.write(id, d.slice(i, i + MAX_WRITE)).catch(() => {});
    });
    x.onResize(({ cols, rows }) => void window.ark.terminal.resize(id, cols, rows).catch(() => {}));
    x.attachCustomKeyEventHandler(keys(x));
    const h = early.get(id);
    early.delete(id);
    h?.data.forEach((c) => x.write(c));
    if (h?.exit !== undefined) exited(id, h.exit);
    const cur = proj(projectId);
    projects.set(projectId, { ...cur, ids: [...cur.ids, id], active: id, error: undefined });
  } catch (e) {
    xterm?.dispose();
    projects.set(projectId, { ...proj(projectId), error: readable(e) });
  }
  if (--creating === 0) early.clear(); // every create in flight has claimed its own: the rest is orphaned
  const after = proj(projectId);
  projects.set(projectId, { ...after, starting: after.starting - 1 });
  emit();
}

/** Opens or closes the panel; the first open with no terminals starts PowerShell. */
export function toggle(projectId: string, root: RootRef): void {
  const p = proj(projectId);
  projects.set(projectId, { ...p, open: !p.open });
  emit();
  if (!p.open && p.ids.length === 0 && p.starting === 0) void create(projectId, root, POWERSHELL);
}

export function activateTerm(projectId: string, id: string): void {
  const p = proj(projectId);
  if (p.active === id) return;
  projects.set(projectId, { ...p, active: id });
  emit();
}

export function closeTerm(projectId: string, id: string): void {
  const t = terms.get(id);
  if (!t) return;
  if (t.exited === undefined) void window.ark.terminal.kill(id).catch(() => {});
  t.xterm.dispose();
  t.el.remove();
  terms.delete(id);
  const p = proj(projectId);
  const i = p.ids.indexOf(id);
  const ids = p.ids.filter((x) => x !== id);
  projects.set(projectId, { ...p, ids, active: p.active === id ? (ids[Math.min(i, ids.length - 1)] ?? null) : p.active });
  emit();
}

/** Puts the term's <div> in `host` (xterm opens on first attach, once it can measure), then fits it. */
export function attach(t: Term, host: HTMLElement): void {
  if (t.el.parentElement !== host) host.appendChild(t.el);
  if (!opened.has(t.xterm)) {
    opened.add(t.xterm);
    t.xterm.open(t.el);
  }
  fitTerm(t);
}

/** Resizes the xterm to its box; xterm's onResize then tells the pty. */
export function fitTerm(t: Term): void {
  if (t.el.isConnected && t.el.clientWidth > 0) t.fit.fit();
}

let shellList: Promise<ShellOption[]> | undefined;
export const shells = (): Promise<ShellOption[]> => (shellList ??= window.ark.terminal.shells());

export const panelHeight = (): number => height;
export function setPanelHeight(f: number): void {
  height = Math.min(0.85, Math.max(0.15, f));
  emit();
}

/** A project's terminals as they are now; the same object until something changes. */
export function termsOf(projectId: string | undefined): TermsView {
  if (!projectId) return EMPTY;
  let s = snaps.get(projectId);
  if (!s) {
    const p = proj(projectId);
    s = { terms: p.ids.map((id) => terms.get(id)).filter((t): t is Term => !!t), active: p.active, open: p.open, starting: p.starting > 0, error: p.error };
    snaps.set(projectId, s);
  }
  return s;
}

function subscribe(l: () => void) {
  listen();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTerms(projectId: string | undefined): TermsView {
  return useSyncExternalStore(subscribe, () => termsOf(projectId));
}
