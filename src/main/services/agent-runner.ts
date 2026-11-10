import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDef, EngineId, Permissions } from '@shared/agent-file';
import type { ImageInput } from '@shared/attachments';
import type { PermissionMode } from '@shared/permissions';
import type { ChatEvent, ChatStarted, EngineInfo, EnginesConfig, TurnResult } from '@shared/types';
import type { Catalog } from './catalog';
import type { startClaudeSession } from './engines/claude-session';
import type { startCodexSession } from './engines/codex-session';
import { ancestorInstructions, checkCodexPersonal, claudeArgs, claudeEnv, claudeSettingsProblem, IsolationError, projectSkillNames } from './engines/isolation';
import { CLAUDE_TIER_MODEL, CODEX_TIER_EFFORT, codexTierModel, resolveRun, type CodexModel } from './engines/models';
import { claudeImportProblem, codexProjectRules } from './engines/project-rules';
import type { EngineSession } from './engines/session';
import { buildSkillFolder, type SkillEntry } from './skills';
import { workspace } from './threads/workspace';

export type RunnerDeps = {
  catalog: Pick<Catalog, 'get'>;
  skills: () => SkillEntry[];
  engines: () => Promise<EngineInfo[]>;
  config: () => EnginesConfig;
  tempDir: string;
  codexHome: string;
  env: () => NodeJS.ProcessEnv;
  startClaude: typeof startClaudeSession;
  startCodex: typeof startCodexSession;
  claudeLimited: () => boolean;
  codexModels: (exe: string) => Promise<CodexModel[]>;
};

type Live = { session: EngineSession; dir: string };

/** Removing a folder right after killing an engine can hit EPERM on Windows: retry, then give up quietly. */
function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // best effort: the folder lives under the temp dir and the OS cleans it up eventually
  }
}

/** Turns an agent and a project folder into a running, isolated chat session. */
export class AgentRunner {
  private readonly live = new Map<string, Live>();
  private stopping = false; // set by stopAll: a start still in flight must not outlive the quit
  private readonly pending = new Map<string, (e: Error) => void>(); // turns waiting on a chat, rejected by stop
  private readonly listeners = new Set<(chatId: string, e: ChatEvent) => void>();

  constructor(private readonly deps: RunnerDeps) {}

  async start(agentId: string, projectDir: string, mode: PermissionMode = 'ask'): Promise<ChatStarted> {
    const agent = this.deps.catalog.get(agentId);
    if (!agent) throw new Error('Unknown agent');
    return this.startAgent(agent, projectDir, 'read-only', mode);
  }

  /** `projectCode`: the user allowed the repository's checks in this thread, so a Claude build session may run them without a card. */
  async startAgent(agent: AgentDef, projectDir: string, permissions: Permissions = 'read-only', permissionMode: PermissionMode = 'ask', preferredEngine?: EngineId, projectCode = false): Promise<ChatStarted> {
    const engines = await this.deps.engines();
    if (this.stopping) throw new Error('Ark is closing');
    const info = (id: EngineId) => engines.find((e) => e.id === id);
    const plan = resolveRun(agent, { claude: !!info('claude')?.installed, codex: !!info('codex')?.installed }, this.deps.claudeLimited(), preferredEngine);
    if ('error' in plan) throw new Error(plan.error);
    const exe = info(plan.engine)?.path;
    if (!exe) throw new Error(`No path for ${plan.engine}`);

    const chatId = randomUUID();
    const dir = join(this.deps.tempDir, 'ark', 'sessions', chatId);
    const index = this.deps.skills();
    mkdirSync(dir, { recursive: true });
    try {
      const missingCheck = (missing: string[]) => {
        if (missing.length) throw new Error('Skill not installed: ' + missing.join(', '));
      };
      let session: EngineSession;
      let model: string;
      if (plan.engine === 'claude') {
        // Claude Code loads CLAUDE.md files from every folder above the project, with no switch to stop it.
        const above = ancestorInstructions(projectDir);
        if (above.length) throw new IsolationError(above.map((p) => 'instructions above the project not allowed: ' + p));
        // The project's .claude/settings.json is loaded too: refuse one that could run commands or skip approval cards.
        const bad = claudeSettingsProblem(projectDir);
        if (bad) throw new Error(bad);
        // CLAUDE.md @imports may point at files outside the project (absolute, ~): refuse those too.
        const badImport = claudeImportProblem(projectDir);
        if (badImport) throw new Error(badImport);
        const pluginDir = join(dir, 'plugin');
        const built = buildSkillFolder('claude-plugin', pluginDir, agent.skills, index);
        missingCheck(built.missing);
        const roleFile = join(dir, 'role.md');
        writeFileSync(roleFile, agent.prompt);
        model = plan.model ?? CLAUDE_TIER_MODEL[plan.tier];
        // What the engine must not load: the user's own Claude skills and the project's.
        // Claude lists skills by frontmatter name, so forbid both the folder and the name.
        const forbidden = new Set(index.filter((s) => s.source === 'claude-user').flatMap((s) => [s.folder, s.name]));
        for (const n of projectSkillNames(projectDir)) forbidden.add(n);
        session = this.deps.startClaude({
          exe,
          cwd: projectDir,
          args: claudeArgs({ model, roleFile, pluginDir, permissions, permissionMode, checks: permissions === 'build' && projectCode ? workspace.checkCommands(projectDir) : [] }),
          env: claudeEnv(this.deps.env()),
          expectedFolders: built.folders,
          forbidden,
        });
      } else {
        // Codex loads ~/.codex/AGENTS.md into every session and has no switch for it: refuse instead.
        const personal = checkCodexPersonal(this.deps.codexHome);
        if (personal.length) throw new IsolationError(personal);
        const privateRoot = join(dir, 'skills');
        const built = buildSkillFolder('codex-root', privateRoot, agent.skills, index);
        missingCheck(built.missing);
        const picked = plan.model ?? codexTierModel(plan.tier, await this.deps.codexModels(exe), this.deps.config().codex?.tiers);
        if (!picked) throw new Error(`No Codex model for tier ${plan.tier}`);
        model = picked;
        const rules = codexProjectRules(projectDir);
        session = await this.deps.startCodex({
          exe,
          cwd: projectDir,
          env: this.deps.env(),
          privateRoot,
          expectedFolders: built.folders,
          model,
          effort: CODEX_TIER_EFFORT[plan.tier],
          instructions: rules ? `${agent.prompt}\n\n# Project instructions\n\n${rules}` : agent.prompt,
          permissions,
          permissionMode,
        });
      }
      if (this.stopping) {
        session.stop();
        throw new Error('Ark is closing'); // the catch below removes the folder
      }
      this.live.set(chatId, { session, dir });
      session.onEvent((e) => this.listeners.forEach((cb) => cb(chatId, e)));
      return { chatId, engine: plan.engine, model, ...(plan.rerouted && { rerouted: true as const }) };
    } catch (e) {
      removeDir(dir); // a failed start leaves nothing behind
      throw e;
    }
  }

