import { describe, expect, it } from 'vitest';
import { createArchiveClient, type ArchiveBacking } from '../db/chapterArchive';
import { emptyArchive, rememberDeleted, type DeletedRecord } from '../domain/chapterVersions';
import type { ChapterNode } from '../data/demo';

function record(id: string): DeletedRecord {
  const node: ChapterNode = { id, type: 'file', title: id, content: id };
  return { id, node, parentId: null, index: 0, deletedAt: 1, title: id };
}

describe('舊版儲存排隊', () => {
  it('兩次更新接連寫入時，兩筆都會留下', async () => {
    let stored = emptyArchive();
    let release = () => {};
    const opened = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    let writes = 0;
    const backing: ArchiveBacking = {
      async read() {
        return structuredClone(stored);
      },
      async write(_bookId, archive) {
        writes += 1;
        if (writes === 1) await opened;
        stored = structuredClone(archive);
      },
    };
    const client = createArchiveClient(backing);
    const first = client.update('book', (current) => ({ ...current, deleted: rememberDeleted(current.deleted, record('a')) }));
    const second = client.update('book', (current) => ({ ...current, deleted: rememberDeleted(current.deleted, record('b')) }));
    release();
    await first;
    await second;
    expect(stored.deleted.map((item) => item.id)).toEqual(['b', 'a']);
  });
});
