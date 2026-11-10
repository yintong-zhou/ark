import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { chatReducer, EMPTY_CHAT } from '@shared/chat-log';
import type { ChatStarted } from '@shared/types';
import type { PermissionMode } from '@shared/permissions';
import { readable } from '../errors';

/** One isolated chat: starts the session, feeds its events to the reducer, and stops it on unmount. */
export function useChat() {
  const [started, setStarted] = useState<ChatStarted | null>(null);
  const [state, dispatch] = useReducer(chatReducer, EMPTY_CHAT);
  const [starting, setStarting] = useState(false);
  const idRef = useRef<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const off = window.ark.chat.onEvent((chatId, event) => {
      if (chatId === idRef.current) dispatch({ type: 'event', event });
    });
    return () => {
      mounted.current = false;
      off();
      const id = idRef.current;
      idRef.current = null;
      if (id) void window.ark.chat.stop(id).catch(() => {});
    };
  }, []);

  /** Rejects with a readable message when the chat cannot start. */
  const start = useCallback(async (agentId: string, projectDir: string, mode?: PermissionMode) => {
    setStarting(true);
    try {
      const s = await window.ark.chat.start(agentId, projectDir, mode);
      if (!mounted.current) {
        // the user left while the engine was starting: nobody owns this session
        void window.ark.chat.stop(s.chatId).catch(() => {});
        return;
      }
      idRef.current = s.chatId;
      setStarted(s);
    } catch (e) {
      throw new Error(readable(e));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }, []);

  const send = useCallback(async (text: string) => {
    const id = idRef.current;
    if (!id) return;
    dispatch({ type: 'sent', text });
    try {
      await window.ark.chat.send(id, text);
    } catch (e) {
      const detail = readable(e);
      if (detail === 'busy') return; // a turn is still running: keep Send disabled until it ends
      // a dead session cannot take another message: end the chat instead of just reporting
      dispatch({ type: 'event', event: { type: 'error', kind: detail === 'session ended' ? 'exit' : 'engine', detail } });
    }
  }, []);

  return { started, starting, state, start, send };
}
