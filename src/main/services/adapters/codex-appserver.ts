import type { Account, UsageWindow } from '@shared/types';
import { num, obj, str } from '../json';
import { AppServerClient } from '../engines/app-server-client';

/**
 * One request to `codex app-server`: open (initialize + initialized), request, close.
 * Never throws: resolves undefined on any error or timeout (timeoutMs covers the whole call),
 * so the UI never breaks on Codex. Message shapes come from `codex app-server generate-ts` (Codex 0.165.0).
 */
export async function appServerRequest(codexPath: string, method: string, params: unknown, timeoutMs = 10000): Promise<unknown> {
  const started = Date.now();
  let client: AppServerClient | undefined;
  try {
    client = await AppServerClient.open(codexPath, ['app-server'], { cwd: process.cwd(), env: process.env, timeoutMs });
    return await client.request(method, params, Math.max(1, timeoutMs - (Date.now() - started)));
  } catch {
    return undefined;
  } finally {
    client?.close();
  }
}

export function parseRateLimitsResult(result: unknown): UsageWindow[] {
  const snap = obj(obj(result)?.rateLimits);
  const out: UsageWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const w = obj(snap?.[key]);
    const usedPct = num(w?.usedPercent);
    const minutes = num(w?.windowDurationMins);
    const resetsAt = num(w?.resetsAt);
    if (usedPct !== undefined && minutes !== undefined && resetsAt !== undefined) out.push({ usedPct, resetsAt, minutes });
  }
  return out;
}

export function parseAccountResult(result: unknown): Account {
  const a = obj(obj(result)?.account);
  if (!a) return { loggedIn: false, method: 'unknown' };
  if (a.type === 'chatgpt') return { loggedIn: true, method: 'subscription', email: str(a.email), plan: str(a.planType) };
  if (a.type === 'apiKey') return { loggedIn: true, method: 'apiKey' };
  return { loggedIn: true, method: 'unknown' };
}

export async function readCodexRateLimits(codexPath: string, timeoutMs = 10000): Promise<UsageWindow[]> {
  return parseRateLimitsResult(
    await appServerRequest(codexPath, 'account/rateLimits/read', { excludeResetCreditDetails: true }, timeoutMs),
  );
}

export async function readCodexAccount(codexPath: string, timeoutMs = 10000): Promise<Account | undefined> {
  const r = await appServerRequest(codexPath, 'account/read', {}, timeoutMs);
  return r === undefined ? undefined : parseAccountResult(r);
}
