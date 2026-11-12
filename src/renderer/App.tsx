import { useEffect, useRef, useState } from 'react';
import type { Project } from '@shared/thread';
import { needsYou } from '@shared/thread-view';
import { areaOf, type Screen } from './agents';
import { Main } from './components/Shell';
import { Rail } from './components/Rail';
import { AgentsNav, UsageNav } from './components/Sidebars';
import { StatusBar } from './components/StatusBar';
import { readable } from './errors';
import { useThreads } from './hooks/useThreads';
import { useUsage } from './hooks/useUsage';
import { Accounts } from './pages/Accounts';
import { AgentDetail } from './pages/AgentDetail';
import { AgentForm } from './pages/AgentForm';
import { HeadForm } from './pages/HeadForm';
import { Agents } from './pages/Agents';
import { Chat } from './pages/Chat';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Threads } from './pages/Threads';
import { Usage } from './pages/Usage';

/**
 * The shell: a rail with the projects, a title bar, and the three places the rail leads to. The frame
 * (rail, title bar, status bar) is Primary; the panes inside it step lighter.
 */
export default function App() {
  const { state, refresh, now } = useUsage();
  const ws = useThreads(); // lives here: the rail shows which projects wait for the user, whatever screen is open
  const [screen, setScreen] = useState<Screen>({ name: 'threads' });
  const [projectId, setProjectId] = useState<string>();
  const [draft, setDraft] = useState(false); // a new thread is being written
  const [problem, setProblem] = useState<string>();

  const { projects, threads, selected, select } = ws;
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const waiting = new Set(threads.filter((t) => needsYou(t)).map((t) => t.projectId));

  // open the project's newest thread when nothing is open yet
  useEffect(() => {
    if (selected || !project) return;
    const first = threads.find((t) => t.projectId === project.id);
    if (first) void select(first.id);
  }, [selected, project, threads, select]);

  /** Runs a call from the rail or the sidebar; a refusal shows at the top of the threads pane. */
  const attempt = async (call: () => Promise<unknown>) => {
    try {
      setProblem(undefined);
      await call();
    } catch (e) {
      setProblem(readable(e));
    }
  };
  const openProject = (p: Project) => {
    setScreen({ name: 'threads' });
    setProjectId(p.id);
    setDraft(false);
    const open = threads.find((t) => t.id === selected);
    if (open?.projectId !== p.id) {
      const first = threads.find((t) => t.projectId === p.id);
      if (first) void select(first.id);
    }
  };
  const addProject = () => {
    setScreen({ name: 'threads' });
    void attempt(async () => {
      const p = await ws.addProject();
      if (p) {
        setProjectId(p.id);
        setDraft(false);
      }
    });
  };
  const area = areaOf(screen);

  // Page history: every (screen, project) pair visited, with back and forward over it.
  type Stop = { screen: Screen; projectId?: string };
  const [hist, setHist] = useState<{ trail: Stop[]; at: number }>({ trail: [], at: -1 });
  const replaying = useRef(false); // a back/forward jump must not be recorded as a new visit
  useEffect(() => {
    if (replaying.current) { replaying.current = false; return; }
    const cur = { screen, projectId: project?.id };
    setHist((h) => {
      if (JSON.stringify(h.trail[h.at]) === JSON.stringify(cur)) return h;
      const trail = [...h.trail.slice(0, h.at + 1), cur].slice(-50);
      return { trail, at: trail.length - 1 };
    });
  }, [screen, project?.id]);
  const go = (step: number) => {
    const to = hist.trail[hist.at + step];
    if (!to) return;
    replaying.current = true;
    setHist({ ...hist, at: hist.at + step });
    setScreen(to.screen);
    setProjectId(to.projectId);
    setDraft(false);
  };
  // the mouse's side buttons (3 = back, 4 = forward) do the same as the Rail's arrows
  useEffect(() => {
    const side = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      go(e.button === 3 ? -1 : 1);
    };
    window.addEventListener('mouseup', side);
    return () => window.removeEventListener('mouseup', side);
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Rail
          projects={projects}
          waiting={waiting}
          area={area}
          projectId={project?.id}
          onProject={openProject}
          onAddProject={addProject}
          onBack={hist.at > 0 ? () => go(-1) : undefined}
          onForward={hist.at < hist.trail.length - 1 ? () => go(1) : undefined}
          onArea={(a) => setScreen({ name: a } as Screen)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* the window's own title bar: Windows draws only its buttons over this strip */}
          <div className="drag h-4 shrink-0 bg-primary" />
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-tl-lg border-l border-t border-divider">
            {area === 'threads' && (
              <Threads ws={ws} project={project} draft={draft} onDraft={setDraft} problem={problem} attempt={attempt} onAddProject={addProject} />
            )}
            {area === 'usage' && (
              <>
                <UsageNav screen={screen} state={state} onNavigate={setScreen} />
                <Main>
                  {screen.name === 'usage' && <Usage state={state} now={now} refresh={refresh} onNavigate={setScreen} />}
                  {screen.name === 'agent' && <AgentDetail id={screen.id} state={state} now={now} />}
                  {screen.name === 'history' && <History />}
                  {screen.name === 'accounts' && <Accounts state={state} />}
                </Main>
              </>
            )}
            {area === 'settings' && <Main><Settings /></Main>}
            {area === 'agents' && (
              <>
                <AgentsNav screen={screen} onNavigate={setScreen} />
                <Main>
                  {screen.name === 'agents' && <Agents state={state} onNavigate={setScreen} />}
                  {screen.name === 'agent-form' && (
                    <AgentForm id={screen.id} draft={screen.draft} onBack={() => setScreen({ name: 'agents' })} />
                  )}
                  {screen.name === 'head-form' && <HeadForm onBack={() => setScreen({ name: 'agents' })} />}
                  {screen.name === 'chat' && <Chat key={screen.agentId} agentId={screen.agentId} />}
                </Main>
              </>
            )}
          </div>
        </div>
      </div>
      <StatusBar state={state} now={now} refresh={refresh} />
    </div>
  );
}
