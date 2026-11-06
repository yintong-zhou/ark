import type { Account, AgentId, Session, UsageWindow } from '@shared/types';

export type AdapterUpdate = { agent: AgentId; windows?: UsageWindow[]; session?: Session; account?: Account };

/** One adapter per agent: maps that agent's own sources to the common model. */
export interface Adapter {
  id: AgentId;
  detect(): Promise<{ installed: boolean; path?: string; version?: string }>;
  account(): Promise<Account | undefined>;
  /** Fresh windows from a live source; [] when the agent has none. */
  refresh(): Promise<UsageWindow[]>;
  start(emit: (u: AdapterUpdate) => void): Promise<void>;
  stop(): void;
}
