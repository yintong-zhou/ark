import { expect, test } from 'vitest';
import { HEAD_FACE } from '@shared/avatars';
import { MANAGER } from '@shared/thread';
import { checkHeadSettings, HEAD, headWith } from '../../src/main/services/head-of-staff';

test('the Head of Staff is a read-only built-in with its own face', () => {
  expect(HEAD).toMatchObject({ id: MANAGER, name: 'Head of Staff', permissions: 'read-only', tier: 'light', avatar: HEAD_FACE, engine: { kind: 'auto' } });
  expect(MANAGER).toBe('head-of-staff');
});

test('saved settings change only skills, model and lock', () => {
  const saved = { skills: ['superpowers:brainstorming'], engine: { kind: 'model', engine: 'claude', model: 'sonnet' }, lock: true, prompt: 'hacked', permissions: 'build' };
  expect(headWith(saved)).toEqual({ ...HEAD, skills: ['superpowers:brainstorming'], engine: { kind: 'model', engine: 'claude', model: 'sonnet' }, lock: true });
});

test('missing or invalid settings fall back to the built-in', () => {
  expect(headWith(undefined)).toEqual(HEAD);
  expect(headWith({ skills: 'all', engine: { kind: 'auto' }, lock: false })).toEqual(HEAD);
  expect(() => checkHeadSettings({ skills: ['../x'], engine: { kind: 'auto' }, lock: false })).toThrow('skills');
  expect(() => checkHeadSettings({ skills: [], engine: { kind: 'model', engine: 'claude', model: 'gpt' }, lock: false })).toThrow('engine');
});
