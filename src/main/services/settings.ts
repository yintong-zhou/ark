import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ViewMode } from '@shared/types';

const file = (userData: string) => join(userData, 'settings.json');

export function readView(userData: string): ViewMode {
  try {
    return JSON.parse(readFileSync(file(userData), 'utf8')).view === 'detailed' ? 'detailed' : 'compact';
  } catch {
    return 'compact';
  }
}

export function writeView(userData: string, v: ViewMode): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(file(userData), JSON.stringify({ view: v }, null, 2));
}
