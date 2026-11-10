import { useCallback, useState } from 'react';
import type { RootRef } from '@shared/files';
import { closeBrowser, useBrowser } from '../browser/browser-store';
import { activate, BROWSER_TAB, close, type TabsView } from '../editor/tabs-store';
import { CloseIcon, PlusIcon } from './Icons';
import { ICON_BUTTON } from './ui';
import { EntryIcon } from './EntryIcon';
import { NewTabMenu } from './NewTabMenu';

const TAB = 'no-drag group flex h-4 max-w-[200px] shrink-0 items-center gap-0.5 rounded-sm px-1.5 text-meta';

type Props = { projectId: string; root: RootRef; label: string; tabs: TabsView; terminal: { open: boolean; onToggle: () => void } };

/** The page's host and port, or `Browser` before an address. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || 'Browser';
  } catch {
    return 'Browser';
  }
}

/** The main pane's tabs, followed by a + menu for terminals and the browser. */
export function TabStrip({ projectId, root, label, tabs, terminal }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const look = (on: boolean) => (on ? 'control-raised bg-raised text-secondary' : 'text-muted hover:bg-raised/50 hover:text-secondary');
  const browser = useBrowser(projectId);
  const byKey = new Map(tabs.docs.map((d) => [d.tab.key, d]));
  const closeButton = (name: string, on: boolean, onClose: () => void) => (
    <button
      aria-label={`Close ${name}`}
      title="Close"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className={`flex size-2 shrink-0 items-center justify-center rounded-xs hover:bg-primary/50 [&_svg]:size-[12px] ${on ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
    >
      <CloseIcon />
    </button>
  );
  return (
    <div className="flex h-5 shrink-0 items-center gap-0.5 border-b border-divider bg-sidebar px-1">
      <div role="tablist" aria-label="Open tabs" className="flex min-w-0 items-center gap-0.5 overflow-x-auto py-0.5">
        <button role="tab" aria-selected={tabs.active === null} onClick={() => activate(projectId, null)} className={`${TAB} ${look(tabs.active === null)}`}>
          <span className="truncate">{label}</span>
        </button>
        {tabs.keys.map((key) => {
          const on = tabs.active === key;
          if (key === BROWSER_TAB) {
            const name = hostOf(browser.state.url);
            return (
              <div
                key={key}
                role="tab"
                aria-selected={on}
                tabIndex={0}
                title={browser.state.title || name}
                onClick={() => activate(projectId, key)}
                onKeyDown={(e) => e.key === 'Enter' && activate(projectId, key)}
                onAuxClick={(e) => e.button === 1 && void closeBrowser(projectId)}
                className={`${TAB} cursor-default ${look(on)}`}
              >
                <span className="truncate">{name}</span>
                {closeButton(name, on, () => void closeBrowser(projectId))}
              </div>
            );
          }
          const doc = byKey.get(key);
          if (!doc) return null;
          const { tab, name } = doc;
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
              <EntryIcon name={name} />
              <span className="truncate">{name}</span>
              {tab.root.kind === 'thread' && <span className="shrink-0 text-muted">· worktree</span>}
              {tab.dirty && <span aria-label="Unsaved changes" className="shrink-0 text-secondary">●</span>}
              {closeButton(name, on, () => close(projectId, tab.key))}
            </div>
          );
        })}
      </div>
      <button
        aria-label="New tab"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        title="New tab"
        onMouseDown={(e) => { if (menu) e.stopPropagation(); }}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? undefined : { x: box.left, y: box.bottom + 4 });
        }}
        className={`${ICON_BUTTON} no-drag ${menu ? 'bg-raised/50 text-secondary' : ''}`}
      >
        <PlusIcon />
      </button>
      {menu && <NewTabMenu projectId={projectId} root={root} terminal={terminal} at={menu} onClose={closeMenu} />}
    </div>
  );
}
