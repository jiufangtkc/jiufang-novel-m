/**
 * WO-132 階段一：嚴-3 自動化實測重現測試（僅用【範例】假稿與記憶體／假 IndexedDB）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDirectoryAppSpace,
  createMemoryAppSpace,
  createMemoryDirectory,
  createMirroredSpace,
  type StoredBook,
} from './appSpace';

function makeStoredBook(key: string, body: string): StoredBook {
  return {
    key,
    filename: `${key}.db`,
    title: `【範例】${body}`,
    bytes: new TextEncoder().encode(`【範例】${body}`),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('WO-132 階段一實測：嚴-3（主暫存失敗、備援成功與 IndexedDB 交易完成確認）', () => {
  it('主空間寫入失敗但備援寫入 v2 成功後，重開 get() 與 list() 應讀回 v2 且後續 put 不蓋掉備援', async () => {
    const primaryInner = createMemoryAppSpace();
    const backup = createMemoryAppSpace();
    let failPrimaryPut = false;
    const primary = {
      async put(book: StoredBook) {
        if (failPrimaryPut) throw new Error('QuotaExceededError: 模擬主暫存空間滿');
        await primaryInner.put(book);
      },
      get: (key: string) => primaryInner.get(key),
      list: () => primaryInner.list(),
      remove: (key: string) => primaryInner.remove(key),
    };
    const mirrored = createMirroredSpace(primary, backup);

    const key = 'wo132-repro-book';
    const v1 = makeStoredBook(key, '舊版內容');
    await mirrored.put(v1);
    expect((await primaryInner.get(key))?.title).toBe(v1.title);
    expect((await backup.get(key))?.title).toBe(v1.title);

    // 注入故障：主空間 put 失敗，備援成功寫入 v2
    failPrimaryPut = true;
    const v2 = makeStoredBook(key, '新版內容');
    await expect(mirrored.put(v2)).resolves.toBeUndefined();
    expect((await backup.get(key))?.title).toBe(v2.title);

    // 解除主空間寫入故障，模擬重開分頁讀取
    failPrimaryPut = false;
    const loadedAfterReopen = await mirrored.get(key);
    const listedAfterReopen = await mirrored.list();

    expect(loadedAfterReopen?.title).toBe(v2.title);
    expect(listedAfterReopen.find((b) => b.key === key)?.title).toBe(v2.title);

    // 重開後若再把讀回的內容寫回，備援裡的 v2 絕不能被舊稿蓋掉，且再寫入 v3 兩側皆應更新為 v3
    await mirrored.put(loadedAfterReopen!);
    expect((await backup.get(key))?.title).toBe(v2.title);

    const v3 = makeStoredBook(key, '第三版內容');
    await mirrored.put(v3);
    expect((await primaryInner.get(key))?.title).toBe(v3.title);
    expect((await backup.get(key))?.title).toBe(v3.title);
  });

  it('主空間留下半套殘缺 .db（長度與 .json 不符）時，get() 與 list() 自動改用備援完整版本', async () => {
    const primaryDir = createMemoryDirectory();
    const primary = createDirectoryAppSpace(primaryDir);
    const backup = createMemoryAppSpace();
    const mirrored = createMirroredSpace(primary, backup);

    const key = 'wo132-half-write';
    const v1 = makeStoredBook(key, '完整備援內容');
    await mirrored.put(v1);

    // 模擬 primary 只寫到一半的殘缺 .db（長度與 .json 記錄不符）
    await primaryDir.write(`${key}.db`, new Uint8Array([1, 2]));
    const loaded = await mirrored.get(key);
    const listed = await mirrored.list();
    expect(loaded?.title).toBe(v1.title);
    expect(loaded?.bytes).toEqual(v1.bytes);
    expect(listed.find((b) => b.key === key)?.title).toBe(v1.title);
  });

  it('舊版無 revision／savedAt 的資料與新版並存時新版勝出；兩側皆舊版時仍可正常讀回', async () => {
    const primary = createMemoryAppSpace();
    const backup = createMemoryAppSpace();
    const key = 'wo132-legacy';
    await primary.put(makeStoredBook(key, '舊版無序號'));
    await backup.put({ ...makeStoredBook(key, '新版有序號'), revision: 1, savedAt: 1000 });
    const mirrored = createMirroredSpace(primary, backup);
    expect((await mirrored.get(key))?.title).toBe('【範例】新版有序號');

    const legacyPrimary = createMemoryAppSpace();
    const legacyBackup = createMemoryAppSpace();
    await legacyPrimary.put(makeStoredBook(key, '雙側舊版主'));
    await legacyBackup.put(makeStoredBook(key, '雙側舊版備'));
    const legacyMirrored = createMirroredSpace(legacyPrimary, legacyBackup);
    expect((await legacyMirrored.get(key))?.title).toBe('【範例】雙側舊版主');
  });

  it('IndexedDB readwrite 交易在 request.onsuccess 後若觸發 onabort，不應回報 put 成功；oncomplete 才成功', async () => {
    vi.resetModules();

    let abortMode = true;
    const fakeIndexedDb = {
      open() {
        const openReq: Record<string, unknown> = {};
        const fakeDb = {
          objectStoreNames: { contains: () => true },
          close: () => {},
          transaction(_storeName: string, mode: IDBTransactionMode) {
            const tx: Record<string, unknown> = {
              error: new Error('模擬交易在提交前中止'),
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  put() {
                    const req: Record<string, unknown> = { result: undefined };
                    queueMicrotask(() => {
                      if (typeof req.onsuccess === 'function') {
                        (req.onsuccess as () => void)();
                      }
                      queueMicrotask(() => {
                        if (mode === 'readwrite' && abortMode && typeof tx.onabort === 'function') {
                          (tx.onabort as () => void)();
                        } else if (typeof tx.oncomplete === 'function') {
                          (tx.oncomplete as () => void)();
                        }
                      });
                    });
                    return req;
                  },
                };
              },
            };
            return tx;
          },
        };
        queueMicrotask(() => {
          openReq.result = fakeDb;
          if (typeof openReq.onsuccess === 'function') {
            (openReq.onsuccess as () => void)();
          }
        });
        return openReq;
      },
    };

    vi.stubGlobal('indexedDB', fakeIndexedDb);
    const { appSpace } = await import('./browserSpace');
    const space = await appSpace();
    await expect(space.put(makeStoredBook('idb-abort-key', '交易中止測試'))).rejects.toThrow();

    abortMode = false;
    await expect(space.put(makeStoredBook('idb-commit-key', '交易提交測試'))).resolves.toBeUndefined();
  });
});
