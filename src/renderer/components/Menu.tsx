import { useEffect, useRef } from 'react';

export type MenuItem = { label: string; onClick: () => void; danger?: boolean };

/** A small Raised popup at the pointer. Escape, a click outside or picking an item closes it. */
export function Menu({ items, at, onClose }: { items: MenuItem[]; at: { x: number; y: number }; onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    ref.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  // keep it on screen near the right and bottom edges
  const left = Math.min(at.x, window.innerWidth - 200);
  const top = Math.min(at.y, window.innerHeight - items.length * 32 - 16);
  return (
    <ul ref={ref} role="menu" style={{ left, top }} className="fixed z-50 w-[192px] rounded-sm bg-raised py-[4px] shadow-lg">
      {items.map((i) => (
        <li key={i.label}>
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              i.onClick();
            }}
            className={`flex h-4 w-full items-center px-2 text-left hover:bg-primary/40 focus:bg-primary/40 focus:outline-none ${i.danger ? 'text-secondary' : 'text-neutral-light'}`}
          >
            {i.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
