import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Permissions } from '@shared/agent-file';
import type { ChatEvent } from '@shared/types';
import { parseRateLimitsResult } from '../adapters/codex-appserver';
import { num, obj, str } from '../json';
import { AppServerClient } from './app-server-client';
import { CODEX_BASE_ARGS, checkCodexMcp, checkCodexSkills, codexArgs, codexSkillsSection, IsolationError } from './isolation';
import type { CodexModel } from './models';
import type { EngineSession, SpawnFn } from './session';

export { CODEX_BASE_ARGS };

type Skill = { name: string; path: string; enabled: boolean };
type Inventory = { skills: Skill[]; mcp: Record<string, { enabled?: boolean }> };

/** What this app-server currently has loaded: skills for `cwd` and configured MCP servers. Throws on a malformed answer. */
async function inventory(c: AppServerClient, cwd: string): Promise<Inventory> {
  const list = obj(await c.request('skills/list', { cwds: [cwd], forceReload: true }));
  const rawSkills = obj(Array.isArray(list?.data) ? list.data[0] : undefined)?.skills;
  if (!Array.isArray(rawSkills)) throw new Error('skills/list: malformed answer');
  const skills = rawSkills.map((s): Skill => {
    const o = obj(s);
    const path = str(o?.path);
    if (!path) throw new Error('skills/list: skill without a path');
    return { name: str(o?.name) ?? path, path, enabled: o?.enabled !== false }; // fail closed: unknown means enabled
  });
  const config = obj(obj(await c.request('config/read', { includeLayers: false, cwd }))?.config);
  if (!config) throw new Error('config/read: malformed answer');
  // Only an absent mcp_servers key means "none"; a present non-object is malformed (fail closed).
  const servers = config.mcp_servers === undefined ? {} : obj(config.mcp_servers);
  if (!servers) throw new Error('config/read: malformed answer');
  const mcp = Object.fromEntries(Object.entries(servers).map(([name, v]) => [name, obj(v) ?? {}]));
  return { skills, mcp };
}

/**
 * Codex on native Windows runs commands with no sandbox at all unless `windows.sandbox` is set
 * (CODEX_BASE_ARGS sets it). Prove it holds: a write the sandbox must refuse is refused, while the
 * very same command succeeds unsandboxed (so a broken probe can never pass). Returns violations.
 */
async function checkSandbox(c: AppServerClient, cwd: string, probe: string): Promise<string[]> {
  const command =
    process.platform === 'win32'
      ? ['powershell.exe', '-NoProfile', '-Command', 'Set-Content -LiteralPath $env:ARK_PROBE -Value x']
      : ['sh', '-c', 'echo x > "$ARK_PROBE"'];
  const run = async (sandboxPolicy: unknown): Promise<boolean> => {
    try {
      await c.request('command/exec', { command, cwd, env: { ARK_PROBE: probe }, sandboxPolicy, timeoutMs: 15000 });
    } catch {
      // a refused or failed command still leaves the file as the verdict
    }
    const wrote = existsSync(probe);
    rmSync(probe, { force: true });
    return wrote;
  };
  if (!(await run({ type: 'dangerFullAccess' }))) return ['sandbox check could not run']; // control: the probe itself works
  return (await run({ type: 'readOnly', networkAccess: false })) ? ['sandbox not enforced'] : [];
}

/**
 * A Codex chat. Isolation first: enumerate the user's skills and MCP servers, restart the app-server
 * with all of them denied, verify that none is enabled, and only then start the thread. The agent's own
 * skills are not loaded by Codex (0.132.0 cannot add a skill root): they are listed in its instructions.
 * Any violation or failed request closes the client and rejects (no retry, no fallback).
 * A build session writes inside its folder and asks Ark before anything else (approval events).
 */
