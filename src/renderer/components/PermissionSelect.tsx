import { useState } from 'react';
import { PERMISSION_DETAIL, PERMISSION_LABEL, PERMISSION_MODES, type PermissionMode } from '@shared/permissions';
import { AccessIcon, ChevronIcon } from './Icons';
import { Menu } from './Menu';

/**
 * The chosen policy is distinct from the role's ability to write files. Quiet like the composer's other tools; in a
 * narrow composer only the icon shows, and the accessible name still says the mode. `note` is said with the control.
 */
export function PermissionSelect({ value, onChange, disabled = false, readOnly = false, note }: {
  value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean; readOnly?: boolean; note?: string;
}) {
  const [at, setAt] = useState<{ x: number; y: number }>();
  const detail = readOnly ? 'Read-only advisor. Permission policy does not enable editing or shell tools.' : PERMISSION_DETAIL[value];
  return (
    <>
      <button type="button" aria-label={`Permissions: ${PERMISSION_LABEL[value]}`} aria-description={note} aria-haspopup="menu" aria-expanded={!!at}
        disabled={disabled} title={note ? `${detail} ${note}` : detail}
        className="flex h-4 shrink-0 items-center gap-[4px] rounded-sm px-[6px] text-meta text-muted enabled:hover:bg-raised/60 enabled:hover:text-secondary disabled:opacity-40"
        // opens above: the control sits at the bottom of the pane; Menu keeps it on screen
        onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setAt({ x: rect.left, y: rect.top - 4 - PERMISSION_MODES.length * 88 - 16 }); }}>
        <AccessIcon mode={value} />
        <span className="@max-md:hidden">{PERMISSION_LABEL[value]}</span>
        <ChevronIcon />
      </button>
      {at && <Menu at={at} width={340} label="Session permissions" onClose={() => setAt(undefined)} items={PERMISSION_MODES.map((mode) => ({
        label: PERMISSION_LABEL[mode], detail: readOnly ? 'Read-only advisor. Editing and shell tools stay disabled.' : PERMISSION_DETAIL[mode],
        icon: <AccessIcon mode={mode} />, checked: value === mode, onClick: () => onChange(mode),
      }))} />}
    </>
  );
}
