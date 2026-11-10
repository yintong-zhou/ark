// Compact 32px controls share a 6px radius and 12px horizontal inset.
const CONTROL = 'control-raised inline-flex h-4 shrink-0 items-center justify-center gap-1 rounded-sm px-1.5 text-body disabled:opacity-60';

/** The call to action of a screen or card. */
export const CTA = `${CONTROL} bg-accent text-primary enabled:hover:brightness-110`;
/** Any other action, on a Content or Sidebar surface. */
export const BUTTON = `${CONTROL} bg-raised text-secondary enabled:hover:brightness-125`;
/** Any other action, inside a Raised card (a Raised button would vanish there). */
export const BUTTON_INSET = `${CONTROL} bg-primary text-secondary enabled:hover:brightness-125`;
/** A quiet text action. */
export const LINK = 'rounded-xs text-muted hover:text-secondary';

/** A text field on a Content surface: FIELD for several lines, INPUT for one line or a select. */
const FIELD_LOOK = 'control-inset min-w-0 rounded-sm border border-neutral-light/15 bg-content px-1.5 text-body text-neutral-light placeholder:text-muted focus-visible:border-neutral-light/40';
export const FIELD = `${FIELD_LOOK} py-1`;
export const INPUT = `${FIELD_LOOK} h-4`;
/** A field inside a Raised card. */
export const FIELD_INSET = 'control-inset h-4 min-w-0 rounded-sm border border-neutral-light/15 bg-primary px-1.5 text-body text-neutral-light';

export const MUTED = 'text-muted';

/** A 32px square action with only an icon: muted until pointed at. */
export const ICON_BUTTON = 'flex size-4 shrink-0 items-center justify-center rounded-sm text-muted enabled:hover:bg-raised/60 enabled:hover:text-secondary disabled:opacity-40';
/** The call to action as an icon alone (Send). */
export const CTA_ICON = 'control-raised flex size-4 shrink-0 items-center justify-center rounded-sm bg-accent text-primary enabled:hover:brightness-110 disabled:opacity-60';
