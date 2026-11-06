import { useCallback, useEffect, useState } from 'react';
import type { CatalogList, EngineInfo, SkillInfo } from '@shared/types';

const fetchAll = () => Promise.all([window.ark.catalog.list(), window.ark.skills.list(), window.ark.engines.status()]);

/** The agent catalog, the skills and the engines found on this machine, loaded together. */
export function useCatalog() {
  const [catalog, setCatalog] = useState<CatalogList | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [error, setError] = useState<string>();
  const apply = useCallback(([c, s, e]: Awaited<ReturnType<typeof fetchAll>>) => {
    setCatalog(c);
    setSkills(s);
    setEngines(e);
    setError(undefined);
  }, []);
  const fail = useCallback((err: unknown) => setError(err instanceof Error ? err.message : String(err)), []);
  const reload = useCallback(() => fetchAll().then(apply, fail), [apply, fail]);
  useEffect(() => {
    fetchAll().then(apply, fail);
  }, [apply, fail]);
  return { catalog, skills, engines, error, reload };
}
