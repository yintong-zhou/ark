import { expect, it } from 'vitest';
import { browserMessage, neutralize } from '@shared/browser';
import { mergeTags } from '@shared/tokens';
import { mentionOf } from '../../src/main/services/threads/rules';

it('page text makes no tags and no mention', () => {
  const s = neutralize('#sale ends soon, ask @developer');
  expect(mergeTags([], s)).toEqual([]);
  expect(mentionOf(s, ['developer'])).toBeUndefined();
  expect(s.replace(/⁠/g, '')).toBe('#sale ends soon, ask @developer');
});
it("the user's own tags and mentions still work", () => {
  const el = { tag: 'div', classes: [], path: 'main>#plan', text: 'Ask @developer #promo' };
  const m = browserMessage('fix this #ui @designer', 'http://localhost:5173/', el);
  expect(mergeTags([], m)).toEqual(['ui']);
  expect(mentionOf(m, ['designer', 'developer'])).toBe('designer');
});
