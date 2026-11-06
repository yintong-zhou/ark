// The agent protocol: agents end a reply with a fenced `ark` JSON block. This module parses it,
// formats the transcript an agent receives, and holds the protocol prompts and Ark's own notes.
import type { AgentDef } from '@shared/agent-file';
import { SWITCH_AT } from '@shared/agent-problems';
import type { Attachment } from '@shared/attachments';
import {
  CODE_REVIEWER, DEVELOPER, MANAGER, PLANNING_BUDGET, SECURITY_REVIEWER,
  type Control, type Phase, type TeamPick, type ThreadMessage,
} from '@shared/thread';
import { obj, str } from '../json';
import type { CheckResult } from './workspace';

export const DIFF_MAX = 100_000;

export const MANAGER_PROTOCOL = `# Working in an Ark thread
You are the project manager of this thread: a conversation between the user and a team of agents. Ark relays it. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark.
End every reply with exactly one Ark block: a fenced code block tagged ark holding one JSON object.
- Team phase (Ark tells you): {"team":[{"agent":"<id>","reason":"<one line>"}],"leftOut":"<one line on the obvious agents you left out>"}. Pick only ids from the catalog Ark lists, never yourself.
- To give the floor to one team member: {"next":"<id>"}. One agent speaks per turn; after they reply it is your turn again. Add "hard":true when the task is hard: that one turn runs on a stronger model.
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]}. choices is optional, at most 4. The team waits for the answer.
When the team agrees on what to build, give the floor to the planner to write the plan.`;
export const MEMBER_PROTOCOL = `# Working in an Ark thread
You are a member of this thread's team, led by the project manager. Ark relays the conversation. On your turn you receive the new messages since your last turn, each starting with [Name]; lines starting with [Ark] are instructions from Ark. You speak only when the project manager gives you the floor: answer what you were asked, briefly.
You may end your reply with one Ark block, a fenced code block tagged ark holding one JSON object:
- To ask the user: {"ask":"<one clear question>","choices":["<short answer>"]} (choices optional, at most 4).
- When your reply is the complete plan in Markdown, split into phases each with its goal and its checks: {"plan":true}. Start each phase with a heading "## Phase <n>: <title>".
Without a block the floor goes back to the project manager.`;
export const DEVELOPER_PROTOCOL = `# Working in an Ark thread
You are the developer. You work alone in your own Git worktree, one plan phase at a time. Ark relays the reviewers' findings and the user's replies as [Ark] notes and messages. Do not commit: Ark commits. Run the project's checks before you finish. No Ark block is needed.`;
export const REVIEWER_PROTOCOL = `# Working in an Ark thread
You review the diff of one phase of the plan. You are read-only: do not change any file. Ark gives you the phase and its diff.
End your reply with exactly one Ark block, a fenced code block tagged ark holding one JSON object:
- Nothing to fix: {"review":"pass"}
- Something to fix: {"review":"changes","findings":["<one concrete finding>"]} with 1 to 20 findings.`;
export const NOTES = {
  teamStart: (project: string, dir: string, catalog: AgentDef[]) =>
    `The user started a thread in project ${project} (${dir}). Propose the team.\nCatalog:\n` +
    catalog.filter((a) => a.id !== MANAGER).map((a) => `- ${a.id}: ${a.name}. ${a.description}`).join('\n'),
  roster: (team: { id: string; name: string }[]) => `Team: ${team.map((a) => `${a.id} (${a.name})`).join(', ')}.`,
  teamApproved: (names: string[]) => `The user approved the team: ${names.join(', ')}. Lead the planning.`,
  invalid: (error: string) => `Your reply had no valid Ark block (${error}). Reply again, ending with one valid Ark block.`,
  budget: `${PLANNING_BUDGET} agent turns without a plan. Write the user a short summary of where the discussion stands and ask how to continue.`,
  rerouted: (name: string) => `Claude is at ${SWITCH_AT}% or more of a usage window: ${name} runs on Codex.`,
  handoff: `Your session is getting long. Write a handoff for yourself: what the thread is about, what was decided, what is open, and what you were doing. Ark starts you in a fresh session from it. No Ark block.`,
  develop: (o: { plan: string; index: number; total: number; phase: string; done: string[]; branch: string; worktree: string; deps: boolean }) =>
    `You start phase ${o.index + 1}/${o.total}. Plan file: ${o.plan}. Worktree: ${o.worktree}. Branch: ${o.branch}.\n` +
    (o.done.length ? `Earlier phases:\n${o.done.map((d) => `- ${d}`).join('\n')}\n` : '') +
    `This phase:\n${o.phase}\n` +
    (o.deps ? 'node_modules is missing: run npm ci first.\n' : '') +
    'Do not commit: Ark commits. Run the checks before you finish.',
  checksFailed: (results: CheckResult[]) =>
    'These checks failed. Fix them; Ark re-runs the checks.\n' +
    results.filter((r) => !r.ok).map((r) => `- ${r.script}:\n${r.tail}`).join('\n'),
  fix: 'The reviewers asked for changes (their findings are above). Fix them; Ark re-runs the checks and the reviews.',
  userFix: 'The user replied (above). Continue the phase.',
  review: (o: { kind: 'code' | 'security'; phase: string; diff: string; worktree: string }) =>
    `Do a ${o.kind} review of this phase.\nPhase:\n${o.phase}\nDiff:\n` +
    (o.diff === '' ? '(no changes in this phase)' : o.diff.slice(0, DIFF_MAX)) +
    (o.diff.length > DIFF_MAX ? `\nThe diff was cut at ${DIFF_MAX} characters: read the changed files in ${o.worktree}.` : ''),
  blocked: (o: { phase: string; points: string[] }) =>
    `Phase "${o.phase}" is blocked after 2 rounds. Open points:\n${o.points.map((p) => `- ${p}`).join('\n')}\nAsk the user how to continue, with one ask block.`,
  summary: (o: { branch: string; phases: { title: string; notes: number; commit?: string }[]; tokens: string[]; windows: string[] }) =>
    `The build is finished. Write the user a short summary: what was built, the branch, the review notes, the tokens below. No Ark block.\nBranch: ${o.branch}\n` +
    o.phases.map((p) => `- ${p.title}: ${p.notes} review notes${p.commit ? `, commit ${p.commit}` : ''}`).join('\n') +
    `\nTokens:\n${o.tokens.map((t) => `- ${t}`).join('\n')}` +
    (o.windows.length ? `\nUsage windows (including your other sessions):\n${o.windows.map((w) => `- ${w}`).join('\n')}` : ''),
  fresh: (handoff: string) => `You are continuing this thread in a fresh session. Your handoff:\n${handoff}`,
};

