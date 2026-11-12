import { useState } from 'react';
import { Menu } from './Menu';
import { BUTTON, BUTTON_INSET } from './ui';

export type Option = { value: string; label: string; disabled?: boolean };

/** Ark's drop-down: a raised button that opens the Ark menu, in place of the OS select. */
export function Select({ value, options, onChange, label, placeholder, disabled, inset, className = '' }: {
  value: string; options: Option[]; onChange: (value: string) => void; label: string;
  placeholder?: string; disabled?: boolean; inset?: boolean; className?: string;
}) {
  const [at, setAt] = useState<{ x: number; y: number; width: number }>();
  const current = options.find((o) => o.value === value)?.label ?? placeholder ?? '';
  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${current}`}
        aria-haspopup="menu"
        aria-expanded={!!at}
        disabled={disabled}
        className={`${inset ? BUTTON_INSET : BUTTON} min-w-0 justify-between text-meta ${className}`}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.left, y: r.bottom + 4, width: Math.max(160, r.width) }); }}
      >
        <span className="truncate">{current}</span>
        <span aria-hidden className="text-[10px] leading-none">▾</span>
      </button>
      {at && (
        <Menu
          at={at}
          width={at.width}
          label={label}
          onClose={() => setAt(undefined)}
          items={options.map((o) => ({ label: o.label, checked: o.value === value, onClick: o.disabled ? undefined : () => onChange(o.value) }))}
        />
      )}
    </>
  );
}
