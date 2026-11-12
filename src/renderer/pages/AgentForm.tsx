import { useState, type ReactNode } from 'react';
import { AGENT_ID_RE, agentId, isLocked, validateAgent, type AgentDef, type EngineId, type EngineSetting, type Permissions } from '@shared/agent-file';
import type { ImageInput } from '@shared/attachments';
import { FACES, nextFace } from '@shared/avatars';
import type { SkillInfo } from '@shared/types';
import { AgentAvatar, forgetImage } from '../components/Avatar';
import { ModelField, SkillsField } from '../components/AgentFields';
import { Page } from '../components/Page';
import { BUTTON, CTA, FIELD, INPUT } from '../components/ui';
import { readable } from '../errors';
import { useCatalog } from '../hooks/useCatalog';

const NEW_AGENT: AgentDef = { id: '', name: '', description: '', engine: { kind: 'auto' }, tier: 'standard', skills: [], permissions: 'read-only', prompt: '' };

export function AgentForm({ id, draft, onBack }: { id?: string; draft?: AgentDef; onBack: () => void }) {
  const { catalog, skills, engines, codex, error } = useCatalog();
  const existing = id ? catalog?.agents.find((a) => a.id === id) : undefined;
  const installed = { claude: engines.some((e) => e.id === 'claude' && e.installed), codex: engines.some((e) => e.id === 'codex' && e.installed) };
  return <Page title={id ? 'Edit agent' : 'New agent'} meta={['Saved to the catalog only when you press Save']} narrow>
    {catalog === null ? <p className="text-muted">{error ?? 'Loading.'}</p> : id && !existing ? <p className="text-muted">This agent no longer exists.</p> :
      <Form initial={existing ?? draft ?? NEW_AGENT} isNew={!id} taken={catalog.agents.map((a) => a.id)} face={nextFace(catalog.agents.map((a) => a.avatar))} skills={skills} installed={installed} codex={codex} onDone={onBack} />}
  </Page>;
}

