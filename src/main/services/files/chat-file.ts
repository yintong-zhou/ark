import type { ReadResult } from '@shared/files';
import { normEntry } from './guard';
import { readText } from './ops';

/** Only a chat owned by this window can read within the folder it started in. */
export function readChatFile(chats: ReadonlyMap<string, string>, id: string, rel: unknown): ReadResult {
  const dir = chats.get(id);
  if (!dir) throw new Error('Unknown chat');
  return readText(dir, normEntry(rel));
}
