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

/** What the prompt writer is told: it answers with the system prompt itself and nothing else. */
export const PROMPT_WRITER_PROMPT = `You write the system prompt of one agent for Ark, a desktop app where small teams of AI agents work together in a thread. Ark adds its own rules about threads, mentions and approvals, so do not repeat them.

The user's message describes the agent: its name, role, task, whether it may change files and the skills it has. It may also include a prompt to improve.

Reply with ONLY the system prompt, with no commentary, title or code fence around it.

Rules:
- Write in the second person ("You are..."), starting with who the agent is and what it is for.
- Say how it works: the steps it follows, what a good result looks like, and how it reports back (short, plain, like a colleague in a channel).
- Say when it asks the user instead of guessing, and what it must not do. A read-only agent never edits files; say so.
- Mention each skill only if the agent needs it, and say when to use it. Never invent skills, tools or facts about the project.
- Keep it under 400 words: concrete and specific to this role, no generic filler.
- If a prompt to improve is given, keep its intent and every specific instruction in it, and fix what is vague, missing or contradictory.
- Write in the language of the description; keep an existing prompt's language.`;

export const PROMPT_WRITER: AgentDef = {
  id: 'ark-prompt-writer',
  name: 'Prompt writer',
  description: 'Writes or improves the system prompt of an Ark agent.',
  engine: { kind: 'auto' },
  tier: 'light',
  skills: [],
  permissions: 'read-only',
  prompt: PROMPT_WRITER_PROMPT,
};

export type PromptBrief = Pick<AgentDef, 'name' | 'description' | 'permissions' | 'skills'> & { alias?: string; role?: string; prompt?: string };

/** The message the prompt writer gets: the agent's fields, and the current prompt when there is one to improve. */
export function promptRequest(b: PromptBrief): string {
  const lines = [
    `Name: ${b.alias?.trim() || b.name}`,
    b.role?.trim() && `Role: ${b.role.trim()}`,
    b.description.trim() && `Task: ${b.description.trim()}`,
    `Can change files: ${b.permissions === 'build' ? 'yes, in the thread worktree' : 'no, advisor only'}`,
    `Skills: ${b.skills.length ? b.skills.join(', ') : 'none'}`,
  ].filter(Boolean);
  const current = b.prompt?.trim();
  return lines.join('\n') + (current ? `\n\nPrompt to improve:\n${current}` : '\n\nThere is no prompt yet: write it.');
}

/** The prompt inside a reply: drops a code fence that wraps the whole reply; undefined when nothing is left. */
export function extractPrompt(text: string): string | undefined {
  const t = text.trim().replace(/^```[^\n]*\n([\s\S]*?)\n```$/, '$1').trim();
  return t || undefined;
}
