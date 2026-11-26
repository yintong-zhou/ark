import type { CSSProperties } from 'react';
import { FACE } from './faces';

/** An agent's face in a circle. Each face blinks on its own rhythm, so a row of them never blinks in unison. */
export function Avatar({ face, size = 40 }: { face: string; size?: number }) {
  const n = Number(face.replace(/\D/g, '')) || 0;
  const rhythm = { '--blink-d': `${5 + (n % 5)}s`, '--blink-w': `${(n * 0.7) % 4}s` } as CSSProperties;
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-raised"
      style={{ width: size, height: size, ...rhythm }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size}>
        {FACE[face]}
      </svg>
    </span>
  );
}
