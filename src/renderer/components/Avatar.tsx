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
import { useEffect, useState, type CSSProperties } from 'react';
import type { AgentDef } from '@shared/agent-file';
import type { ImageInput } from '@shared/attachments';
import { FACE } from './faces';


const images = new Map<string, Promise<ImageInput | null>>();

export function forgetImage(id: string): void {
  images.delete(id);
}

export function AgentAvatar({ agent, name, size = 40, inset = false, title }: { agent?: Pick<AgentDef, 'id' | 'avatar'>; name: string; size?: 24 | 32 | 40; inset?: boolean; title?: string }) {
  const [loaded, setLoaded] = useState<{ id: string; image: ImageInput | null }>();
  const id = agent?.id;
  const avatar = agent?.avatar;
  useEffect(() => {
    if (!id || avatar !== 'custom') return;
    let active = true;
    let image = images.get(id);
    if (!image) {
      image = window.ark.catalog.image(id).catch(() => null);
      images.set(id, image);
    }
    void image.then((value) => { if (active) setLoaded({ id, image: value }); });
    return () => { active = false; };
  }, [id, avatar]);
  const picture = avatar === 'custom' && loaded && loaded.id === id ? loaded.image : null;
  if (picture) return <span title={title} aria-hidden className={`inline-flex shrink-0 overflow-hidden rounded-full ${SIZE[size]}`}><img className="h-full w-full object-cover" src={`data:${picture.mime};base64,${picture.data}`} alt="" /></span>;
  if (avatar && FACE[avatar]) {
    // each agent blinks on its own rhythm: 4.5-7.5s apart, out of step with the others
    const h = [...(id ?? avatar)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const rhythm = { '--blink-d': `${4.5 + (h % 30) / 10}s`, '--blink-w': `-${((h >> 5) % 60) / 10}s` } as CSSProperties;
    return <span title={title} aria-hidden className={`inline-flex shrink-0 overflow-hidden rounded-full ${SIZE[size]} ${inset ? 'bg-primary' : 'bg-raised'}`}><svg viewBox="0 0 40 40" style={rhythm} className="h-full w-full">{FACE[avatar]}</svg></span>;
  }
  return <Avatar text={initials(name)} size={size} inset={inset} title={title} />;
}
