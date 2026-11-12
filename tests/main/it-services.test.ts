import { expect, test } from 'vitest';
import { validateAgent } from '@shared/agent-file';
import { checkProposal } from '@shared/roles';
import { IT_SERVICES_AGENTS } from '../../src/main/services/it-services';

const get = (id: string) => IT_SERVICES_AGENTS.find((a) => a.id === id);

test('14 valid profiles, each with alias, role and its own face', () => {
  expect(IT_SERVICES_AGENTS).toHaveLength(14);
  for (const a of IT_SERVICES_AGENTS) {
    expect(validateAgent(a), a.id).toMatchObject({ ok: true });
    expect(a.name).toBe(`${a.alias} - ${a.role}`);
  }
  expect(new Set(IT_SERVICES_AGENTS.map((a) => a.avatar)).size).toBe(14);
});

test('the three developers build, everyone else advises', () => {
  expect(IT_SERVICES_AGENTS.filter((a) => a.permissions === 'build').map((a) => a.id).sort()).toEqual(['backend_dev', 'frontend_dev', 'mobile_dev']);
});

test('the team covers a whole thread by itself', () => {
  const picks = ['dev_manager', 'backend_dev', 'frontend_dev', 'tech_lead', 'security'].map((agent) => ({ agent, reason: 'r' }));
  const roles = { planner: 'dev_manager', builders: ['backend_dev', 'frontend_dev'], codeReview: 'tech_lead', securityReview: 'security' };
  expect(checkProposal({ kind: 'team', picks, leftOut: '', difficulty: 'hard', roles }, get)).toBeUndefined();
});

test('no profile mentions the roles Ark no longer has', () => {
  for (const a of IT_SERVICES_AGENTS) {
    expect(`${a.description}\n${a.prompt}`, a.id).not.toMatch(/build developer|Ark's developer|project-manager|Ark's project manager|the coordinator/i);
  }
  expect(get('tech_lead')!.description).toContain('review the code of every build phase');
  expect(get('security')!.description).toContain('review every build phase for security problems');
});
