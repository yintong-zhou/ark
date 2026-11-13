// The agent protocol: agents end a reply with a fenced `ark` JSON block. This module parses it,
// formats the transcript an agent receives, and holds the protocol prompts and Ark's own notes.
import { AGENT_ID_RE, type AgentDef } from '@shared/agent-file';
import { SWITCH_AT } from '@shared/agent-problems';
import type { Attachment } from '@shared/attachments';
import type { PermissionMode } from '@shared/permissions';
import {
  MANAGER, PLANNING_BUDGET,
  type Control, type ReviewKind, type Roles, type TeamPick, type ThreadMessage,
} from '@shared/thread';
import { obj, str } from '../json';
import type { CheckResult } from './workspace';

export const DIFF_MAX = 100_000;
export const REQUEST_MAX = 2_000; // one user request, as a fresh reviewer reads it
export const OUTCOME_MAX = 4_000; // the builder's report, as a fresh reviewer reads it
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)} [cut]` : s);

/** How every role writes; each protocol adds who it escalates to. */
const WRITING = (escalate: string) => `## How to write
Write like a capable colleague: plain, short and specific. Lead with the answer or the result; do not repeat what others said, thank, praise or announce what you are about to do.
When something blocks you, name the blocker plainly: what is blocked, the evidence (file and line, a command and its output, a check result) and what would unblock it. ${escalate}
Never say you ran, checked or applied something you did not.`;

export const HEAD_PROTOCOL = `# Working in an Ark thread
You are the Head of Staff of this thread: a conversation between the user, who is your boss, and a team of the user's own agents. Ark relays it. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark.
You do not do the work yourself. You read the request, judge how hard it is, and put the right agents and models on it.
End every reply with exactly one Ark block: a fenced code block tagged ark holding one JSON object.

## First: propose the team
Ark lists the catalog: each agent's username, name and task, and whether it can change files. Reply with
{"team":[{"agent":"<username>","reason":"<one line>"}],"leftOut":"<one line on the obvious agents you left out>","difficulty":"easy"|"hard","planner":"<username>","builders":["<username>"],"codeReview":"<username>","securityReview":"<username>"}
- Pick only usernames from the catalog, never yourself. Everyone with a role must be in team.
- difficulty: easy for a small, precise change such as fixing one known bug; hard for a new feature, a refactoring, or anything whose requirements are not settled.
- A request that changes no files (a question, an analysis) needs only team and difficulty.
- builders: only agents that can change files. Name one per area that must change, for example backend and frontend.
- planner: who writes the plan. For an easy request leave it out: the first builder writes a short plan and nobody else is consulted. For a hard request choose an agent whose task is managing or planning.
- codeReview and securityReview: agents suited to review, never a builder of this thread. One agent may do both.
When the catalog lacks someone the work needs, do not improvise. Ask the user and say which agent to create in Agents:
- a hard request and no agent suited to manage and plan it: a project manager agent;
- files must change and no agent can change files: an agent that can build;
- no agent suited to a review: a reviewer. Offer the choices "I will create a reviewer" and "Go on without it". If the user goes on without it, leave that review out; Ark confirms it with the user before the build.

## Then: lead the planning (hard requests)
- To give the floor to one team member: {"next":"<username>"}. One agent speaks per turn; after they reply it is your turn again. Add "level":"light"|"standard"|"heavy" to run that one turn on a lighter or stronger model than the agent's own. An agent whose model the user locked ignores it.
- First have the manager work out with the user what is wanted, then have the builders size the work, then give the floor to the planner to write the plan, with "level":"heavy".
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]}. choices is optional, at most 4. The team waits for the answer.
- To change who plans, builds or reviews before the build starts: {"roles":{"builders":["<username>"]}} with only the keys that change (planner, builders, codeReview, securityReview), team members only.
The plan's phases are the tasks. A phase heading may end with (@username) to name the builder of that phase.

