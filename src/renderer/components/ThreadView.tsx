import { useEffect, useRef, useState } from 'react';
import type { AgentDef } from '@shared/agent-file';
import type { Phase, Reaction, Thread, ThreadMessage } from '@shared/thread';
import { actionable, decisionsOf, lastModel, reactionsOf, startsGroup } from '@shared/thread-view';
import { tokenize } from '@shared/tokens';
import { readable } from '../errors';
import { Sent, toUploads } from './Attachments';
import { Avatar, initials } from './Avatar';
import { ApprovalCard, Cards, PhaseCard, PlanCard } from './Cards';
import { Composer } from './Composer';
import { PHASE_GLYPH, shortModel } from './glyphs';
import { ModelMark } from './Logos';
import { Markdown } from './Markdown';
import { PauseIcon, TasksIcon, ThreadIcon } from './Icons';
import { PaneHeader } from './Page';
import { TaskBoard } from './TaskBoard';
import { BUTTON, ICON_BUTTON } from './ui';
import { modeOf } from '@shared/permissions';
import { PermissionSelect } from './PermissionSelect';

type Props = {
  thread: Thread;
  messages: ThreadMessage[];
  agents: AgentDef[];
  tags: string[]; // tags already used in the project, offered when the user types #
  onTag: (tag: string) => void; // a #tag was clicked: show the project's threads with it
};

const PHASE: Record<Phase, string> = { team: 'Team', planning: 'Planning', build: 'Build', done: 'Done' };
const AT_REST: Record<Phase, string> = {
  team: 'Choosing who works on this thread',
  planning: 'Planning with the team',
  build: 'Plan approved',
  done: 'Finished',
};

/** Time of day, with the date when it was not today. */
const clock = (at: number) => {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
};

