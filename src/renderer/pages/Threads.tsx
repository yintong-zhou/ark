import { useEffect, useRef, useState } from 'react';
import type { AgentDef } from '@shared/agent-file';
import { rootKey, type RootRef } from '@shared/files';
import type { Project, Thread } from '@shared/thread';
import { needsYou } from '@shared/thread-view';
import { toUploads } from '../components/Attachments';
import { BrowserPane } from '../components/BrowserPane';
import { Composer } from '../components/Composer';
import { confirmAction } from '../components/Confirm';
import { DiffView } from '../components/DiffView';
import { Editor } from '../components/Editor';
import { FileTree } from '../components/FileTree';
import { GitView } from '../components/GitView';
import { AgentsIcon, CloseIcon, ExplorerIcon, GitBranchIcon, PlusIcon, ThreadIcon, TrashIcon } from '../components/Icons';
import { Empty, PaneHeader } from '../components/Page';
import { Main, Pill, Presence, Sidebar, SideLabel, SideRow } from '../components/Shell';
import { TabStrip } from '../components/TabStrip';
import { TeamPanel } from '../components/TeamPanel';
import { TerminalPanel } from '../components/TerminalPanel';
import { ThreadView } from '../components/ThreadView';
import { BUTTON, CTA, ICON_BUTTON } from '../components/ui';
import { PermissionSelect } from '../components/PermissionSelect';
import type { PermissionMode } from '@shared/permissions';
import { onBrowserKey, startSelect, useBrowser } from '../browser/browser-store';
import { activate, BROWSER_TAB, open as openTab, openDiff, useTabs } from '../editor/tabs-store';
import type { useThreads } from '../hooks/useThreads';
import { panelHeight, setPanelHeight, toggle as toggleTerminal, useTerms } from '../terminal/terms-store';

type Props = {
  ws: ReturnType<typeof useThreads>;
  project: Project | undefined;
  draft: boolean; // a new thread is being written for `project`
  onDraft: (on: boolean) => void;
  problem?: string;
  attempt: (call: () => Promise<unknown>) => Promise<void>;
  onAddProject: () => void;
};

/** The workspace view outlives this screen; threads stay visible in the left column. */
type View = 'team' | 'files' | 'git';
let lastView: View = 'team';
const keepView = (v: View) => (lastView = v);
const VIEW_LABEL: Record<View, string> = { team: 'Team', files: 'Files', git: 'Git' };
const VIEW_ICON = { team: AgentsIcon, files: ExplorerIcon, git: GitBranchIcon };

/** What a thread row says on the right. */
const trail = (t: Thread) =>
  needsYou(t) ? <Pill label="Your turn">✋</Pill>
  : t.status === 'running' ? <Presence state="speaking" />
  : t.status === 'error' ? <Pill label="Something went wrong">⚠️</Pill>
  : null;

