import type { RootRef } from './files';

type Root = { dir: string; root: RootRef };
type Target = { root: RootRef; rel: string };

export const threadDocumentRoots = (project: Root, worktree?: Root): Root[] => worktree ? [worktree, project] : [project];

/** Map a Markdown destination to a known folder; the main process still validates every file read. */
function parseDocumentLink(href: string, roots: Root[], selected: RootRef): (Target & { explicit: boolean }) | null {
  let path = href.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { return null; }
  path = path.replace(/:[1-9]\d*(?::[1-9]\d*)?$/, '');
  if (/^file:\/\//i.test(path)) {
    if (!/^file:\/\/\/(?:[a-z]:\/|[^/])/i.test(path)) return null;
    path = path.slice(7);
    if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  path = path.replace(/\\/g, '/');
  if (!path || path.startsWith('//') || path.includes('\0')) return null;
  let root = selected;
  const explicit = path.startsWith('/') || /^[a-z]:\//i.test(path);
  if (explicit) {
    const match = [...roots].sort((a, b) => b.dir.length - a.dir.length).find(({ dir }) => {
      const base = dir.replace(/\\/g, '/').replace(/\/+$/, '');
      return path.toLowerCase().startsWith(`${base.toLowerCase()}/`);
    });
    if (!match) return null;
    path = path.slice(match.dir.replace(/\\/g, '/').replace(/\/+$/, '').length + 1);
    root = match.root;
  }
  const parts = path.split('/');
  if (parts.includes('..') || parts.some((p) => p.includes(':'))) return null;
  const rel = parts.filter((p) => p && p !== '.').join('/');
  return rel ? { root, rel, explicit } : null;
}

export function documentLink(href: string, roots: Root[], selected: RootRef): Target | null {
  const target = parseDocumentLink(href, roots, selected);
  return target && { root: target.root, rel: target.rel };
}

/** For relative links, prefer the first folder containing the file; explicit paths never fall back. */
export async function findDocumentLink(href: string, roots: Root[], exists: (root: RootRef, rel: string) => Promise<boolean>): Promise<Target> {
  const target = roots[0] && parseDocumentLink(href, roots, roots[0].root);
  if (!target) throw new Error('Cannot open this link: it does not name a document inside this project.');
  if (!target.explicit) {
    for (const { root } of roots) {
      if (await exists(root, target.rel)) return { root, rel: target.rel };
    }
  }
  return { root: target.explicit ? target.root : roots[roots.length - 1].root, rel: target.rel };
}
