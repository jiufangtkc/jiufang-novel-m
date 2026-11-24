import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_UNSAVED_BADGE,
  OPEN_DB_FAIL,
  OPEN_DB_NEWER_VERSION,
  OPEN_DB_NOT_JIUFANG,
  OPEN_DB_STORAGE_FAIL,
  SAVE_FATAL_FAIL,
  openFileErrorMessage,
} from '../copy/userFacing';
import * as browserSpace from '../db/browserSpace';
import type { DiskFile, TargetStore } from '../db/fileTarget';
import { DatabaseOpenError } from '../db/openDbError';
import { forgetOpenFile, recallOpenFile } from '../db/openFileMemory';
import { writeFileProject, type FileProjectInfo } from '../db/projectFile';
import { autoSaveProjectToPlace, type SaveEnvironment } from '../db/saveProject';
import { openMemoryDb } from '../db/wasmDb';
import { resolveAutoSaveStatus, resolveHeaderSaveDisplay } from '../domain/autoSave';
import { unifiedFocusSaveLabel } from '../screens/editorSaveStatus';
import {
  createState,
  openDatabaseManuscript,
  reduce,
  runManualSaveProject,
  verifyBytesForSave,
  type Action,
  type SampleState,
} from './sampleStore';

afterEach(() => {
  vi.restoreAllMocks();
});

function sampleInfo(title = '【範例】記不住位置稿'): FileProjectInfo {
  return {
    title,
    logline: '',
    currentTheme: '',
    globalFontFamily: '',
    globalFontSize: 12,
    editorFontFamily: '',
    editorFontSize: 16,
    targetWordCount: 10000,
    dailyTargetWordCount: 500,
    categoryOrder: null,
    expandedCategories: null,
    categoriesMeta: '{}',
    lastOpenedNodeId: 'ch-1',
    lastCursorPosition: 0,
  };
}

async function buildSampleDbBytes(title = '【範例】記不住位置稿'): Promise<Uint8Array> {
  const db = await openMemoryDb(new Uint8Array());
  try {
    writeFileProject(
      db.sql,
      sampleInfo(title),
      [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　霧港',
          progress: 'Draft',
          content: '【範例】這一段正文一定要完整打開。',
        },
      ],
      [],
      [],
    );
    return db.exportBytes();
  } finally {
    db.close();
  }
}

function makeMemoryDiskFile(initialBytes: Uint8Array, name = '範例.db'): {
  file: DiskFile;
  getBytes: () => Uint8Array;
  getWriteCount: () => number;
} {
  let current = initialBytes.slice();
  let writes = 0;
  const file: DiskFile = {
    name,
    async read() {
      return current.slice();
    },
    async write(bytes) {
      current = bytes.slice();
      writes += 1;
    },
    async queryPermission() {
      return 'granted';
    },
    async requestPermission() {
      return 'granted';
    },
  };
  return {
    file,
    getBytes: () => current,
    getWriteCount: () => writes,
  };
}

