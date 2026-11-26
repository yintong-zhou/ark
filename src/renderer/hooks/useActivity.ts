import { useEffect, useState } from 'react';
import type { ThreadActivity } from '@shared/activity';

/**
 * What the thread's speaking agent is doing now. Kept apart from the thread list on purpose: a change redraws only the
 * components that call this hook, never the message list.
 */
export function useActivity(threadId: string | undefined): ThreadActivity | undefined {
  const [state, setState] = useState<{ id: string; activity: ThreadActivity | undefined }>();
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    const off = window.ark.threads.onActivity((id, activity) => {
      if (id === threadId) setState({ id, activity });
    });
    // A thread opened mid-turn: the current value, unless a push already arrived.
    window.ark.threads.activity(threadId).then(
      (activity) => live && setState((s) => (s?.id === threadId ? s : { id: threadId, activity })),
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [threadId]);
  return state && state.id === threadId ? state.activity : undefined;
}
