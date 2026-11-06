import type { Project } from '@shared/thread';
import logo from '../assets/logo.png';
import type { Area } from '../agents';
import { initials } from './Avatar';
import { AgentsIcon, PlusIcon, UsageIcon } from './Icons';

type Props = {
  projects: Project[];
  waiting: Set<string>; // projects with a thread that waits for the user
  area: Area;
  projectId?: string;
  onProject: (p: Project) => void;
  onAddProject: () => void;
  onArea: (a: Exclude<Area, 'threads'>) => void;
};

const TILE = 'relative flex size-5 items-center justify-center rounded-sm';
const tone = (on: boolean) => (on ? 'bg-raised text-secondary' : 'text-muted hover:bg-raised/50 hover:text-secondary');

/** The far-left column: the logo once, the projects, and the places that belong to no project. */
export function Rail({ projects, waiting, area, projectId, onProject, onAddProject, onArea }: Props) {
  return (
    <nav aria-label="Projects" className="flex w-8 shrink-0 flex-col items-center bg-primary">
      <div className="drag flex h-6 w-full shrink-0 items-center justify-center">
        <img src={logo} alt="Ark" draggable={false} className="size-5" />
      </div>

      <ul className="flex min-h-0 w-full flex-col items-center gap-1 overflow-y-auto pt-1">
        {projects.map((p) => {
          const on = area === 'threads' && p.id === projectId;
          return (
            <li key={p.id} className="relative">
              {waiting.has(p.id) && <span aria-hidden className="absolute -left-[12px] inset-y-0 w-[2px] bg-accent" />}
              <button
                onClick={() => onProject(p)}
                title={p.name}
                aria-label={waiting.has(p.id) ? `${p.name}, a thread waits for you` : p.name}
                aria-current={on ? 'page' : undefined}
                className={`${TILE} head ${on ? 'bg-raised' : 'bg-sidebar hover:bg-raised/50'}`}
              >
                {initials(p.name)}
              </button>
            </li>
          );
        })}
        <li>
          <button onClick={onAddProject} title="Add project" aria-label="Add project" className={`${TILE} ${tone(false)}`}>
            <PlusIcon />
          </button>
        </li>
      </ul>

      <div className="mt-auto flex flex-col items-center gap-1 pb-1">
        <span aria-hidden className="mb-1 h-px w-5 bg-divider" />
        <button onClick={() => onArea('usage')} title="Usage" aria-label="Usage" aria-current={area === 'usage' ? 'page' : undefined} className={`${TILE} ${tone(area === 'usage')}`}>
          <UsageIcon />
        </button>
        <button onClick={() => onArea('agents')} title="Agents" aria-label="Agents" aria-current={area === 'agents' ? 'page' : undefined} className={`${TILE} ${tone(area === 'agents')}`}>
          <AgentsIcon />
        </button>
      </div>
    </nav>
  );
}