## Building
Team members read the project but change nothing while the thread plans. Once the plan is approved, Ark runs the build: each phase is implemented by its builder in the thread's own Git worktree, Ark commits and runs the project's checks, and the reviewers review each phase. Never ask the user to apply a patch, open another session or grant tools: to get something built, get the plan written. When Ark tells you a phase is blocked, ask the user how to continue. When the build is finished, Ark asks you for the summary; the thread then stays open for the user's follow-ups.

${WRITING('Settle what the team can settle by giving the floor to the specialist who knows; ask the user only for missing intent, a material change of scope, a sensitive decision or a blocker the team cannot resolve.')}`;
export const MEMBER_PROTOCOL = `# Working in an Ark thread
You are a member of this thread's team, led by the Head of Staff. Ark relays the conversation. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark. You speak only when you are given the floor: answer what you were asked, briefly. While the thread plans you read the project but cannot change files or run commands, even if you build later: describe the changes for the plan instead of writing patches.
You may end your reply with one Ark block, a fenced code block tagged ark holding one JSON object:
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]} (choices optional, at most 4).
- When your reply is the complete plan in Markdown, split into phases each with its goal and its checks: {"plan":true}. Start each phase with a heading "## Phase <n>: <title>"; add " (@username)" at the end of a heading to name the builder who implements that phase.
Without a block the floor goes back to the Head of Staff.

${WRITING('Raise what you cannot settle with the Head of Staff, and say which specialist could help.')}`;
export const BUILDER_PROTOCOL = `# Working in an Ark thread
You are the builder of this phase. You work in the thread's Git worktree, one plan phase at a time. Ark relays the reviewers' findings and the user's replies as [Ark] notes and messages. Do not commit: Ark commits. Run the project's checks before you finish. No Ark block is needed.
End with a short report for the reviewers: what you changed, the checks you ran and their result, and what is left.

${WRITING('If you cannot finish the phase, say what is missing: the reviewers and the Head of Staff read your report.')}`;
export const REVIEWER_PROTOCOL = `# Working in an Ark thread
You review the diff of one phase of the plan. You are read-only: do not change any file. Ark gives you the phase and its diff.
End your reply with exactly one Ark block, a fenced code block tagged ark holding one JSON object:
- Nothing to fix: {"review":"pass"}
- Something to fix: {"review":"changes","findings":["<one concrete finding>"]} with 1 to 20 findings.

