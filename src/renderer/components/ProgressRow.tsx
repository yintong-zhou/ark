import { useEffect, useState } from 'react';
import { activityLabel, elapsed, type ThreadActivity } from '@shared/activity';
import type { AgentDef } from '@shared/agent-file';
import type { Thread } from '@shared/thread';
import { taskLine } from '@shared/thread-view';
import { useActivity } from '../hooks/useActivity';
import { AgentAvatar } from './Avatar';

/**
 * The wait, made visible: while an agent works, who it is, what it is doing, what for and for how long.
 * `activity` and `now` override the live values (tests); the row owns its own subscription and clock, so nothing
 * above it redraws when they change.
 */
export function ProgressRow({ thread, agents, activity, now }: { thread: Thread; agents: AgentDef[]; activity?: ThreadActivity; now?: number }) {
  const speaker = thread.status === 'running' ? thread.speaking : undefined;
  const live = useActivity(thread.id);
  const [tick, setTick] = useState(Date.now);
  useEffect(() => {
    if (!speaker || now !== undefined) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [speaker, now]);
  if (!speaker) return null;

  const at = now ?? tick;
  const current = activity ?? live;
  const mine = current?.agent === speaker ? current : undefined; // an event of an earlier speaker is not this one's
  const agent = agents.find((a) => a.id === speaker);
  const name = agent?.name ?? speaker;
  const task = taskLine(thread, speaker);
  const label = activityLabel(mine?.action ?? 'thinking', (thread.approvals?.length ?? 0) > 0);
  return (
    <div className="flex max-w-[960px] items-center gap-1.5 px-2 pb-1 pt-2 lg:gap-2 lg:px-3">
      <div className="w-5 shrink-0"><AgentAvatar agent={agent} name={name} /></div>
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1">
          <span className="head truncate">{name}</span>
          <span aria-hidden className="size-1 shrink-0 rounded-full bg-secondary breathe" />
        </span>
        <span className="truncate text-meta text-muted">{[label, task, elapsed(at - (mine?.since ?? at))].filter(Boolean).join(' - ')}</span>
      </div>
    </div>
  );
}
