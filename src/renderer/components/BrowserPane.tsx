import { useEffect, useRef, useState } from 'react';
import { cancelSelect, go, setAddress, startSelect, useBrowser } from '../browser/browser-store';
import { useOverlayOpen } from '../browser/overlay';
import { BrowserSelect } from './BrowserSelect';
import { BackIcon, ForwardIcon, RefreshIcon } from './Icons';
import { BUTTON, BUTTON_INSET, CTA, ICON_BUTTON, INPUT } from './ui';

const bar = () => window.ark.browser;

/**
 * The browser tab: an address bar over a placeholder `div`. The page itself is a native view in main, which this
 * component keeps laid over the placeholder (spec §5.1). The view is hidden (`layout(…, null)`) when the pane unmounts,
 * an overlay is open, there is no address yet or the load failed: then the placeholder has its own content.
 */
export function BrowserPane({ projectId, thread }: { projectId: string; thread?: { id: string; title: string } }) {
  const view = useBrowser(projectId);
  const { state, address, error, sel, sent } = view;
  const overlay = useOverlayOpen();
  const place = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<string>(); // the page as it was when an overlay opened
  const live = !!state.url && !state.failed;
  const selecting = !!sel;

  useEffect(() => {
    const el = place.current;
    if (!el) return;
    const hide = () => void bar().layout(projectId, null).catch(() => {});
    if (!live || selecting) {
      hide();
      return;
    }
    if (overlay) {
      // capture first so nothing jumps, then hide the view
      let alive = true;
      void bar()
        .capture(projectId)
        .then((url) => alive && setFrame(url))
        .catch(() => {})
        .finally(() => alive && hide());
      return () => {
        alive = false;
        setFrame(undefined);
      };
    }
    const send = () => {
      const r = el.getBoundingClientRect();
      void bar().layout(projectId, { x: r.x, y: r.y, width: r.width, height: r.height }).catch(() => {});
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [projectId, live, overlay, selecting]);

  // leaving the pane (another tab, project or area) hides the view; main keeps it alive
  useEffect(() => () => void bar().layout(projectId, null).catch(() => {}), [projectId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-4 shrink-0 items-center gap-[4px] border-b border-divider bg-sidebar px-1">
        <button aria-label="Back" title="Back" disabled={!state.canBack} onClick={() => void bar().back(projectId)} className={`${ICON_BUTTON} disabled:opacity-40`}>
          <BackIcon />
        </button>
        <button aria-label="Forward" title="Forward" disabled={!state.canForward} onClick={() => void bar().forward(projectId)} className={`${ICON_BUTTON} disabled:opacity-40`}>
          <ForwardIcon />
        </button>
        <button aria-label="Reload" title="Reload" disabled={!state.url} onClick={() => void bar().reload(projectId)} className={`${ICON_BUTTON} disabled:opacity-40`}>
          <RefreshIcon />
        </button>
        <input
          aria-label="Address"
          value={address}
          placeholder="localhost:5173"
          spellCheck={false}
          onChange={(e) => setAddress(projectId, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void go(projectId)}
          className={`${INPUT} min-w-0 flex-1`}
        />
        {sent && <span role="status" className="shrink-0 text-meta text-muted">{sent}</span>}
        <button
          disabled={!live}
          aria-pressed={selecting}
          title="Select an area (Ctrl+Shift+S)"
          onClick={() => (selecting ? cancelSelect(projectId) : void startSelect(projectId))}
          className={selecting ? CTA : BUTTON}
        >
          Select
        </button>
      </div>
      {error && <p role="alert" className="shrink-0 border-b border-divider px-2 py-[4px] text-meta text-muted">{error}</p>}
      {state.blocked && (
        <div role="alert" className="flex shrink-0 items-center gap-1 border-b border-divider px-2 py-[4px] text-meta text-muted">
          <span className="min-w-0 flex-1">This page tried to open {state.blocked.host}, which isn&apos;t local.</span>
          <button onClick={() => void bar().openBlocked(projectId)} className={BUTTON_INSET}>Open in your browser</button>
        </div>
      )}
      <div ref={place} className="relative flex min-h-0 flex-1 items-center justify-center bg-content">
        {!state.url ? (
          <p className="max-w-[420px] px-3 text-center text-muted">Start your dev server in the terminal (Ctrl+`), then enter its address, for example localhost:5173.</p>
        ) : state.failed ? (
          <div className="flex flex-col items-center gap-1 px-3 text-center text-muted">
            <p>Can&apos;t reach {state.failed.url}. Is the dev server running?</p>
            <button onClick={() => void bar().reload(projectId)} className={BUTTON_INSET}>Retry</button>
          </div>
        ) : (
          sel ? (
            <BrowserSelect projectId={projectId} view={view} thread={thread} />
          ) : (
            overlay && frame && <img src={frame} alt="" className="size-full object-fill" />
          )
        )}
      </div>
    </div>
  );
}
