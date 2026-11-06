import type { AgentDef } from '@shared/agent-file';
import { MANAGER, type Thread, type ThreadMessage } from '@shared/thread';
import { lastModel, tokensBy, tokensByAgent, windowLines } from '@shared/thread-view';
import { Avatar, initials } from './Avatar';
import { shortModel } from './glyphs';
import { ModelMark } from './Logos';
import { Presence } from './Shell';
import { TokenLine } from './TokenLine';

/** The agents on the thread, by role: who speaks, who waits for the user, and what each has used. */
export function TeamPanel({ thread, messages, agents }: { thread: Thread; messages: ThreadMessage[]; agents: AgentDef[] }) {
  const tokens = tokensByAgent(messages);
  const byModel = Object.entries(tokensBy(messages, (m) => m.model)).filter(([model]) => model);
  const windows = windowLines(thread.windows);
  const ids = thread.phase === 'team' ? [MANAGER] : thread.team; // the team is picked after the first proposal
  const groups = [
    { title: '🧭 Manager', ids: ids.filter((id) => id === MANAGER) },
    { title: '👥 Members', ids: ids.filter((id) => id !== MANAGER) },
  ].filter((g) => g.ids.length > 0);

  return (
    <aside aria-label="Team" className="flex w-30 shrink-0 flex-col border-l border-divider bg-sidebar">
      <header className="drag flex h-6 shrink-0 items-center border-b border-divider px-2">
        <h2 className="text-body">Team</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="section px-2 pb-[4px] pt-2 font-body font-normal text-muted">{g.title} — {g.ids.length}</h3>
            <ul>
              {g.ids.map((id) => {
                const name = agents.find((a) => a.id === id)?.name ?? id;
                const model = lastModel(messages, id);
                const state = thread.speaking === id ? 'speaking' : thread.waitingOn === id ? 'waiting' : 'idle';
                return (
                  <li key={id} className="relative flex items-center gap-1 px-2 py-1">
                    {state === 'waiting' && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
                    <Avatar text={initials(name)} size={32} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="head truncate leading-[22px]">{name}</span>
                      {model && (
                        <span className="flex items-center gap-[4px] truncate text-meta text-muted" title={model}>
                          <ModelMark model={model} />
                          {shortModel(model)}
                        </span>
                      )}
                      {tokens[id] && <TokenLine tokens={tokens[id]} />}
                    </div>
                    <Presence state={state} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {byModel.length > 0 && (
        <section className="shrink-0 border-t border-divider pb-1">
          <h3 className="section px-2 pb-[4px] pt-2 font-body font-normal text-muted">Thread cost</h3>
          <ul>
            {byModel.map(([model, t]) => (
              <li key={model} className="flex flex-col px-2 py-[4px]">
                <span className="flex items-center gap-[4px] truncate text-meta text-muted" title={model}>
                  <ModelMark model={model} />
                  {shortModel(model)}
                </span>
                <TokenLine tokens={t} />
              </li>
            ))}
          </ul>
          {windows.length > 0 && (
            <div className="px-2 pt-[4px] text-meta text-muted">
              {windows.map((w) => <div key={w}>{w}</div>)}
              <div>Including your other sessions</div>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
