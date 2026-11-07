import { useState } from 'react';
import { rootKey, type RootRef } from '@shared/files';
import type { Project, Thread } from '@shared/thread';
import { needsYou } from '@shared/thread-view';
import { toUploads } from '../components/Attachments';
import { Composer } from '../components/Composer';
import { Editor } from '../components/Editor';
import { FileTree } from '../components/FileTree';
import { CloseIcon, PlusIcon } from '../components/Icons';
import { Empty, PaneHeader } from '../components/Page';
import { Main, Pill, Presence, Sidebar, SideLabel, SideRow } from '../components/Shell';
import { TabStrip } from '../components/TabStrip';
import { TeamPanel } from '../components/TeamPanel';
import { ThreadView } from '../components/ThreadView';
import { BUTTON, CTA, ICON_BUTTON } from '../components/ui';
import { activate, open as openTab, useTabs } from '../editor/tabs-store';
import type { useThreads } from '../hooks/useThreads';

type Props = {
  ws: ReturnType<typeof useThreads>;
  project: Project | undefined;
  draft: boolean; // a new thread is being written for `project`
  onDraft: (on: boolean) => void;
  problem?: string;
  attempt: (call: () => Promise<unknown>) => Promise<void>;
  onAddProject: () => void;
};

/** The sidebar view outlives this screen: back from Usage or Agents, the user finds Files where they left it. */
let lastView: 'threads' | 'files' = 'threads';
const keepView = (v: 'threads' | 'files') => (lastView = v);

/** What a thread row says on the right. */
const trail = (t: Thread) =>
  needsYou(t) ? <Pill label="Your turn">✋</Pill>
  : t.status === 'running' ? <Presence state="speaking" />
  : t.status === 'error' ? <Pill label="Something went wrong">⚠️</Pill>
  : null;

