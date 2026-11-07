import { activate, close, type TabsView } from '../editor/tabs-store';
import { CloseIcon, TerminalIcon } from './Icons';
import { ICON_BUTTON } from './ui';

const TAB = 'no-drag group flex h-full max-w-[200px] shrink-0 items-center gap-[4px] border-r border-divider px-1 text-meta';

type Props = { projectId: string; label: string; tabs: TabsView; terminal: { open: boolean; onToggle: () => void } };

/** The main pane's tabs: the thread first, then the open files (spec §5.2), and the terminal button on the right. */
export function TabStrip({ projectId, label, tabs, terminal }: Props) {
  const look = (on: boolean) => (on ? 'bg-content text-secondary' : 'text-muted hover:text-secondary');
  return (
    <div className="flex h-4 shrink-0 border-b border-divider bg-sidebar">
      <div role="tablist" aria-label="Open tabs" className="flex min-w-0 flex-1 overflow-x-auto">
        <button role="tab" aria-selected={tabs.active === null} onClick={() => activate(projectId, null)} className={`${TAB} ${look(tabs.active === null)}`}>
          <span className="truncate">{label}</span>
        </button>
        {tabs.docs.map(({ tab, name }) => {
          const on = tabs.active === tab.key;
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={on}
              tabIndex={0}
              title={tab.rel}
              onClick={() => activate(projectId, tab.key)}
              onKeyDown={(e) => e.key === 'Enter' && activate(projectId, tab.key)}
              onAuxClick={(e) => e.button === 1 && close(projectId, tab.key)}
              className={`${TAB} cursor-default ${look(on)}`}
            >
              <span className="truncate">{name}</span>
              {tab.root.kind === 'thread' && <span className="shrink-0 text-muted">· worktree</span>}
              {tab.dirty && <span aria-label="Unsaved changes" className="shrink-0 text-secondary">●</span>}
              <button
                aria-label={`Close ${name}`}
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  close(projectId, tab.key);
                }}
                className={`flex size-2 shrink-0 items-center justify-center rounded-xs hover:bg-raised [&_svg]:size-[12px] ${on ? '' : 'invisible group-hover:visible'}`}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>
      <button
        aria-label="Terminal"
        aria-pressed={terminal.open}
        title="Terminal (Ctrl+`)"
        onClick={terminal.onToggle}
        className={`${ICON_BUTTON} no-drag rounded-none ${terminal.open ? 'text-secondary' : ''}`}
      >
        <TerminalIcon />
      </button>
    </div>
  );
}
