import { joinRel, type DirListing } from '@shared/files';
import { gitNow, queued } from '../git/run';

/** Git applies its own nested rules and excludes. NUL framing keeps every filename literal. */
export async function markIgnored(root: string, rel: string, listing: DirListing): Promise<DirListing> {
  if (!listing.entries.length) return listing;
  const paths = listing.entries.map((e) => './' + joinRel(rel, e.name) + (e.kind === 'dir' ? '/' : ''));
  try {
    // check-ignore takes literal filenames, not pathspecs, and rejects GIT_LITERAL_PATHSPECS=1.
    // './' also prevents a filename beginning with ':' from being parsed as pathspec magic.
    const output = await queued(root, () => gitNow(root, ['check-ignore', '-z', '--stdin'], {
      input: paths.join('\0') + '\0', env: { GIT_LITERAL_PATHSPECS: '0' },
    }));
    const ignored = new Set(output.split('\0').filter(Boolean));
    return { ...listing, entries: listing.entries.map((e, i) => ignored.has(paths[i]) ? { ...e, ignored: true } : e) };
  } catch {
    // Exit 1 means no match; a non-repository or a failed Git inspection must not hide the files.
    return listing;
  }
}