export async function startCodexSession(o: {
  exe: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  privateRoot: string;
  expectedFolders: string[];
  model: string;
  effort: 'low' | 'medium' | 'high';
  instructions: string;
  permissions: Permissions;
  spawn?: SpawnFn;
}): Promise<EngineSession> {
  const open = (args: string[]) => AppServerClient.open(o.exe, args, { cwd: o.cwd, env: o.env, spawn: o.spawn });

  // 1. Enumerate with a plain app-server.
  const probe = await open(CODEX_BASE_ARGS);
  let found: Inventory;
  try {
    found = await inventory(probe, o.cwd);
  } finally {
    probe.close();
  }

  // 2-5. The isolated session.
  const client = await open(
    codexArgs({
      skillPaths: found.skills.filter((s) => s.enabled).map((s) => s.path),
      mcpServers: Object.keys(found.mcp),
    }),
  );
  let threadId: string;
  try {
    const now = await inventory(client, o.cwd);
    const violations = [...checkCodexSkills(now.skills), ...checkCodexMcp(now.mcp), ...(await checkSandbox(client, o.cwd, join(o.privateRoot, '.sandbox-probe')))];
    if (violations.length) throw new IsolationError(violations);
    const section = codexSkillsSection(o.privateRoot, o.expectedFolders);
    const t = await client.request('thread/start', {
      model: o.model,
      cwd: o.cwd,
      approvalPolicy: o.permissions === 'build' ? 'on-request' : 'never',
      sandbox: o.permissions === 'build' ? 'workspace-write' : 'read-only',
      developerInstructions: section ? `${o.instructions}\n\n${section}` : o.instructions,
    });
    const id = str(obj(obj(t)?.thread)?.id);
    if (!id) throw new Error('thread/start: no thread id');
    threadId = id;
  } catch (e) {
    client.close();
    throw e;
  }

  const listeners: ((e: ChatEvent) => void)[] = [];
  const emit = (e: ChatEvent) => listeners.forEach((cb) => cb(e));
  let busy = false;
  let ended = false; // set by stop() or an exit: nothing more is forwarded
  let last: Record<string, unknown> | undefined;
  let contextWindow: number | undefined;
  const pending = new Map<string, (result: unknown) => void>(); // approval id -> reply

  client.onExit((code, stderrTail) => {
    if (ended) return;
    ended = true;
    busy = false;
    pending.clear();
    emit({ type: 'error', kind: 'exit', detail: stderrTail || `exit code ${code}` });
  });
  if (o.permissions === 'build') {
    client.onRequest((method, params, reply, rpcId) => {
      const tool = method === 'item/commandExecution/requestApproval' ? 'command' : method === 'item/fileChange/requestApproval' ? 'file change' : undefined;
      if (!tool || ended) return false;
      const p = obj(params);
      const id = String(rpcId);
      pending.set(id, reply);
      emit({ type: 'approval', id, tool, detail: commandDetail(str(p?.command), str(p?.cwd)) ?? fileDetail(str(p?.grantRoot), str(p?.reason)) ?? '' });
      return true;
    });
  }
  client.onNotification((method, params) => {
    if (ended) return;
    const p = obj(params);
    if (method === 'item/completed') {
      const item = obj(p?.item);
      const text = item?.type === 'agentMessage' ? str(item.text) : undefined;
      if (text) emit({ type: 'message', text });
    } else if (method === 'account/rateLimits/updated') {
      const windows = parseRateLimitsResult(params);
      if (windows.length) emit({ type: 'limits', engine: 'codex', windows });
    } else if (method === 'thread/tokenUsage/updated') {
      last = obj(obj(p?.tokenUsage)?.last);
      contextWindow = num(obj(p?.tokenUsage)?.modelContextWindow);
    } else if (method === 'turn/completed') {
      busy = false;
      pending.clear();
      const status = str(obj(p?.turn)?.status);
      if (status !== 'completed') {
        const why = str(obj(obj(p?.turn)?.error)?.message); // only present when the turn failed
        return emit({ type: 'error', kind: 'engine', detail: why ? `turn ${status ?? 'unknown'}: ${why}` : `turn ${status ?? 'unknown'}` });
      }
      emit({
        type: 'turn',
        model: o.model,
        tokens: { input: num(last?.inputTokens) ?? 0, cached: num(last?.cachedInputTokens) ?? 0, output: num(last?.outputTokens) ?? 0 },
        contextWindow,
      });
    }
  });

  return {
    get busy() {
      return busy;
    },
    send(text, images = []) {
      if (ended) throw new Error('session ended');
      if (busy) throw new Error('busy');
      busy = true;
      // Skills and MCP servers can change under a running app-server: re-check before every turn.
      void (async () => {
        const now = await inventory(client, o.cwd);
        const violations = [...checkCodexSkills(now.skills), ...checkCodexMcp(now.mcp)];
        if (ended) return;
        if (violations.length) {
          ended = true;
          busy = false;
          client.close();
          return emit({ type: 'error', kind: 'isolation', detail: violations.join('; ') });
        }
        const pictures = images.map((i) => ({ type: 'image', url: `data:${i.mime};base64,${i.data}` }));
        await client.request('turn/start', { threadId, effort: o.effort, input: [{ type: 'text', text, text_elements: [] }, ...pictures] });
      })().catch((e: Error) => {
        if (ended) return;
        busy = false;
        emit({ type: 'error', kind: 'engine', detail: e.message });
      });
    },
    stop() {
      if (ended) return;
      ended = true;
      busy = false;
      pending.clear();
      client.close();
    },
    answer(id, allow) {
      const reply = pending.get(id);
      if (!reply || ended) throw new Error('This request is no longer pending');
      pending.delete(id);
      reply({ decision: allow ? 'accept' : 'decline' });
    },
    onEvent(cb) {
      listeners.push(cb);
    },
  };
}

/** Models Codex offers, newest first (as reported). */
export async function codexModels(exe: string, env: NodeJS.ProcessEnv, spawn?: SpawnFn): Promise<CodexModel[]> {
  const c = await AppServerClient.open(exe, CODEX_BASE_ARGS, { cwd: process.cwd(), env, spawn });
  try {
    const data = obj(await c.request('model/list', {}))?.data;
    if (!Array.isArray(data)) return [];
    return data.flatMap((m) => {
      const id = str(obj(m)?.id);
      return id ? [{ id, hidden: obj(m)?.hidden === true, isDefault: obj(m)?.isDefault === true }] : [];
    });
  } finally {
    c.close();
  }
}

/** A command shown like a shell prompt, so the card says where it would run: `D:\proj> curl x`. */
function commandDetail(command?: string, cwd?: string): string | undefined {
  return command && cwd ? `${cwd}> ${command}` : command;
}

/** The folder being granted leads; the model-written reason is context only. */
function fileDetail(grantRoot?: string, reason?: string): string | undefined {
  return grantRoot ? (reason ? `${grantRoot} (${reason})` : grantRoot) : reason;
}
