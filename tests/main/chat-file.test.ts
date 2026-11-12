import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readChatFile } from '../../src/main/services/files/chat-file';

test('chat reads only files inside the folder of a live chat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ark-chat-'));
  const outside = mkdtempSync(join(tmpdir(), 'ark-chat-out-'));
  try {
    writeFileSync(join(dir, 'README.md'), 'hello');
    writeFileSync(join(outside, 'secret'), 'secret');
    symlinkSync(outside, join(dir, 'out'), 'junction');
    const chats = new Map([['live', dir]]);
    expect(readChatFile(chats, 'live', 'README.md')).toMatchObject({ kind: 'text', text: 'hello' });
    expect(() => readChatFile(chats, 'unknown', 'README.md')).toThrow('Unknown chat');
    for (const path of ['../secret', join(outside, 'secret'), 'out/secret', '']) {
      expect(() => readChatFile(chats, 'live', path)).toThrow();
    }
    chats.delete('live');
    expect(() => readChatFile(chats, 'live', 'README.md')).toThrow('Unknown chat');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
