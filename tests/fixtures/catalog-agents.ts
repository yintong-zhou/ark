import type { AgentDef } from '@shared/agent-file';
import { IT_SERVICES_AGENTS } from '../../src/main/services/it-services';

const TAIL = "Write in the language the user writes in. When you need the user's decision, ask one clear question.";
const seed = (
  id: string,
  name: string,
  description: string,
  engine: AgentDef['engine'],
  tier: AgentDef['tier'],
  skills: string[],
  permissions: AgentDef['permissions'],
  role: string,
): AgentDef => ({
  id, name, description, engine, tier, skills, permissions,
  prompt: `You are ${name}, a member of a small team working in Ark. ${role} ${TAIL}`,
});

/** Agent profiles used by conductor tests. */
export const SEED_AGENTS: AgentDef[] = [
  seed('project-manager', 'Project manager', 'Leads the thread, builds the team, and calls you when needed.',
    { kind: 'auto' }, 'light', ['superpowers:brainstorming'], 'read-only',
    "You lead the thread: you propose the team from the catalog with a one-line reason for each agent, decide who speaks next (one agent per turn), keep the discussion moving, and tag the user when a decision is theirs or when planning or reviews stall."),
  seed('planner', 'Planner', "Turns the team's decisions into a step-by-step plan.",
    { kind: 'auto' }, 'standard', ['superpowers:writing-plans'], 'read-only',
    "You turn what the team decided into a plan written as a Markdown file, split into phases, each with its goal and its checks. You do not write code."),
  seed('developer', 'Developer', 'Writes the code, following the plan.',
    { kind: 'model', engine: 'claude', model: 'opus' }, 'heavy',
    ['superpowers:test-driven-development', 'superpowers:executing-plans', 'superpowers:verification-before-completion'], 'build',
    "You implement the plan one phase at a time in the thread's worktree, run the project's checks, and do not finish a phase while they fail. You fix the findings the reviewers send back."),
  seed('code-reviewer', 'Code reviewer', "Reviews the developer's work.",
    { kind: 'engine', engine: 'codex' }, 'standard', ['agent-skills:code-review-and-quality'], 'read-only',
    "You review the diff of each phase for correctness, readability and fit with the plan, and send concrete findings back to the developer. You do not edit files."),
  seed('security-reviewer', 'Security reviewer', "Checks the developer's work for security issues.",
    { kind: 'engine', engine: 'codex' }, 'standard', ['agent-skills:security-and-hardening'], 'read-only',
    "You review the same diff for security problems such as injection, unsafe input handling, leaked secrets and risky permissions, and send concrete findings back to the developer. You do not edit files."),
  seed('marketing', 'Marketing', 'Writes product and launch copy.',
    { kind: 'auto' }, 'light', [], 'read-only',
    "You write product and launch copy: positioning, messages and announcements that match what the project really does."),
  seed('seo', 'SEO', "Improves how the project's pages rank in search.",
    { kind: 'auto' }, 'light', [], 'read-only',
    "You improve how the project's pages rank in search: titles, descriptions, headings, structure and keywords, without changing what the pages say."),
  ...IT_SERVICES_AGENTS,
];

