import { useState, type ReactNode } from 'react';
import type { AgentDef } from '@shared/agent-file';
import type { AgentTeam, TeamGroup } from '@shared/agent-teams';
import { readable } from '../errors';
import { BUTTON, INPUT, LINK } from './ui';

type Props = {
  group: TeamGroup;
  teams: AgentTeam[];
  open: boolean;
  onToggle(): void;
  onRename(name: string): Promise<void>;
  onDelete(): void;
  onMove(agentId: string, teamId: string | null): void;
  renderRow(a: AgentDef, move: ReactNode): ReactNode;
};

/** One team's header (toggle, name, count, rename, delete) and its agent rows. */
export function AgentTeamSection({ group, teams, open, onToggle, onRename, onDelete, onMove, renderRow }: Props) {
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
    <li className="flex flex-col border-t border-divider">
      <div className="flex flex-wrap items-center gap-1 py-1">
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
          <button type="button" onClick={onToggle} aria-expanded={open} className={`${LINK} flex items-baseline gap-1 text-left`}>
            <span aria-hidden>{open ? '▾' : '▸'}</span>
            <span className="head">{label}</span>
            <span className="text-meta text-muted">Team - {agents.length}</span>
          </button>
        )}
        <span className="flex-1" />
        {team && !renaming && (
          <>
            <button type="button" onClick={() => { setName(team.name); setRenaming(true); }} className={BUTTON}>Rename</button>
            <button type="button" onClick={onDelete} className={BUTTON}>Delete</button>
          </>
        )}
        {renaming && <button type="button" onClick={() => void submit()} className={BUTTON}>Save</button>}
      </div>
      {problem && <p role="alert" className="pb-1 text-muted">{problem}</p>}
      {open && (
        <ul className="flex flex-col">
          {agents.length === 0 && <li className="border-t border-divider py-1 text-muted">No agents yet. Move agents here from their Team menu.</li>}
          {agents.map((a) => renderRow(a, (
            <select
              aria-label={`Team of ${a.name}`}
              value={team?.id ?? ''}
              onChange={(e) => onMove(a.id, e.target.value || null)}
              className={INPUT}
            >
              <option value="">Ungrouped</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )))}
        </ul>
      )}
    </li>
  );
}
