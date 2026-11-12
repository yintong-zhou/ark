import type { AgentDef } from './agent-file';

/** What the drafter is told. The message lists the skills; the model must pick only from that list. */
export const DRAFTER_PROMPT = `You write agent files for Ark, a desktop app where small teams of AI agents work together.

The user's message lists the skills available and describes the agent they need. Reply with ONLY one agent file in exactly this format, with no commentary before or after it:

---
name: <alias> - <role>
alias: <agent's name>
role: <job title>
description: <one sentence saying what the agent does>
engine: auto
tier: <light | standard | heavy>
skills: [<skill names>]
permissions: <read-only | build>
---
<role prompt>

Rules:
- tier: light for talking and reading, standard for planning and review, heavy for writing code.
- skills: choose only from the list in the message, only those the agent really needs, and write the names exactly as listed. Use [] when none fit.
- permissions: read-only unless the agent has to change files, then build.
- The role prompt is written in the second person ("You are..."). It says what the agent does, when it asks the user instead of guessing, and what it must not do.
- Write the file in the language of the user's description.
- Output the file only: no code fences, no explanation.`;

export const DRAFTER: AgentDef = {
  id: 'ark-drafter',
  name: 'Agent drafter',
  description: 'Writes an Ark agent file from a one-sentence description.',
  engine: { kind: 'auto' },
  tier: 'light',
  skills: [],
  permissions: 'read-only',
  prompt: DRAFTER_PROMPT,
};

/** The agent file inside a model reply: drops ``` fences and any preamble before the first line that is exactly `---`. */
export function extractAgentFile(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter((l) => !l.trim().startsWith('```'));
  const start = lines.findIndex((l) => l.trim() === '---');
  return start < 0 ? undefined : lines.slice(start).join('\n').trim();
}
