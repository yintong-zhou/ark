import { useState } from 'react';
import { PERMISSION_DETAIL, PERMISSION_LABEL, PERMISSION_MODES, type PermissionMode } from '@shared/permissions';
import { Menu } from './Menu';
import { BUTTON } from './ui';

/** The chosen policy is distinct from the role's ability to write files. */
export function PermissionSelect({ value, onChange, disabled = false, readOnly = false }: {
  value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean; readOnly?: boolean;
}) {
  const [at, setAt] = useState<{ x: number; y: number }>();
  return (
    <>
      <button type="button" aria-label={`Permissions: ${PERMISSION_LABEL[value]}`} aria-haspopup="menu" aria-expanded={!!at}
        disabled={disabled} title={readOnly ? 'Read-only advisor. Permission policy does not enable editing or shell tools.' : PERMISSION_DETAIL[value]}
        className={`${BUTTON} text-meta`}
        onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setAt({ x: rect.left, y: rect.bottom + 4 }); }}>
        {PERMISSION_LABEL[value]} <span aria-hidden>▾</span>
      </button>
      {at && <Menu at={at} width={340} label="Session permissions" onClose={() => setAt(undefined)} items={PERMISSION_MODES.map((mode) => ({
        label: PERMISSION_LABEL[mode], detail: readOnly ? 'Read-only advisor. Editing and shell tools stay disabled.' : PERMISSION_DETAIL[mode],
        checked: value === mode, onClick: () => onChange(mode),
      }))} />}
    </>
  );
}