describe('WO-133 第 2 段：記不住原檔位置照常開稿與開檔錯誤分流', () => {
  it('targets.save 拋出 IndexedDB 錯誤時，picker 與 importFile 核心流程皆正常開稿且不顯示 OPEN_DB_FAIL，當次存檔仍可寫回且不報 SAVE_FATAL_FAIL', async () => {
    const sampleBytes = await buildSampleDbBytes();
    const { file: diskFile, getWriteCount } = makeMemoryDiskFile(sampleBytes, '霧港範例.db');

    const stored = new Map<string, unknown>();
    vi.spyOn(browserSpace, 'appSpace').mockResolvedValue({
      put: async (book) => {
        stored.set(book.key, book);
      },
      get: async (key) => (stored.get(key) as never) ?? null,
      list: async () => [],
      remove: async (key) => {
        stored.delete(key);
      },
    });

    const failingTargets: TargetStore = {
      async save() {
        throw new DOMException('IndexedDB 寫入把手失敗', 'UnknownError');
      },
      async load() {
        throw new DOMException('IndexedDB 讀取失敗', 'UnknownError');
      },
      async remove() {},
    };

    const actions: Action[] = [];
    let state: SampleState = createState(new Date('2026-11-23T23:10:00+08:00'));
    const dispatch = (action: Action) => {
      actions.push(action);
      state = reduce(state, action);
    };

    const opened = await openDatabaseManuscript({
      filename: '霧港範例.db',
      bytes: sampleBytes,
      diskFile,
      dispatch,
      env: { targets: failingTargets },
      store: null,
      now: new Date('2026-11-23T23:10:00+08:00'),
    });

    expect(opened.id).toContain('file-');
    expect(opened.chapterId).toBe('ch-1');
    const project = state.projects.find((item) => item.id === opened.id);
    expect(project).toBeDefined();
    expect(project?.title).toBe('【範例】記不住位置稿');
    expect(project?.nodes[0]?.content).toBe('【範例】這一段正文一定要完整打開。');
    expect(state.toast).toBeNull();
    expect(actions.some((a) => a.type === 'toast' && a.message === OPEN_DB_FAIL)).toBe(false);
    expect(recallOpenFile(opened.id)).toBe(diskFile);

    // 同一輪操作中（targets.load 也壞掉時），手動儲存透過記憶體把手直接寫回，不報 SAVE_FATAL_FAIL
    const pickedSpy = vi.fn(async () => null);
    const saveEnv: SaveEnvironment = {
      canPickFiles: true,
      targets: failingTargets,
      verify: verifyBytesForSave,
      pickSaveLocation: pickedSpy,
      share: async () => 'cancelled',
    };
    const saveActions: Action[] = [];
    const manualOutcome = await runManualSaveProject({
      getState: () => state,
      dispatch: (action) => {
        saveActions.push(action);
        state = reduce(state, action);
      },
      env: saveEnv,
      inflight: { current: null },
      lastSavedRevById: {},
      onSaved: () => undefined,
      snapshot: async () => ({ key: opened.id, bytes: sampleBytes }),
      store: null,
    });

    expect(manualOutcome).toEqual({ kind: 'saved', filename: '霧港範例.db' });
    expect(getWriteCount()).toBe(1);
    expect(pickedSpy).not.toHaveBeenCalled();
    expect(saveActions.some((a) => a.type === 'toast' && a.message === SAVE_FATAL_FAIL)).toBe(false);

    // 同時確認無原檔把手（importFile 路徑）且 targets.save 失敗時，一樣可正常開稿；
    // 之後按下儲存可改走選存檔位置視窗，不報 SAVE_FATAL_FAIL
    const imported = await openDatabaseManuscript({
      filename: '霧港匯入.db',
      bytes: sampleBytes,
      diskFile: null,
      dispatch,
      env: { targets: failingTargets },
      store: null,
      now: new Date('2026-11-23T23:11:00+08:00'),
    });
    expect(state.projects.find((item) => item.id === imported.id)?.nodes[0]?.content).toBe(
      '【範例】這一段正文一定要完整打開。',
    );
    expect(actions.some((a) => a.type === 'toast' && a.message === OPEN_DB_FAIL)).toBe(false);

    const { file: pickedNewFile, getWriteCount: getPickedWrites } = makeMemoryDiskFile(new Uint8Array(), '另選位置.db');
    const pickOutcome = await runManualSaveProject({
      getState: () => state,
      dispatch: (action) => {
        saveActions.push(action);
        state = reduce(state, action);
      },
      env: {
        ...saveEnv,
        pickSaveLocation: async () => pickedNewFile,
      },
      inflight: { current: null },
      lastSavedRevById: {},
      onSaved: () => undefined,
      snapshot: async () => ({ key: imported.id, bytes: sampleBytes }),
      store: null,
    });
    expect(pickOutcome).toEqual({ kind: 'saved', filename: '另選位置.db' });
    expect(getPickedWrites()).toBe(1);
    expect(saveActions.some((a) => a.type === 'toast' && a.message === SAVE_FATAL_FAIL)).toBe(false);

    forgetOpenFile(opened.id);
    forgetOpenFile(imported.id);
  });

  it('targets.save 失敗後模擬重開分頁（記憶體把手清空、targets.load 回 null）：自動存檔回 no-handle 且頁首狀態顯示「還沒存成檔案」', async () => {
    const sampleBytes = await buildSampleDbBytes();
    const emptyTargets: TargetStore = {
      async save() {
        throw new Error('IDB quota');
      },
      async load() {
        return null;
      },
      async remove() {},
    };

    const autoOutcome = await autoSaveProjectToPlace(
      { targets: emptyTargets, verify: verifyBytesForSave },
      'file-reloaded',
      sampleBytes,
      '重載範例.db',
      null,
    );
    expect(autoOutcome).toEqual({ kind: 'no-handle' });

    const autoStatus = resolveAutoSaveStatus({
      canPickFiles: true,
      isSample: false,
      removed: false,
      hasSavedFile: false,
      needsNewName: false,
      permission: 'none',
      lastAutoSaveFailed: false,
    });
    expect(autoStatus).toBe('unsaved');
    const headerKind = resolveHeaderSaveDisplay({
      isSample: false,
      autoSaveStatus: autoStatus,
      staleDays: null,
      lastFileSaveMs: null,
    });
    expect(headerKind).toBe('unsaved');
    expect(
      unifiedFocusSaveLabel({
        headerKind,
        isSample: false,
        staleDays: null,
        lastFileSaveMs: null,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: null,
      }),
    ).toBe(AUTOSAVE_UNSAVED_BADGE);
  });

  it('putBook 拋出空間不足時，不誤報 OPEN_DB_FAIL，改拋 storage-failed 並顯示 OPEN_DB_STORAGE_FAIL', async () => {
    const sampleBytes = await buildSampleDbBytes();
    vi.spyOn(browserSpace, 'appSpace').mockResolvedValue({
      put: async () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      get: async () => null,
      list: async () => [],
      remove: async () => undefined,
    });

    let caught: unknown;
    try {
      await openDatabaseManuscript({
        filename: '滿空間.db',
        bytes: sampleBytes,
        diskFile: null,
        dispatch: () => undefined,
        env: {
          targets: {
            save: async () => undefined,
            load: async () => null,
            remove: async () => undefined,
          },
        },
        store: null,
        now: new Date('2026-11-23T23:12:00+08:00'),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseOpenError);
    expect((caught as DatabaseOpenError).code).toBe('storage-failed');
    expect(openFileErrorMessage(caught)).toBe(OPEN_DB_STORAGE_FAIL);
    expect(openFileErrorMessage(caught)).not.toBe(OPEN_DB_FAIL);
  });

  it('openFileErrorMessage 正確對應四類開檔錯誤文案', () => {
    expect(openFileErrorMessage(new DatabaseOpenError('not-jiufang'))).toBe(OPEN_DB_NOT_JIUFANG);
    expect(openFileErrorMessage(new DatabaseOpenError('newer-schema', 15))).toBe(OPEN_DB_NEWER_VERSION);
    expect(openFileErrorMessage(new DatabaseOpenError('storage-failed'))).toBe(OPEN_DB_STORAGE_FAIL);
    expect(openFileErrorMessage(new Error('other'))).toBe(OPEN_DB_FAIL);
  });
});
