import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { boxPlace, clampPoint, MIN_SELECTION, type Rect } from '@shared/browser';
import { cancelSelect, pickArea, sendArea, setDraft, type BrowserView } from '../browser/browser-store';
import { CloseIcon } from './Icons';
import { CTA, FIELD, ICON_BUTTON } from './ui';

const BOX = { width: 288, height: 170 }; // a stand-in for the comment box's height when placing it

const normalize = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});
const inside = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/**
 * The freeze frame with the drag and the comment box, in the placeholder's place (spec §5.3). It fills the placeholder,
 * so a point in it is a point of the page in CSS px.
 */
export function BrowserSelect({ projectId, view, thread }: { projectId: string; view: BrowserView; thread?: { id: string; title: string } }) {
  const { sel, draft } = view;
  const root = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [from, setFrom] = useState<{ x: number; y: number }>();
  const [drag, setDrag] = useState<Rect>();
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = () => {
      const b = el.getBoundingClientRect(); // fractional, like the bounds main validates against
      setSize({ width: b.width, height: b.height });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelSelect(projectId);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectId]);

  const ready = !!sel?.rect;
  useEffect(() => {
    if (ready) area.current?.focus();
  }, [ready]);

  const point = (e: PointerEvent) => {
    const r = root.current!.getBoundingClientRect();
    return clampPoint({ x: e.clientX - r.left, y: e.clientY - r.top }, size);
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = point(e);
    if (sel?.rect && inside(sel.rect, p)) return; // inside the rectangle: nothing happens
    root.current!.setPointerCapture(e.pointerId);
    setFrom(p);
  };
  const move = (e: PointerEvent) => from && setDrag(normalize(from, point(e)));
  const up = (e: PointerEvent) => {
    if (!from) return;
    const r = normalize(from, point(e));
    setFrom(undefined);
    setDrag(undefined);
    if (r.width >= MIN_SELECTION && r.height >= MIN_SELECTION) void pickArea(projectId, r);
    else if (sel?.rect) cancelSelect(projectId); // a plain click outside the rectangle and box
  };

  const shown = drag ?? sel?.rect;
  const place = sel?.rect && !drag ? boxPlace(sel.rect, BOX, size) : undefined;
  const canSend = !!thread && !!draft.trim() && !!sel?.picked && !sel.sending;
  const send = () => canSend && void sendArea(projectId, thread);

  return (
    <div
      ref={root}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      className="absolute inset-0 cursor-crosshair select-none overflow-hidden"
    >
      {sel && <img src={sel.frame} alt="" draggable={false} className="size-full object-fill" />}
      <p className="pointer-events-none absolute inset-x-0 top-0 bg-sidebar/90 px-2 py-[4px] text-meta text-muted">Drag over the area to comment on. Esc to cancel.</p>
      {shown && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/10"
          style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }}
        />
      )}
      {place && (
        <div
          role="dialog"
          aria-label="Comment on this area"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute flex cursor-default flex-col gap-1 rounded-sm border border-raised bg-sidebar p-1"
          style={{ left: place.x, top: place.y, width: BOX.width }}
        >
          <div className="flex items-start gap-1">
            <textarea
              ref={area}
              aria-label="Comment"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(projectId, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              className={`${FIELD} min-w-0 flex-1 resize-none`}
            />
            <button aria-label="Cancel" title="Cancel" onClick={() => cancelSelect(projectId)} className={ICON_BUTTON}>
              <CloseIcon />
            </button>
          </div>
          {!thread && <p className="text-meta text-muted">Open a thread to send this.</p>}
          {sel?.error && <p role="alert" className="text-meta text-muted">{sel.error}</p>}
          <button disabled={!canSend} onClick={send} className={`${CTA} self-end`}>Send to thread</button>
        </div>
      )}
    </div>
  );
}
