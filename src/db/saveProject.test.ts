import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryAppSpace } from './appSpace';
import { DATABASE_FILE_TYPE, savePickerConfig } from './browserDisk';
import { createMemoryTargetStore, restoreTarget, type DiskFile } from './fileTarget';
import { readFileProject, snapshotFingerprints, writeFileProject, type FileProjectInfo } from './projectFile';
import { openMemoryDb } from './wasmDb';
import {
  handOffPrepared,
  saveNotice,
  saveProjectAsNew,
  saveProjectFromClick,
  saveProjectToPlace,
  shouldPickBeforeBuild,
  writeWithoutDestroying,
  type SaveEnvironment,
} from './saveProject';
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
    expect(saveNotice(outcome)).toBe('沒有寫入權限，請再按一次並選「允許」。');
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
    expect(saveNotice(outcome)).toBe('存檔失敗。稿件目前仍在 APP 暫存空間。');
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

  it('不支援選檔且沒有把手時無法儲存專案', async () => {
    const box = env();
    await box.store.save('book-1', { filename: '原稿.db', file: null });
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '書名.db');
    expect(outcome.kind).toBe('cancelled');
    expect(box.shared).toEqual([]);
    expect(saveNotice(outcome)).toBeNull();
  });

  it('沒有原檔名也沒有把手時仍取消', async () => {
    const box = env();
    const outcome = await saveProjectToPlace(box.env, 'book-1', NEXT, '未命名.db');
    expect(outcome.kind).toBe('cancelled');
    expect(box.shared).toEqual([]);
  });
});

describe('另存專案', () => {
  it('分享選單成功後提示已另存', () => {
    expect(saveNotice({ kind: 'handed-off', via: 'share', filename: '【範例】測試書_20260315-0905.db' })).toBe('已另存');
  });

  it('分享選單取消時不顯示成功', async () => {
    const box = env({ share: async () => 'cancelled' });
    const outcome = await saveProjectAsNew(box.env, 'book-1', NEXT, '【範例】測試書_20260315-0905.db');
    expect(outcome.kind).toBe('cancelled');
    expect(saveNotice(outcome)).toBeNull();
  });

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

  it('手機另存只交給分享選單，不更新儲存目標檔名', async () => {
    const box = env();
    await box.store.save('book-1', { filename: '原稿.db', file: null });
    const savedAs = await saveProjectAsNew(box.env, 'book-1', NEXT, '霧港_20260315-0905.db');
    expect(savedAs).toEqual({
      kind: 'handed-off',
      via: 'share',
      filename: '霧港_20260315-0905.db',
    });
    expect(saveNotice(savedAs)).toBe('已另存');
    const loaded = await box.store.load('book-1');
    expect(loaded?.filename).toBe('原稿.db');
    expect(loaded?.file).toBeNull();
  });
});

