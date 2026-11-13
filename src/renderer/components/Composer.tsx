import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ACCEPT, checkUploads } from '@shared/attachments';
import { activeToken } from '@shared/tokens';
import { Staged } from './Attachments';
import { AgentAvatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';
import { PaperclipIcon, SendIcon } from './Icons';
import { CTA, CTA_ICON, ICON_BUTTON } from './ui';

type Option = { key: string; insert: string; lead: ReactNode; label: string; hint?: string };

/**
 * The bar under a conversation: attach, emoji, the text, Send (the only Accent element). Enter sends,
 * Shift+Enter breaks the line. Typing @ offers the agents, typing # offers the tags (and a new one).
 * Files come from the paperclip, a drop or a paste, and wait here until the message goes.
 */
export function Composer({ label, placeholder, value, onChange, onSubmit, disabled = false, submitLabel = 'Send', attach = false, mentions = [], tags, tools, extra, problem }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  /** Sends the text and the waiting files. Resolves true when it went through, so the files can be cleared. */
  onSubmit: (files: File[]) => Promise<boolean>;
  disabled?: boolean; submitLabel?: string; attach?: boolean;
  mentions?: { id: string; name: string; avatar?: string }[];
  /** Tags already on the project's threads; leave undefined where # means nothing. */
  tags?: string[];
  /** Controls after attach and emoji, such as the access mode. */
  tools?: ReactNode;
  extra?: ReactNode; problem?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState<string>();
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closedAt, setClosedAt] = useState<number>();
  const [over, setOver] = useState(false);
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const listId = useId();

  // grow with the text, up to 160px
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const token = activeToken(value, caret);
  const options: Option[] = token && token.start !== closedAt ? suggest(token.trigger, token.query.toLowerCase(), mentions, tags) : [];
  const sel = Math.min(pick, options.length - 1);
  const canSend = !disabled && !sending && (value.trim() !== '' || files.length > 0);

  const insertAt = (start: number, end: number, text: string) => {
    onChange(value.slice(0, start) + text + value.slice(end));
    const pos = start + text.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };
  const add = (list: File[]) => {
    const next = [...files, ...list];
    const refused = checkUploads(next.map((f) => ({ name: f.name, size: f.size })));
    setNote(refused);
    if (!refused) setFiles(next);
  };
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setNote(undefined);
    try {
      if (await onSubmit(files)) setFiles([]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative shrink-0 px-2 pb-2 pt-1.5 lg:px-3 lg:pb-3">
      {options.length > 0 && token && (
        <ul id={listId} role="listbox" aria-label={token.trigger === '@' ? 'Agents' : 'Tags'} className="surface-floating absolute bottom-full left-2 z-10 mb-1 w-[min(280px,calc(100%-32px))] rounded-md bg-sidebar p-0.5 lg:left-3">
          {options.map((o, i) => (
            <li key={o.key} role="option" aria-selected={i === sel}>
              <button
                type="button"
                // mousedown, not click: the text field must keep the focus
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertAt(token.start, caret, o.insert);
                }}
                className={`flex h-4 w-full items-center gap-1 rounded-xs px-1 text-left ${i === sel ? 'bg-primary text-secondary' : 'text-neutral-light hover:bg-primary/60'}`}
              >
                <span className="flex w-3 shrink-0 justify-center">{o.lead}</span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-meta text-muted">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(problem ?? note) && <p role="alert" className="pb-1 text-meta text-muted">{problem ?? note}</p>}
      <div
        onDragOver={(e) => {
          if (!attach || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!attach) return;
          e.preventDefault();
          setOver(false);
          add([...e.dataTransfer.files]);
        }}
        className={`composer-surface @container flex flex-col rounded-lg border bg-sidebar ${over ? 'border-muted' : 'border-neutral-light/15 focus-within:border-neutral-light/40'}`}
      >
        {files.length > 0 && <Staged files={files} onRemove={(f) => setFiles(files.filter((x) => x !== f))} />}
        {/* a narrow composer gives the text its own line above the tools */}
        <div className="flex items-end gap-0.5 p-1 @max-sm:flex-wrap">
          {attach && (
            <>
              <button type="button" onClick={() => picker.current?.click()} aria-label="Attach files or images" title="Attach files or images" className={ICON_BUTTON}>
                <PaperclipIcon />
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                accept={ACCEPT}
                onChange={(e) => {
                  add([...(e.target.files ?? [])]);
                  e.target.value = ''; // the same file can be picked again
                }}
              />
            </>
          )}
          <EmojiPicker
            onPick={(emoji) => {
              const el = area.current;
              insertAt(el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, emoji);
            }}
          />
          {tools}
          <textarea
            ref={area}
            aria-label={label}
            aria-autocomplete="list"
            aria-controls={options.length ? listId : undefined}
            placeholder={placeholder}
            value={value}
            rows={1}
            onChange={(e) => {
              onChange(e.target.value);
              setCaret(e.target.selectionStart);
              setPick(0);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              if (!attach || e.clipboardData.files.length === 0) return;
              e.preventDefault();
              add([...e.clipboardData.files]);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (options.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPick((sel + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                  return;
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && token) {
                  e.preventDefault();
                  insertAt(token.start, caret, options[sel].insert);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setClosedAt(token?.start);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="min-h-4 min-w-0 flex-1 resize-none @max-sm:order-first @max-sm:basis-full bg-transparent px-1 py-[5px] text-body text-neutral-light placeholder:text-muted focus-visible:outline-hidden"
          />
          {extra}
          <button onClick={() => void submit()} disabled={!canSend} aria-label={submitLabel} title={submitLabel} className={submitLabel === 'Send' ? CTA_ICON : CTA}>
            <SendIcon />
            {submitLabel !== 'Send' && submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What typing @ or # offers: the agents that match, or the project's tags that match plus the one being typed. */
function suggest(trigger: '@' | '#', q: string, mentions: { id: string; name: string; avatar?: string }[], tags: string[] | undefined): Option[] {
  if (trigger === '@') {
    return mentions
      .filter((m) => m.id.includes(q) || m.name.toLowerCase().includes(q))
      .map((m) => ({ key: m.id, insert: `@${m.id} `, lead: <AgentAvatar agent={m} name={m.name} size={24} />, label: m.name }));
  }
  if (!tags) return [];
  const known: Option[] = tags.filter((t) => t.startsWith(q)).map((t) => ({ key: t, insert: `#${t} `, lead: <span aria-hidden>🏷️</span>, label: `#${t}` }));
  const fresh: Option[] = q && /^\p{L}/u.test(q) && !tags.includes(q) ? [{ key: `new:${q}`, insert: `#${q} `, lead: <span aria-hidden>✨</span>, label: `#${q}`, hint: 'New tag' }] : [];
  return [...known, ...fresh];
}
