import type { ChatEvent, TokenCount } from './types';

export type ChatEntry = { role: 'user' | 'agent' | 'error'; text: string; model?: string; tokens?: TokenCount };
export type ChatState = { entries: ChatEntry[]; busy: boolean; ended: boolean };
export const EMPTY_CHAT: ChatState = { entries: [], busy: false, ended: false };

type Action = { type: 'sent'; text: string } | { type: 'event'; event: ChatEvent };

/** How an engine failure reads in the chat. */
function errorText(kind: 'isolation' | 'engine' | 'exit', detail: string): string {
  if (kind === 'isolation') return `Stopped: this agent could see things it was not given.\n${detail}`;
  if (kind === 'exit') return `The engine stopped.\n${detail}`;
  return detail;
}

/** Pure chat state: one entry per message, busy from Send until the turn (or an error) ends. */
export function chatReducer(s: ChatState, a: Action): ChatState {
  if (a.type === 'sent') return { ...s, entries: [...s.entries, { role: 'user', text: a.text }], busy: true };
  const e = a.event;
  switch (e.type) {
    case 'message':
      return { ...s, entries: [...s.entries, { role: 'agent', text: e.text }] };
    case 'turn': {
      const last = s.entries[s.entries.length - 1];
      const counted = { model: e.model, tokens: e.tokens };
      const entries = last?.role === 'agent'
        ? [...s.entries.slice(0, -1), { ...last, ...counted }]
        : [...s.entries, { role: 'agent' as const, text: '', ...counted }];
      return { ...s, entries, busy: false };
    }
    case 'limits':
      return s; // feeds the usage view only
    case 'approval':
      return s; // approval cards belong to team threads; a plain chat has no UI for them
    case 'error':
      return {
        entries: [...s.entries, { role: 'error', text: errorText(e.kind, e.detail) }],
        busy: false,
        ended: s.ended || e.kind !== 'engine',
      };
  }
}
