import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentDef } from '@shared/agent-file';
import type { Upload } from '@shared/attachments';
import type { PermissionMode } from '@shared/permissions';
import type { Project, Thread, ThreadMessage, ThreadUpdate } from '@shared/thread';
import { mergeMessages } from '@shared/thread-view';
import { readable } from '../errors';

/** Replaces the item with the same id, or puts a new one first (the list is newest first). */
const upsert = <T extends { id: string }>(list: T[], item: T, last = false): T[] =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : last ? [...list, item] : [item, ...list];

/**
 * Projects, threads and the catalog, plus the selected thread with its messages.
 * Thread sessions outlive the screen, so everything is loaded on mount and kept current by threads.onUpdate.
 */
export function useThreads() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [selected, setSelected] = useState<string>();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [error, setError] = useState<string>();
  const selectedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const off = window.ark.threads.onUpdate((u: ThreadUpdate) => {
      setThreads((ts) => upsert(ts, u.thread));
      if (u.thread.id === selectedRef.current) setMessages((ms) => mergeMessages(ms, u.added));
    });
    Promise.all([window.ark.projects.list(), window.ark.threads.list(), window.ark.catalog.list()]).then(
      ([p, t, c]) => {
        if (!mounted) return;
        setProjects(p);
        setThreads(t);
        setAgents(c.agents);
      },
      (e) => mounted && setError(readable(e)),
    );
    return () => {
      mounted = false;
      off();
    };
  }, []);

  /** Opens a thread: its messages load now, and updates that arrive meanwhile are kept. */
  const select = useCallback(async (id: string) => {
    selectedRef.current = id;
    setSelected(id);
    setMessages([]);
    try {
      const o = await window.ark.threads.open(id);
      if (selectedRef.current === id) {
        setMessages((ms) => mergeMessages(o.messages, ms));
        setError(undefined);
      }
    } catch (e) {
      if (selectedRef.current === id) setError(readable(e));
    }
  }, []);

  /** Starts a thread and selects it. Rejects when main refuses (no Project manager in the catalog, say). */
  const create = useCallback(async (projectId: string, text: string, files?: Upload[], mode?: PermissionMode) => {
    const t = await window.ark.threads.create(projectId, text, files, mode);
    setThreads((ts) => upsert(ts, t));
    void select(t.id);
  }, [select]);

  /** Asks for a folder and adds it as a project; resolves to the project, or nothing when the user cancels. */
  const addProject = useCallback(async () => {
    const dir = await window.ark.chat.pickFolder();
    if (!dir) return undefined;
    const p = await window.ark.projects.add(dir);
    setProjects((ps) => upsert(ps, p, true));
    return p;
  }, []);

  const gitInit = useCallback(async (id: string) => {
    const p = await window.ark.projects.gitInit(id);
    setProjects((ps) => upsert(ps, p, true));
  }, []);

  const removeThread = useCallback(async (id: string) => {
    await window.ark.threads.remove(id);
    if (selectedRef.current === id) {
      selectedRef.current = undefined;
      setSelected(undefined);
      setMessages([]);
    }
    setThreads((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const removeProject = useCallback(async (id: string) => {
    await window.ark.projects.remove(id);
    if (threads.some((t) => t.projectId === id && t.id === selectedRef.current)) {
      selectedRef.current = undefined;
      setSelected(undefined);
      setMessages([]);
    }
    setProjects((ps) => ps.filter((p) => p.id !== id));
  }, [threads]);

  return { projects, threads, agents, selected, messages, error, select, create, addProject, gitInit, removeThread, removeProject };
}
