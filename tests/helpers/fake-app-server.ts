import type { SpawnFn } from '../../src/main/services/engines/session';
import { FakeChild } from './fake-child';

/**
 * A scripted `codex app-server`: every spawn gets a FakeChild that answers requests with the handler
 * of the same method name (initialize answers {} by default). A handler that throws, or a method with
 * no handler, answers with a JSON-RPC error. `requests` lists every request with the index of the spawn it came to.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test handlers take whatever params the test expects
export function fakeAppServer(handlers: Record<string, (params: any) => unknown>) {
  const children: FakeChild[] = [];
  const spawns: { command: string; args: string[] }[] = [];
  const requests: { method: string; params: unknown; spawn: number }[] = [];
  const spawn: SpawnFn = (command, args) => {
    const index = children.length;
    const child = new FakeChild();
    children.push(child);
    spawns.push({ command, args });
    let buf = '';
    child.stdin.on('data', (d: string) => {
      const parts = (buf + d).split('\n');
      buf = parts.pop() ?? '';
      for (const l of parts.filter(Boolean)) {
        const m = JSON.parse(l) as { id?: number; method: string; params: unknown };
        if (m.id === undefined || !m.method) continue; // notification (initialized) or a reply to a server request
        requests.push({ method: m.method, params: m.params, spawn: index });
        const h = handlers[m.method] ?? (m.method === 'initialize' ? () => ({}) : undefined);
        try {
          if (!h) throw new Error(`no handler for ${m.method}`);
          child.emitLine({ id: m.id, result: h(m.params) });
        } catch (e) {
          child.emitLine({ id: m.id, error: { code: -32601, message: (e as Error).message } });
        }
      }
    });
    return child;
  };
  return {
    spawn,
    spawns,
    requests,
    children,
    /** Sends a server notification on the most recent spawn. */
    notify(method: string, params: unknown) {
      children[children.length - 1].emitLine({ method, params });
    },
  };
}
