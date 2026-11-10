import { Fragment, useMemo, type ReactNode } from 'react';
import { lexer, type Token, type Tokens } from 'marked';

// Agent replies are Markdown. marked only parses here: its tokens become React elements, so no HTML string from an
// agent ever reaches the DOM (no innerHTML, raw HTML shows as text). Plain text runs go through `leaf`, which the
// thread uses to draw @mentions and #tags. Links are not followed: the window never navigates, the URL is the tooltip.

type Leaf = (text: string) => ReactNode;

/** marked escapes inline text and code spans for its own HTML output; React escapes again, so undo it. */
const unescape = (s: string) =>
  s.replace(/&(lt|gt|quot|#39|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[e]!);

function inline(tokens: Token[] | undefined, leaf: Leaf): ReactNode {
  return tokens?.map((t, i) => <Fragment key={i}>{inlineOne(t, leaf)}</Fragment>);
}

function inlineOne(t: Token, leaf: Leaf): ReactNode {
  switch (t.type) {
    case 'strong': return <strong className="font-semibold text-secondary">{inline(t.tokens, leaf)}</strong>;
    case 'em': return <em>{inline(t.tokens, leaf)}</em>;
    case 'del': return <del>{inline(t.tokens, leaf)}</del>;
    case 'codespan': return <code className="rounded-xs bg-raised px-[4px] font-mono text-[0.9em]">{unescape(t.text)}</code>;
    case 'br': return <br />;
    case 'link': return <span title={t.href} className="text-accent underline underline-offset-2">{inline(t.tokens, leaf)}</span>;
    case 'image': return <span title={t.href}>[{t.text}]</span>;
    case 'text':
    case 'escape':
      return 'tokens' in t && t.tokens ? inline(t.tokens, leaf) : leaf(unescape(t.text));
    default: return leaf('raw' in t ? t.raw : '');
  }
}

function blocks(tokens: Token[], leaf: Leaf): ReactNode {
  return tokens.map((t, i) => <Fragment key={i}>{block(t, leaf)}</Fragment>);
}

const HEADING = ['text-[18px]', 'text-[16px]', 'text-[15px]'];

function block(t: Token, leaf: Leaf): ReactNode {
  switch (t.type) {
    case 'space': return null;
    case 'heading': {
      const H = `h${Math.min(t.depth + 2, 6)}` as 'h3';
      return <H className={`head mt-2 first:mt-0 ${HEADING[t.depth - 1] ?? ''}`}>{inline(t.tokens, leaf)}</H>;
    }
    case 'paragraph': return <p className="my-1 first:mt-0 last:mb-0">{inline(t.tokens, leaf)}</p>;
    case 'text': return <span>{'tokens' in t && t.tokens ? inline(t.tokens, leaf) : leaf(unescape(t.text))}</span>;
    case 'list': {
      const L = t.ordered ? 'ol' : 'ul';
      return (
        <L start={t.ordered && t.start !== 1 ? (t.start as number) : undefined} className={`my-1 pl-3 ${t.ordered ? 'list-decimal' : 'list-disc'}`}>
          {(t as Tokens.List).items.map((item, i) => (
            <li key={i} className={item.task ? 'list-none' : undefined}>
              {item.task && <input type="checkbox" checked={!!item.checked} disabled aria-label={item.checked ? 'Done' : 'Not done'} className="mr-[6px] -ml-3 align-middle" />}
              {blocks(item.tokens.filter((x) => x.type !== 'checkbox'), leaf)}
            </li>
          ))}
        </L>
      );
    }
    case 'code':
      return (
        <pre className="my-1 overflow-x-auto rounded-sm bg-primary p-1 font-mono text-[13px] leading-[20px]" aria-label={t.lang ? `${t.lang} code` : 'Code'}>
          <code>{t.text}</code>
        </pre>
      );
    case 'blockquote': return <blockquote className="my-1 border-l-2 border-raised pl-2 text-muted">{blocks(t.tokens ?? [], leaf)}</blockquote>;
    case 'hr': return <hr className="my-2 border-divider" />;
    case 'table': {
      const tb = t as Tokens.Table;
      const cell = 'border border-divider px-1 py-[2px] text-left';
      return (
        <div className="my-1 overflow-x-auto">
          <table className="border-collapse">
            <thead><tr>{tb.header.map((h, i) => <th key={i} className={`${cell} head`}>{inline(h.tokens, leaf)}</th>)}</tr></thead>
            <tbody>{tb.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cell}>{inline(c.tokens, leaf)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    default: return <p className="my-1 whitespace-pre-wrap">{leaf('raw' in t ? t.raw : '')}</p>;
  }
}

/** Markdown text as formatted blocks. Single newlines stay line breaks, as in a chat. */
export function Markdown({ text, leaf = (s) => s, className = '' }: { text: string; leaf?: Leaf; className?: string }) {
  const tokens = useMemo(() => lexer(text, { gfm: true, breaks: true }), [text]);
  return <div className={`break-words ${className}`}>{blocks(tokens, leaf)}</div>;
}
