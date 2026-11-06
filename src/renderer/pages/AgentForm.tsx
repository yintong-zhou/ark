import { useState, type ReactNode } from 'react';
import { agentId, validateAgent, type AgentDef, type EngineSetting, type Permissions, type Tier } from '@shared/agent-file';
import type { SkillInfo } from '@shared/types';
import { Page } from '../components/Page';
import { BUTTON, CTA, FIELD, INPUT } from '../components/ui';
import { readable } from '../errors';
import { useCatalog } from '../hooks/useCatalog';

const ENGINES: [value: string, label: string][] = [
  ['auto', 'Auto'], ['claude', 'Claude Code'], ['codex', 'Codex'],
  ['claude:haiku', 'Claude Haiku'], ['claude:sonnet', 'Claude Sonnet'], ['claude:opus', 'Claude Opus'],
  ['codex-model', 'Codex model…'],
];
const TIERS: [Tier, string][] = [['light', 'Light'], ['standard', 'Standard'], ['heavy', 'Heavy']];
const PERMISSIONS: [Permissions, string][] = [['read-only', 'Read-only'], ['build', 'Build']];
const NEW_AGENT: AgentDef = { id: '', name: '', description: '', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions: 'read-only', prompt: '' };

const engineKey = (e: EngineSetting) =>
  e.kind === 'auto' ? 'auto' : e.kind === 'engine' ? e.engine : e.engine === 'codex' ? 'codex-model' : `claude:${e.model}`;

/** Create or edit one agent. A draft (from an import) is a new agent: nothing is saved until Save. */
export function AgentForm({ id, draft, onBack }: { id?: string; draft?: AgentDef; onBack: () => void }) {
  const { catalog, skills, error } = useCatalog();
  const existing = id ? catalog?.agents.find((a) => a.id === id) : undefined;
  return (
    <Page title={id ? 'Edit agent' : 'New agent'} meta={['Saved to the catalog only when you press Save']} narrow>
      {catalog === null ? (
        <p className="text-muted">{error ?? 'Loading.'}</p>
      ) : id && !existing ? (
        <p className="text-muted">This agent no longer exists.</p>
      ) : (
        <Form initial={existing ?? draft ?? NEW_AGENT} isNew={!id} taken={catalog.agents.map((a) => a.id)} skills={skills} onDone={onBack} />
      )}
    </Page>
  );
}