/** Threads on the left, conversation/editor in the middle, Team/Files/Git on the right. */
export function Threads({ ws, project, draft, onDraft, problem, attempt, onAddProject }: Props) {
  const [text, setText] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto');
  const [filter, setFilter] = useState<string>(); // a #tag the thread list is narrowed to
  const mine = ws.threads.filter((t) => t.projectId === project?.id);
  const thread = draft ? undefined : mine.find((t) => t.id === ws.selected);
  const [threadAgents, setThreadAgents] = useState<AgentDef[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all([window.ark.head.get(), window.ark.catalog.list()]).then(([head, catalog]) => { if (active) setThreadAgents([head, ...catalog.agents]); }, () => {});
    return () => { active = false; };
  }, [thread?.id]);
  const tags = [...new Set(mine.flatMap((t) => t.tags ?? []))];
  const only = filter && tags.includes(filter) ? filter : undefined;
  const listed = only ? mine.filter((t) => t.tags?.includes(only)) : mine;
  const [selectedView, setViewState] = useState(lastView);
  const view = selectedView === 'team' && !thread ? 'files' : selectedView;
  const setView = (v: View) => setViewState(keepView(v));
  // Files and Git show the project, or the open thread's worktree once its build has one.
  const worktree = thread?.build && !thread.build.removed ? thread.build.worktree : undefined;
  const [rootSel, setRootSel] = useState<'project' | 'worktree'>('project');
  const [rootFor, setRootFor] = useState(thread?.id);
  const [wanted, setWanted] = useState<string>(); // a thread Show picked: its worktree is wanted once it is open
  if (rootFor !== thread?.id) {
    setRootFor(thread?.id);
    setRootSel(wanted && wanted === thread?.id ? 'worktree' : 'project');
    setWanted(undefined);
  }
  const root: RootRef = worktree && rootSel === 'worktree' && thread ? { kind: 'thread', id: thread.id } : { kind: 'project', id: project?.id ?? '' };
  const openFile = (r: RootRef, rel: string) => project && void attempt(() => openTab(project.id, r, rel));
  const tabs = useTabs(project?.id);
  const fileDoc = tabs.active ? tabs.docs.find((d) => d.tab.key === tabs.active) : undefined;
  const showThread = () => project && activate(project.id, null);
  const showWorktree = (id: string) => {
    onDraft(false);
    showThread();
    if (id === thread?.id) setRootSel('worktree');
    else {
      setWanted(id);
      void ws.select(id);
    }
  };
  const initGit = project && <button onClick={() => void attempt(() => ws.gitInit(project.id))} className={BUTTON}>Initialize Git</button>;
  const terms = useTerms(project?.id);
  // Ctrl+` toggles the terminal from anywhere in the area, Monaco and xterm included (capture runs first). It is the
  // physical key left of 1, whatever the layout prints on it.
  const bv = useBrowser(project?.id);
  const selectable = tabs.active === BROWSER_TAB && !!bv.state.url && !bv.state.failed; // there is a page to select on
  const here = useRef({ projectId: project?.id, root, selectable });
  useEffect(() => {
    here.current = { projectId: project?.id, root, selectable };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { projectId, root: r, selectable: sel } = here.current;
      if (projectId && sel && e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyS') {
        e.preventDefault();
        if (!e.repeat) void startSelect(projectId);
        return;
      }
      if (!projectId || !e.ctrlKey || e.code !== 'Backquote') return;
      e.preventDefault();
      if (e.repeat) return; // a held key would flicker the panel
      toggleTerminal(projectId, r);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // With the page focused the keys never reach this window: main hands them back.
  useEffect(
    () =>
      onBrowserKey((_projectId, k) => {
        const { projectId, root: r, selectable: sel } = here.current;
        if (k === 'terminal' && projectId) toggleTerminal(projectId, r);
        if (k === 'select' && projectId && sel) void startSelect(projectId);
      }),
    [],
  );

  const start = async (files: File[]) => {
    const t = text.trim();
    if (!project) return false;
    let done = false;
    await attempt(async () => {
      await ws.create(project.id, t, files.length ? await toUploads(files) : undefined, permissionMode);
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
          <div className="flex flex-wrap items-center gap-1 border-t border-divider p-1.5">
            <p className="min-w-0 flex-1 truncate text-meta text-muted" title={project.dir}>{project.dir}</p>
            {!project.git && view !== 'git' && initGit}
            <button onClick={async () => {
              if (await confirmAction(`Remove ${project.name} from Ark? Running threads will be paused. Files and threads are kept; add the folder again to restore it.`)) void attempt(() => ws.removeProject(project.id));
            }} aria-label="Remove project" title="Remove project" className={ICON_BUTTON}><TrashIcon /></button>
          </div>
        )}
      >
        {project ? (
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
                onRemove={async () => {
                  if (await confirmAction(`Delete thread "${t.title}"? Its conversation and attachments will be moved to the Recycle Bin.`)) void attempt(() => ws.removeThread(t.id));
                }}
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
        {project && (
          <TabStrip
            key={project.id}
            projectId={project.id}
            root={root}
            tabs={tabs}
            label={draft ? 'New thread' : thread ? `# ${thread.title}` : project.name}
            terminal={{ open: terms.open, onToggle: () => toggleTerminal(project.id, root) }}
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          {project && tabs.active === BROWSER_TAB ? (
            <BrowserPane key={project.id} projectId={project.id} thread={thread ? { id: thread.id, title: thread.title } : undefined} />
          ) : project && fileDoc?.diff ? (
            <DiffView key={fileDoc.tab.key} projectId={project.id} doc={fileDoc} onOpenFile={() => openFile(fileDoc.tab.root, fileDoc.tab.rel)} />
          ) : project && fileDoc ? (
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
                  {permissionMode === 'ask' ? 'The Head of Staff proposes a team and waits for your approval.' : 'The team plans and builds autonomously. You can pause it at any time.'}
                </Empty>
              </div>
              <div className="px-2 pb-0.5 lg:px-3"><PermissionSelect value={permissionMode} onChange={setPermissionMode} /></div>
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
            <ThreadView key={thread.id} thread={thread} messages={ws.messages} agents={threadAgents} tags={tags} onTag={(t) => setFilter(only === t ? undefined : t)} />
          ) : (
            <>
              <PaneHeader title={project.name} />
              <Empty
                glyph={<span className="block text-muted [&_svg]:size-4"><ThreadIcon /></span>}
                title={mine.length === 0 ? 'No threads yet' : 'Pick a thread'}
                action={<button onClick={() => onDraft(true)} className={CTA}>New thread</button>}
              >
                {mine.length === 0 ? 'Start one and the Head of Staff will propose a team.' : 'Open one on the left, or start a new one.'}
              </Empty>
            </>
          )}
        </div>
        {project && terms.open && (
          <>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                // the panel's height is a share of <Main>, so the drag measures against <Main> too
                const box = e.currentTarget.parentElement?.getBoundingClientRect();
                if (box && e.currentTarget.hasPointerCapture(e.pointerId)) setPanelHeight((box.bottom - e.clientY) / box.height);
              }}
              className="h-[4px] shrink-0 cursor-row-resize border-t border-divider hover:bg-divider"
            />
            <div style={{ height: `${panelHeight() * 100}%` }} className="flex shrink-0 flex-col">
              <TerminalPanel projectId={project.id} root={root} />
            </div>
          </>
        )}
      </Main>

      {project && (
        <Sidebar
          title="Workspace"
          label="Workspace"
          side="right"
          header={
            <div role="tablist" aria-label="Workspace view" className="control-inset no-drag flex min-w-0 gap-0.5 overflow-x-auto rounded-md bg-primary p-0.5">
              {(['team', 'files', 'git'] as const).filter((v) => v !== 'team' || thread).map((v) => {
                const Icon = VIEW_ICON[v];
                return (
                  <button
                    key={v}
                    role="tab"
                    aria-label={VIEW_LABEL[v]}
                    title={VIEW_LABEL[v]}
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`flex size-4 shrink-0 items-center justify-center rounded-sm text-body [&_svg]:size-2 ${view === v ? 'control-raised bg-raised text-secondary' : 'text-muted hover:text-secondary'}`}
                  >
                    <Icon />
                  </button>
                );
              })}
            </div>
          }
        >
          {view === 'team' && thread ? (
            <TeamPanel thread={thread} messages={ws.messages} agents={threadAgents} />
          ) : (
            <div className="p-1">
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
              {view === 'files' ? (
                <FileTree
                  key={rootKey(root)}
                  root={root}
                  name={root.kind === 'thread' ? `${thread?.title ?? ''} (worktree)` : project.name}
                  onOpen={(rel) => openFile(root, rel)}
                  attempt={attempt}
                  git={project.git}
                />
              ) : project.git ? (
                <GitView
                  key={rootKey(root)}
                  root={root}
                  projectId={project.id}
                  thread={root.kind === 'thread' ? thread : undefined}
                  busyThread={root.kind === 'thread' && thread?.status === 'running'}
                  onOpenFile={(rel) => openFile(root, rel)}
                  onOpenDiff={(rel, side) => openDiff(project.id, root, rel, side)}
                  attempt={attempt}
                  onShowThread={showWorktree}
                  onConflict={() => setRootSel('project')}
                />
              ) : initGit}
            </div>
          )}
        </Sidebar>
      )}
    </>
  );
}
