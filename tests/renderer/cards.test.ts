import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { PhaseCard, PlanCard } from '../../src/renderer/components/Cards';

const name = (id: string) => ({ dev: 'Forge', ui: 'Gon', rev: 'Orion' })[id] ?? id;
const plan = '## Phase 1: API (@dev)\na\n## Phase 2: UI (@ui)\nb\n## Phase 3: Docs\nc';

test('the plan card says who builds each phase and who reviews', () => {
  const html = renderToStaticMarkup(createElement(PlanCard, { text: plan, active: true, pending: false, start: () => {}, name, roles: { builders: ['dev', 'ui'], codeReview: 'rev' } }));
  expect(html).toContain('Builds: Phase 1 - Forge, Phase 2 - Gon, Phase 3 - Forge');
  expect(html).toContain('Code review: Orion');
  expect(html).toContain('Security review: none');
  expect(html).toContain('Start build');
});

test('the phase card names the builder and marks a review that will not run', () => {
  const phase = { title: 'API', text: '', step: 'develop' as const, rounds: 0, notes: 0, open: 0 };
  const html = renderToStaticMarkup(createElement(PhaseCard, { phase, index: 0, total: 1, builder: 'Forge', reviews: { code: true, security: false } }));
  expect(html).toContain('development - Forge');
  expect(html).toContain('security - skipped');
  expect(html).not.toContain('review - skipped');
});
