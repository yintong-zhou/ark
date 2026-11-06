/** Usage bar: Raised track, Light neutral fill, and optional ticks (handoff threshold, weekly pace). */
export function Bar({ pct, ticks = [], wide = false, label }: { pct?: number; ticks?: number[]; wide?: boolean; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`relative h-1 shrink-0 rounded-xs bg-raised ${wide ? 'w-13' : 'w-8'}`}
    >
      {pct !== undefined && (
        <div className="h-full rounded-xs bg-neutral-light" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      )}
      {ticks.map((t) => (
        <span key={t} className="absolute -top-[4px] -bottom-[4px] w-[2px] bg-secondary" style={{ left: `calc(${t}% - 1px)` }} />
      ))}
    </div>
  );
}
