import { useState } from 'react';
import { isLocked, type AgentDef, type EngineSetting } from '@shared/agent-file';
import { ModelField, SkillsField } from '../components/AgentFields';
import { Page } from '../components/Page';
import { BUTTON, CTA } from '../components/ui';
import { readable } from '../errors';
import { useCatalog } from '../hooks/useCatalog';

export function HeadForm({ onBack }: { onBack: () => void }) {
  const { head, skills, engines, codex, error } = useCatalog();
  const installed = { claude: engines.some((e) => e.id === 'claude' && e.installed), codex: engines.some((e) => e.id === 'codex' && e.installed) };
  return <Page title="Head of Staff" meta={['Its instructions are part of Ark. You choose its skills and model.']} narrow>
    {head ? <Form initial={head} skills={skills} installed={installed} codex={codex} onBack={onBack} /> : <p className="text-muted">{error ?? 'Loading.'}</p>}
  </Page>;
}

function Form({ initial, skills, installed, codex, onBack }: { initial: AgentDef; skills: Parameters<typeof SkillsField>[0]['skills']; installed: { claude: boolean; codex: boolean }; codex: string[]; onBack: () => void }) {
  const [engine, setEngine] = useState<EngineSetting>(initial.engine);
  const [lock, setLock] = useState(isLocked(initial));
  const [picked, setPicked] = useState(initial.skills);
  const [error, setError] = useState<string>();
  const save = async () => { try { await window.ark.head.save({ skills: picked, engine, lock }); onBack(); } catch (e) { setError(readable(e)); } };
  return <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <SkillsField skills={skills} picked={picked} onChange={setPicked} />
    <ModelField engine={engine} lock={lock} installed={installed} codex={codex} onChange={(e, l) => { setEngine(e); setLock(l); }} />
    {error && <p role="alert" className="text-muted">{error}</p>}
    <div className="flex gap-1"><button type="submit" className={CTA}>Save</button><button type="button" className={BUTTON} onClick={onBack}>Cancel</button></div>
  </form>;
}