${WRITING("Each finding names the file and what is wrong, with the evidence; a matter of taste is not a finding. Judge the change against the user's requests and the phase.")}`;
const DEVELOP_DENIED = "Ark will not run this project's checks in this thread: the user did not allow project code. Running one yourself asks the user each time.";
export const NOTES = {
  noAgents: 'No agents yet. Create an agent or add a ready team in Agents.',
  teamStart: (project: string, dir: string) => `The user started a thread in project ${project} (${dir}). Propose the team.`,
  catalog: (agents: AgentDef[]) => 'Catalog:\n' + agents.filter((a) => a.id !== MANAGER).map((a) => `- ${a.id}: ${a.name}. ${a.description}${a.permissions === 'build' ? ' [can change files]' : ''}`).join('\n'),
  roster: (team: { id: string; name: string }[]) => `Team: ${team.map((a) => `${a.id} (${a.name})`).join(', ')}.`,
  teamApproved: (names: string[]) => `The user approved the team: ${names.join(', ')}. Lead the planning.`,
  easyPlan: 'This is an easy request: no discussion. Write the short plan now: one phase, or one phase per builder when more than one must change files. End with {"plan":true}.',
  rolesChanged: 'Roles updated. Go on.',
  legacyBuild: "This build used Ark's built-in developer and reviewers, which no longer exist. Send a message and the Head of Staff will pick who continues.",
  assignRoles: 'This thread is mid-build and has nobody set to build or review. Pick them from the catalog with one roles block, or ask the user to create an agent that can build.',
  waiveTool: (kind: ReviewKind) => `a build without a ${kind} review`,
  waive: (kind: ReviewKind) => `No agent on this thread is set to do the ${kind} review. Allow builds this thread without it. Deny keeps the plan waiting: create a reviewer in Agents, then ask the Head of Staff to pick it.`,
  invalid: (error: string) => `Your reply had no valid Ark block (${error}). Reply again, ending with one valid Ark block.`,
  budget: `${PLANNING_BUDGET} agent turns without a plan. Write the user a short summary of where the discussion stands and ask how to continue.`,
  autoBudget: `${PLANNING_BUDGET} agent turns without a plan. Synthesize the team's work now: produce a complete plan with numbered phase headings and a plan block, or ask the user about one specific unresolved blocker. Do not delegate more turns.`,
  rerouted: (name: string) => `Claude is at ${SWITCH_AT}% or more of a usage window: ${name} runs on Codex.`,
  handoff: `Your session is getting long. Write a handoff for yourself: what the thread is about, what was decided and why, what is open (blockers with their evidence), and your next step. Ark starts you in a fresh session from it. No Ark block.`,
  handedOff: (from: string) => `${from} gave you the floor: answer what they asked above. Say what you found, with evidence, and any blocker plainly.`,
  relayLimit: 'The team has handed the floor around several times. As Head of Staff, decide the next step: give the floor to one specialist with a clear question, write up what is settled, or ask the user about a real blocker.',
  worktreeDirty: (paths: string[]) =>
    `The worktree has changes that are not part of this build (${paths.slice(0, 5).join(', ')}${paths.length > 5 ? ` and ${paths.length - 5} more` : ''}). Commit or discard them in Git first, so Ark's automatic commits hold only the build's work.`,
  /** `denied`: the thread may not run project code (not Full, not allowed), so Ark runs none of the checks. */
  develop: (o: { plan: string; index: number; total: number; phase: string; done: string[]; branch: string; worktree: string; setup: string[]; checks: string[]; denied?: boolean }) =>
    `You start phase ${o.index + 1}/${o.total}. Plan file: ${o.plan}. Worktree: ${o.worktree}. Branch: ${o.branch}.\n` +
    (o.done.length ? `Earlier phases:\n${o.done.map((d) => `- ${d}`).join('\n')}\n` : '') +
    `This phase:\n${o.phase}\n` +
    o.setup.map((h) => `${h}\n`).join('') +
    (o.checks.length && o.denied
      ? `${DEVELOP_DENIED}\n`
      : o.checks.length
      ? `Ark runs these checks after your turn, from the worktree root: ${o.checks.map((c) => (/^\w+$/.test(c) ? `npm run ${c}` : c)).join(', ')}. Run them yourself first, with exactly these commands, and fix what fails.\n`
      : 'Ark found no checks to run for this project: run its tests yourself and report the output.\n') +
    'Do not commit: Ark commits.',
  checksFailed: (results: CheckResult[]) =>
    'These checks failed. Fix them; Ark re-runs the checks.\n' +
    results.filter((r) => !r.ok).map((r) => `- ${r.script}:\n${r.tail}`).join('\n'),
  // Project code consent: the approval card's tool and detail ("Developer wants to use this repository's code"), and the
  // checks note after a denial. The copy must say the repository's code runs with the user's permissions.
  consentTool: "this repository's code",
  consent: (commands: string[]) =>
    `Ark will run this repository's checks (${commands.join(', ')}) on your computer with your permissions, after each builder turn, for the rest of this thread. The builder can change what they run. Allow also lets the Claude builder run these commands without another card. Allow only if you would run this code yourself.`,
  checksDenied: 'Checks not run: you did not allow project code in this thread.',
  developDenied: DEVELOP_DENIED,
  fix: 'The reviewers asked for changes (their findings are above). Fix them; Ark re-runs the checks and the reviews.',
  userFix: 'The user replied (above). Continue the phase.',
  /** A fresh reviewer reads no transcript: the user's requests and the builder's report come with the phase and its diff. */
  review: (o: { kind: 'code' | 'security'; phase: string; diff: string; worktree: string; requests?: string[]; requestsIncomplete?: boolean; outcome?: string }) =>
    `Do a ${o.kind} review of this phase.\n` +
    (o.requests?.length ? `The user's requests, oldest first:\n${o.requests.map((r) => `- ${cut(r, REQUEST_MAX)}`).join('\n')}\n` : '') +
    (o.requestsIncomplete ? 'Some user requests were omitted or truncated to fit the review context. Do not approve without the complete requirements: report this as a finding and ask the Head of Staff for them.\n' : '') +
    `Phase:\n${o.phase}\n` +
    (o.outcome ? `The builder's report:\n${cut(o.outcome, OUTCOME_MAX)}\n` : '') +
    'Diff:\n' +
    (o.diff === '' ? '(no changes in this phase)' : o.diff.slice(0, DIFF_MAX)) +
    (o.diff.length > DIFF_MAX ? `\nThe diff was cut at ${DIFF_MAX} characters: read the changed files in ${o.worktree}.` : ''),
  blocked: (o: { phase: string; points: string[] }) =>
    `Phase "${o.phase}" is blocked after 2 rounds. Open points:\n${o.points.map((p) => `- ${p}`).join('\n')}\nAsk the user how to continue, with one ask block.`,
  summary: (o: { branch: string; phases: { title: string; notes: number; commit?: string }[]; tokens: string[]; windows: string[]; git?: string[] }) =>
    `The build is finished. Write the user a short summary: what was built, the branch, the review notes, the tokens below. No Ark block.\nBranch: ${o.branch}\n` +
    o.phases.map((p) => `- ${p.title}: ${p.notes} review notes${p.commit ? `, commit ${p.commit}` : ''}`).join('\n') +
    `\nTokens:\n${o.tokens.map((t) => `- ${t}`).join('\n')}` +
    (o.windows.length ? `\nUsage windows (including your other sessions):\n${o.windows.map((w) => `- ${w}`).join('\n')}` : '') +
    (o.git?.length ? `\nGit:\n${o.git.map((g) => `- ${g}`).join('\n')}\n${NOTES.gitOffer}` : ''),
  gitOffer: 'Tell the user which of these next steps apply: commit the uncommitted files, merge the branch, push it. Keep uncommitted files apart from commits not merged or pushed. The user runs each one from the Git actions in this thread; Ark does none of them on its own. Never say one was done.',
  fresh: (handoff: string) => `You are continuing this thread in a fresh session. Your handoff:\n${handoff}`,
  followUp: 'The build is finished and the thread stays open. Only if the user explicitly requests a Git action, propose it with an Ark block: {"git":"commit"}, {"git":"merge"}, or {"git":"push"}. Ark shows the actual source and target and requires user confirmation; never claim the action was performed. Answer the user from the transcript and the project; a plain answer needs no Ark block. For further changes, lead the planning as before until a plan is written: once it is approved, Ark builds it as a new cycle in the same worktree and branch, with the checks and reviews again.',
  worktreeRemoved: "This thread's worktree was removed, so Ark cannot build here again. Start a new thread for further changes.",
  worktreeMissing: (dir: string) => `This thread's worktree is missing (${dir}). Ark does not recreate it: restore it, or start a new thread for further changes.`,
};

