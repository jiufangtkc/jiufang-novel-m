import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OPEN_DB_FAIL,
  OPEN_DB_NEWER_VERSION,
  OPEN_DB_NOT_JIUFANG,
  OPEN_DB_STORAGE_FAIL,
  openFileErrorMessage,
} from '../copy/userFacing';
import { TOAST_OPEN_FAIL_MS, toastDurationMs, verifyBytesForSave } from '../state/sampleStore';
import type { StoredBook } from './appSpace';
import * as browserSpace from './browserSpace';
import { loadStoredBooks, readBookBytes } from './library';
import { applyMigrations, currentSchemaVersion } from './migrations';
import { openNodeSql } from './nodeSql';
import { DatabaseOpenError, hasSqliteHeader, isDatabaseOpenError } from './openDbError';
import { readFileProject, validateJiufangDatabase, writeFileProject, type FileProjectInfo } from './projectFile';
import { createVersion1, createVersion14Shell } from './schemaFixture';
import { tableNames } from './sql';
import { openDesktopSampleMemoryDb } from './testing/desktopSampleDb';
import { verifyExportedDatabase } from './verifyDatabase';
import { openMemoryDb } from './wasmDb';

afterEach(() => {
  vi.restoreAllMocks();
});

function sampleInfo(title = '【範例】測試稿'): FileProjectInfo {
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
    lastOpenedNodeId: null,
    lastCursorPosition: 0,
  };
}

