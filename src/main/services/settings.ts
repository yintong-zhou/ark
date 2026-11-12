import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineId } from '@shared/agent-file';
import type { ViewMode } from '@shared/types';
import { checkHeadSettings, headWith } from './head-of-staff';

const file = (userData: string) => join(userData, 'settings.json');
function read(userData: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(file(userData), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
function write(userData: string, value: Record<string, unknown>): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(file(userData), JSON.stringify(value, null, 2));
}
export function readView(userData: string): ViewMode {
  return read(userData).view === 'detailed' ? 'detailed' : 'compact';
}
export function writeView(userData: string, v: ViewMode): void {
  write(userData, { ...read(userData), view: v });
}
export function readHead(userData: string) {
  return headWith(read(userData).headOfStaff);
}
export function writeHead(userData: string, v: unknown): void {
  write(userData, { ...read(userData), headOfStaff: checkHeadSettings(v) });
}
export function readHandoffThresholds(userData: string): Record<EngineId, number> {
  const raw = read(userData).handoffThresholds;
  const values = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const get = (id: EngineId) => typeof values[id] === 'number' && Number.isInteger(values[id]) && values[id] >= 1 && values[id] <= 100 ? values[id] : 40;
  return { claude: get('claude'), codex: get('codex') };
}
export function writeHandoffThreshold(userData: string, engine: EngineId, percent: number): void {
  if ((engine !== 'claude' && engine !== 'codex') || !Number.isInteger(percent) || percent < 1 || percent > 100) throw new Error('invalid handoff threshold');
  write(userData, { ...read(userData), handoffThresholds: { ...readHandoffThresholds(userData), [engine]: percent } });
}