export type ThreadRole = 'head' | 'member' | 'builder' | 'reviewer';
const protocolFor = (role: ThreadRole) => role === 'head' ? HEAD_PROTOCOL : role === 'builder' ? BUILDER_PROTOCOL : role === 'reviewer' ? REVIEWER_PROTOCOL : MEMBER_PROTOCOL;
export const withProtocol = (agent: AgentDef, role: ThreadRole = 'member', mode: PermissionMode = 'ask'): AgentDef => ({
  ...agent,
  threadRole: role,
  prompt: `${agent.prompt}\n\n${protocolFor(role)}\n\n${mode === 'ask'
    ? 'Session policy: Ask for approval. The user confirms the team and starts the build after the plan.'
    : `# Autonomous session policy (overrides earlier turn-routing instructions)\nThe user authorized the team to select its members, agree on routine implementation decisions and proceed from a valid plan into the build. Do not ask the user to approve ordinary team choices, planning, inspections, local edits or checks.\nMembers may hand off to another approved team member with {"next":"<id>"}, never themselves or an outsider. Member ask blocks are questions to the Head of Staff, who resolves them using context and specialists. Only the Head of Staff escalates missing user intent, material scope changes, sensitive decisions or real blockers. A complete valid plan starts the build automatically.\nKeep decisions within the user's goal and report them in the conversation. Ark enforces tool approvals independently. Your role's read-only/build capability remains in force. Permission mode: ${mode}.`}`,
});