/** One thread: a header that says where it stands, the messages with the cards the user can act on, and the composer. */
export function ThreadView({ thread, messages, agents, tags, onTag }: Props) {
  const [text, setText] = useState('');
  const [board, setBoard] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [inflight, setInflight] = useState(0); // IPC calls awaiting main; the one-shot buttons wait for them
  const end = useRef<HTMLDivElement>(null);
  // keep the latest message and the composer in view
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, board]);

  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const card = actionable(thread, messages);
  const reactions = reactionsOf(messages);
  const decisions = decisionsOf(messages);

  /** Runs one IPC call; a refusal shows over the composer. */
  const run = async (call: () => Promise<void>) => {
    setInflight((n) => n + 1);
    try {
      setProblem(undefined);
      await call();
      return true;
    } catch (e) {
      setProblem(readable(e));
      return false;
    } finally {
      setInflight((n) => n - 1);
    }
  };
  const send = (t: string) => run(() => window.ark.threads.send(thread.id, t));
  const submit = async (files: File[]) => {
    const t = text.trim();
    setText('');
    const ok = await run(async () => window.ark.threads.send(thread.id, t, files.length ? await toUploads(files) : undefined));
    if (!ok) setText((cur) => cur || t); // keep what the user wrote
    return ok;
  };

  const status = thread.speaking
    ? `⏳ ${name(thread.speaking)} is working`
    : thread.waitingOn
      ? `✋ ${name(thread.waitingOn)} is waiting for you`
      : thread.status === 'error'
        ? '⚠️ Something went wrong. Send a message to continue'
        : AT_REST[thread.phase];

  // Only these kinds are drawn, so a kind added later stays hidden until it gets a card. A reaction sits under its
  // message and a decision shows on its approval card.
  const shown = messages.filter((m) => m.kind === 'user' || m.kind === 'agent' || m.kind === 'note' || m.kind === 'phase' || m.kind === 'approval');
  const rows = shown.map((m, i) => ({ m, first: startsGroup(shown[i - 1], m) }));

  return (
    <>
      <PaneHeader title={thread.title} meta={board ? ['Task board'] : [`${PHASE_GLYPH[thread.phase]} ${PHASE[thread.phase]}`, status]} actions={
        <button className={BUTTON} aria-label={board ? 'Conversation' : `Tasks (${thread.tasks?.length ?? 0})`} title={board ? 'Conversation' : 'Task board'} aria-pressed={board} onClick={() => setBoard(!board)}>
          {board ? <ThreadIcon /> : <TasksIcon />}
          {!board && <span className="text-meta">{thread.tasks?.length ?? 0}</span>}
        </button>
      } />

      {board ? <TaskBoard thread={thread} agents={agents} /> : <div className="min-h-0 flex-1 overflow-y-auto">
        <ol className="flex max-w-[960px] flex-col pb-2 pt-1">
          {rows.map(({ m, first }) => {
            if (m.kind === 'note') {
              return (
                <li key={m.seq} className="mt-2 whitespace-pre-wrap break-words pl-[68px] pr-2 text-meta text-muted lg:pl-[80px] lg:pr-3">
                  <span aria-hidden className="mr-[4px]">ℹ️</span>{m.text}
                </li>
              );
            }
            if (m.kind === 'phase') {
              const phase = thread.build?.phases[m.index];
              return phase && (
                <li key={m.seq} className="mt-2 pl-[68px] pr-2 lg:pl-[80px] lg:pr-3">
                  <PhaseCard phase={phase} index={m.index} total={thread.build?.phases.length ?? 0} />
                </li>
              );
            }
            if (m.kind === 'approval') {
              return (
                <li key={m.seq} className="mt-2 pl-[68px] pr-2 lg:pl-[80px] lg:pr-3">
                  <ApprovalCard
                    m={m}
                    name={name(m.agent)}
                    pending={thread.approvals?.includes(m.seq) ?? false}
                    decision={decisions.get(m.seq)}
                    busy={inflight > 0}
                    answer={(allow) => run(() => window.ark.threads.answer(thread.id, m.seq, allow))}
                  />
                </li>
              );
            }
            const mine = card?.seq === m.seq;
            const you = m.kind === 'user';
            const author = m.kind === 'agent' ? name(m.agent) : 'You';
            const model = m.kind === 'agent' ? m.model || lastModel(messages, m.agent) : undefined;
            const mood = m.kind === 'agent' ? reactions.get(m.seq) : undefined;
            return (
              <li key={m.seq} className={`group relative flex gap-1.5 px-2 hover:bg-raised/30 lg:gap-2 lg:px-3 ${first ? 'mt-2' : 'mt-[2px]'}`}>
                {mine && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
                <div className="w-5 shrink-0">
                  {first ? (
                    <Avatar text={you ? 'You' : initials(author)} you={you} />
                  ) : (
                    <time dateTime={new Date(m.at).toISOString()} className="block whitespace-nowrap pr-1 text-right text-meta leading-[22px] text-muted opacity-0 group-hover:opacity-100">
                      {new Date(m.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {first && (
                    <div className="flex items-baseline gap-1">
                      <span className="head">{author}</span>
                      <time dateTime={new Date(m.at).toISOString()} className="shrink-0 whitespace-nowrap text-meta text-muted">{clock(m.at)}</time>
                      {model && (
                        <span className="inline-flex items-center gap-[4px] rounded-full bg-raised px-1 text-meta text-muted" title={model}>
                          <ModelMark model={model} />
                          {m.kind === 'agent' && m.engine ? `${m.engine === 'codex' ? 'Codex' : 'Claude'} / ` : ''}{shortModel(model)}
                        </span>
                      )}
                    </div>
                  )}
                  {m.kind === 'agent' && m.control?.kind === 'plan' ? (
                    <PlanCard text={m.text} active={mine} pending={inflight > 0} start={() => run(() => window.ark.threads.startDeveloper(thread.id))} />
                  ) : (
                    m.text && <Body text={m.text} agents={agents} onTag={onTag} />
                  )}
                  {m.kind === 'user' && m.attachments && <Sent threadId={thread.id} list={m.attachments} />}
                  {m.kind === 'agent' && m.control && (
                    <Cards
                      control={m.control}
                      name={name}
                      agents={agents}
                      active={mine}
                      pending={inflight > 0}
                      send={send}
                      approve={(ids) => run(() => window.ark.threads.approveTeam(thread.id, ids))}
                    />
                  )}
                  {mood && (
                    <div className="mt-1">
                      <span className="inline-flex h-3 items-center gap-[4px] rounded-full border border-neutral-light bg-raised px-1 text-meta text-secondary">
                        <span aria-hidden>{mood}</span>
                        <span>1</span>
                        <span className="sr-only">{mood === '👍' ? 'You marked this as a good answer' : 'You marked this as a bad answer'}</span>
                      </span>
                    </div>
                  )}
                </div>
                {m.kind === 'agent' && <Mood current={mood} react={(e) => run(() => window.ark.threads.react(thread.id, m.seq, e))} />}
              </li>
            );
          })}
        </ol>
        <div ref={end} />
      </div>}

      <div className="flex items-center gap-1 px-2 pb-0.5 lg:px-3">
        <PermissionSelect value={modeOf(thread)} disabled={inflight > 0} onChange={(mode) => void run(() => window.ark.threads.setPermissionMode(thread.id, mode))} />
        {thread.status === 'running' && <span className="text-meta text-muted">Changing permissions pauses the team</span>}
      </div>
      <Composer
        label="Message the thread"
        placeholder="Message the team"
        value={text}
        onChange={setText}
        onSubmit={submit}
        attach
        mentions={thread.team.map((id) => ({ id, name: name(id) }))}
        tags={tags}
        problem={problem}
        extra={
          thread.status === 'running' && (
            <button onClick={() => void run(() => window.ark.threads.pause(thread.id))} aria-label="Pause" title="Pause the turn" className={ICON_BUTTON}>
              <PauseIcon />
            </button>
          )
        }
      />
    </>
  );
}

/** Message text; an @mention reads as a chip with the agent's name, a #tag as a chip that filters the threads. */
function Body({ text, agents, onTag }: { text: string; agents: AgentDef[]; onTag: (tag: string) => void }) {
  const leaf = (run: string) =>
    tokenize(run).map((t, i) => {
      if (t.kind === 'text') return t.text;
      if (t.kind === 'mention') {
        return <span key={i} className="rounded-xs bg-raised px-[4px] text-secondary">@{agents.find((a) => a.id === t.id)?.name ?? t.id}</span>;
      }
      return (
        <button key={i} type="button" onClick={() => onTag(t.tag)} className="rounded-xs bg-raised px-[4px] text-secondary hover:brightness-125">
          #{t.tag}
        </button>
      );
    });
  return <Markdown text={text} leaf={leaf} />;
}

/** The two reactions, shown over the message on hover or focus. */
function Mood({ current, react }: { current: Reaction | undefined; react: (e: Reaction) => void }) {
  return (
    <div className="absolute -top-1 right-3 flex rounded-sm bg-raised p-[2px] opacity-0 focus-within:opacity-100 group-hover:opacity-100">
      {(['👍', '👎'] as const).map((e) => (
        <button
          key={e}
          onClick={() => current !== e && react(e)}
          aria-pressed={current === e}
          aria-label={e === '👍' ? 'Good answer' : 'Bad answer'}
          className={`size-3 rounded-xs hover:bg-primary ${current === e ? 'bg-primary' : ''}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