  /** One question, one answer: the joined message texts of the first turn. The session is always stopped. */
  async oneShot(agent: AgentDef, projectDir: string, text: string, timeoutMs = 120_000): Promise<string> {
    const { chatId } = await this.startAgent(agent, projectDir);
    try {
      return (await this.turn(chatId, text, timeoutMs, 'The drafter timed out')).text;
    } finally {
      try {
        this.stop(chatId);
      } catch {
        // the answer or the original error matters more than a failed stop
      }
    }
  }

  /** Sends one message and waits for the turn to end. Rejects on an engine error, on timeout, or when stop(chatId) runs first. */
  async turn(chatId: string, text: string, timeoutMs = 900_000, timeoutMessage = 'The agent timed out', images?: ImageInput[]): Promise<TurnResult> {
    let off = () => {};
    let timer: NodeJS.Timeout | undefined;
    try {
      return await new Promise<TurnResult>((resolve, reject) => {
        const parts: string[] = [];
        this.pending.set(chatId, reject);
        // subscribe before sending: the first events can arrive during send
        off = this.onEvent((id, e) => {
          if (id !== chatId) return;
          if (e.type === 'message') parts.push(e.text);
          else if (e.type === 'turn') resolve({ text: parts.join('\n\n'), model: e.model, tokens: e.tokens, contextWindow: e.contextWindow, contextUsed: e.contextUsed });
          else if (e.type === 'error') reject(new Error(e.detail)); // approvals are neither text nor an error
        });
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        try {
          this.send(chatId, text, images);
        } catch (e) {
          reject(e);
        }
      });
    } finally {
      off();
      clearTimeout(timer);
      this.pending.delete(chatId);
    }
  }

  send(chatId: string, text: string, images?: ImageInput[]): void {
    const s = this.live.get(chatId);
    if (!s) throw new Error('Unknown chat');
    s.session.send(text, images); // busy and session ended propagate
  }

  /** Answers an approval event of the chat's session. Unknown chat or a no-longer-pending id throws. */
  answer(chatId: string, id: string, allow: boolean): void {
    const s = this.live.get(chatId);
    if (!s) throw new Error('Unknown chat');
    s.session.answer(id, allow);
  }

  stop(chatId: string): void {
    const s = this.live.get(chatId);
    if (!s) return;
    this.pending.get(chatId)?.(new Error('stopped'));
    this.live.delete(chatId);
    try {
      s.session.stop();
    } finally {
      removeDir(s.dir);
    }
  }

  stopAll(): void {
    this.stopping = true;
    for (const id of [...this.live.keys()]) {
      try {
        this.stop(id);
      } catch {
        // keep stopping the rest
      }
    }
  }

  onEvent(cb: (chatId: string, e: ChatEvent) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
}
