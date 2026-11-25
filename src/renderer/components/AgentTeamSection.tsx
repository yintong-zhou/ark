import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AgentDef } from '@shared/agent-file';
import type { AgentTeam, TeamGroup } from '@shared/agent-teams';
import { readable } from '../errors';
import { Select } from './Select';
import { BUTTON, INPUT, LINK } from './ui';
import { FAST, staggerItem } from '../motion';
import { ChevronIcon } from './Icons';

type Props = {
  group: TeamGroup;
  teams: AgentTeam[];
  open: boolean;
  entrance?: boolean;
  onToggle(): void;
  onRename(name: string): Promise<void>;
  onDelete(): void;
  onMove(agentId: string, teamId: string | null): void;
  renderRow(a: AgentDef, move: ReactNode): ReactNode;
};

/** One team's header (toggle, name, count, rename, delete) and its agent rows. */
export function AgentTeamSection({ group, teams, open, entrance, onToggle, onRename, onDelete, onMove, renderRow }: Props) {
  const { team, agents } = group;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string>();
  const label = team?.name ?? 'Ungrouped';

  const submit = async () => {
    try {
      await onRename(name);
      setRenaming(false);
      setProblem(undefined);
    } catch (e) {
      setProblem(readable(e));
    }
  };

  return (
    <motion.li {...(entrance ? staggerItem : {})} className="flex flex-col border-t border-divider">
      <div className="group/team flex flex-wrap items-center gap-1 py-1">
        {renaming ? (
          <input
            autoFocus
            aria-label="Team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') { setRenaming(false); setProblem(undefined); }
            }}
            className={`${INPUT} min-w-40`}
          />
        ) : (
          <button type="button" onClick={onToggle} aria-expanded={open} className={`${LINK} flex min-h-4 items-center gap-1 text-left`}>
            <span aria-hidden className={open ? '' : '-rotate-90'}><ChevronIcon /></span>
            <span className="head">{label}</span>
            <span className="text-meta text-muted">Team - {agents.length}</span>
          </button>
        )}
        <span className="flex-1" />
        {team && !renaming && (
          <div className="flex gap-1 opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/team:opacity-100 group-focus-within/team:opacity-100 motion-safe:transition-opacity motion-safe:duration-[120ms] motion-safe:ease-(--ease)">
            <button type="button" onClick={() => { setName(team.name); setRenaming(true); }} className={BUTTON}>Rename</button>
            <button type="button" onClick={onDelete} className={BUTTON}>Delete</button>
          </div>
        )}
        {renaming && <button type="button" onClick={() => void submit()} className={BUTTON}>Save</button>}
      </div>
      {problem && <p role="alert" className="pb-1 text-muted">{problem}</p>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul key="agents" className="flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FAST}>
            {agents.length === 0 && <li className="border-t border-divider py-1 text-muted">No agents yet. Move agents here from their Team menu.</li>}
            {agents.map((a) => renderRow(a, <Select label={`Team of ${a.name}`} value={team?.id ?? ''} onChange={(v) => onMove(a.id, v || null)} options={[{ value: '', label: 'Ungrouped' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} />))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

