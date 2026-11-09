// Live thread check: a real thread against the real engines through Ark's own runner and conductor.
// Run only with `npm run test:live`; the manager runs on the light tier (one or two cheap calls).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { MANAGER } from '@shared/thread';
import { AgentRunner } from '../../src/main/services/agent-runner';
import { Catalog } from '../../src/main/services/catalog';
import { startClaudeSession } from '../../src/main/services/engines/claude-session';
import { codexModels, startCodexSession } from '../../src/main/services/engines/codex-session';
import { engineStatus } from '../../src/main/services/engines/config';
import { cleanEnv } from '../../src/main/services/engines/isolation';
import { indexSkills } from '../../src/main/services/skills';
import { Conductor } from '../../src/main/services/threads/conductor';
import { ThreadStore } from '../../src/main/services/threads/store';
import { workspace } from '../../src/main/services/threads/workspace';
import { SEED_AGENTS } from '../fixtures/catalog-agents';

// Everything lives under one OS temp folder; the runner builds its session folders under it too.
const tmp = mkdtempSync(join(tmpdir(), 'ark-live-thread-'));
const projectDir = join(tmp, 'project');
const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

// Built the way src/main/index.ts builds it; the engines are found on PATH (no engines.json).
const catalog = new Catalog(join(tmp, 'agents'));
const runner = new AgentRunner({
  catalog,
  skills: () => indexSkills({ claudeConfigDir, home: homedir(), codexHome }),
  engines: () => engineStatus({}),
  config: () => ({}),
  tempDir: tmp,
  codexHome,
  env: () => cleanEnv(process.env),
  startClaude: startClaudeSession,
  startCodex: startCodexSession,
  claudeLimited: () => false,
  codexModels: (exe) => codexModels(exe, cleanEnv(process.env)),
});
const store = new ThreadStore(join(tmp, 'data'));
const conductor = new Conductor({ store, catalog, runner, workspace, worktrees: join(tmp, 'worktrees'), windows: () => undefined });

// A killed engine can hold its cwd for a moment on Windows: wait, then clean up on a best-effort basis (it is only OS temp).
afterAll(async () => {
  conductor.stopAll();
  runner.stopAll();
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    console.warn(`could not remove ${tmp}: ${(e as Error).message}`);
  }
});

test('Thread: the manager answers the first message with a team proposal or a question', async () => {
  for (const agent of SEED_AGENTS) catalog.save(agent);
  execFileSync('git', ['init', '-q', projectDir], { stdio: 'ignore' });
  const project = store.addProject(projectDir);
  expect(project.git).toBe(true);

  const started = Date.now();
  conductor.onUpdate((u) => {
    for (const m of u.added) console.log(`THREAD +${Math.round((Date.now() - started) / 1000)}s [${m.kind}]`, JSON.stringify(m));
  });
  const thread = conductor.create(project.id, 'Add a one-paragraph README to this empty repository.');
  expect(thread.status).toBe('running');

  // The turn runs in the background: poll the saved thread until it stops running (at most 180 s).
  let status = thread.status;
  while (status === 'running' && Date.now() - started < 180_000) {
    await new Promise((r) => setTimeout(r, 500));
    status = store.get(thread.id)!.status;
  }
  const messages = store.messages(thread.id);
  console.log(`THREAD ${status} after ${Math.round((Date.now() - started) / 1000)}s:`, JSON.stringify(messages));

  expect(messages.filter((m) => m.kind === 'note' && m.text.includes('stopped'))).toEqual([]);
  expect(status).toBe('waiting');
  const last = messages.findLast((m) => m.kind === 'agent');
  expect(last?.kind).toBe('agent');
  if (last?.kind !== 'agent') return;
  expect(last.agent).toBe(MANAGER);
  expect(['team', 'ask']).toContain(last.control?.kind);
  expect(last.model).toContain('haiku');
}, 200_000);