describe('App 空間', () => {
  it('寫進空間後可以原樣讀回', async () => {
    const space = createMemoryAppSpace();
    await space.put({ key: 'book-1', filename: '原稿.db', title: '【範例】測試書', bytes: NEXT });
    const loaded = await space.get('book-1');
    expect(loaded?.filename).toBe('原稿.db');
    expect(loaded?.title).toBe('【範例】測試書');
    expect(Array.from(loaded?.bytes ?? [])).toEqual(Array.from(NEXT));
  });
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const sampleInfo = (title: string): FileProjectInfo => ({
  title,
  logline: '【範例】一句話',
  currentTheme: '',
  globalFontFamily: '',
  globalFontSize: 12,
  editorFontFamily: '',
  editorFontSize: 16,
  targetWordCount: 100000,
  dailyTargetWordCount: 1000,
  categoryOrder: null,
  expandedCategories: null,
  categoriesMeta: '{}',
  lastOpenedNodeId: 'ch-1',
  lastCursorPosition: 3,
});

async function sampleBytes(title: string): Promise<Uint8Array> {
  const db = await openMemoryDb(new Uint8Array());
  try {
    writeFileProject(
      db.sql,
      sampleInfo(title),
      [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　未班車',
          content: '【範例】地下道的燈一盞一盞熄滅。',
          progress: 'Final',
        },
        {
          id: 'ch-2',
          type: 'file',
          title: '第二章　剪票口',
          content: '【範例】狐狸把票根對折。',
          progress: 'Draft',
        },
      ],
      [],
      [],
    );
    db.sql.run(
      'INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES (?, ?, ?, ?, ?)',
      ['【範例】快照', '', '2026-10-30', 12, 'kept'],
    );
    return db.exportBytes();
  } finally {
    db.close();
  }
}

async function retitle(bytes: Uint8Array, title: string): Promise<Uint8Array> {
  const db = await openMemoryDb(bytes);
  try {
    const loaded = readFileProject(db.sql);
    writeFileProject(db.sql, { ...loaded.info, title }, loaded.tree, loaded.cards, loaded.logs);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

describe('用新書名另存', () => {
  it('先開存檔視窗再整理內容；取消就什麼都不寫', async () => {
    const order: string[] = [];
    const original = new FakeDisk('【範例】月台上的狐狸.db', ORIGINAL);
    const box = env({
      canPickFiles: true,
      pick: async () => {
        order.push('pick');
        return null;
      },
    });
    const outcome = await saveProjectFromClick({
      env: box.env,
      bookKey: 'book-1',
      plan: 'pick-new-name',
      writeBackName: original.name,
      newTitleName: '【範例】月台上的白狐.db',
      startIn: original,
      buildBytes: async () => {
        order.push('build');
        return NEXT;
      },
    });
    expect(order).toEqual(['pick']);
    expect(outcome.kind).toBe('cancelled');
    expect(original.writes).toBe(0);
    expect(saveNotice(outcome)).toBeNull();
  });

  it('舊檔的大小和雜湊不變，新檔只有書名不同', async () => {
    const oldBytes = await sampleBytes('【範例】月台上的狐狸');
    const newBytes = await retitle(oldBytes, '【範例】月台上的白狐');
    const oldDb = await openMemoryDb(oldBytes);
    const newDb = await openMemoryDb(newBytes);
    try {
      const before = readFileProject(oldDb.sql);
      const after = readFileProject(newDb.sql);
      expect(after.info.title).toBe('【範例】月台上的白狐');
      expect(before.info.title).toBe('【範例】月台上的狐狸');
      expect(after.tree).toEqual(before.tree);
      expect(after.cards).toEqual(before.cards);
      expect(after.logs).toEqual(before.logs);
      expect(snapshotFingerprints(newDb.sql)).toEqual(snapshotFingerprints(oldDb.sql));
      expect(sha256(oldBytes)).not.toBe(sha256(newBytes));
    } finally {
      oldDb.close();
      newDb.close();
    }

    const order: string[] = [];
    const original = new FakeDisk('【範例】月台上的狐狸.db', oldBytes);
    const created = new FakeDisk('【範例】月台上的白狐.db', new Uint8Array());
    const oldHash = sha256(original.bytes);
    const box = env({
      canPickFiles: true,
      pick: async (name, startIn) => {
        order.push('pick');
        expect(name).toBe('【範例】月台上的白狐.db');
        expect(startIn).toBe(original);
        return created;
      },
    });
    const outcome = await saveProjectFromClick({
      env: box.env,
      bookKey: 'book-1',
      plan: 'pick-new-name',
      writeBackName: original.name,
      newTitleName: '【範例】月台上的白狐.db',
      startIn: original,
      buildBytes: async () => {
        order.push('build');
        return newBytes;
      },
    });
    expect(order).toEqual(['pick', 'build']);
    expect(outcome).toEqual({ kind: 'saved-under-new-title', filename: created.name });
    expect(saveNotice(outcome)).toBe('已用新書名另存一份');
    expect(original.writes).toBe(0);
    expect(original.bytes.byteLength).toBe(oldBytes.byteLength);
    expect(sha256(original.bytes)).toBe(oldHash);
    expect(sha256(created.bytes)).toBe(sha256(newBytes));

    const again = new Uint8Array([4, 5, 6]);
    const saved = await saveProjectToPlace(box.env, 'book-1', again, '【範例】月台上的白狐.db');
    expect(saved.kind).toBe('saved');
    expect(Array.from(created.bytes)).toEqual(Array.from(again));
    expect(sha256(original.bytes)).toBe(oldHash);
  });

  it('改過書名才先跳視窗；寫回原檔不用跳', () => {
    const file = new FakeDisk('原稿.db', ORIGINAL);
    expect(shouldPickBeforeBuild({
      canPick: true,
      needsNewName: true,
      remembered: undefined,
      hasExternalFile: true,
    })).toBe(true);
    expect(shouldPickBeforeBuild({
      canPick: true,
      needsNewName: false,
      remembered: null,
      hasExternalFile: false,
    })).toBe(true);
    expect(shouldPickBeforeBuild({
      canPick: true,
      needsNewName: false,
      remembered: file,
      hasExternalFile: true,
    })).toBe(false);
    expect(shouldPickBeforeBuild({
      canPick: false,
      needsNewName: true,
      remembered: null,
      hasExternalFile: true,
    })).toBe(false);
  });

  it('存檔類型用九方編輯器稿件檔，並把舊檔把手交給視窗', () => {
    const handle = { name: '原稿.db' };
    expect(DATABASE_FILE_TYPE.description).toBe('九方編輯器稿件檔');
    expect(savePickerConfig('白狐.db', handle).startIn).toBe(handle);
    expect(savePickerConfig('白狐.db').startIn).toBeUndefined();
  });

  it('事先備好的分享在按下時直接交出檔案', async () => {
    const shared: string[] = [];
    const box = env({
      share: async (filename) => {
        shared.push(filename);
        return 'shared';
      },
    });
    const outcome = await handOffPrepared(box.env, '白狐_20261030-1140.db', NEXT);
    expect(outcome.kind).toBe('handed-off');
    expect(shared).toEqual(['白狐_20261030-1140.db']);
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
