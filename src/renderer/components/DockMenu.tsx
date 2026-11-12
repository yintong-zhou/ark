import { useEffect, useState, type PointerEvent } from 'react';
import { useOverlay } from '../browser/overlay';
import { Menu } from './Menu';
import { ICON_BUTTON } from './ui';

const BTN = `${ICON_BUTTON} no-drag !size-3`;

/** Which side of `rect` the pointer is nearest to, among `sides`; null when it is outside. */
function sideAt<T extends string>(rect: DOMRect, x: number, y: number, sides: readonly T[]): T | null {
  const nx = (x - rect.left) / rect.width;
  const ny = (y - rect.top) / rect.height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  const dist = { left: nx, right: 1 - nx, top: ny, bottom: 1 - ny } as Record<string, number>;
  return sides.reduce((best, s) => (dist[s] < dist[best] ? s : best));
}

/** The half of the area a dropped panel would take, drawn over everything while dragging. */
function DropOverlay({ rect, side }: { rect: DOMRect; side: string | null }) {
  useOverlay(); // a native browser page would hide the overlay
  const zone: Record<string, string> = { left: 'inset-y-0 left-0 w-1/2', right: 'inset-y-0 right-0 w-1/2', top: 'inset-x-0 top-0 h-1/2', bottom: 'inset-x-0 bottom-0 h-1/2' };
  return (
    <div style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} className="pointer-events-none fixed z-50">
      {side && <div className={`absolute ${zone[side]} rounded-md border border-neutral-light/40 bg-neutral-light/10`} />}
    </div>
  );
}

/**
 * Grab it and drop on the side of `area` where the panel should dock; or open the menu for the same choice.
 * Escape, or releasing outside the area, cancels.
 */
export function DockControls<T extends string>({ label, value, sides, onChange, area }: {
  label: string; value: T; sides: readonly T[]; onChange: (side: T) => void;
  area: (grip: HTMLElement) => Element | null | undefined; // the region the panel docks into
}) {
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [drag, setDrag] = useState<{ rect: DOMRect; side: T | null }>();
  useEffect(() => {
    if (!drag) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setDrag(undefined);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [drag]);
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    const box = e.button === 0 ? area(e.currentTarget) : null;
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ rect: box.getBoundingClientRect(), side: null });
  };
  const finish = (cancel: boolean) => {
    if (drag?.side && !cancel) onChange(drag.side);
    setDrag(undefined);
  };
  return (
    <span className="ml-auto flex shrink-0">
      <button
        type="button"
        aria-label={`Drag ${label} to a side`}
        title={`Drag ${label} to a side`}
        className={`${BTN} cursor-grab touch-none`}
        onPointerDown={down}
        onPointerMove={(e) => drag && setDrag({ ...drag, side: sideAt(drag.rect, e.clientX, e.clientY, sides) })}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
      >
        <span aria-hidden>⠿</span>
      </button>
      <button
        type="button"
        aria-label={`Move ${label}`}
        title={`Move ${label}`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        className={BTN}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 192, y: r.bottom + 4 }); }}
      >
        <span aria-hidden>⇱</span>
      </button>
      {menu && (
        <Menu at={menu} label={`Move ${label}`} onClose={() => setMenu(undefined)}
          items={sides.map((s) => ({ label: `${s[0].toUpperCase()}${s.slice(1)}`, checked: s === value, onClick: () => onChange(s) }))} />
      )}
      {drag && <DropOverlay rect={drag.rect} side={drag.side} />}
    </span>
  );
}
