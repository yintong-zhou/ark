import { useCallback, useEffect, useState } from 'react';
import type { CatalogList, EngineInfo, SkillInfo, TeamInfo } from '@shared/types';
import type { AgentDef } from '@shared/agent-file';

const fetchAll = () => Promise.all([window.ark.catalog.list(), window.ark.skills.list(), window.ark.engines.status(), window.ark.engines.codexModels(), window.ark.head.get(), window.ark.catalog.teams()]);

/** The agent catalog, the skills and the engines found on this machine, loaded together. */
export function useCatalog() {
  const [catalog, setCatalog] = useState<CatalogList | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [codex, setCodex] = useState<string[]>([]);
  const [head, setHead] = useState<AgentDef | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [error, setError] = useState<string>();
  const apply = useCallback(([c, s, e, models, h, teamList]: Awaited<ReturnType<typeof fetchAll>>) => {
    setCatalog(c);
    setSkills(s);
    setEngines(e);
    setCodex(models);
    setHead(h);
    setTeams(teamList);
    setError(undefined);
  }, []);
  const fail = useCallback((err: unknown) => setError(err instanceof Error ? err.message : String(err)), []);
  const reload = useCallback(() => fetchAll().then(apply, fail), [apply, fail]);
  const reloadSkills = useCallback(() => window.ark.skills.list().then(setSkills, fail), [fail]);
  useEffect(() => {
    fetchAll().then(apply, fail);
  }, [apply, fail]);
  return { catalog, skills, engines, codex, head, teams, error, reload, reloadSkills };
}
