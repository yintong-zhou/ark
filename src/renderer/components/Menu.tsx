import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useOverlay } from '../browser/overlay';

export type MenuItem = { label: string; onClick?: () => void; danger?: boolean; icon?: ReactNode; shortcut?: string; separator?: boolean; detail?: string; checked?: boolean };

/** A popup at the pointer or trigger, optionally searchable. Native browser pages stay behind it. */
export function Menu({ items, at, onClose, searchPlaceholder, label, width = searchPlaceholder ? 320 : 192 }: {
  items: MenuItem[];
  at: { x: number; y: number };
  onClose: () => void;
  searchPlaceholder?: string;
  label?: string;
  width?: number;
}) {
  useOverlay();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const shown = items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const previous = document.activeElement;
    const menu = ref.current;
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    menu?.querySelector<HTMLElement>('input, button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
      if ((menu?.contains(document.activeElement) || document.activeElement === document.body) && previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);
  const navigate = (e: KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Tab') {
      onClose();
      return;
    }
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      buttons[0]?.click();
      return;
    }
    let next: number;
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (index <= 0 ? buttons.length : index) - 1;
    else if (e.key === 'Home' && index >= 0) next = 0;
    else if (e.key === 'End' && index >= 0) next = buttons.length - 1;
    else return;
    e.preventDefault();
    buttons[next]?.focus();
  };
  const left = Math.max(8, Math.min(at.x, window.innerWidth - width - 8));
  const height = shown.reduce((n, i) => n + (i.detail ? 88 : 40), 0);
  const top = Math.max(8, Math.min(at.y, window.innerHeight - Math.max(40, height) - (searchPlaceholder ? 56 : 16)));
  return (
    <div
      ref={ref}
      onKeyDown={navigate}
      style={{ left, top, width, maxHeight: window.innerHeight - top - 8 }}
      className="surface-floating no-drag fixed z-50 flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md bg-sidebar"
    >
      {searchPlaceholder && (
        <div className="shrink-0 border-b border-divider p-1">
          <input
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-4 w-full rounded-xs bg-transparent px-1 text-meta text-neutral-light placeholder:text-muted focus:outline-none"
          />
        </div>
      )}
      <ul role="menu" aria-label={label} className="min-h-0 overflow-y-auto p-0.5">
        {shown.map((i, index) => (
          <li key={i.label} role="none" className={i.separator && index > 0 ? 'mt-[4px] border-t border-divider pt-[4px]' : undefined}>
            <button
              role={i.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={i.checked}
              disabled={!i.onClick}
              onClick={() => {
                onClose();
                i.onClick?.();
              }}
              className={`flex ${i.detail ? 'min-h-5 py-1' : 'h-4'} w-full items-center gap-1 rounded-sm px-1.5 text-left enabled:hover:bg-raised focus:bg-raised focus:outline-none disabled:text-muted ${searchPlaceholder ? 'text-meta' : ''} ${i.danger ? 'text-secondary' : 'text-neutral-light'}`}
            >
              {i.icon && <span className="shrink-0 text-muted [&_svg]:size-2">{i.icon}</span>}
              {i.checked !== undefined && <span aria-hidden className="w-1.5 shrink-0 text-meta">{i.checked ? '●' : ''}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{i.label}</span>
                {i.detail && <span className="mt-[2px] block text-meta leading-[18px] text-muted">{i.detail}</span>}
              </span>
              {i.shortcut && <span className="shrink-0 text-meta text-muted">{i.shortcut}</span>}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li role="none" className="px-2 py-1 text-meta text-muted">No actions found.</li>}
      </ul>
    </div>
  );
}
