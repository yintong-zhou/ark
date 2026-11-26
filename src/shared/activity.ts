/** What an agent is doing right now, as a category only: never a path, command or tool input. */
export type ActivityAction = 'thinking' | 'reading' | 'searching' | 'editing' | 'running' | 'other';

/** The live state of a thread's speaking agent. `since` is when its turn started. Transient: never stored. */
export type ThreadActivity = { agent: string; action: ActivityAction; since: number };

const CLAUDE: Record<string, ActivityAction> = {
  Read: 'reading',
  Glob: 'searching',
  Grep: 'searching',
  Edit: 'editing',
  Write: 'editing',
  NotebookEdit: 'editing',
  Bash: 'running',
  PowerShell: 'running',
};

/** The category of a Claude tool; a tool Ark does not know is `other`. */
export const claudeAction = (tool: string): ActivityAction => CLAUDE[tool] ?? 'other';

const CODEX: Record<string, ActivityAction | undefined> = {
  reasoning: 'thinking',
  commandExecution: 'running',
  fileChange: 'editing',
  webSearch: 'searching',
  agentMessage: undefined, // the answer itself, not work
  userMessage: undefined,
};

/** The category of a Codex item, or undefined when the item is not work (a message). */
export const codexAction = (itemType: string): ActivityAction | undefined => (itemType in CODEX ? CODEX[itemType] : 'other');

const LABEL: Record<ActivityAction, string> = {
  thinking: 'Thinking',
  reading: 'Reading files',
  searching: 'Searching',
  editing: 'Editing code',
  running: 'Running a command',
  other: 'Working',
};

/** The line shown for an action; an open approval card wins over whatever the engine last did. */
export const activityLabel = (action: ActivityAction | undefined, awaitingApproval: boolean): string =>
  awaitingApproval ? 'Waiting for approval' : LABEL[action ?? 'other'];

/** m:ss, or h:mm:ss from one hour. */
export function elapsed(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
