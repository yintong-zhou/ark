import { expect, test } from 'vitest';
import { assignFaces, FACES, HEAD_FACE, nextFace } from '@shared/avatars';

test('there are 24 gallery faces and the head face is not one of them', () => {
  expect(FACES).toHaveLength(24);
  expect(FACES[0]).toBe('face-01');
  expect(FACES[23]).toBe('face-24');
  expect(FACES).not.toContain(HEAD_FACE);
});

test('nextFace is the first unused face', () => {
  expect(nextFace([])).toBe('face-01');
  expect(nextFace(['face-01', 'custom', undefined, 'face-03'])).toBe('face-02');
});

test('when every face is taken the least used one is reused', () => {
  expect(nextFace([...FACES, 'face-01'])).toBe('face-02');
});

test('assignFaces fills the gaps in id order and keeps what is set', () => {
  const out = assignFaces([{ id: 'zed' }, { id: 'amy', avatar: 'face-01' }, { id: 'bob' }]);
  expect(out).toEqual([{ id: 'zed', avatar: 'face-03' }, { id: 'amy', avatar: 'face-01' }, { id: 'bob', avatar: 'face-02' }]);
});

test('30 agents all get a face', () => {
  const agents: { id: string; avatar?: string }[] = Array.from({ length: 30 }, (_, i) => ({ id: `a${String(i).padStart(2, '0')}` }));
  const out = assignFaces(agents);
  expect(out.every((a) => FACES.includes(a.avatar!))).toBe(true);
  expect(new Set(out.slice(0, 24).map((a) => a.avatar)).size).toBe(24);
});