export { parsePhases } from '@shared/plan';

const BLOCK = /```ark\s*\n([\s\S]*?)\n```/g;
const MAX_CHOICES = 4;
const MAX_CHOICE = 60;
const MAX_FINDINGS = 20;
const MAX_FINDING = 2000;
const fail = (error: string) => ({ error: `ark block: ${error}` });

function parseRoles(o: Record<string, unknown>): { roles: Partial<Roles> } | { error: string } {
  const roles: Partial<Roles> = {};
  for (const key of ['planner', 'codeReview', 'securityReview'] as const) {
    if (o[key] !== undefined) {
      if (typeof o[key] !== 'string' || !AGENT_ID_RE.test(o[key])) return fail(`${key} must be an agent id`);
      roles[key] = o[key];
    }
  }
  if (o.builders !== undefined) {
    if (!Array.isArray(o.builders) || !o.builders.every((id) => typeof id === 'string' && AGENT_ID_RE.test(id))) return fail('builders must be a list of agent ids');
    roles.builders = o.builders;
  }
  return { roles };
}

/** Validates the JSON of one ark block into a Control, or an error message. */
function toControl(json: string): { control: Control } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail('not valid JSON');
  }
  const o = obj(raw);
  if (!o) return fail('not valid JSON');
  const kinds = ['team', 'next', 'ask', 'plan', 'review', 'roles', 'git'].filter((k) => o[k] !== undefined);
  if (kinds.length !== 1) return fail('use exactly one of team, next, ask, plan, review, roles');
  switch (kinds[0]) {
    case 'git':
      return o.git === 'commit' || o.git === 'merge' || o.git === 'push' ? { control: { kind: 'git', action: o.git } } : fail('git must be commit, merge or push');
    case 'team': {
      if (!Array.isArray(o.team) || o.team.length === 0) return fail('team needs at least one pick');
      const picks: TeamPick[] = [];
      for (const p of o.team) {
        const agent = str(obj(p)?.agent);
        const reason = str(obj(p)?.reason);
        if (!agent || !reason) return fail('each pick needs an agent and a reason');
        picks.push({ agent, reason });
      }
      if (o.difficulty !== undefined && o.difficulty !== 'easy' && o.difficulty !== 'hard') return fail('difficulty must be easy or hard');
      const parsed = parseRoles(o);
      if ('error' in parsed) return parsed;
      const roles = Object.keys(parsed.roles).length ? { builders: [], ...parsed.roles } : undefined;
      return { control: { kind: 'team', picks, leftOut: typeof o.leftOut === 'string' ? o.leftOut : '', ...(o.difficulty !== undefined && { difficulty: o.difficulty }), ...(roles && { roles }) } };
    }
    case 'roles': {
      const value = obj(o.roles);
      if (!value) return fail('roles needs planner, builders, codeReview or securityReview');
      const parsed = parseRoles(value);
      if ('error' in parsed) return parsed;
      if (!Object.keys(parsed.roles).length) return fail('roles needs planner, builders, codeReview or securityReview');
      return { control: { kind: 'roles', roles: parsed.roles } };
    }
    case 'next': {
      const agent = str(o.next);
      if (!agent) return fail('next must be an agent id');
      if (o.level !== undefined && o.level !== 'light' && o.level !== 'standard' && o.level !== 'heavy') return fail('level must be light, standard or heavy');
      return { control: { kind: 'next', agent, ...(o.level !== undefined && { level: o.level }) } };
    }
    case 'ask': {
      const question = str(o.ask);
      if (!question) return fail('ask must be a question');
      const list = o.choices ?? [];
      if (!Array.isArray(list)) return fail('choices must be a list');
      if (list.length > MAX_CHOICES) return fail(`at most ${MAX_CHOICES} choices`);
      const choices = list.map((c) => (typeof c === 'string' ? c.trim() : ''));
      if (choices.some((c) => c === '' || c.length > MAX_CHOICE)) return fail(`choices must be 1 to ${MAX_CHOICE} characters`);
      return { control: { kind: 'ask', question, choices } };
    }
    case 'review': {
      if (o.review === 'pass') return { control: { kind: 'review', pass: true, findings: [] } };
      const f = o.findings;
      const ok = o.review === 'changes' && Array.isArray(f) && f.length >= 1 && f.length <= MAX_FINDINGS
        && f.every((x) => typeof x === 'string' && x.trim() !== '' && x.length <= MAX_FINDING);
      return ok ? { control: { kind: 'review', pass: false, findings: f as string[] } }
        : fail(`review must be "pass", or "changes" with 1 to ${MAX_FINDINGS} findings`);
    }
    default:
      return o.plan === true ? { control: { kind: 'plan' } } : fail('plan must be true');
  }
}

