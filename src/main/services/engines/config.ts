import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Tier } from '@shared/agent-file';
import type { EngineInfo, EnginesConfig } from '@shared/types';
import { detect, run } from '../exec';
import { writeAtomic } from '../files';
import { obj } from '../json';

const TIERS: readonly Tier[] = ['light', 'standard', 'heavy'];
const MODEL = /^[\w.-]{1,64}$/;
const file = (userData: string) => join(userData, 'engines.json');

function path(v: unknown, what: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !isAbsolute(v) || !/\.(exe|cmd|bat)$/i.test(v)) {
    throw new Error(`${what}: use the full path of an .exe, .cmd or .bat file`);
  }
  return v;
}

/** Checks an engines config from outside and returns a clean copy (unknown keys dropped). Throws on invalid. */
export function validateEngines(c: unknown): EnginesConfig {
  const top = obj(c);
  if (!top) throw new Error('engines: must be an object');
  const out: EnginesConfig = {};
  const claude = top.claude === undefined ? undefined : obj(top.claude);
  if (top.claude !== undefined) {
    if (!claude) throw new Error('claude: must be an object');
    out.claude = { path: path(claude.path, 'claude.path') };
  }
  const codex = top.codex === undefined ? undefined : obj(top.codex);
  if (top.codex !== undefined) {
    if (!codex) throw new Error('codex: must be an object');
    out.codex = { path: path(codex.path, 'codex.path') };
    if (codex.tiers !== undefined) {
      const tiers = obj(codex.tiers);
      if (!tiers) throw new Error('codex.tiers: must be an object');
      const clean: Partial<Record<Tier, string>> = {};
      for (const [k, v] of Object.entries(tiers)) {
        if (!(TIERS as readonly string[]).includes(k)) throw new Error(`codex.tiers: unknown tier ${k}`);
        if (typeof v !== 'string' || !MODEL.test(v)) throw new Error(`codex.tiers.${k}: not a model name`);
        clean[k as Tier] = v;
      }
      out.codex.tiers = clean;
    }
  }
  // JSON has no undefined: drop empty paths so the result compares and round-trips cleanly
  for (const e of [out.claude, out.codex]) if (e && e.path === undefined) delete e.path;
  return out;
}

/** `<userData>/engines.json`; a missing or invalid file reads as {}. */
export function readEngines(userData: string): EnginesConfig {
  try {
    return validateEngines(JSON.parse(readFileSync(file(userData), 'utf8')));
  } catch {
    return {};
  }
}

/** Applies a patch per engine key: keys in the patch override, everything else (other engine, tiers) is kept. */
export function mergeEngines(current: EnginesConfig, patch: EnginesConfig): EnginesConfig {
  const out: EnginesConfig = { ...current };
  if (patch.claude) out.claude = { ...current.claude, ...patch.claude };
  if (patch.codex) out.codex = { ...current.codex, ...patch.codex };
  return out;
}

export function writeEngines(userData: string, c: EnginesConfig): void {
  const clean = validateEngines(c);
  mkdirSync(userData, { recursive: true });
  writeAtomic(file(userData), JSON.stringify(clean, null, 2));
}

/** Each engine: the configured path when that file exists (manual), otherwise whatever is on PATH. */
export async function engineStatus(c: EnginesConfig, detectFn: typeof detect = detect): Promise<EngineInfo[]> {
  const one = async (id: EngineInfo['id']): Promise<EngineInfo> => {
    const manual = c[id]?.path;
    if (manual && existsSync(manual)) {
      const r = await run(manual, ['--version']);
      return { id, installed: true, path: manual, version: r.stdout.match(/\d+\.\d+\.\d+/)?.[0], manual: true };
    }
    const d = await detectFn(id);
    return { id, ...d, manual: false };
  };
  return Promise.all([one('claude'), one('codex')]);
}
