import { useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { touches } from '@shared/editor-tabs';
import { rootKey } from '@shared/files';
import { groups, type ShowResult } from '@shared/git';
import { readable } from '../errors';
import { loadMonaco } from '../editor/monaco';
import { close, type Doc } from '../editor/tabs-store';
import { useGit } from '../git/status-store';
import { FONT, placeholderText } from './Editor';
import { LINK } from './ui';

type Made = { diff: editor.IStandaloneDiffEditor; left: editor.ITextModel; right: editor.ITextModel };

let mounts = 0; // makes each mount's model URIs unique

/** A side's text; a missing side (new or deleted file) is empty. */
const textOf = (r: ShowResult): string => (r.kind === 'text' ? r.text : '');

type Props = { projectId: string; doc: Doc; onOpenFile: () => void };

/** One file's side-by-side diff, read-only (spec §5.2). Changes: index vs working tree; Staged: HEAD vs index. */
export function DiffView({ projectId, doc, onOpenFile }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [made, setMade] = useState<Made>();
  const [problem, setProblem] = useState<string>(); // the last load's placeholder or error, shown instead of the diff
  const [gone, setGone] = useState(false); // the right side is missing: a deleted file has nothing to open
  const [writes, setWrites] = useState(0); // bumps on each disk change to the file, which the status may not show
  const { root, rel, key } = doc.tab;
  const side = doc.diff ?? 'changes';
  const { status, error } = useGit(root, true);
  const entry = status && groups(status.entries)[side].find((e) => e.rel === rel);
  const listed = !!entry;
  const orig = entry?.orig; // a staged rename: HEAD has the file under its old path

  // the diff editor and its two models: made once per mount (Threads keys this view by the tab)
  useEffect(() => {
    let disposed = false;
    let m: Made | undefined;
    const n = ++mounts;
    void loadMonaco().then((monaco) => {
      if (disposed || !host.current) return;
      const diff = monaco.editor.createDiffEditor(host.current, {
        theme: 'ark-dark',
        automaticLayout: true,
        ...FONT,
        readOnly: true,
        originalEditable: false,
        minimap: { enabled: false },
      });
      // the diff editor's own addCommand binds only the right side
      for (const ed of [diff.getOriginalEditor(), diff.getModifiedEditor()]) {
        ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => close(projectId, key));
      }
      // the extension stays last in the path, so the language comes from it
      const model = (s: string) => monaco.editor.createModel('', undefined, monaco.Uri.from({ scheme: 'ark-diff', path: `/${n}/${s}/${rel}` }));
      m = { diff, left: model('left'), right: model('right') };
      diff.setModel({ original: m.left, modified: m.right });
      setMade(m);
    });
    return () => {
      disposed = true;
      m?.diff.dispose();
      m?.left.dispose();
      m?.right.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one file per mount
  }, []);

  // a write to the file (a save, an agent) changes the diff even when its status letter stays the same
  useEffect(
    () => window.ark.files.onChanged((k, rels) => k === rootKey(root) && touches(rels, rel) && setWrites((w) => w + 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- root and rel are fixed per mount
    [],
  );

  // both sides, reloaded whenever the root's status changes or the file is written
  useEffect(() => {
    if (!made || !listed) return; // not in the side's group: `No changes`
    let stale = false;
    const git = window.ark.git;
    const work = (): Promise<ShowResult> =>
      window.ark.files.read(root, rel).then(
        (r) => (r.kind === 'text' ? { kind: 'text', text: r.text } : r),
        () => ({ kind: 'missing' }), // deleted on disk: an empty right side
      );
    const sides = side === 'changes' ? [git.show(root, rel, 'index'), work()] : [git.show(root, orig ?? rel, 'head'), git.show(root, rel, 'index')];
    void Promise.all(sides).then(
      ([a, b]) => {
        if (stale) return;
        setGone(b.kind === 'missing');
        const p = [a, b].find((r): r is Exclude<ShowResult, { kind: 'text' | 'missing' }> => r.kind === 'binary' || r.kind === 'large');
        if (p) return setProblem(placeholderText(p));
        for (const [model, text] of [[made.left, textOf(a)], [made.right, textOf(b)]] as const) {
          if (model.getValue() !== text) model.setValue(text);
        }
        setProblem(undefined);
      },
      (e) => !stale && setProblem(readable(e)),
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- root, rel and side are fixed per mount
  }, [made, status, listed, orig, writes]);

  const note = !status ? error : !listed ? 'No changes' : problem;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-3 shrink-0 items-center gap-1 px-2 text-meta text-muted" title={rel}>
        <span className="truncate">{rel}</span>
        {root.kind === 'thread' && <span className="shrink-0">· worktree</span>}
        {!gone && <button onClick={onOpenFile} className={`${LINK} ml-auto shrink-0`}>Open file</button>}
      </div>
      {note && <p className="flex flex-1 items-center justify-center text-muted">{note}</p>}
      {/* always mounted, so the one diff editor outlives a placeholder */}
      <div ref={host} className={note ? 'hidden' : 'min-h-0 flex-1'} />
    </div>
  );
}