describe('WO-133 第 1 段：開檔九方稿件驗證與較新版格式攔截', () => {
  it('0 位元組與純文字假檔會拋出 not-jiufang 並對應 OPEN_DB_NOT_JIUFANG', async () => {
    expect(hasSqliteHeader(new Uint8Array(0))).toBe(false);
    expect(hasSqliteHeader(new TextEncoder().encode('SQLite format 3'))).toBe(false);

    await expect(readBookBytes('空檔.db', new Uint8Array(0), 'k-empty')).rejects.toSatisfy(
      (err: unknown) => isDatabaseOpenError(err) && err.code === 'not-jiufang',
    );

    const textBytes = new TextEncoder().encode('這只是純文字假檔內容，被改名成 .db');
    let caught: unknown;
    try {
      await readBookBytes('偽裝.db', textBytes, 'k-text');
    } catch (err) {
      caught = err;
    }
    expect(isDatabaseOpenError(caught)).toBe(true);
    expect((caught as DatabaseOpenError).code).toBe('not-jiufang');
    expect(openFileErrorMessage(caught)).toBe(OPEN_DB_NOT_JIUFANG);
    expect(toastDurationMs(OPEN_DB_NOT_JIUFANG)).toBe(TOAST_OPEN_FAIL_MS);
  });

  it('損壞的 SQLite 標頭檔案反序列化失敗時包裝為 not-jiufang', async () => {
    const fakeSqlite = new Uint8Array(128);
    fakeSqlite.set(new TextEncoder().encode('SQLite format 3\0'), 0);
    fakeSqlite.fill(0xff, 16);

    await expect(readBookBytes('壞檔.db', fakeSqlite, 'k-corrupt')).rejects.toSatisfy(
      (err: unknown) => isDatabaseOpenError(err) && err.code === 'not-jiufang',
    );
  });

  it('一般非九方 SQLite 檔（含他家 schema_version=99）會拋出 not-jiufang 且不補建九方表', async () => {
    const db = await openMemoryDb(new Uint8Array());
    try {
      db.sql.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
      db.sql.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT)');
      db.sql.run('INSERT INTO notes (body) VALUES (?)', ['【範例】筆記']);
      db.sql.run('INSERT INTO schema_version (version, applied_at) VALUES (99, ?)', ['2026-11-23']);
      const bytes = db.exportBytes();

      await expect(readBookBytes('notes.db', bytes, 'k-notes')).rejects.toSatisfy(
        (err: unknown) => isDatabaseOpenError(err) && err.code === 'not-jiufang',
      );

      expect(() => validateJiufangDatabase(db.sql)).toThrow(DatabaseOpenError);
      const tables = tableNames(db.sql);
      expect(tables.has('project_info')).toBe(false);
      expect(tables.has('chapters')).toBe(false);
      expect(tables.has('cards')).toBe(false);
      expect(tables.has('writing_logs')).toBe(false);
    } finally {
      db.close();
    }
  });

  it('較新版九方稿件（schema_version = 15 與 20）會拋出 newer-schema 且原表未被改寫', async () => {
    for (const ver of [15, 20]) {
      const db = await openMemoryDb(new Uint8Array());
      try {
        createVersion14Shell(db.sql);
        db.sql.run('INSERT INTO project_info (title) VALUES (?)', ['【範例】未來版']);
        db.sql.run('INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          'ch-future',
          null,
          '第一章',
          'file',
          '【範例】未來正文',
          'Draft',
          0,
        ]);
        db.sql.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [ver, '2027-01-01']);
        const bytes = db.exportBytes();

        let caught: unknown;
        try {
          await readBookBytes(`v${ver}.db`, bytes, `k-v${ver}`);
        } catch (err) {
          caught = err;
        }
        expect(isDatabaseOpenError(caught)).toBe(true);
        expect((caught as DatabaseOpenError).code).toBe('newer-schema');
        expect((caught as DatabaseOpenError).foundVersion).toBe(ver);
        expect(openFileErrorMessage(caught)).toBe(OPEN_DB_NEWER_VERSION);
        expect(toastDurationMs(OPEN_DB_NEWER_VERSION)).toBe(TOAST_OPEN_FAIL_MS);
        expect(currentSchemaVersion(db.sql)).toBe(ver);
      } finally {
        db.close();
      }
    }

    // 即使未來新版增減 cards / writing_logs，只要有 project_info + chapters 且 schema_version > 14，仍判為 newer-schema
    const futurePartial = openNodeSql();
    futurePartial.sql.exec('CREATE TABLE project_info (id INTEGER PRIMARY KEY, title TEXT)');
    futurePartial.sql.exec('CREATE TABLE chapters (id TEXT PRIMARY KEY, name TEXT)');
    futurePartial.sql.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)');
    futurePartial.sql.run('INSERT INTO schema_version (version) VALUES (16)');
    expect(() => readFileProject(futurePartial.sql)).toThrowError(
      expect.objectContaining({ code: 'newer-schema', foundVersion: 16 }),
    );
  });

  it('舊版相容回歸：v1、中間版（v5 缺後期欄位）、v14 與桌面假稿皆可正常開啟且新建稿件寫出與驗證通過', async () => {
    // 1) v1 假稿
    const dbV1 = await openMemoryDb(new Uint8Array());
    try {
      createVersion1(dbV1.sql);
      const loadedV1 = await readBookBytes('v1.db', dbV1.exportBytes(), 'k-v1');
      expect(loadedV1.title).toBe('【範例】舊檔');
      expect(loadedV1.tree[0]?.content).toBe('【範例】霧港只有這一句。');
    } finally {
      dbV1.close();
    }

    // 2) 中間版（升級到一半的 v5，無 schema_version 紀錄、缺後期欄位）
    const dbMid = await openMemoryDb(new Uint8Array());
    try {
      createVersion1(dbMid.sql);
      dbMid.sql.exec('ALTER TABLE project_info ADD COLUMN global_font_family TEXT');
      dbMid.sql.exec("ALTER TABLE chapters ADD COLUMN scene_summary TEXT DEFAULT ''");
      dbMid.sql.exec('CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, note TEXT, timestamp TEXT, word_count INTEGER, project_data TEXT)');
      const loadedMid = await readBookBytes('v5.db', dbMid.exportBytes(), 'k-mid');
      expect(loadedMid.title).toBe('【範例】舊檔');
      expect(loadedMid.tree[0]?.title).toBe('第一章　信');
    } finally {
      dbMid.close();
    }

    // 3) v14 空殼 + 桌面假稿
    const db14 = await openMemoryDb(new Uint8Array());
    try {
      createVersion14Shell(db14.sql);
      db14.sql.run('INSERT INTO project_info (title) VALUES (?)', ['【範例】v14 測試']);
      const loaded14 = await readBookBytes('v14.db', db14.exportBytes(), 'k-14');
      expect(loaded14.title).toBe('【範例】v14 測試');
    } finally {
      db14.close();
    }

    const desktopDb = await openDesktopSampleMemoryDb();
    try {
      const desktopLoaded = await readBookBytes('desktop.db', desktopDb.exportBytes(), 'k-desktop');
      expect(desktopLoaded.tree.length).toBeGreaterThan(0);
      expect(desktopLoaded.cards.length).toBeGreaterThan(0);
    } finally {
      desktopDb.close();
    }

    // 4) 全新空白稿 writeFileProject 寫出後可正常讀回且 verifyBytesForSave 通過
    const fresh = await openMemoryDb(new Uint8Array());
    let freshBytes: Uint8Array;
    try {
      writeFileProject(
        fresh.sql,
        sampleInfo('【範例】全新稿件'),
        [{ id: 'ch-1', type: 'file', title: '第一章　', progress: 'Draft', content: '【範例】開筆' }],
        [],
        [],
      );
      freshBytes = fresh.exportBytes();
    } finally {
      fresh.close();
    }
    await expect(verifyBytesForSave(freshBytes)).resolves.toBeUndefined();
    const reopened = await readBookBytes('fresh.db', freshBytes, 'k-fresh');
    expect(reopened.title).toBe('【範例】全新稿件');
    expect(reopened.tree[0]?.content).toBe('【範例】開筆');
  });

  it('存檔驗證會擋下版本超過 14 或缺九方底表的資料庫', async () => {
    const header = new TextEncoder().encode('SQLite format 3\0');
    await expect(verifyExportedDatabase(header, async () => 15)).rejects.toThrow('15');

    const dbFuture = await openMemoryDb(new Uint8Array());
    try {
      createVersion14Shell(dbFuture.sql);
      dbFuture.sql.run('INSERT INTO schema_version (version, applied_at) VALUES (15, ?)', ['2027-01-01']);
      await expect(verifyBytesForSave(dbFuture.exportBytes())).rejects.toThrow(DatabaseOpenError);
    } finally {
      dbFuture.close();
    }

    const dbForeign = await openMemoryDb(new Uint8Array());
    try {
      dbForeign.sql.exec('CREATE TABLE other (id INTEGER PRIMARY KEY)');
      dbForeign.sql.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)');
      dbForeign.sql.run('INSERT INTO schema_version (version) VALUES (14)');
      await expect(verifyBytesForSave(dbForeign.exportBytes())).rejects.toThrow(DatabaseOpenError);
    } finally {
      dbForeign.close();
    }
  });

  it('loadStoredBooks 遇到單本損毀暫存時會略過，不拖垮其餘正常稿件載入', async () => {
    const dbGood = await openMemoryDb(new Uint8Array());
    let goodBytes: Uint8Array;
    try {
      applyMigrations(dbGood.sql);
      dbGood.sql.run('INSERT INTO project_info (title) VALUES (?)', ['【範例】正常稿']);
      goodBytes = dbGood.exportBytes();
    } finally {
      dbGood.close();
    }

    const stored: StoredBook[] = [
      { key: 'bad-empty', filename: '壞1.db', title: '壞1', bytes: new Uint8Array(0) },
      { key: 'bad-text', filename: '壞2.db', title: '壞2', bytes: new TextEncoder().encode('not sqlite') },
      { key: 'good-1', filename: '正常.db', title: '【範例】正常稿', bytes: goodBytes },
    ];
    vi.spyOn(browserSpace, 'appSpace').mockResolvedValue({
      put: async () => undefined,
      get: async () => null,
      list: async () => stored,
      remove: async () => undefined,
    });

    const loaded = await loadStoredBooks();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.key).toBe('good-1');
    expect(loaded[0]?.title).toBe('【範例】正常稿');
  });

  it('openFileErrorMessage 與 toastDurationMs 對四類錯誤回傳正確文案與 5 秒停留', () => {
    expect(openFileErrorMessage(new DatabaseOpenError('not-jiufang'))).toBe(OPEN_DB_NOT_JIUFANG);
    expect(openFileErrorMessage(new DatabaseOpenError('newer-schema', 15))).toBe(OPEN_DB_NEWER_VERSION);
    expect(openFileErrorMessage(new DatabaseOpenError('storage-failed'))).toBe(OPEN_DB_STORAGE_FAIL);
    expect(openFileErrorMessage(new Error('unknown'))).toBe(OPEN_DB_FAIL);

    expect(toastDurationMs(OPEN_DB_NOT_JIUFANG)).toBe(5000);
    expect(toastDurationMs(OPEN_DB_NEWER_VERSION)).toBe(5000);
    expect(toastDurationMs(OPEN_DB_STORAGE_FAIL)).toBe(5000);
    expect(toastDurationMs(OPEN_DB_FAIL)).toBe(5000);
  });
});
