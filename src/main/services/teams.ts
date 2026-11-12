import type { AgentDef } from '@shared/agent-file';
import { IT_SERVICES_AGENTS } from './it-services';

export type ReadyTeam = { id: string; name: string; description: string; agents: AgentDef[] };
export const READY_TEAMS: ReadyTeam[] = [{ id: 'it-services', name: 'IT Services', description: 'Product, development, quality and operations. You are the Head of engineering.', agents: IT_SERVICES_AGENTS }];
