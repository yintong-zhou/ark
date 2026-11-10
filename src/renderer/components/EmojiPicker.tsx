import { useEffect, useRef, useState } from 'react';
import { SmileIcon } from './Icons';
import { ICON_BUTTON } from './ui';

// Enough for a work thread, in one grid: no categories, no search.
const EMOJI = [
  '😀', '😄', '😂', '🙂', '😉', '😍', '🤔', '😅',
  '😎', '🙏', '👍', '👎', '👏', '🙌', '💪', '👀',
  '🎉', '🔥', '✨', '⭐', '✅', '❌', '⚠️', '💡',
  '🐛', '🔧', '🔨', '🚀', '📦', '📌', '🔒', '⏳',
  '❤️', '💬', '📝', '🧪', '🔍', '🧠', '📊', '☕',
];

/** A button that opens a grid of emoji above it; picking one hands it back and closes the grid. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Add an emoji"
        aria-expanded={open}
        title="Add an emoji"
        className={ICON_BUTTON}
      >
        <SmileIcon />
      </button>
      {open && (
        <div role="dialog" aria-label="Emoji" className="surface-floating absolute bottom-full left-0 z-10 mb-1 grid w-[288px] grid-cols-8 gap-[2px] rounded-md bg-sidebar p-1">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              className="size-4 rounded-xs hover:bg-primary"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
