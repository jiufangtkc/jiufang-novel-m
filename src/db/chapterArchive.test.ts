import { describe, expect, it } from 'vitest';
import { createArchiveClient, type ArchiveBacking } from '../db/chapterArchive';
import { emptyArchive, rememberDeleted, type DeletedRecord } from '../domain/chapterVersions';
import type { ChapterNode } from '../data/demo';

function record(id: string): DeletedRecord {
  const node: ChapterNode = { id, type: 'file', title: id, content: id };
  return { id, node, parentId: null, index: 0, deletedAt: 1, title: id };
}

describe('舊版儲存排隊', () => {
  it('寫入失敗時還原內容並標記無法保存', async () => {
    let stored = emptyArchive();
    const backing: ArchiveBacking = {
      async read() {
        return structuredClone(stored);
      },
      async write(_bookId, _archive) {
        throw new Error('舊版沒寫入');
      },
    };
    const client = createArchiveClient(backing);
    const persist: boolean[] = [];
    client.subscribePersist((_id, ok) => persist.push(ok));
    await client.read('book');
    await expect(
      client.update('book', (current) => ({
        ...current,
        deleted: rememberDeleted(current.deleted, record('lost')),
      })),
    ).rejects.toThrow('舊版沒寫入');
    expect(await client.read('book')).toEqual(emptyArchive());
    expect(client.isPersistOk('book')).toBe(false);
    expect(persist).toEqual([false]);
  });

  it('換版前留舊版失敗時，會標成 restore', async () => {
    const backing: ArchiveBacking = {
      async read() {
        return emptyArchive();
      },
      async write() {
        throw new Error('舊版沒寫入');
      },
    };
    const client = createArchiveClient(backing);
    const kinds: string[] = [];
    client.subscribePersist((_id, ok, kind) => {
      if (!ok) kinds.push(kind);
    });
    await expect(client.update('book', (current) => current, 'restore')).rejects.toThrow('舊版沒寫入');
    await expect(client.update('book', (current) => current, 'delete')).rejects.toThrow('舊版沒寫入');
    expect(kinds).toEqual(['restore', 'delete']);
  });

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
