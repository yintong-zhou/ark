import { useEffect, useState, type ReactNode } from 'react';
import { formatEngineSetting, type AgentDef, type EngineId } from '@shared/agent-file';
import { agentProblems } from '@shared/agent-problems';
import { assignAgent, createTeam, deleteTeam, groupAgents, renameTeam, type AgentTeams } from '@shared/agent-teams';
import type { EngineInfo, ImportableAgent, TeamInfo, UsageState } from '@shared/types';
import { AGENT_NAME, type Navigate } from '../agents';
import { AgentTag } from '../components/AgentTag';
import { AgentTeamSection } from '../components/AgentTeamSection';
import { confirmAction } from '../components/Confirm';
import { AgentAvatar, forgetImage } from '../components/Avatar';
import { EngineLogo } from '../components/Logos';
import { Page } from '../components/Page';
import { BUTTON, CTA, INPUT } from '../components/ui';
import { readable } from '../errors';
import { useCatalog } from '../hooks/useCatalog';

const OPEN_KEY = 'ark-agent-teams-open';
const readOpen = (): Record<string, boolean> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
    return typeof v === 'object' && v !== null ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

/** The agent catalog: engines found on this machine, import, and one row per agent. */
export function Agents({ state, onNavigate }: { state: UsageState | null; onNavigate: Navigate }) {
  const { catalog, skills, engines, head, teams, agentTeams, saveAgentTeams, error, reload } = useCatalog();
  const [importing, setImporting] = useState<ImportableAgent[] | null>(null);
  const [problem, setProblem] = useState<string>();
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamResult, setTeamResult] = useState<string>();
  const [confirmTeam, setConfirmTeam] = useState<string>();
  const skillNames = new Set(skills.map((s) => s.name));
  const [newTeam, setNewTeam] = useState<string | null>(null);
  const [teamProblem, setTeamProblem] = useState<string>();
  const [openState, setOpenState] = useState<Record<string, boolean>>(readOpen);
  const isOpen = (key: string) => openState[key] !== false;
  const toggle = (key: string) => {
    const next = { ...openState, [key]: !isOpen(key) };
    setOpenState(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* remembered only when storage works */ }
  };
  // Saves an edited document; on failure shows the error and reloads the saved one.
  const edit = async (change: (t: AgentTeams) => AgentTeams) => {
    try {
      setProblem(undefined);
      await saveAgentTeams(change(agentTeams));
    } catch (e) {
      setProblem(readable(e));
      await reload();
    }
  };
  const submitNewTeam = async () => {
    try {
      await saveAgentTeams(createTeam(agentTeams, newTeam ?? '', crypto.randomUUID()));
      setNewTeam(null);
      setTeamProblem(undefined);
    } catch (e) {
      setTeamProblem(readable(e));
    }
  };
  const removeTeam = async (id: string, name: string, count: number) => {
    if (count > 0 && !(await confirmAction(`Delete team ${name}? Its ${count} agents move to Ungrouped. The agents themselves are kept.`))) return;
    await edit((t) => deleteTeam(t, id));
  };

  useEffect(() => {
    if (!confirmTeam) return;
    const cancel = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(`[data-team-confirm="${confirmTeam}"]`)) setConfirmTeam(undefined);
    };
    document.addEventListener('pointerdown', cancel, true);
    document.addEventListener('focusin', cancel, true);
    return () => { document.removeEventListener('pointerdown', cancel, true); document.removeEventListener('focusin', cancel, true); };
  }, [confirmTeam]);

  const openImport = async () => {
    if (importing) return setImporting(null);
    try {
      setProblem(undefined);
      setImporting(await window.ark.catalog.importable());
    } catch (e) {
      setProblem(readable(e));
    }
  };
  const pick = async (path: string) => {
    try {
      onNavigate({ name: 'agent-form', draft: await window.ark.catalog.import(path) });
    } catch (e) {
      setProblem(readable(e));
    }
  };
  const addTeam = async (team: TeamInfo) => {
    setAddingTeam(true);
    setProblem(undefined);
    setTeamResult(undefined);
    try {
      const { added, skipped } = await window.ark.catalog.addTeam(team.id);
      setTeamResult(`Added ${added.length} ${team.name} agents.${skipped.length ? ` ${skipped.length} existing profiles kept.` : ''}`);
      await reload();
    } catch (e) {
      setProblem(readable(e));
    } finally {
      setAddingTeam(false);
    }
  };

  const updateTeam = async (team: TeamInfo) => {
    if (confirmTeam !== team.id) { setConfirmTeam(team.id); return; }
    setConfirmTeam(undefined); setAddingTeam(true); setProblem(undefined); setTeamResult(undefined);
    try {
      const { updated } = await window.ark.catalog.updateTeam(team.id);
      updated.forEach(forgetImage);
      setTeamResult(`Updated ${updated.length} ${team.name} agents.`);
      await reload();
    } catch (e) { setProblem(readable(e)); } finally { setAddingTeam(false); }
  };


  const renderRow = (a: AgentDef, move?: ReactNode) => (
    <Row key={a.id} a={a} move={move} problems={agentProblems(a, skillNames, engines)} onNavigate={onNavigate} />
  );

  return (
    <Page
      title="Agents"
      meta={['The agents the Head of Staff picks each team from']}
      actions={
        <>
          <button onClick={() => { setNewTeam(newTeam === null ? '' : null); setTeamProblem(undefined); }} aria-expanded={newTeam !== null} className={BUTTON}>New team</button>
          <button onClick={openImport} aria-expanded={importing !== null} className={BUTTON}>Import</button>
          <button onClick={() => onNavigate({ name: 'agent-form' })} className={CTA}>New agent</button>
        </>
      }
    >
      <EngineRow engines={engines} state={state} reload={reload} />


      <section className="flex flex-col gap-1" aria-label="Ready teams">
        <h2 className="text-body">Ready teams</h2>
        <p className="max-w-[65ch] text-muted">Agents ready to use. Adding a team copies them into your catalog, where you can edit or delete them.</p>
        {teams.map((team) => <div key={team.id} className="flex flex-wrap items-start gap-1 border-t border-divider py-1">
          <div className="min-w-0 flex-1"><p className="head">{team.name}</p><p className="text-muted">{team.description}</p><p className="text-meta text-muted">{team.count} agents</p>{confirmTeam === team.id && <p className="text-meta text-muted">Your edits to these profiles will be lost.</p>}</div>
          {team.present < team.count && <button type="button" onClick={() => void addTeam(team)} disabled={addingTeam || catalog === null} className={BUTTON}>{team.present ? 'Add missing agents' : 'Add team'}</button>}
          {team.present > 0 && <button type="button" data-team-confirm={team.id} onClick={() => void updateTeam(team)} disabled={addingTeam || catalog === null} className={BUTTON}>{confirmTeam === team.id ? `Replace ${team.present} profiles` : 'Update team'}</button>}
        </div>)}
        {teamResult && <p role="status" className="text-muted">{teamResult}</p>}
      </section>

      {importing && (
        <ul className="flex flex-col">
          {importing.length === 0 && <li className="border-t border-divider py-1 text-muted">Nothing to import.</li>}
          {importing.map((i) => (
            <li key={i.path} className="border-t border-divider">
              <button onClick={() => pick(i.path)} className="flex w-full gap-2 rounded-xs py-1 text-left hover:text-secondary">
                <span>{i.name}</span>
                <span className="text-muted">{i.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {newTeam !== null && (
        <div className="flex flex-col gap-1">
          <input
            autoFocus
            aria-label="New team name"
            placeholder="Team name"
            value={newTeam}
            onChange={(e) => setNewTeam(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewTeam();
              if (e.key === 'Escape') { setNewTeam(null); setTeamProblem(undefined); }
            }}
            className={`${INPUT} max-w-60`}
          />
          {teamProblem && <p role="alert" className="text-muted">{teamProblem}</p>}
        </div>
      )}

      {(problem ?? error) && <p role="alert" className="text-muted">{problem ?? error}</p>}
      {catalog === null && !error && <p className="text-muted">Loading agents.</p>}

      <ul className="flex flex-col">
        {head && <li className="flex gap-2 border-t border-divider py-2">
          <AgentAvatar agent={head} name={head.name} />
          <div className="min-w-0 flex-1"><h2 className="text-body">Head of Staff</h2><p className="text-muted">Built into Ark. It coordinates every thread.</p><p className="text-meta text-muted">{formatEngineSetting(head.engine)}</p></div>
          <button onClick={() => onNavigate({ name: 'head-form' })} className={BUTTON}>Edit</button>
        </li>}
        {catalog && catalog.agents.length === 0 && <li className="border-t border-divider py-2 text-muted">No agents yet. Create one with New agent, or add a ready team above.</li>}
        {catalog && agentTeams.teams.length === 0 && catalog.agents.map(renderRow)}
        {catalog && agentTeams.teams.length > 0 && groupAgents(catalog.agents, agentTeams).map((group) => {
          const key = group.team?.id ?? 'ungrouped';
          return (
            <AgentTeamSection
              key={key}
              group={group}
              teams={agentTeams.teams}
              open={isOpen(key)}
              onToggle={() => toggle(key)}
              onRename={async (name) => { await saveAgentTeams(renameTeam(agentTeams, key, name)); }}
              onDelete={() => void removeTeam(key, group.team?.name ?? '', group.agents.length)}
              onMove={(id, teamId) => void edit((t) => assignAgent(t, id, teamId))}
              renderRow={renderRow}
            />
          );
        })}
      </ul>

      {catalog && catalog.invalid.length > 0 && (
        <section className="flex flex-col">
          <h2 className="pb-1 text-body">Files with errors</h2>
          <ul className="flex flex-col">
            {catalog.invalid.map((f) => (
              <li key={f.file} className="flex gap-2 border-t border-divider py-1">
                <span>{f.file}</span>
                <span className="text-muted">{f.error}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

function Row({ a, problems, move, onNavigate }: { a: AgentDef; problems: string[]; move?: ReactNode; onNavigate: Navigate }) {
  return (
    <li className="flex gap-2 border-t border-divider py-2">
      <AgentAvatar agent={a} name={a.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <div className="flex items-baseline gap-1">
          <h2 className="text-body">{a.name}</h2>
          <span className="flex items-center gap-1 text-meta text-muted">
            {a.engine.kind !== 'auto' && <EngineLogo id={a.engine.engine} size={14} />}
            <span>{formatEngineSetting(a.engine)}</span>
            {a.engine.kind !== 'model' && <span className="capitalize">{a.tier}</span>}
          </span>
        </div>
        {a.description && <p className="line-clamp-2 max-w-[65ch] text-muted">{a.description}</p>}
        {a.skills.length > 0 && (
          <ul className="flex flex-wrap gap-[4px]">
            {a.skills.map((s) => (
              <li key={s} className="rounded-full bg-raised px-1 text-meta text-muted">{s}</li>
            ))}
          </ul>
        )}
        {problems.map((p) => (
          <p key={p} className="text-meta text-secondary">{p}</p>
        ))}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {move}
        <button onClick={() => onNavigate({ name: 'chat', agentId: a.id })} className={BUTTON}>Chat</button>
        <button onClick={() => onNavigate({ name: 'agent-form', id: a.id })} className={BUTTON}>Edit</button>
      </div>
    </li>
  );
}

/** One line per engine, and a way to point Ark at an engine it did not find. */
function EngineRow({ engines, state, reload }: { engines: EngineInfo[]; state: UsageState | null; reload: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [engine, setEngine] = useState<EngineId>('claude');
  const [path, setPath] = useState('');
  const [problem, setProblem] = useState<string>();

  const save = async () => {
    try {
      // main merges this into the saved config, so only the edited engine is sent
      await window.ark.engines.save({ [engine]: { path: path.trim() } });
      setAdding(false);
      setPath('');
      setProblem(undefined);
      await reload();
    } catch (e) {
      setProblem(readable(e));
    }
  };

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h2 className="text-body">Engines on this machine</h2>
        <button onClick={() => setAdding(!adding)} aria-expanded={adding} className="rounded-xs text-muted underline-offset-4 hover:text-secondary hover:underline">
          Add manually
        </button>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {engines.map((e) => {
          const plan = state?.agents.find((a) => a.id === e.id)?.account?.plan;
          return (
            <li key={e.id} className="flex items-center gap-1">
              <AgentTag id={e.id} />
              <span className="text-secondary">{AGENT_NAME[e.id]}</span>
              {e.installed ? (
                <span className="flex gap-1 text-muted">
                  {plan && <span>{plan}</span>}
                  {e.version && <span>{e.version}</span>}
                  {e.manual && <span>manual</span>}
                </span>
              ) : (
                <span className="text-muted">not installed</span>
              )}
            </li>
          );
        })}
      </ul>
      {adding && (
        <div className="flex flex-wrap items-center gap-1">
          <select aria-label="Engine" value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} className={INPUT}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <input
            aria-label="Path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\path\to\engine.exe"
            className={`${INPUT} min-w-40 flex-1`}
          />
          <button onClick={save} disabled={!path.trim()} className={BUTTON}>Save</button>
        </div>
      )}
      {problem && <p role="alert" className="text-muted">{problem}</p>}
    </section>
  );
}
