const PHASE_HEADING = /^(#{1,3})[ \t]+\S+[ \t]+\d+[ \t]*[:.\-–\u2014][ \t]*(.+)$/gm;
/**
 * The plan's phases: each numbered heading at the shallowest level used starts a phase, which runs to the next
 * (or the end); numbered sub-headings (`### Step 1: …`) stay inside their phase.
 */
export function parsePhases(markdown: string): { title: string; text: string; builder?: string }[] {
  const all = [...markdown.matchAll(PHASE_HEADING)];
  const top = Math.min(...all.map((h) => h[1].length)); // a numbered sub-heading may come before Phase 1
  const heads = all.filter((h) => h[1].length === top);
  return heads.map((h, i) => {
    const match = /\s+\(@([a-z0-9_-]{1,64})\)$/.exec(h[2].trim());
    return { title: match ? h[2].trim().slice(0, match.index).trim() : h[2].trim(), text: markdown.slice(h.index, heads[i + 1]?.index ?? markdown.length).trim(), ...(match && { builder: match[1] }) };
  });
}

