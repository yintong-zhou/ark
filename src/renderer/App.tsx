import { useEffect, useState } from 'react';
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
import { Agents } from './pages/Agents';
import { Chat } from './pages/Chat';
import { History } from './pages/History';
import { StatuslineConnect } from './pages/StatuslineConnect';
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
          onArea={(a) => setScreen(a === 'usage' ? { name: 'usage' } : { name: 'agents' })}
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
                  {screen.name === 'statusline' && <StatuslineConnect />}
                </Main>
              </>
            )}
            {area === 'agents' && (
              <>
                <AgentsNav screen={screen} onNavigate={setScreen} />
                <Main>
                  {screen.name === 'agents' && <Agents state={state} onNavigate={setScreen} />}
                  {screen.name === 'agent-form' && (
                    <AgentForm id={screen.id} draft={screen.draft} onBack={() => setScreen({ name: 'agents' })} />
                  )}
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
