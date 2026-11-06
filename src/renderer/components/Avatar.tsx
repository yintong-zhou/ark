const SIZE = {
  24: 'size-3 text-meta',
  32: 'size-4 text-meta',
  40: 'size-5 text-body',
} as const;

/** Two letters for an avatar: the first letters of two words, or the first two letters of one. */
export const initials = (name: string): string => {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
};

/**
 * The only round, image-like element. Agents are Raised with Secondary letters; the person at the
 * keyboard is inverted (Light neutral with Primary letters), so the two never need a hue to differ.
 * `inset` is for an avatar that sits on a Raised card.
 */
export function Avatar({ text, size = 40, you = false, inset = false, title }: { text: string; size?: keyof typeof SIZE; you?: boolean; inset?: boolean; title?: string }) {
  return (
    <span
      title={title}
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-heading font-semibold ${SIZE[size]} ${
        you ? 'bg-neutral-light text-primary' : `${inset ? 'bg-primary' : 'bg-raised'} text-secondary`
      }`}
    >
      {text}
    </span>
  );
}
