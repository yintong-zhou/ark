import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { FACES, HEAD_FACE } from '@shared/avatars';
import { FACE } from '../../src/renderer/components/faces';

const svg = (id: string) => renderToStaticMarkup(createElement('svg', { viewBox: '0 0 40 40' }, FACE[id]));

test('every face id has a drawing and no two drawings are the same', () => {
  const ids = [...FACES, HEAD_FACE];
  expect(Object.keys(FACE).sort()).toEqual([...ids].sort());
  expect(new Set(ids.map(svg)).size).toBe(ids.length);
});

test('faces use only the brand neutrals, never the accent', () => {
  const allowed = new Set(['#0e1013', '#fafaf9', '#2c2f36', '#dee1e6']);
  for (const id of Object.keys(FACE)) {
    for (const hex of svg(id).match(/#[0-9a-f]{3,8}\b/gi) ?? []) expect(allowed, `${id} uses ${hex}`).toContain(hex.toLowerCase());
  }
});
