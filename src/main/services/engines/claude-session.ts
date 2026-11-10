import type { ChatEvent, UsageWindow } from '@shared/types';
import { num, obj, str } from '../json';
import { checkClaudeInit } from './isolation';
import { isProjectCheck } from './approval-policy';
import { jsonLines, nodeSpawn, spawnCommand, type EngineSession, type SpawnFn } from './session';

const STDERR_TAIL = 500;
const CLAUDE_WINDOW_MINUTES: Record<string, number> = { five_hour: 300, seven_day: 10080 };

/** The 5-hour or weekly window of a `rate_limit_event` line; any other limit type, or a missing figure, gives nothing. */
export function claudeRateLimit(line: Record<string, unknown>): UsageWindow | undefined {
  const info = obj(line.rate_limit_info);
  const minutes = CLAUDE_WINDOW_MINUTES[str(info?.rateLimitType) ?? ''];
  const utilization = num(info?.utilization);
  const resetsAt = num(info?.resetsAt);
  if (!minutes || utilization === undefined || resetsAt === undefined) return undefined;
  return { usedPct: Math.round(utilization * 100), resetsAt, minutes };
}

/**
 * One long-lived `claude -p` stream-json process. Every turn starts with system/init; it is checked
 * before any answer is forwarded, and a violation kills the process (no retry, no fallback).
 */
export function startClaudeSession(o: {
  exe: string;
  cwd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  expectedFolders: string[];
  forbidden: ReadonlySet<string>;
  projectCommands?: ReadonlySet<string>;
  spawn?: SpawnFn;
}): EngineSession {
  const c = spawnCommand(o.exe, o.args); // .cmd/.bat shims need a shell and cmd.exe quoting
  const child = (o.spawn ?? nodeSpawn)(c.command, c.args, { cwd: o.cwd, env: o.env, shell: c.shell });
  const listeners: ((e: ChatEvent) => void)[] = [];
  const emit = (e: ChatEvent) => listeners.forEach((cb) => cb(e));
  let busy = false;
  let checked = false; // true once an init with no violations was seen; nothing is forwarded before
  let ended = false; // set by stop(), an exit or an isolation stop: nothing more is forwarded
  let model = '';
  let lastRequest: number | undefined; // context filled by the turn's last request (the final assistant event)
  let stderr = '';
  const pending = new Map<string, { input: Record<string, unknown>; tool: string }>();
  let shellStateKnown = true; // arbitrary approved commands can change cwd, aliases or the shell environment

  child.stderr.on('data', (d: Buffer | string) => (stderr = (stderr + d.toString()).slice(-STDERR_TAIL)));
  child.on('exit', (code) => {
    if (ended) return;
    ended = true;
    busy = false;
    pending.clear();
    emit({ type: 'error', kind: 'exit', detail: stderr.trim() || `exit code ${code}` });
  });

  jsonLines(child.stdout, (line) => {
    if (ended) return;
    const isolationStop = (detail: string) => {
      ended = true;
      busy = false;
      pending.clear();
      child.kill();
      emit({ type: 'error', kind: 'isolation', detail });
    };
    if (line.type === 'system' && line.subtype === 'init') {
      const violations = checkClaudeInit(line, o.expectedFolders, o.forbidden, o.projectCommands);
      if (violations.length) return isolationStop(violations.join('; '));
      checked = true;
      model = str(line.model) ?? model;
    } else if (line.type === 'rate_limit_event') {
      const w = claudeRateLimit(line);
      if (w) emit({ type: 'limits', engine: 'claude', windows: [w] });
    } else if (!checked) {
      // Output before any init means the check never ran: same as a failed check.
      if (line.type === 'assistant' || line.type === 'result' || line.type === 'control_request') isolationStop('no init event');
    } else if (line.type === 'control_request') {
      const id = str(line.request_id);
      const req = obj(line.request);
      if (!id) return;
      if (req?.subtype !== 'can_use_tool') {
        const error = { type: 'control_response', response: { subtype: 'error', request_id: id, error: 'Not supported by Ark' } };
        return void child.stdin.write(JSON.stringify(error) + '\n');
      }
      const input = obj(req.input) ?? {};
      const tool = str(req.tool_name) ?? '';
      pending.set(id, { input, tool });
      const detail = str(input.command) ?? str(input.file_path) ?? str(req.description) ?? JSON.stringify(input).slice(0, 500);
      emit({ type: 'approval', id, tool: str(req.display_name) ?? str(req.tool_name) ?? 'tool', detail,
        request: { engine: 'claude', tool, input: shellStateKnown ? input : { ...input, arkShellStateUnknown: true }, cwd: o.cwd } });
    } else if (line.type === 'assistant') {
      const content = obj(line.message)?.content;
      const text = Array.isArray(content)
        ? content.map((p) => (obj(p)?.type === 'text' ? (str(obj(p)?.text) ?? '') : '')).join('')
        : '';
      if (text) emit({ type: 'message', text });
      const u = obj(obj(line.message)?.usage);
      if (u) lastRequest = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
    } else if (line.type === 'result') {
      busy = false;
      pending.clear();
      if (line.subtype !== 'success') {
        emit({ type: 'error', kind: 'engine', detail: str(line.subtype) ?? 'unknown result' });
        return;
      }
      const u = obj(line.usage);
      const cached = num(u?.cache_read_input_tokens) ?? 0;
      const input = (num(u?.input_tokens) ?? 0) + (num(u?.cache_creation_input_tokens) ?? 0) + cached;
      // The window of the turn's own model; a turn that ran a sub-agent on another model lists several.
      const usage = Object.entries(obj(line.modelUsage) ?? {});
      const contextWindow = num(obj((usage.find(([k]) => k === model) ?? usage.find(([k]) => k.startsWith(model) || model.startsWith(k)) ?? usage[0])?.[1])?.contextWindow);
      emit({ type: 'turn', model, tokens: { input, cached, output: num(u?.output_tokens) ?? 0 }, contextWindow, contextUsed: lastRequest });
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
      lastRequest = undefined;
      const pictures = images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }));
      const msg = { type: 'user', message: { role: 'user', content: [...pictures, { type: 'text', text }] } };
      child.stdin.write(JSON.stringify(msg) + '\n');
    },
    stop() {
      if (ended) return;
      ended = true;
      busy = false;
      pending.clear();
      child.kill();
    },
    answer(id, allow) {
      const req = pending.get(id);
      if (!req || ended) throw new Error('This request is no longer pending');
      const { input, tool } = req;
      pending.delete(id);
      if (allow && (tool === 'Bash' || tool === 'PowerShell') && !isProjectCheck(input.command)) shellStateKnown = false;
      const response = allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user denied this in Ark.' };
      child.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response } }) + '\n');
    },
    onEvent(cb) {
      listeners.push(cb);
    },
  };
}