const protocolFor = (id: string, phase: Phase) => {
  if (id === MANAGER) return MANAGER_PROTOCOL;
  if (phase === 'build' && id === DEVELOPER) return DEVELOPER_PROTOCOL;
  if (phase === 'build' && (id === CODE_REVIEWER || id === SECURITY_REVIEWER)) return REVIEWER_PROTOCOL;
  return MEMBER_PROTOCOL;
};
export const withProtocol = (agent: AgentDef, phase: Phase = 'planning'): AgentDef => ({
  ...agent,
  prompt: `${agent.prompt}\n\n${protocolFor(agent.id, phase)}`,
});

const PHASE_HEADING = /^(#{1,3})[ \t]+\S+[ \t]+\d+[ \t]*[:.\-–—][ \t]*(.+)$/gm;
/**
 * The plan's phases: each numbered heading at the shallowest level used starts a phase, which runs to the next
 * (or the end); numbered sub-headings (`### Step 1: …`) stay inside their phase.
 */
export function parsePhases(markdown: string): { title: string; text: string }[] {
  const all = [...markdown.matchAll(PHASE_HEADING)];
  const top = Math.min(...all.map((h) => h[1].length)); // a numbered sub-heading may come before Phase 1
  const heads = all.filter((h) => h[1].length === top);
  return heads.map((h, i) => ({
    title: h[2].trim(),
    text: markdown.slice(h.index, heads[i + 1]?.index ?? markdown.length).trim(),
  }));
}

const BLOCK = /```ark\s*\n([\s\S]*?)\n```/g;
const MAX_CHOICES = 4;
const MAX_CHOICE = 60;
const MAX_FINDINGS = 20;
const MAX_FINDING = 2000;
const fail = (error: string) => ({ error: `ark block: ${error}` });

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
  const kinds = ['team', 'next', 'ask', 'plan', 'review'].filter((k) => o[k] !== undefined);
  if (kinds.length !== 1) return fail('use exactly one of team, next, ask, plan, review');
  switch (kinds[0]) {
    case 'team': {
      if (!Array.isArray(o.team) || o.team.length === 0) return fail('team needs at least one pick');
      const picks: TeamPick[] = [];
      for (const p of o.team) {
        const agent = str(obj(p)?.agent);
        const reason = str(obj(p)?.reason);
        if (!agent || !reason) return fail('each pick needs an agent and a reason');
        picks.push({ agent, reason });
      }
      return { control: { kind: 'team', picks, leftOut: typeof o.leftOut === 'string' ? o.leftOut : '' } };
    }
    case 'next': {
      const agent = str(o.next);
      return agent ? { control: { kind: 'next', agent, ...(o.hard === true ? { hard: true as const } : {}) } } : fail('next must be an agent id');
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
