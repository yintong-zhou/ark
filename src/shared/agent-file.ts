import { parse, stringify } from 'yaml';

/** Agent catalog file format: Markdown with a YAML header, same shape as Claude Code agents. */

export type Tier = 'light' | 'standard' | 'heavy';
export type EngineId = 'claude' | 'codex';
export type EngineSetting =
  | { kind: 'auto' }
  | { kind: 'engine'; engine: EngineId }
  | { kind: 'model'; engine: EngineId; model: string };
export type Permissions = 'read-only' | 'build';
export type AgentDef = {
  id: string;
  name: string;
  description: string;
  engine: EngineSetting;
  tier: Tier;
  skills: string[];
  permissions: Permissions;
  prompt: string;
};
export type ParseResult = { ok: true; agent: AgentDef } | { ok: false; error: string };

const TIERS: readonly Tier[] = ['light', 'standard', 'heavy'];
const PERMISSIONS: readonly Permissions[] = ['read-only', 'build'];
/** Folder-safe agent id: what the catalog accepts on disk and IPC accepts from the renderer. */
export const AGENT_ID_RE = /^[a-z0-9_-]{1,64}$/;
const SKILL_RE = /^[A-Za-z0-9][\w.-]*(:[A-Za-z0-9][\w.-]*)?$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 4000;
const MAX_PROMPT = 50000;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type Frontmatter = { data: Record<string, unknown>; body: string } | { error: string };

/** Reads the header; the error says what is wrong, including the YAML parser's reason. */
function readFrontmatter(text: string): Frontmatter {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { error: 'frontmatter: missing YAML header between --- lines' };
  let data: unknown;
  try {
    data = parse(m[1]);
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    return { error: `frontmatter: invalid YAML: ${reason}` };
  }
  return isObject(data) ? { data, body: m[2] } : { error: 'frontmatter: header must be key: value pairs' };
}

/** Splits `---` YAML `---` body. Undefined when there is no frontmatter or it is not a YAML mapping. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined {
  const fm = readFrontmatter(text);
  return 'error' in fm ? undefined : fm;
}

/** `auto`, `claude`, `codex`, `claude:haiku|sonnet|opus`, `codex:<model>`. */
export function parseEngineSetting(s: string): EngineSetting | undefined {
  if (s === 'auto') return { kind: 'auto' };
  if (s === 'claude' || s === 'codex') return { kind: 'engine', engine: s };
  const claude = /^claude:(haiku|sonnet|opus)$/.exec(s);
  if (claude) return { kind: 'model', engine: 'claude', model: claude[1] };
  const codex = /^codex:([\w.-]+)$/.exec(s);
  if (codex) return { kind: 'model', engine: 'codex', model: codex[1] };
  return undefined;
}

/** Machine form, the inverse of parseEngineSetting (what goes in the file). */
function engineString(e: EngineSetting): string {
  return e.kind === 'auto' ? 'auto' : e.kind === 'engine' ? e.engine : `${e.engine}:${e.model}`;
}

/** Human label for the UI. */
export function formatEngineSetting(e: EngineSetting): string {
  if (e.kind === 'auto') return 'Auto';
  if (e.kind === 'engine') return e.engine === 'claude' ? 'Claude Code' : 'Codex';
  if (e.engine === 'claude') return `Claude ${e.model[0].toUpperCase()}${e.model.slice(1)}`;
  return `Codex ${e.model}`;
}

/** Folder/file-safe slug: lowercase ASCII, single dashes, at most 64 characters. */
export function agentId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '');
  return slug || 'agent';
}

const fail = (error: string): ParseResult => ({ ok: false, error });

export function parseAgentFile(text: string, id: string): ParseResult {
  const fm = readFrontmatter(text);
  if ('error' in fm) return fail(fm.error);
  const { data, body } = fm;

  const name = data.name;
  if (typeof name !== 'string' || name.length < 1 || name.length > MAX_NAME) {
    return fail(`name: required, 1 to ${MAX_NAME} characters`);
  }

  const description = data.description ?? '';
  if (typeof description !== 'string' || description.length > MAX_DESCRIPTION) {
    return fail(`description: must be text of at most ${MAX_DESCRIPTION} characters`);
  }

  const tier = data.tier ?? 'standard';
  if (!TIERS.includes(tier as Tier)) return fail(`tier: must be one of ${TIERS.join(', ')}`);

  const permissions = data.permissions ?? 'read-only';
  if (!PERMISSIONS.includes(permissions as Permissions)) {
    return fail(`permissions: must be one of ${PERMISSIONS.join(', ')}`);
  }

  const skills = data.skills ?? [];
  if (!Array.isArray(skills) || !skills.every((s) => typeof s === 'string' && SKILL_RE.test(s))) {
    return fail('skills: must be a list of skill names such as writing-plans or superpowers:writing-plans');
  }

  let engine: EngineSetting | undefined = { kind: 'auto' };
  if (data.engine != null) {
    engine = typeof data.engine === 'string' ? parseEngineSetting(data.engine) : undefined;
    if (!engine) return fail('engine: must be auto, claude, codex, claude:haiku|sonnet|opus or codex:<model>');
  } else if (data.model === 'haiku' || data.model === 'sonnet' || data.model === 'opus') {
    // Claude Code agent files name a model, not an engine
    engine = { kind: 'model', engine: 'claude', model: data.model };
  }

  const prompt = body.trim();
  if (!prompt || prompt.length > MAX_PROMPT) return fail(`prompt: the body is required, at most ${MAX_PROMPT} characters`);

  return {
    ok: true,
    agent: { id, name, description, engine, tier: tier as Tier, skills: skills as string[], permissions: permissions as Permissions, prompt },
  };
}

export function serializeAgentFile(a: AgentDef): string {
  const header = stringify(
    {
      name: a.name,
      description: a.description,
      engine: engineString(a.engine),
      tier: a.tier,
      skills: a.skills,
      permissions: a.permissions,
    },
    { lineWidth: 0 },
  );
  return `---\n${header}---\n${a.prompt}\n`;
}

/** IPC guard: checks the types serialize needs, then serializes and parses again so one rule set decides. */
export function validateAgent(a: unknown): ParseResult {
  if (!isObject(a)) return fail('agent: must be an object');
  const { id, name, description, engine, tier, skills, permissions, prompt } = a;
  if (typeof id !== 'string') return fail('id: must be text');
  if (typeof name !== 'string') return fail('name: must be text');
  if (typeof description !== 'string') return fail('description: must be text');
  if (typeof prompt !== 'string') return fail('prompt: must be text');
  if (!Array.isArray(skills)) return fail('skills: must be a list');
  if (!isObject(engine)) return fail('engine: must be an object');
  const setting = parseEngineSetting(engineString(engine as EngineSetting));
  if (!setting) return fail('engine: invalid engine setting');
  try {
    return parseAgentFile(
      serializeAgentFile({ id, name, description, engine: setting, tier, skills, permissions, prompt } as AgentDef),
      id,
    );
  } catch {
    return fail('agent: not serializable');
  }
}
