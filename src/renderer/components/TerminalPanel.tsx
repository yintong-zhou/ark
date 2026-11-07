import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { RootRef } from '@shared/files';
import type { ShellOption } from '@shared/terminal';
import { activateTerm, attach, closeTerm, create, fitTerm, shells, useTerms } from '../terminal/terms-store';
import { CloseIcon, PlusIcon } from './Icons';
import { Menu } from './Menu';

const TAB = 'group flex h-full max-w-[180px] shrink-0 items-center gap-[4px] border-r border-divider px-1 text-meta';

/** The bottom panel: the project's terminals as small tabs, the active one below (spec §5.4). */
export function TerminalPanel({ projectId, root }: { projectId: string; root: RootRef }) {
  const view = useTerms(projectId);
  const body = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; options: ShellOption[] }>();
  const term = view.terms.find((t) => t.id === view.active);

  // show the active terminal's own <div>, and keep it sized to the panel
  useEffect(() => {
    const host = body.current;
    if (!host || !term) return;
    attach(term, host);
    term.xterm.focus();
    const ro = new ResizeObserver(() => fitTerm(term));
    ro.observe(host);
    return () => {
      ro.disconnect();
      term.el.remove();
    };
  }, [term]);

  const pick = async (e: MouseEvent) => {
    const at = { x: e.clientX, y: e.clientY };
    setMenu({ ...at, options: await shells() });
  };

  return (
    <section aria-label="Terminals" className="flex min-h-0 flex-1 flex-col bg-primary">
      <div role="tablist" aria-label="Terminals" className="flex h-3 shrink-0 items-stretch overflow-x-auto border-b border-divider bg-sidebar">
        {view.terms.map((t) => {
          const on = t.id === view.active;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={on}
              tabIndex={0}
              title={t.exited === undefined ? t.name : `Process exited (code ${t.exited})`}
              onClick={() => activateTerm(projectId, t.id)}
              onKeyDown={(e) => e.key === 'Enter' && activateTerm(projectId, t.id)}
              className={`${TAB} cursor-default ${on ? 'bg-primary text-secondary' : 'text-muted hover:text-secondary'}`}
            >
              <span className="truncate">{t.name}</span>
              {t.exited !== undefined && <span className="shrink-0 text-muted">· exited</span>}
              <button
                aria-label={`Close ${t.name}`}
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerm(projectId, t.id);
                }}
                className={`flex size-2 shrink-0 items-center justify-center rounded-xs hover:bg-raised [&_svg]:size-[12px] ${on ? '' : 'invisible group-hover:visible'}`}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
        <button aria-label="New terminal" title="New terminal" onClick={(e) => void pick(e)} className="flex w-3 shrink-0 items-center justify-center text-muted hover:text-secondary [&_svg]:size-[14px]">
          <PlusIcon />
        </button>
      </div>
      {view.error && <p role="alert" className="shrink-0 px-2 py-[4px] text-meta text-muted">Couldn't start the terminal: {view.error}</p>}
      <div ref={body} className="min-h-0 flex-1 overflow-hidden pl-1 pt-[4px]" />
      {menu && (
        <Menu
          at={menu}
          onClose={() => setMenu(undefined)}
          items={menu.options.map((s) => ({ label: s.name, onClick: () => void create(projectId, root, s) }))}
        />
      )}
    </section>
  );
}
