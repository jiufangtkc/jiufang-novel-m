import { describe, expect, it } from 'vitest';
import { createMemoryAppSpace } from './appSpace';
import { createMemoryTargetStore, restoreTarget, type DiskFile } from './fileTarget';
import { saveNotice, saveProjectAsNew, saveProjectToPlace, writeWithoutDestroying, type SaveEnvironment } from './saveProject';
import { verifyExportedDatabase } from './verifyDatabase';

const ORIGINAL = new Uint8Array([1, 2, 3, 4]);
const NEXT = new Uint8Array([9, 9, 9, 9]);

class FakeDisk implements DiskFile {
  bytes: Uint8Array;
  permission: 'granted' | 'prompt' | 'denied' = 'granted';
  requestResult: 'granted' | 'denied' = 'granted';
  writes = 0;
  failTimes = 0;
  mutateBeforeFail = false;
  requested = 0;
  constructor(readonly name: string, bytes: Uint8Array) {
    this.bytes = bytes.slice();
  }
  async read() {
    return this.bytes.slice();
  }
  async write(next: Uint8Array) {
    this.writes += 1;
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      if (this.mutateBeforeFail) this.bytes = next.slice();
      throw new Error('寫入失敗');
    }
    this.bytes = next.slice();
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    this.requested += 1;
    this.permission = this.requestResult;
    return this.requestResult;
  }
}

function env(options?: {
  canPickFiles?: boolean;
  verify?: (bytes: Uint8Array) => Promise<void>;
  pick?: SaveEnvironment['pickSaveLocation'];
  share?: SaveEnvironment['share'];
}): { env: SaveEnvironment; store: ReturnType<typeof createMemoryTargetStore>; shared: string[] } {
  const store = createMemoryTargetStore();
  const shared: string[] = [];
  return {
    store,
    shared,
    env: {
      canPickFiles: options?.canPickFiles ?? false,
      targets: store,
      verify: options?.verify ?? (async () => undefined),
      pickSaveLocation: options?.pick ?? (async () => null),
      share: options?.share ?? (async (filename) => {
        shared.push(filename);
        return 'shared';
      }),
    },
  };
}

describe('檔案把手記住與還原', () => {
  it('同一把把手存進目標後還能拿回來', async () => {
    const file = new FakeDisk('原稿.db', ORIGINAL);
    const store = createMemoryTargetStore();
    await store.save('book-1', { filename: '原稿.db', file });
    const loaded = await store.load('book-1');
    expect(loaded?.file).toBe(file);
    expect(loaded?.filename).toBe('原稿.db');
  });

  it('從儲存列還原時沿用原來的把手', () => {
    const handle = { name: '原稿.db' };
    const restored = restoreTarget({ filename: '原稿.db', handle }, (value) => value as DiskFile);
    expect(restored?.file).toBe(handle);
  });
});

describe('儲存專案', () => {
  it('權限被拒時不寫檔', async () => {
    const file = new FakeDisk('原稿.db', ORIGINAL);
    file.permission = 'prompt';
    file.requestResult = 'denied';
    const box = env();
    await box.store.save('book-1', { filename: '原稿.db', file });
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '書名.db');
    expect(outcome.kind).toBe('permission-denied');
    expect(file.writes).toBe(0);
    expect(file.requested).toBe(1);
    expect(Array.from(file.bytes)).toEqual(Array.from(ORIGINAL));
    expect(saveNotice(outcome)).toBe('沒有寫入權限，原檔沒有更動');
  });

  it('寫到一半失敗時把原檔寫回去', async () => {
    const file = new FakeDisk('原稿.db', ORIGINAL);
    file.failTimes = 1;
    file.mutateBeforeFail = true;
    const result = await writeWithoutDestroying(file, NEXT);
    expect(result).toEqual({ restored: true });
    expect(Array.from(file.bytes)).toEqual(Array.from(ORIGINAL));
  });

  it('寫入失敗時儲存流程不把壞檔留在原位', async () => {
    const file = new FakeDisk('原稿.db', ORIGINAL);
    file.failTimes = 1;
    file.mutateBeforeFail = true;
    const box = env();
    await box.store.save('book-1', { filename: '原稿.db', file });
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '書名.db');
    expect(outcome).toEqual({ kind: 'write-failed', restored: true });
    expect(Array.from(file.bytes)).toEqual(Array.from(ORIGINAL));
  });

  it('匯出檔不合法時完全不碰原檔', async () => {
    const file = new FakeDisk('原稿.db', ORIGINAL);
    const box = env({
      verify: async () => {
        throw new Error('壞檔');
      },
    });
    await box.store.save('book-1', { filename: '原稿.db', file });
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '書名.db');
    expect(outcome.kind).toBe('invalid-database');
    expect(file.writes).toBe(0);
  });

  it('不支援選檔時改走分享選單，並用原檔名', async () => {
    const box = env();
    await box.store.save('book-1', { filename: '原稿.db', file: null });
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '書名.db');
    expect(outcome).toEqual({ kind: 'handed-off', via: 'share', filename: '原稿.db' });
    expect(box.shared).toEqual(['原稿.db']);
    expect(saveNotice(outcome)).toBe('已交給存檔選單');
  });

  it('沒有原檔名時分享用書名.db', async () => {
    const box = env();
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '未命名.db');
    expect(outcome).toEqual({ kind: 'handed-off', via: 'share', filename: '未命名.db' });
  });

  it('分享選單取消時不算成功', async () => {
    const box = env({
      share: async () => 'cancelled',
    });
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '原稿.db');
    expect(outcome.kind).toBe('cancelled');
    expect(saveNotice(outcome)).toBeNull();
  });
});

