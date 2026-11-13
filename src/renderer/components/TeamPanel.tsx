import type { AgentDef } from '@shared/agent-file';
import { MANAGER, type Thread, type ThreadMessage } from '@shared/thread';
import { lastModel, tokensBy, tokensByAgent, windowLines } from '@shared/thread-view';
import { roleLabels } from '@shared/roles';
import { estimateUsd, formatUsd, PRICES_CHECKED } from '@shared/pricing';
import { AgentAvatar } from './Avatar';
import { shortModel } from './glyphs';
import { ModelMark } from './Logos';
import { Presence } from './Shell';
import { TokenLine } from './TokenLine';

/** Team details inside the shared workspace column: roles, presence and usage. */
export function TeamPanel({ thread, messages, agents }: { thread: Thread; messages: ThreadMessage[]; agents: AgentDef[] }) {
  const tokens = tokensByAgent(messages);
  const byModel = Object.entries(tokensBy(messages, (m) => m.model))
    .filter(([model]) => model)
    .map(([model, t]) => [model, t, estimateUsd(model, t)] as const);
  const windows = windowLines(thread.windows);
  const ids = thread.phase === 'team' ? [MANAGER] : thread.team; // the team is picked after the first proposal
  const groups = [
    { title: '🧭 Head of Staff', ids: ids.filter((id) => id === MANAGER) },
    { title: '👥 Team', ids: ids.filter((id) => id !== MANAGER) },
  ].filter((g) => g.ids.length > 0);

  return (
    <section aria-label="Team" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="section px-2 pb-[4px] pt-2 font-body font-normal text-muted">{g.title} - {g.ids.length}</h3>
            <ul>
              {g.ids.map((id) => {
                const name = agents.find((a) => a.id === id)?.name ?? id;
                const assignment = thread.assignments?.[id];
                const model = assignment?.model ?? lastModel(messages, id); // same source as the engine icon
                const state = thread.speaking === id ? 'speaking' : thread.waitingOn === id ? 'waiting' : 'idle';
                return (
                  <li key={id} className="relative flex items-center gap-1 px-2 py-1">
                    {state === 'waiting' && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
                    <AgentAvatar agent={agents.find((a) => a.id === id)} name={name} size={32} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="head truncate leading-[22px]">{name}</span>
                      {roleLabels(thread.roles, id).length > 0 && <span className="text-meta text-muted">{roleLabels(thread.roles, id).join(', ')}</span>}
                      {model && (
                        <span className="flex items-center gap-[4px] truncate text-meta text-muted" title={model}>
                          <ModelMark model={model} />
                          {assignment ? `${assignment.engine === 'codex' ? 'Codex' : 'Claude'} / ` : ''}{shortModel(model)}
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
            {byModel.map(([model, t, usd]) => (
              <li key={model} className="flex flex-col px-2 py-[4px]">
                <span className="flex items-center gap-[4px] truncate text-meta text-muted" title={model}>
                  <ModelMark model={model} />
                  {shortModel(model)}
                </span>
                <TokenLine tokens={t} />
                <span className="text-meta text-muted">
                  {usd === undefined ? 'API estimate unavailable' : `About ${formatUsd(usd)} at standard API list prices (estimate)`}
                </span>
              </li>
            ))}
          </ul>
          {byModel.some(([, , usd]) => usd !== undefined) && (
            <p className="px-2 pt-[4px] text-meta text-muted">
              Estimated at standard public API list prices as of {PRICES_CHECKED}, not what a subscription or your API
              account bills. Cache writes are counted as plain input; long-context, regional, fast-mode and discounted
              rates are not applied.
            </p>
          )}
          {windows.length > 0 && (
            <div className="px-2 pt-[4px] text-meta text-muted">
              {windows.map((w) => <div key={w}>{w}</div>)}
              <div>Including your other sessions</div>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