function Form({ initial, isNew, taken, skills, onDone }: {
  initial: AgentDef; isNew: boolean; taken: string[]; skills: SkillInfo[]; onDone: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [engine, setEngine] = useState(engineKey(initial.engine));
  const [codexModel, setCodexModel] = useState(initial.engine.kind === 'model' && initial.engine.engine === 'codex' ? initial.engine.model : '');
  const [tier, setTier] = useState<Tier>(initial.tier);
  const [permissions, setPermissions] = useState<Permissions>(initial.permissions);
  const [picked, setPicked] = useState<string[]>(initial.skills);
  const [filter, setFilter] = useState('');
  const [prompt, setPrompt] = useState(initial.prompt);
  const [saveError, setSaveError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [idea, setIdea] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string>();

  const setting: EngineSetting =
    engine === 'codex-model' ? { kind: 'model', engine: 'codex', model: codexModel.trim() }
    : engine === 'auto' ? { kind: 'auto' }
    : engine === 'claude' || engine === 'codex' ? { kind: 'engine', engine }
    : { kind: 'model', engine: 'claude', model: engine.slice('claude:'.length) };
  const exactModel = setting.kind === 'model';
  const agent: AgentDef = {
    id: isNew ? agentId(name) : initial.id, name: name.trim(), description, engine: setting,
    tier, skills: picked, permissions, prompt,
  };
  const checked = validateAgent(agent);
  // a new agent never silently replaces an existing one
  const duplicate = isNew && taken.includes(agent.id);
  const problem = duplicate ? 'An agent with this name already exists.' : checked.ok ? undefined : checked.error;

  // skills the agent names but this machine lacks stay listed, so they can be unchecked
  const known = new Set(skills.map((s) => s.name));
  const all = [...skills, ...picked.filter((s) => !known.has(s)).map((s) => ({ name: s, source: 'not installed', description: '' }))];
  const shown = all.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (n: string) => setPicked(picked.includes(n) ? picked.filter((s) => s !== n) : [...picked, n]);

  // fills the form with a drafted agent; nothing is saved until Save
  const draft = async () => {
    setDrafting(true);
    setDraftError(undefined);
    try {
      const a = await window.ark.catalog.draft(idea.trim());
      setName(a.name);
      setDescription(a.description);
      setEngine(engineKey(a.engine));
      setCodexModel(a.engine.kind === 'model' && a.engine.engine === 'codex' ? a.engine.model : '');
      setTier(a.tier);
      setPermissions(a.permissions);
      setPicked(a.skills);
      setPrompt(a.prompt);
      setSaveError(undefined);
    } catch (e) {
      setDraftError(readable(e));
    } finally {
      setDrafting(false);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onDone();
    } catch (e) {
      setSaveError(readable(e));
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && checked.ok) void run(() => window.ark.catalog.save(checked.agent));
      }}
      className="flex flex-col gap-2"
    >
      {isNew && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <input
              aria-label="Describe the agent in one sentence"
              placeholder="Describe the agent in one sentence"
              value={idea}
              maxLength={2000}
              disabled={drafting}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (idea.trim() && !drafting) void draft();
              }}
              className={`${INPUT} flex-1`}
            />
            <button
              type="button"
              disabled={drafting || !idea.trim()}
              onClick={() => void draft()}
              className={BUTTON}
            >
              {drafting ? 'Drafting' : 'Draft with AI'}
            </button>
          </div>
          {draftError && <p role="alert" className="text-muted">{draftError}</p>}
        </div>
      )}
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
      </Field>
      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={FIELD} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Field label="Engine">
          <select value={engine} onChange={(e) => setEngine(e.target.value)} className={INPUT}>
            {ENGINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {engine === 'codex-model' && (
          <Field label="Codex model">
            <input value={codexModel} onChange={(e) => setCodexModel(e.target.value)} className={INPUT} />
          </Field>
        )}
        {!exactModel && (
          <Field label="Tier">
            <select value={tier} onChange={(e) => setTier(e.target.value as Tier)} className={INPUT}>
              {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
        <Field label="Permissions">
          <select value={permissions} onChange={(e) => setPermissions(e.target.value as Permissions)} className={INPUT}>
            {PERMISSIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-meta text-muted">Skills</legend>
        <input aria-label="Filter skills" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} className={INPUT} />
        <ul className="flex max-h-40 flex-col overflow-y-auto rounded-sm border border-raised">
          {shown.length === 0 && <li className="px-1 py-[4px] text-muted">No skills match.</li>}
          {shown.map((s) => (
            <li key={s.name}>
              <label className="flex cursor-pointer items-center gap-1 px-1 py-[4px] hover:bg-raised/50">
                <input type="checkbox" checked={picked.includes(s.name)} onChange={() => toggle(s.name)} className="accent-neutral-light" />
                <span>{s.name}</span>
                <span className="text-meta text-muted">{s.source}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <Field label="Role prompt">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} className={`${FIELD} font-mono`} />
      </Field>

      {(problem ?? saveError) && <p role="alert" className="text-muted">{problem ?? saveError}</p>}
      <div className="flex gap-1">
        <button type="submit" disabled={!!problem} className={CTA}>Save</button>
        <button type="button" onClick={onDone} className={BUTTON}>Cancel</button>
        {!isNew && (
          <button
            type="button"
            onClick={() => (confirmDelete ? void run(() => window.ark.catalog.remove(initial.id)) : setConfirmDelete(true))}
            className={`${BUTTON} ml-auto`}
          >
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[4px]">
      <span className="text-meta text-muted">{label}</span>
      {children}
    </label>
  );
}
