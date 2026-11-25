import type { Project } from '@shared/thread';
import logo from '../assets/logo.png';
import type { Area } from '../agents';
import { initials } from './Avatar';
import { ICON_BUTTON } from './ui';
import { Highlight, LayoutGroup } from '../motion';
import { AgentsIcon, ArrowIcon, PlusIcon, SettingsIcon, UsageIcon } from './Icons';

type Props = {
  projects: Project[];
  waiting: Set<string>; // projects with a thread that waits for the user
  area: Area;
  projectId?: string;
  onProject: (p: Project) => void;
  onAddProject: () => void;
  onArea: (a: Exclude<Area, 'threads'>) => void;
  onBack?: () => void; // undefined: nowhere to go
  onForward?: () => void;
};

const TILE = 'relative flex size-5 items-center justify-center rounded-md';
const tone = (on: boolean) => (on ? 'text-secondary' : 'text-muted hover:bg-raised/50 hover:text-secondary');
/** The tile behind the open project or area; it glides from one to the next. */
const Lit = () => <Highlight group="rail" className="control-raised absolute inset-0 rounded-md bg-raised" />;

/** The far-left column: the logo once, the projects, and the places that belong to no project. */
export function Rail({ projects, waiting, area, projectId, onProject, onAddProject, onArea, onBack, onForward }: Props) {
  return (
    <nav aria-label="Projects" className="flex w-8 shrink-0 flex-col items-center bg-primary">
     <LayoutGroup id="rail">
      <div className="drag flex h-10 w-full shrink-0 flex-col items-center">
        <div className="flex h-4 items-center">
          <button type="button" onClick={onBack} disabled={!onBack} aria-label="Back" title="Back" className={`${ICON_BUTTON} no-drag !size-3`}><ArrowIcon dir="back" /></button>
          <button type="button" onClick={onForward} disabled={!onForward} aria-label="Forward" title="Forward" className={`${ICON_BUTTON} no-drag !size-3`}><ArrowIcon dir="forward" /></button>
        </div>
        <img src={logo} alt="Ark" draggable={false} className="size-5" />
      </div>

      <ul className="flex min-h-0 w-full flex-col items-center gap-1.5 overflow-y-auto py-1">
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
                className={`${TILE} head ${on ? '' : 'bg-sidebar hover:bg-raised/50'}`}
              >
                {on && <Lit />}
                <span className="relative">{initials(p.name)}</span>
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
          {area === 'usage' && <Lit />}
          <span className="relative"><UsageIcon /></span>
        </button>
        <button onClick={() => onArea('agents')} title="Agents" aria-label="Agents" aria-current={area === 'agents' ? 'page' : undefined} className={`${TILE} ${tone(area === 'agents')}`}>
          {area === 'agents' && <Lit />}
          <span className="relative"><AgentsIcon /></span>
        </button>
        <button onClick={() => onArea('settings')} title="Settings" aria-label="Settings" aria-current={area === 'settings' ? 'page' : undefined} className={`${TILE} ${tone(area === 'settings')}`}>
          {area === 'settings' && <Lit />}
          <span className="relative"><SettingsIcon /></span>
        </button>
      </div>
     </LayoutGroup>
    </nav>
  );
}
