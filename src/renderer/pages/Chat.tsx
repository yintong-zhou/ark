import { useEffect, useRef, useState } from 'react';
import { documentLink } from '@shared/document-link';
import type { ChatEntry } from '@shared/chat-log';
import type { AgentDef } from '@shared/agent-file';
import { AgentAvatar, Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { shortModel } from '../components/glyphs';
import { ModelMark } from '../components/Logos';
import { Markdown } from '../components/Markdown';
import { PaneHeader, Page } from '../components/Page';
import { TokenLine } from '../components/TokenLine';
import { BUTTON, CTA } from '../components/ui';
import { readable } from '../errors';
import { useChat } from '../hooks/useChat';
import { PermissionSelect } from '../components/PermissionSelect';
import type { PermissionMode } from '@shared/permissions';

/** Chat with one catalog agent, in a project folder the user picks. */
export function Chat({ agentId }: { agentId: string }) {
  const { started, starting, state, start, send } = useChat();
  const [agent, setAgent] = useState<AgentDef>();
  const [folder, setFolder] = useState<string | null>(null);
  const [problem, setProblem] = useState<string>();
  const [text, setText] = useState('');
  const [document, setDocument] = useState<{ name: string; text: string }>();
  const [mode, setMode] = useState<PermissionMode>('ask');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.ark.catalog.list().then((c) => setAgent(c.agents.find((a) => a.id === agentId)), () => {});
  }, [agentId]);
  const agentName = agent?.name ?? agentId;
  // keep the latest reply and the composer in view
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [state.entries]);

  const choose = async () => {
    try {
      const picked = await window.ark.chat.pickFolder();
      if (picked) setFolder(picked);
    } catch (e) {
      setProblem(readable(e));
    }
  };
  const begin = async () => {
    if (!folder) return;
    try {
      setProblem(undefined);
      await start(agentId, folder, mode);
    } catch (e) {
      setProblem(readable(e));
    }
  };
  const submit = () => {
    const t = text.trim();
    if (!t || state.busy || state.ended) return;
    setText('');
    void send(t);
  };

  if (!started) {
    return (
      <Page title={`Chat with ${agentName}`} meta={['A private chat in the folder you pick']} narrow>
        <section className="flex flex-col gap-1">
          <span className="text-meta text-muted">Project folder</span>
          <div className="flex items-center gap-2">
            <button onClick={choose} className={BUTTON}>Choose folder</button>
            {folder && <span className="min-w-0 break-all">{folder}</span>}
          </div>
        </section>
        <div className="flex items-center gap-1">
          <PermissionSelect value={mode} onChange={setMode} disabled={starting} readOnly />
          <span className="text-meta text-muted">Read-only advisor</span>
        </div>
        <div>
          <button onClick={begin} disabled={!folder || starting} className={CTA}>Start chat</button>
        </div>
        {problem && <p role="alert" className="text-muted">{problem}</p>}
      </Page>
    );
  }

  const openLink = async (href: string) => {
    if (!folder) return;
    const root = { kind: 'project' as const, id: started.chatId };
    const target = documentLink(href, [{ dir: folder, root }], root);
    if (!target) {
      setProblem('Cannot open this link: it does not name a document inside this folder.');
      return;
    }
    try {
      const result = await window.ark.chat.readFile(started.chatId, target.rel);
      setDocument({ name: target.rel, text: result.kind === 'text' ? result.text : result.kind === 'binary' ? 'This file is binary.' : 'This file is too large to display.' });
      setProblem(undefined);
    } catch (e) { setProblem(readable(e)); }
  };

  return (
    <>
      <PaneHeader title={agentName} meta={[started.model, 'Read-only advisor', folder ?? ''].filter(Boolean)} />
      {problem && <p role="alert" className="px-3 text-muted">{problem}</p>}
      {document ? <div className="min-h-0 flex-1 overflow-auto p-3"><button className={BUTTON} onClick={() => setDocument(undefined)}>Back to chat</button><h2 className="head my-1">{document.name}</h2><pre className="whitespace-pre-wrap break-words">{document.text}</pre></div> : <div className="min-h-0 flex-1 overflow-y-auto">
        <ol className="flex max-w-[960px] flex-col pb-2">
          {state.entries.map((e, i) => (
            <Entry key={i} e={e} agentName={agentName} agent={agent} onLink={(href) => void openLink(href)} />
          ))}
        </ol>
        <div ref={end} />
      </div>}
      <div className="px-2 pb-0.5 lg:px-3"><PermissionSelect value={mode} onChange={setMode} disabled readOnly /></div>
      <Composer
        label={`Message ${agentName}`}
        placeholder={`Message ${agentName}`}
        value={text}
        onChange={setText}
        onSubmit={async () => {
          submit();
          return true;
        }}
        disabled={state.busy || state.ended}
      />
    </>
  );
}

function Entry({ e, agentName, agent, onLink }: { e: ChatEntry; agentName: string; agent?: AgentDef; onLink: (href: string) => void }) {
  if (e.role === 'error') {
    return <li role="alert" className="mt-2 whitespace-pre-wrap break-words pl-[80px] pr-3 text-meta text-muted">{e.text}</li>;
  }
  const you = e.role === 'user';
  const author = you ? 'You' : agentName;
  return (
    <li className="mt-2 flex gap-2 px-3 hover:bg-raised/30">
      {you ? <Avatar text="You" you /> : <AgentAvatar agent={agent} name={author} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className="head">{author}</span>
          {e.model && (
            <span className="inline-flex items-center gap-[4px] rounded-full bg-raised px-1 text-meta text-muted" title={e.model}>
              <ModelMark model={e.model} />
              {shortModel(e.model)}
            </span>
          )}
        </div>
        {e.text && (you ? <p className="whitespace-pre-wrap break-words">{e.text}</p> : <Markdown text={e.text} onLink={onLink} />)}
        {e.tokens && <TokenLine tokens={e.tokens} />}
      </div>
    </li>
  );
}
