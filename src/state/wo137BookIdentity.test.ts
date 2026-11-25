import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDirectoryAppSpace, createMemoryDirectory, type AppSpace } from '../db/appSpace';
import { BOOK_META_TABLE, readBookMeta } from '../db/bookMeta';
import * as browserSpace from '../db/browserSpace';
import { isValidUuidV4 } from '../db/extensionMeta';
import { createMemoryTargetStore, type DiskFile } from '../db/fileTarget';
import { loadStoredBooks, readBookBytes } from '../db/library';
import { currentSchemaVersion } from '../db/migrations';
import { forgetOpenFile } from '../db/openFileMemory';
import { readFileProject } from '../db/projectFile';
import { createVersion1 } from '../db/schemaFixture';
import type { SaveEnvironment } from '../db/saveProject';
import { SavePickerAbortedError } from '../db/savePickerAbort';
import { tableNames } from '../db/sql';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import { openMemoryDb } from '../db/wasmDb';
import type { KeyValueStore } from '../domain/outline';
import {
  addProjectAction,
  commitTextImport,
  createState,
  executeBackgroundAutoSave,
  manuscriptBytesOn,
  openDatabaseManuscript,
  persistFileBookStash,
  reduce,
  runManualSaveProject,
  runSaveProjectAs,
  verifyBytesForSave,
  type Action,
} from './sampleStore';

class FakeDisk implements DiskFile {
  bytes: Uint8Array;
  writes = 0;
  failWrite = false;
  constructor(readonly name: string, initial: Uint8Array) {
    this.bytes = initial.slice();
  }
  async read(): Promise<Uint8Array> {
    return this.bytes.slice();
  }
  async write(next: Uint8Array): Promise<void> {
    this.writes += 1;
    if (this.failWrite) throw new Error('模擬磁碟寫入失敗');
    this.bytes = next.slice();
  }
  async queryPermission(): Promise<'granted'> {
    return 'granted';
  }
  async requestPermission(): Promise<'granted'> {
    return 'granted';
  }
}

function makeMemoryKeyValueStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function makeFakeEnv(options: {
  canPickFiles: boolean;
  pickSaveLocation?: SaveEnvironment['pickSaveLocation'];
  share?: SaveEnvironment['share'];
}): { env: SaveEnvironment; targets: ReturnType<typeof createMemoryTargetStore> } {
  const targets = createMemoryTargetStore();
  return {
    targets,
    env: {
      canPickFiles: options.canPickFiles,
      targets,
      verify: verifyBytesForSave,
      pickSaveLocation: options.pickSaveLocation ?? (async () => null),
      share: options.share ?? (async () => 'shared'),
    },
  };
}

