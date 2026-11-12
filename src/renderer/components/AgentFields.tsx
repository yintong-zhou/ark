import { useState, type ReactNode } from 'react';
import { engineString, modelOptions, parseEngineSetting, type EngineId, type EngineSetting } from '@shared/agent-file';
import type { SkillInfo } from '@shared/types';
import { INPUT } from './ui';

export function ModelField({ engine, lock, installed, codex, onChange }: { engine: EngineSetting; lock: boolean; installed: Record<EngineId, boolean>; codex: string[]; onChange: (engine: EngineSetting, lock: boolean) => void }) {
  return <div className="flex flex-col gap-1">
    <label className="flex flex-col gap-[4px]"><span className="text-meta text-muted">Model</span>
      <select value={engineString(engine)} onChange={(e) => { const next = parseEngineSetting(e.target.value); if (next) onChange(next, next.kind === 'model' ? lock : false); }} className={INPUT}>
        {modelOptions(installed, codex, engine).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    {engine.kind === 'model' && <label className="flex items-center gap-1"><input type="checkbox" checked={lock} onChange={(e) => onChange(engine, e.target.checked)} className="accent-neutral-light" />Lock this model</label>}
    <p className="text-meta text-muted">Unlocked: the Head of Staff may go up or down with the difficulty of the task.</p>
  </div>;
}

export function SkillsField({ skills, picked, onChange, children }: { skills: SkillInfo[]; picked: string[]; onChange: (picked: string[]) => void; children?: ReactNode }) {
  const [filter, setFilter] = useState('');
  const known = new Set(skills.map((s) => s.name));
  const all = [...skills, ...picked.filter((s) => !known.has(s)).map((s) => ({ name: s, source: 'not installed', description: '' }))];
  const shown = all.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return <fieldset className="flex flex-col gap-1">
    <legend className="mb-1 text-meta text-muted">Skills</legend>
    <p className="text-meta text-muted">Skills installed on this PC.</p>
    <input aria-label="Filter skills" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} className={INPUT} />
    <ul className="flex max-h-40 flex-col overflow-y-auto rounded-sm border border-raised">
      {shown.length === 0 && <li className="px-1 py-[4px] text-muted">No skills match.</li>}
      {shown.map((s) => <li key={s.name}><label className="flex cursor-pointer items-center gap-1 px-1 py-[4px] hover:bg-raised/50">
        <input type="checkbox" checked={picked.includes(s.name)} onChange={() => onChange(picked.includes(s.name) ? picked.filter((n) => n !== s.name) : [...picked, s.name])} className="accent-neutral-light" />
        <span>{s.name}</span><span className="text-meta text-muted">{s.source}</span>
      </label></li>)}
    </ul>{children}
  </fieldset>;
}
