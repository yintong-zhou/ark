import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { StatuslineStatus } from '@shared/types';
import { writeAtomic } from './files';
import { obj, str } from './json';

export type StatuslinePaths = {
  claudeSettings: string;
  userData: string;
  wrapperSource: string;
  runner: { kind: 'node' } | { kind: 'electron'; exe: string };
  /** The shell Claude Code runs status lines in (Git Bash on Windows); the wrapper runs the original in it. */
  shell?: string;
};

type State = { originalCommand: string | null; ourCommand: string; backupPath: string; shell?: string };

/** Any command that runs an Ark wrapper is Ark's own, even if node/Ark.exe/userData moved since. */
const isArkCommand = (cmd?: string) => !!cmd && cmd.includes('statusline-wrapper.cjs');

const slash = (p: string) => p.replace(/\\/g, '/');

export function buildCommand(runner: StatuslinePaths['runner'], wrapperPath: string): string {
  return runner.kind === 'node'
    ? `node "${slash(wrapperPath)}"`
    : `ELECTRON_RUN_AS_NODE=1 "${slash(runner.exe)}" "${slash(wrapperPath)}"`;
}

const statePath = (p: StatuslinePaths) => join(p.userData, 'statusline-original.json');

function readState(p: StatuslinePaths): State | undefined {
  try {
    return JSON.parse(readFileSync(statePath(p), 'utf8')) as State;
  } catch {
    return undefined;
  }
}

/** Parse the user's Claude settings. A missing file is {}; an invalid one throws, so nothing gets written. */
function readSettings(p: StatuslinePaths): Record<string, unknown> {
  if (!existsSync(p.claudeSettings)) return {};
  const parsed = obj(JSON.parse(readFileSync(p.claudeSettings, 'utf8')));
  if (!parsed) throw new Error(`${p.claudeSettings} is not a JSON object`);
  return parsed;
}

const currentCommand = (settings: Record<string, unknown>) => str(obj(settings.statusLine)?.command);

export function statuslineStatus(p: StatuslinePaths): StatuslineStatus {
  const state = readState(p);
  if (!state) return 'disconnected';
  let settings: Record<string, unknown>;
  try {
    settings = readSettings(p);
  } catch {
    return 'bypassed'; // unreadable settings: we can't claim to be connected
  }
  return currentCommand(settings) === state.ourCommand ? 'connected' : 'bypassed';
}

/** Wrap the user's status line with Ark's wrapper. Only called on an explicit user click. */
export function connectStatusline(p: StatuslinePaths): StatuslineStatus {
  const settings = readSettings(p); // throws before any write on invalid JSON
  mkdirSync(join(p.userData, 'backups'), { recursive: true });
  const wrapperPath = join(p.userData, 'statusline-wrapper.cjs');
  const ourCommand = buildCommand(p.runner, wrapperPath);
  const cur = currentCommand(settings);
  // Never record our own command as "original": the wrapper would call itself forever.
  const originalCommand = isArkCommand(cur) ? (readState(p)?.originalCommand ?? null) : (cur ?? null);

  const backupPath = join(p.userData, 'backups', `claude-settings-${Date.now()}.json`);
  if (existsSync(p.claudeSettings)) copyFileSync(p.claudeSettings, backupPath);
  copyFileSync(p.wrapperSource, wrapperPath);
  const state: State = { originalCommand, ourCommand, backupPath, shell: p.shell };
  writeAtomic(statePath(p), JSON.stringify(state, null, 2));

  settings.statusLine = { ...obj(settings.statusLine), type: 'command', command: ourCommand };
  writeAtomic(p.claudeSettings, JSON.stringify(settings, null, 2) + '\n');
  return 'connected';
}

/** Restore the user's original status line. If they changed it since, leave their settings alone. */
export function disconnectStatusline(p: StatuslinePaths): StatuslineStatus {
  const state = readState(p);
  if (!state) return 'disconnected';
  if (statuslineStatus(p) === 'connected') {
    const settings = readSettings(p);
    if (state.originalCommand === null) delete settings.statusLine;
    else settings.statusLine = { ...obj(settings.statusLine), command: state.originalCommand };
    writeAtomic(p.claudeSettings, JSON.stringify(settings, null, 2) + '\n');
  }
  unlinkSync(statePath(p));
  return 'disconnected';
}