function Form({ initial, isNew, taken, face, skills, installed, codex, onDone }: { initial: AgentDef; isNew: boolean; taken: string[]; face: string; skills: SkillInfo[]; installed: Record<EngineId, boolean>; codex: string[]; onDone: () => void }) {
  const [alias, setAlias] = useState(initial.alias ?? initial.name);
  const [role, setRole] = useState(initial.role ?? '');
  const [username, setUsername] = useState(isNew ? agentId(initial.role || initial.alias || initial.name) : initial.id);
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [description, setDescription] = useState(initial.description);
  const [engine, setEngine] = useState<EngineSetting>(initial.engine);
  const [lock, setLock] = useState(isNew ? false : isLocked(initial));
  const [permissions, setPermissions] = useState<Permissions>(initial.permissions);
  const [picked, setPicked] = useState(initial.skills);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [avatar, setAvatar] = useState(initial.avatar ?? face);
  const [image, setImage] = useState<ImageInput | null | undefined>();
  const [gallery, setGallery] = useState(false);
  const [imageError, setImageError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [idea, setIdea] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string>();
  const changeName = (nextAlias: string, nextRole: string) => { setAlias(nextAlias); setRole(nextRole); if (isNew && !usernameEdited) setUsername(agentId(nextRole || nextAlias)); };
  const name = role.trim() ? `${alias.trim()} - ${role.trim()}` : alias.trim();
  const legacyLong = !isNew && initial.alias === undefined && alias === initial.name && alias.length > 40 && !role;
  const agent: AgentDef = { ...initial, id: username, name, description, engine, skills: picked, permissions, prompt, avatar, lock: isNew || initial.lock !== undefined || engine.kind === 'model' ? lock : undefined, alias: legacyLong ? undefined : alias.trim(), role: role.trim() || undefined };
  const checked = validateAgent(agent);
  const problem = !AGENT_ID_RE.test(username) ? 'Username: lowercase letters, digits, - and _ (up to 64).' : isNew && taken.includes(username) ? 'This username is taken.' : checked.ok ? undefined : checked.error;
  const run = async (fn: () => Promise<void>) => { try { setSaveError(undefined); await fn(); forgetImage(username); onDone(); } catch (e) { setSaveError(readable(e)); } };
  const draftAgent = async () => {
    setDrafting(true); setDraftError(undefined);
    try {
      const a = await window.ark.catalog.draft(idea.trim());
      changeName(a.alias ?? a.name, a.role ?? ''); setDescription(a.description); setEngine(a.engine); setPermissions(a.permissions); setPicked(a.skills); setPrompt(a.prompt);
    } catch (e) { setDraftError(readable(e)); } finally { setDrafting(false); }
  };
  const upload = async () => { try { setImageError(undefined); const pickedImage = await window.ark.catalog.pickImage(); if (pickedImage) { setImage(pickedImage); setAvatar('custom'); } } catch (e) { setImageError(readable(e)); } };
  return <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (!problem && checked.ok) void run(() => window.ark.catalog.save(checked.agent, image)); }}>
    {isNew && <div className="flex flex-col gap-1"><div className="flex gap-1"><input aria-label="Describe the agent in one sentence" placeholder="Describe the agent in one sentence" value={idea} maxLength={2000} disabled={drafting} onChange={(e) => setIdea(e.target.value)} className={`${INPUT} flex-1`} /><button type="button" disabled={drafting || !idea.trim()} onClick={() => void draftAgent()} className={BUTTON}>{drafting ? 'Drafting' : 'Draft with AI'}</button></div>{draftError && <p role="alert" className="text-muted">{draftError}</p>}</div>}
    <div className="flex flex-col gap-1"><span className="text-meta text-muted">Profile image</span><div className="flex items-center gap-1"><div className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-raised">{image && avatar === 'custom' ? <img src={`data:${image.mime};base64,${image.data}`} alt="" className="h-full w-full object-cover" /> : <span className="scale-[1.6]"><AgentAvatar agent={{ id: initial.id, avatar }} name={name || 'Agent'} /></span>}</div><button type="button" className={BUTTON} onClick={() => setGallery(!gallery)}>Choose from gallery</button><button type="button" className={BUTTON} onClick={() => void upload()}>Upload from PC</button></div><p className="text-meta text-muted">Assigned automatically, different for every agent.</p>{imageError && <p role="alert" className="text-muted">{imageError}</p>}{gallery && <div className="flex flex-wrap gap-1">{FACES.map((f) => <button type="button" key={f} aria-label={f} aria-pressed={avatar === f} className={`rounded-full ${avatar === f ? 'outline outline-neutral-light' : ''}`} onClick={() => { setAvatar(f); setImage(null); setGallery(false); }}><AgentAvatar agent={{ id: '', avatar: f }} name={f} /></button>)}</div>}</div>
    <Field label="Alias" hint="The agent's own name."><input value={alias} maxLength={legacyLong ? 80 : 40} onChange={(e) => changeName(e.target.value, role)} className={INPUT} /></Field>
    <Field label="Role" hint="Shown next to the alias: Forge - Backend dev."><input value={role} maxLength={60} onChange={(e) => changeName(alias, e.target.value)} className={INPUT} /></Field>
    <Field label="Username" hint="How you call it in a thread. Cannot change after creation."><div className="flex items-center gap-1"><span>@</span><input value={username} readOnly={!isNew} onChange={(e) => { setUsernameEdited(true); setUsername(e.target.value); }} className={INPUT} /></div></Field>
    <Field label="Task" hint="One sentence. The Head of Staff reads it to decide who to involve."><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={FIELD} /></Field>
    <ModelField engine={engine} lock={lock} installed={installed} codex={codex} onChange={(e, l) => { setEngine(e); setLock(l); }} />
    <Field label="Can change files"><select value={permissions} onChange={(e) => setPermissions(e.target.value as Permissions)} className={INPUT}><option value="read-only">No - advisor only</option><option value="build">Yes - can write code in the thread worktree</option></select></Field>
    <SkillsField skills={skills} picked={picked} onChange={setPicked} />
    <Field label="System prompt"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} className={`${FIELD} font-mono`} /></Field>
    {(problem ?? saveError) && <p role="alert" className="text-muted">{problem ?? saveError}</p>}
    <div className="flex gap-1"><button type="submit" disabled={!!problem} className={CTA}>Save</button><button type="button" onClick={onDone} className={BUTTON}>Cancel</button>{!isNew && <button type="button" onClick={() => confirmDelete ? void run(() => window.ark.catalog.remove(initial.id)) : setConfirmDelete(true)} className={`${BUTTON} ml-auto`}>{confirmDelete ? 'Confirm delete' : 'Delete'}</button>}</div>
  </form>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="flex flex-col gap-[4px]"><span className="text-meta text-muted">{label}</span>{children}{hint && <span className="text-meta text-muted">{hint}</span>}</label>;
}
