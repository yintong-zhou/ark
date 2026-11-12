import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { Avatars, checkImage, IMAGE_MAX, imageOf } from '../../src/main/services/avatars';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = Buffer.from('GIF89a..');
const input = (mime: string, b: Buffer) => ({ mime, data: b.toString('base64') });

let dir: string;
let avatars: Avatars;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ark-avatars-'));
  avatars = new Avatars(dir);
  return () => rmSync(dir, { recursive: true, force: true });
});

test('an image round-trips and a new one replaces the old extension', () => {
  avatars.write('forge', input('image/png', PNG));
  expect(avatars.read('forge')).toEqual(input('image/png', PNG));
  avatars.write('forge', input('image/jpeg', JPEG));
  expect(readdirSync(dir)).toEqual(['forge.jpg']);
  avatars.remove('forge');
  expect(avatars.read('forge')).toBeNull();
});

test('refuses what is not a small PNG, JPEG or WebP', () => {
  expect(() => checkImage(input('image/png', GIF))).toThrow('Use a PNG, JPEG or WebP image');
  expect(() => checkImage(input('image/gif', GIF))).toThrow('Use a PNG, JPEG or WebP image');
  expect(() => checkImage({ mime: 'image/png' })).toThrow('Use a PNG, JPEG or WebP image');
  expect(() => checkImage(input('image/png', Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX)])))).toThrow('The image is larger than 512 KB');
  expect(() => imageOf(GIF)).toThrow('Use a PNG, JPEG or WebP image');
  expect(imageOf(PNG).mime).toBe('image/png');
});

test('a refused image writes nothing, and an unsafe id never reaches the disk', () => {
  expect(() => avatars.write('forge', input('image/png', GIF))).toThrow();
  expect(readdirSync(dir)).toEqual([]);
  expect(() => avatars.write('../x', input('image/png', PNG))).toThrow('Unsafe agent id');
  expect(() => avatars.read('../x')).toThrow('Unsafe agent id');
});
