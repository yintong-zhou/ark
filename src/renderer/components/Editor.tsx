import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { editor } from 'monaco-editor';
import { loadMonaco } from '../editor/monaco';
import { close, keep, reload, remember, save, type Doc } from '../editor/tabs-store';
import { BUTTON } from './ui';

/** The editor font, shared with the diff tab. */
export const FONT = { fontFamily: "'Cascadia Mono', Consolas, monospace", fontSize: 13 };

/** What shows instead of a file Monaco won't open; the diff tab uses the same copy. */
export const placeholderText = (p: NonNullable<Doc['placeholder']>): string =>
  p.kind === 'binary' ? 'Binary file, not shown' : `Too large to open here (${(p.size / 1024 / 1024).toFixed(1)} MB)`;

/** One Monaco editor for the project's file tabs: switching tabs swaps the model and restores where the user was. */
export function Editor({ projectId, doc }: { projectId: string; doc: Doc }) {
  const host = useRef<HTMLDivElement>(null);
  const [ed, setEd] = useState<editor.IStandaloneCodeEditor>();
  const current = useRef(doc);
  useEffect(() => {
    current.current = doc;
  });

  // the editor itself: created once per mount, with Ctrl+S and Ctrl+W bound to whichever tab is current
  useEffect(() => {
    let disposed = false;
    let made: editor.IStandaloneCodeEditor | undefined;
    void loadMonaco().then((monaco) => {
      if (disposed || !host.current) return;
      made = monaco.editor.create(host.current, {
        theme: 'ark-dark',
        automaticLayout: true,
        ...FONT,
        minimap: { enabled: true },
        wordWrap: 'off',
        model: null,
      });
      made.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save(current.current.tab.key));
      made.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => close(projectId, current.current.tab.key));
      setEd(made);
    });
    return () => {
      disposed = true;
      if (made) remember(current.current.tab.key, made.saveViewState());
      made?.dispose();
    };
  }, [projectId]);

  // switching tabs: remember where the user was in the old file, restore it in the new one
  const model = doc.model;
  const key = doc.tab.key;
  useEffect(() => {
    if (!ed || !model) return;
    ed.setModel(model);
    if (doc.view) ed.restoreViewState(doc.view);
    ed.focus();
    return () => {
      const v = ed.saveViewState(); // null once the editor is disposed (unmount): keep what was remembered then
      if (v) remember(key, v);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doc.view is read once, on switching in
  }, [ed, model, key]);
  useEffect(() => ed?.updateOptions({ readOnly: doc.tab.readonly }), [ed, doc.tab.readonly]);

  const t = doc.tab;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-3 shrink-0 items-center gap-1 px-2 text-meta text-muted" title={t.rel}>
        <span className="truncate">{t.rel}</span>
        {t.root.kind === 'thread' && <span className="shrink-0">· worktree</span>}
      </div>
      {doc.error && <Bar>{doc.error}</Bar>}
      {t.readonly && <Bar>Not UTF-8: opened read-only so saving can't damage it</Bar>}
      {t.bar === 'changed' && (
        <Bar
          actions={
            <>
              <button onClick={() => void reload(t.key)} className={BUTTON}>Reload</button>
              <button onClick={() => keep(t.key)} className={BUTTON}>Keep mine</button>
            </>
          }
        >
          Changed on disk. Reload drops your edits; Keep mine overwrites it on the next save.
        </Bar>
      )}
      {t.bar === 'deleted' && <Bar>Deleted on disk. Saving will recreate it.</Bar>}
      {doc.placeholder && (
        <p className="flex flex-1 items-center justify-center text-muted">{placeholderText(doc.placeholder)}</p>
      )}
      {/* always mounted, so the one editor outlives a placeholder tab */}
      <div ref={host} className={doc.placeholder ? 'hidden' : 'min-h-0 flex-1'} />
    </div>
  );
}

function Bar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-y border-divider bg-sidebar px-2 py-[4px] text-neutral-light">
      <span className="min-w-0 flex-1">{children}</span>
      {actions}
    </div>
  );
}