/** The workspace: the open project's threads on the left, the thread in the middle, its team on the right. */
export function Threads({ ws, project, draft, onDraft, problem, attempt, onAddProject }: Props) {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<string>(); // a #tag the thread list is narrowed to
  const mine = ws.threads.filter((t) => t.projectId === project?.id);
  const thread = draft ? undefined : mine.find((t) => t.id === ws.selected);
  const tags = [...new Set(mine.flatMap((t) => t.tags ?? []))];
  const only = filter && tags.includes(filter) ? filter : undefined;
  const listed = only ? mine.filter((t) => t.tags?.includes(only)) : mine;
  const [view, setViewState] = useState(lastView);
  const setView = (v: 'threads' | 'files') => setViewState(keepView(v));
  // Files show the project, or the open thread's worktree once its build has one.
  const worktree = thread?.build?.worktree;
  const [rootSel, setRootSel] = useState<'project' | 'worktree'>('project');
  const [rootFor, setRootFor] = useState(thread?.id);
  if (rootFor !== thread?.id) {
    setRootFor(thread?.id);
    setRootSel('project');
  }
  const root: RootRef = worktree && rootSel === 'worktree' && thread ? { kind: 'thread', id: thread.id } : { kind: 'project', id: project?.id ?? '' };
  const openFile = (r: RootRef, rel: string) => project && void attempt(() => openTab(project.id, r, rel));
  const tabs = useTabs(project?.id);
  const fileDoc = tabs.active ? tabs.docs.find((d) => d.tab.key === tabs.active) : undefined;
  const showThread = () => project && activate(project.id, null);

  const start = async (files: File[]) => {
    const t = text.trim();
    if (!project) return false;
    let done = false;
    await attempt(async () => {
      await ws.create(project.id, t, files.length ? await toUploads(files) : undefined);
      setText('');
      onDraft(false);
      done = true;
    });
    return done;
  };

  return (
    <>
      <Sidebar
        title={project?.name ?? 'Projects'}
        label="Threads"
        footer={project && (
          <div className="flex flex-col gap-1 border-t border-divider p-2">
            <p className="truncate text-meta text-muted" title={project.dir}>{project.dir}</p>
            {!project.git && <button onClick={() => void attempt(() => ws.gitInit(project.id))} className={BUTTON}>Initialize Git</button>}
          </div>
        )}
      >
        {project && (
          <div role="tablist" aria-label="Sidebar view" className="flex gap-[4px] px-1 pb-1">
            {(['threads', 'files'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-full px-1 text-meta ${view === v ? 'bg-neutral-light text-primary' : 'bg-raised text-muted hover:text-secondary'}`}
              >
                {v === 'threads' ? 'Threads' : 'Files'}
              </button>
            ))}
          </div>
        )}
        {project && view === 'files' ? (
          <>
            {worktree && (
              <select
                aria-label="Folder"
                value={rootSel}
                onChange={(e) => setRootSel(e.target.value as 'project' | 'worktree')}
                className="mb-1 h-3 w-full rounded-xs bg-raised px-[4px] text-meta text-secondary"
              >
                <option value="project">Project</option>
                <option value="worktree">Worktree · #{thread?.title}</option>
              </select>
            )}
            <FileTree
              key={rootKey(root)}
              root={root}
              name={root.kind === 'thread' ? `${thread?.title ?? ''} (worktree)` : project.name}
              onOpen={(rel) => openFile(root, rel)}
              attempt={attempt}
            />
          </>
        ) : project ? (
          <>
            <SideRow lead={<PlusIcon />} selected={draft} onClick={() => (showThread(), onDraft(true))}>New thread</SideRow>
            <SideLabel>Threads</SideLabel>
            {tags.length > 0 && (
              <ul className="flex flex-wrap gap-[4px] px-1 pb-1">
                {tags.map((t) => (
                  <li key={t}>
                    <button
                      onClick={() => setFilter(only === t ? undefined : t)}
                      aria-pressed={only === t}
                      title={only === t ? 'Show every thread' : `Show threads tagged #${t}`}
                      className={`rounded-full px-1 text-meta ${only === t ? 'bg-neutral-light text-primary' : 'bg-raised text-muted hover:text-secondary'}`}
                    >
                      #{t}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {listed.map((t) => (
              <SideRow
                key={t.id}
                lead={<span aria-hidden className="font-heading">#</span>}
                selected={thread?.id === t.id}
                waiting={needsYou(t)}
                trail={trail(t)}
                title={t.title}
                onClick={() => {
                  onDraft(false);
                  showThread();
                  void ws.select(t.id);
                }}
              >
                {t.title}
              </SideRow>
            ))}
            {listed.length === 0 && <p className="px-1 text-muted">{mine.length === 0 ? 'No threads yet.' : 'No thread has this tag.'}</p>}
          </>
        ) : (
          <p className="px-1 text-muted">No projects yet.</p>
        )}
      </Sidebar>

      <Main>
        {(ws.error ?? problem) && <p role="alert" className="shrink-0 border-b border-divider px-3 py-1 text-muted">{ws.error ?? problem}</p>}
        {project && tabs.docs.length > 0 && (
          <TabStrip projectId={project.id} tabs={tabs} label={draft ? 'New thread' : thread ? `# ${thread.title}` : project.name} />
        )}
        {project && fileDoc ? (
          <Editor key={project.id} projectId={project.id} doc={fileDoc} />
        ) : !project ? (
          <>
            <PaneHeader title="Projects" />
            <Empty glyph="📁" title="Add a project folder" action={<button onClick={onAddProject} className={CTA}>Add project</button>}>
              A project is the folder your agents work in. Each project keeps its own threads.
            </Empty>
          </>
        ) : draft ? (
          <>
            <PaneHeader title="New thread" meta={[`in ${project.name}`]} />
            <div className="flex min-h-0 flex-1 flex-col justify-end">
              <Empty glyph="💡" title="What do you want to work on?">
                The project manager reads it and proposes a team. Nobody starts before you approve.
              </Empty>
            </div>
            <Composer
              label="What do you want to work on?"
              placeholder="Describe the goal"
              value={text}
              onChange={setText}
              onSubmit={start}
              attach
              tags={tags}
              submitLabel="Start thread"
              extra={
                <button onClick={() => onDraft(false)} aria-label="Cancel" title="Cancel" className={ICON_BUTTON}>
                  <CloseIcon />
                </button>
              }
            />
          </>
        ) : thread ? (
          <ThreadView key={thread.id} thread={thread} messages={ws.messages} agents={ws.agents} tags={tags} onTag={(t) => setFilter(only === t ? undefined : t)} />
        ) : (
          <>
            <PaneHeader title={project.name} />
            <Empty
              glyph="💬"
              title={mine.length === 0 ? 'No threads yet' : 'Pick a thread'}
              action={<button onClick={() => onDraft(true)} className={CTA}>New thread</button>}
            >
              {mine.length === 0 ? 'Start one and the project manager will propose a team.' : 'Open one on the left, or start a new one.'}
            </Empty>
          </>
        )}
      </Main>

      {thread && !fileDoc && <TeamPanel thread={thread} messages={ws.messages} agents={ws.agents} />}
    </>
  );
}