function setupMemoryAppSpace(): { dir: ReturnType<typeof createMemoryDirectory>; space: AppSpace } {
  const dir = createMemoryDirectory();
  const space = createDirectoryAppSpace(dir);
  vi.spyOn(browserSpace, 'appSpace').mockResolvedValue(space);
  return { dir, space };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WO-137 第 4 段：稿子固定身分證生命週期、舊稿零寫入與另存方案 A', () => {
  it('硬性原則：打開無 jiufangm_book_meta 的舊檔（v14／v1）零外部寫入、不設 dirty／不增 contentRev、放著超過 5 分鐘自動存檔零寫入，重整仍維持同顆待寫入 UUID', async () => {
    const { dir } = setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】舊稿.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-25T10:00:00+08:00'),
    });

    const project = state.projects.find((p) => p.id === opened.id)!;
    expect(isValidUuidV4(project.bookUuid)).toBe(true);
    expect(project.bookMetaPersisted).toBe(false);
    expect(project.originBookUuid).toBeNull();
    // 1) 外部原檔 0 次寫入、位元組完全不變
    expect(disk.writes).toBe(0);
    expect(Array.from(disk.bytes)).toEqual(Array.from(originalBytes));
    // 2) 不誤設 dirtySinceFileSave，也不遞增 contentRevById
    expect(Boolean(state.saveMeta[opened.id]?.dirtySinceFileSave)).toBe(false);
    expect(state.contentRevById?.[opened.id] ?? 0).toBe(0);

    // 3) 觸發 App 空間自動暫存（模擬開檔後 250ms stash）：不改寫 App 空間 .db 本體加表，中繼 .json 記住同一顆 UUID
    await persistFileBookStash({
      state,
      project,
      extra: state.fileExtras[project.dbKey!]!,
      dispatch,
      onStashResult: () => undefined,
    });
    const storedDbBytes = (await dir.read(`${project.dbKey!}.db`))!;
    const dbCheck = await openMemoryDb(storedDbBytes);
    try {
      expect(tableNames(dbCheck.sql).has(BOOK_META_TABLE)).toBe(false);
    } finally {
      dbCheck.close();
    }
    const storedJson = JSON.parse(new TextDecoder().decode((await dir.read(`${project.dbKey!}.json`))!)) as {
      bookUuid?: string;
      bookMetaPersisted?: boolean;
    };
    expect(storedJson.bookUuid).toBe(project.bookUuid);
    expect(storedJson.bookMetaPersisted).toBe(false);

    // 4) 決-4：模擬重整（loadStoredBooks）後仍是同一顆待寫入 UUID
    const reloadedBooks = await loadStoredBooks(new Date('2026-11-25T10:02:00+08:00'));
    expect(reloadedBooks).toHaveLength(1);
    expect(reloadedBooks[0]!.bookUuid).toBe(project.bookUuid);
    expect(reloadedBooks[0]!.bookMetaPersisted).toBe(false);

    // 5) 打開舊稿完全沒改字，5 分鐘背景自動存檔不寫回外部檔
    const autoOutcome = await executeBackgroundAutoSave({
      projectId: opened.id,
      getState: () => state,
      getStatus: () => 'active',
      lastSavedRevById: {},
      inflight: { current: null },
      dispatch,
      env,
      onSaved: () => undefined,
      onNeedsPermission: () => undefined,
      isPreviouslyFailed: () => false,
      onFailed: () => undefined,
      onNoHandle: () => undefined,
      store: kv,
    });
    expect(autoOutcome).toBe('no-changes');
    expect(disk.writes).toBe(0);
    expect(Array.from(disk.bytes)).toEqual(Array.from(originalBytes));

    // v1 舊檔亦同樣零寫入
    const v1Mem = await openMemoryDb(new Uint8Array());
    let v1Bytes: Uint8Array;
    try {
      createVersion1(v1Mem.sql);
      v1Bytes = v1Mem.exportBytes();
    } finally {
      v1Mem.close();
    }
    const v1Disk = new FakeDisk('【範例】v1舊檔.db', v1Bytes);
    const v1Opened = await openDatabaseManuscript({
      filename: v1Disk.name,
      bytes: v1Bytes,
      diskFile: v1Disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-25T10:03:00+08:00'),
    });
    expect(v1Disk.writes).toBe(0);
    expect(isValidUuidV4(state.projects.find((p) => p.id === v1Opened.id)?.bookUuid)).toBe(true);
  });

  it('決-3：打開舊稿完全沒改字，作家主動按「儲存專案」順便寫入身分證，重開仍是同一顆', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】主動補證.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-25T10:00:00+08:00'),
    });
    const pendingUuid = state.projects.find((p) => p.id === opened.id)!.bookUuid!;
    expect(disk.writes).toBe(0);

    // 沒改任何字，直接主動按「儲存專案」
    const saveOutcome = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: {},
      onSaved: () => undefined,
      store: kv,
    });
    expect(saveOutcome).toEqual({ kind: 'saved', filename: '【範例】主動補證.db' });
    expect(disk.writes).toBe(1);
    expect(state.projects.find((p) => p.id === opened.id)?.bookMetaPersisted).toBe(true);

    // 用新實例重開外部寫出的 .db，讀回同一顆 book_uuid
    const reopened = await readBookBytes(disk.name, disk.bytes, 'file-reopen');
    expect(reopened.bookMeta).toMatchObject({
      kind: 'ok',
      revision: 1,
      meta: { bookUuid: pendingUuid, originBookUuid: null },
    });
    expect(reopened.bookUuid).toBe(pendingUuid);
    expect(reopened.bookMetaPersisted).toBe(true);
  });

  it('情境 B／C：實質編輯後自動存檔寫入身分證；新開稿子與匯入 TXT 建稿即有身分證且存檔延續', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const disk = new FakeDisk('【範例】自動存檔補證.db', originalBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: originalBytes,
      diskFile: disk,
      dispatch,
      env,
      store: kv,
      now: new Date('2026-11-25T10:00:00+08:00'),
    });
    const expectedUuid = state.projects.find((p) => p.id === opened.id)!.bookUuid!;

    // 實質修改第一章正文
    dispatch({
      type: 'commit-text',
      projectId: opened.id,
      nodeId: 'ch-sample-doc-1',
      text: '【範例】修改後觸發自動存檔的一段文字。',
    });
    expect(state.saveMeta[opened.id]?.dirtySinceFileSave).toBe(true);

    const lastSavedRevById: Record<string, number> = {};
    const autoOutcome = await executeBackgroundAutoSave({
      projectId: opened.id,
      getState: () => state,
      getStatus: () => 'active',
      lastSavedRevById,
      inflight: { current: null },
      dispatch,
      env,
      onSaved: () => undefined,
      onNeedsPermission: () => undefined,
      isPreviouslyFailed: () => false,
      onFailed: () => undefined,
      onNoHandle: () => undefined,
      store: kv,
    });
    expect(autoOutcome).toEqual({ kind: 'saved', filename: '【範例】自動存檔補證.db' });
    expect(disk.writes).toBe(1);

    const checkDb = await openMemoryDb(disk.bytes);
    try {
      expect(currentSchemaVersion(checkDb.sql)).toBe(14);
      const loaded = readFileProject(checkDb.sql);
      expect(loaded.bookMeta).toMatchObject({
        kind: 'ok',
        meta: { bookUuid: expectedUuid, originBookUuid: null },
      });
      expect(loaded.tree[0]?.children?.[0]?.content).toBe('【範例】修改後觸發自動存檔的一段文字。');
    } finally {
      checkDb.close();
    }

    // 新開稿子與匯入 TXT 建稿當下就有 UUID，寫出再讀回一致
    dispatch(addProjectAction('p-1764000000001', '【範例】全新小說', 'novel', 1_764_000_000_001, kv));
    const newProj = state.projects.find((p) => p.id === 'p-1764000000001')!;
    expect(isValidUuidV4(newProj.bookUuid)).toBe(true);
    const newBytes = await manuscriptBytesOn(state, newProj, null);
    const reopenedNew = await readBookBytes('新小說.db', newBytes, 'file-new-reopen');
    expect(reopenedNew.bookUuid).toBe(newProj.bookUuid);

    const txtOutcome = commitTextImport({
      filename: '【範例】匯入小說.txt',
      chapters: [{ title: '第一章　海霧', content: '【範例】匯入正文。' }],
      getState: () => state,
      dispatch,
      store: kv,
      now: () => new Date('2026-11-25T10:05:00+08:00'),
    });
    expect(txtOutcome.kind).toBe('imported');
    if (txtOutcome.kind === 'imported') {
      const txtProj = state.projects.find((p) => p.id === txtOutcome.id)!;
      expect(isValidUuidV4(txtProj.bookUuid)).toBe(true);
      const txtBytes = await manuscriptBytesOn(state, txtProj, null);
      const reopenedTxt = await readBookBytes('匯入小說.db', txtBytes, 'file-txt-reopen');
      expect(reopenedTxt.bookUuid).toBe(txtProj.bookUuid);
    }
  });

  it('決-2（方案 A）：電腦有外部檔另存換新證並記原證（取消／失敗維持原證）；手機另存、新稿首存與改書名存新檔皆沿用原證', async () => {
    setupMemoryAppSpace();
    const originalBytes = await generateDesktopSampleBytes();
    const diskOrig = new FakeDisk('【範例】原稿.db', originalBytes);
    const diskBranch = new FakeDisk('【範例】另存分枝.db', new Uint8Array());
    const diskFail = new FakeDisk('【範例】失敗檔.db', new Uint8Array());
    diskFail.failWrite = true;

    let pickTarget: DiskFile | null = null;
    let pickShouldAbort = false;
    const { env: desktopEnv } = makeFakeEnv({
      canPickFiles: true,
      pickSaveLocation: async () => {
        if (pickShouldAbort) throw new SavePickerAbortedError();
        return pickTarget;
      },
    });
    const kv = makeMemoryKeyValueStore();

    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: diskOrig.name,
      bytes: originalBytes,
      diskFile: diskOrig,
      dispatch,
      env: desktopEnv,
      store: kv,
      now: new Date('2026-11-25T10:00:00+08:00'),
    });
    const origUuid = state.projects.find((p) => p.id === opened.id)!.bookUuid!;

    // 1) 電腦另存按取消（AbortError）→ 維持原證
    pickShouldAbort = true;
    const aborted = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === opened.id)!,
      dispatch,
      env: desktopEnv,
      preparedBytes: null,
    });
    expect(aborted.outcome).toEqual({ kind: 'picker-aborted' });
    expect(state.projects.find((p) => p.id === opened.id)?.bookUuid).toBe(origUuid);
    expect(state.projects.find((p) => p.id === opened.id)?.originBookUuid).toBeNull();

    // 2) 電腦另存寫檔失敗 → 維持原證
    pickShouldAbort = false;
    pickTarget = diskFail;
    const failed = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === opened.id)!,
      dispatch,
      env: desktopEnv,
      preparedBytes: null,
    });
    expect(failed.outcome.kind).toBe('write-failed');
    expect(state.projects.find((p) => p.id === opened.id)?.bookUuid).toBe(origUuid);

    // 3) 電腦另存成功 → 核發新 book_uuid 並在 origin_book_uuid 記下原稿 UUID
    pickTarget = diskBranch;
    const branched = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === opened.id)!,
      dispatch,
      env: desktopEnv,
      preparedBytes: null,
    });
    expect(branched.outcome).toEqual({ kind: 'saved-as', filename: '【範例】另存分枝.db' });
    const afterBranch = state.projects.find((p) => p.id === opened.id)!;
    expect(isValidUuidV4(afterBranch.bookUuid)).toBe(true);
    expect(afterBranch.bookUuid).not.toBe(origUuid);
    expect(afterBranch.originBookUuid).toBe(origUuid);
    expect(afterBranch.bookMetaPersisted).toBe(true);

    const branchLoaded = await readBookBytes(diskBranch.name, diskBranch.bytes, 'file-branch-check');
    expect(branchLoaded.bookMeta).toMatchObject({
      kind: 'ok',
      meta: { bookUuid: afterBranch.bookUuid, originBookUuid: origUuid },
    });

    // 4) 電腦改書名後按「儲存專案」存成新檔名（saved-under-new-title）→ 沿用目前身分證（不換新證）
    const renamedDisk = new FakeDisk('【範例】改書名存新檔.db', new Uint8Array());
    pickTarget = renamedDisk;
    dispatch({
      type: 'rename-book',
      projectId: opened.id,
      title: '【範例】改書名存新檔',
      titleSavePending: 'resave',
    });
    const renamedSave = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env: desktopEnv,
      inflight: { current: null },
      lastSavedRevById: {},
      onSaved: () => undefined,
      store: kv,
    });
    expect(renamedSave).toEqual({ kind: 'saved-under-new-title', filename: '【範例】改書名存新檔.db' });
    expect(state.projects.find((p) => p.id === opened.id)?.bookUuid).toBe(afterBranch.bookUuid);

    // 5) 手機不支援直接寫回（canPickFiles: false）按「另存專案」→ 沿用原證
    const { env: mobileEnv } = makeFakeEnv({
      canPickFiles: false,
      share: async () => 'shared',
    });
    const mobileRes = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === opened.id)!,
      dispatch,
      env: mobileEnv,
      preparedBytes: null,
    });
    expect(mobileRes.outcome.kind).toBe('handed-off');
    expect(state.projects.find((p) => p.id === opened.id)?.bookUuid).toBe(afterBranch.bookUuid);

    // 6) 新稿首次另存（hasExternalFile: false）在電腦按「另存專案」→ 沿用新稿原本 UUID
    const newId = 'p-1764000000099';
    forgetOpenFile(newId);
    dispatch(addProjectAction(newId, '【範例】新稿首存', 'novel', 1_764_000_000_099, kv));
    const newOrigUuid = state.projects.find((p) => p.id === newId)!.bookUuid!;
    const newFirstDisk = new FakeDisk('【範例】新稿首存.db', new Uint8Array());
    pickTarget = newFirstDisk;
    const firstSaveAs = await runSaveProjectAs({
      state,
      project: state.projects.find((p) => p.id === newId)!,
      dispatch,
      env: desktopEnv,
      preparedBytes: null,
    });
    expect(firstSaveAs.outcome).toEqual({ kind: 'saved-as', filename: '【範例】新稿首存.db' });
    expect(state.projects.find((p) => p.id === newId)?.bookUuid).toBe(newOrigUuid);
    expect(state.projects.find((p) => p.id === newId)?.originBookUuid).toBeNull();
  });

  it('較新修訂值（format_revision = 2）的 jiufangm_book_meta 在應用層存檔與另存時保持唯讀不覆寫', async () => {
    setupMemoryAppSpace();
    const base = await generateDesktopSampleBytes();
    const db = await openMemoryDb(base);
    let newerBytes: Uint8Array;
    try {
      db.sql.exec(`CREATE TABLE ${BOOK_META_TABLE} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        format_revision INTEGER NOT NULL,
        book_uuid TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        origin_book_uuid TEXT DEFAULT NULL
      )`);
      db.sql.run(
        `INSERT INTO ${BOOK_META_TABLE} (id, format_revision, book_uuid, created_at_ms) VALUES (1, 2, ?, ?)`,
        ['550e8400-e29b-41d4-a716-446655440000', 1_764_000_000_000],
      );
      newerBytes = db.exportBytes();
    } finally {
      db.close();
    }

    const disk = new FakeDisk('【範例】未來版.db', newerBytes);
    const { env } = makeFakeEnv({ canPickFiles: true });
    let state = createState(new Date('2026-11-25T10:00:00+08:00'));
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: disk.name,
      bytes: newerBytes,
      diskFile: disk,
      dispatch,
      env,
      store: makeMemoryKeyValueStore(),
    });
    expect(state.fileExtras[opened.id]?.bookMeta).toEqual({ kind: 'newer-revision', revision: 2 });

    dispatch({
      type: 'commit-text',
      projectId: opened.id,
      nodeId: 'ch-sample-doc-1',
      text: '【範例】較新版下仍可修改並存檔',
    });
    const saveOutcome = await runManualSaveProject({
      getState: () => state,
      dispatch,
      env,
      inflight: { current: null },
      lastSavedRevById: {},
      onSaved: () => undefined,
      store: makeMemoryKeyValueStore(),
    });
    expect(saveOutcome).toEqual({ kind: 'saved', filename: '【範例】未來版.db' });

    const verifyDb = await openMemoryDb(disk.bytes);
    try {
      expect(readBookMeta(verifyDb.sql)).toEqual({ kind: 'newer-revision', revision: 2 });
      expect(verifyDb.sql.select(`SELECT format_revision, book_uuid FROM ${BOOK_META_TABLE}`)).toEqual([
        { format_revision: 2, book_uuid: '550e8400-e29b-41d4-a716-446655440000' },
      ]);
      expect(readFileProject(verifyDb.sql).tree[0]?.children?.[0]?.content).toBe(
        '【範例】較新版下仍可修改並存檔',
      );
    } finally {
      verifyDb.close();
    }
  });
});
