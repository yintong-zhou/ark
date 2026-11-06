import { expect, test } from 'vitest';
import { ATTACH_MAX_FILES, IMAGE_MAX_BYTES, TEXT_MAX_BYTES, checkUploads, formatSize, kindOf } from '@shared/attachments';
import { MAX_TAGS, activeToken, mergeTags, tokenize } from '@shared/tokens';

test('tokenize cuts @mentions and #tags and leaves e-mails, numbers and mid-word marks alone', () => {
  expect(tokenize('ask @seo about #Landing-page, not a@b.it or issue #12 or c#sharp')).toEqual([
    { kind: 'text', text: 'ask ' },
    { kind: 'mention', id: 'seo', text: '@seo' },
    { kind: 'text', text: ' about ' },
    { kind: 'tag', tag: 'landing-page', text: '#Landing-page' },
    { kind: 'text', text: ', not a@b.it or issue #12 or c#sharp' },
  ]);
  expect(tokenize('')).toEqual([]);
  expect(tokenize('#bug')).toEqual([{ kind: 'tag', tag: 'bug', text: '#bug' }]);
});

test('mergeTags keeps old tags first, drops repeats and stops at the limit', () => {
  expect(mergeTags(undefined, 'no tags here')).toEqual([]);
  expect(mergeTags(['ui'], '#bug and #UI and #bug')).toEqual(['ui', 'bug']);
  const many = Array.from({ length: MAX_TAGS + 3 }, (_, i) => `#t${String.fromCharCode(97 + i)}`).join(' ');
  expect(mergeTags(undefined, many)).toHaveLength(MAX_TAGS);
});

test('activeToken finds the @ or # the caret is in', () => {
  expect(activeToken('hi @pl', 6)).toEqual({ trigger: '@', query: 'pl', start: 3 });
  expect(activeToken('hi #', 4)).toEqual({ trigger: '#', query: '', start: 3 });
  expect(activeToken('#bu and more', 3)).toEqual({ trigger: '#', query: 'bu', start: 0 });
  expect(activeToken('mail a@b', 8)).toBeUndefined(); // not after whitespace
  expect(activeToken('hi @pl there', 12)).toBeUndefined(); // caret already past it
  expect(activeToken('plain', 5)).toBeUndefined();
});

test('kindOf goes by extension, case-insensitively, and refuses the rest', () => {
  expect(kindOf('shot.PNG')).toEqual({ kind: 'image', mime: 'image/png' });
  expect(kindOf('a.jpeg')?.mime).toBe('image/jpeg');
  expect(kindOf('notes.md')).toEqual({ kind: 'text', mime: 'text/plain' });
  expect(kindOf('main.tsx')?.kind).toBe('text');
  for (const bad of ['setup.exe', 'archive.zip', '.env', 'noext', 'doc.pdf']) expect(kindOf(bad)).toBeUndefined();
});

test('checkUploads says why a set of files is refused', () => {
  const ok = { name: 'a.png', size: 1000 };
  expect(checkUploads([ok, { name: 'b.ts', size: 10 }])).toBeUndefined();
  expect(checkUploads(Array(ATTACH_MAX_FILES + 1).fill(ok))).toContain(`up to ${ATTACH_MAX_FILES}`);
  expect(checkUploads([{ name: 'x.zip', size: 1 }])).toContain("x.zip isn't supported");
  expect(checkUploads([{ name: 'big.png', size: IMAGE_MAX_BYTES + 1 }])).toContain('too large');
  expect(checkUploads([{ name: 'big.txt', size: TEXT_MAX_BYTES + 1 }])).toContain('too large');
  expect(checkUploads([{ name: 'edge.png', size: IMAGE_MAX_BYTES }])).toBeUndefined();
});

test('formatSize', () => {
  expect([formatSize(12), formatSize(2048), formatSize(3 * 1024 * 1024)]).toEqual(['12 B', '2 KB', '3.0 MB']);
});