describe('另存專案', () => {
  it('桌機另存後，儲存專案改寫新檔', async () => {
    const original = new FakeDisk('原稿.db', ORIGINAL);
    const created = new FakeDisk('霧港_20260315-0905.db', new Uint8Array());
    const box = env({
      canPickFiles: true,
      pick: async () => created,
    });
    await box.store.save('book-1', { filename: '原稿.db', file: original });
    const savedAs = await saveProjectAsNew(box.env, 'book-1', NEXT, '霧港_20260315-0905.db');
    expect(savedAs).toEqual({ kind: 'saved-as', filename: created.name });
    expect(Array.from(original.bytes)).toEqual(Array.from(ORIGINAL));
    expect(Array.from(created.bytes)).toEqual(Array.from(NEXT));
    const again = new Uint8Array([7, 7]);
    const saved = await saveProjectToPlace(box.env, 'book-1', again, '原稿.db');
    expect(saved.kind).toBe('saved');
    expect(Array.from(created.bytes)).toEqual(Array.from(again));
    expect(Array.from(original.bytes)).toEqual(Array.from(ORIGINAL));
  });

  it('手機另存後，下次儲存改用新檔名，但仍走分享選單', async () => {
    const box = env();
    await box.store.save('book-1', { filename: '原稿.db', file: null });
    const savedAs = await saveProjectAsNew(box.env, 'book-1', NEXT, '霧港_20260315-0905.db');
    expect(savedAs).toEqual({
      kind: 'handed-off',
      via: 'share',
      filename: '霧港_20260315-0905.db',
    });
    box.shared.length = 0;
    const saved = await saveProjectToPlace(box.env, 'book-1', NEXT, '原稿.db');
    expect(saved).toEqual({
      kind: 'handed-off',
      via: 'share',
      filename: '霧港_20260315-0905.db',
    });
  });
});

describe('App 空間', () => {
  it('寫進空間後可以原樣讀回', async () => {
    const space = createMemoryAppSpace();
    await space.put({ key: 'book-1', filename: '原稿.db', title: '【示範】假書', bytes: NEXT });
    const loaded = await space.get('book-1');
    expect(loaded?.filename).toBe('原稿.db');
    expect(loaded?.title).toBe('【示範】假書');
    expect(Array.from(loaded?.bytes ?? [])).toEqual(Array.from(NEXT));
  });
});

describe('匯出檔驗證', () => {
  it('檔頭不對或讀不到版本就拒絕', async () => {
    await expect(verifyExportedDatabase(new Uint8Array([1, 2, 3]), async () => 14)).rejects.toThrow('不是資料庫');
    const header = new TextEncoder().encode('SQLite format 3\0');
    await expect(verifyExportedDatabase(header, async () => null)).rejects.toThrow('版本');
    await expect(verifyExportedDatabase(header, async () => 14)).resolves.toBe(14);
  });
});