/** Splits a reply into its visible body and the control of its last ark block. */
export function parseReply(text: string): { body: string; control?: Control; error?: string } {
  const blocks = [...text.matchAll(BLOCK)];
  const body = text.replace(BLOCK, '').trim();
  if (blocks.length === 0) return { body };
  return { body, ...toControl(blocks[blocks.length - 1][1]) };
}

const QUOTE_MAX = 80;

/**
 * What the agent is told about a message's attachments. An image travels as an image next to the text, so
 * only its name appears here; a text file is pasted in, because the agent has no access to Ark's folders.
 */
function attached(list: Attachment[] | undefined, readText: (a: Attachment) => string | undefined): string {
  return (list ?? [])
    .map((a) => {
      if (a.kind === 'image') return `
(attached image: ${a.name})`;
      const body = readText(a);
      return body === undefined ? `
(attached file ${a.name} could not be read)` : `
--- ${a.name} ---
${body}
--- end of ${a.name} ---`;
    })
    .join('');
}

/** The transcript an agent receives: the messages it has not seen, minus its own, one labelled paragraph each. */
export function formatForAgent(
  unseen: ThreadMessage[],
  all: ThreadMessage[],
  names: Record<string, string>,
  self: string,
  readText: (a: Attachment) => string | undefined = () => undefined,
): string {
  const nameOf = (id: string) => names[id] ?? id;
  const labelOf = (m: ThreadMessage | undefined) => (m?.kind === 'agent' ? nameOf(m.agent) : 'User');
  const quote = (m: ThreadMessage | undefined) => {
    const t = m && 'text' in m ? m.text : '';
    return t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX)}…` : t;
  };
  const lines: string[] = [];
  for (const m of unseen) {
    if (m.kind === 'agent') {
      if (m.agent === self) continue;
      const ask = m.control?.kind === 'ask' ? `\n(asked the user: ${m.control.question})` : '';
      const c = m.control;
      const review = c?.kind !== 'review' ? '' : c.pass ? '\n(review: pass)' : `\n(findings:\n${c.findings.map((f) => `- ${f}`).join('\n')})`;
      lines.push(`[${nameOf(m.agent)}] ${m.text}${ask}${review}`);
    } else if (m.kind === 'user') lines.push(`[User] ${m.text}${attached(m.attachments, readText)}`);
    else if (m.kind === 'note') lines.push(`[Ark] ${m.text}`);
    else if (m.kind === 'reaction') {
      const target = all.find((x) => x.seq === m.target);
      lines.push(`[User reacted ${m.emoji} to ${labelOf(target)}: "${quote(target)}"]`);
    }
  }
  return lines.join('\n\n');
}
