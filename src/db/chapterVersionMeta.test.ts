import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createManuscriptVersion,
  MANUSCRIPT_VERSION_AUTO_NOTE,
  type ManuscriptVersion,
} from '../domain/manuscriptVersions';
import type { StoredBook } from './appSpace';
import * as browserSpace from './browserSpace';
import {
  assertChapterVersionDataWritable,
  CHAPTER_VERSION_FORMAT_REVISION,
  CHAPTER_VERSION_META_TABLE,
  CHAPTER_VERSION_TABLES,
  CHAPTER_VERSIONS_TABLE,
  ChapterVersionDataError,
  readChapterVersionData,
  writeChapterVersionData,
} from './chapterVersionMeta';
import {
  isExtensionReadOnlyPreserved,
  shouldBlockSaveForExtension,
} from './extensionMeta';
import {
  loadStoredBooks,
  readBookBytes,
  saveBookBytes,
  writeBookBytes,
} from './library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion } from './migrations';
import {
  proofFingerprints,
  readFileProject,
  snapshotFingerprints,
  writeFileProject,
} from './projectFile';
import { openNodeSql } from './nodeSql';
import { createVersion1, createVersion14Shell } from './schemaFixture';
import { tableNames, type Sql, type SqlValue } from './sql';
import {
  generateDesktopSampleBytes,
  openDesktopSampleMemoryDb,
  SAMPLE_DESKTOP_SCHEMA_VERSIONS,
} from './testing/desktopSampleDb';
import { openMemoryDb } from './wasmDb';

afterEach(() => {
  vi.restoreAllMocks();
});

async function withDb<T>(bytes: Uint8Array, run: (sql: Sql) => T | Promise<T>): Promise<T> {
  const db = await openMemoryDb(bytes);
  try {
    return await run(db.sql);
  } finally {
    db.close();
  }
}

async function mutate(bytes: Uint8Array, run: (sql: Sql) => void): Promise<Uint8Array> {
  const db = await openMemoryDb(bytes);
  try {
    run(db.sql);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

function dumpAllTablesExceptSequence(sql: Sql): Record<string, Record<string, unknown>[]> {
  const names = [...tableNames(sql)]
    .filter((name) => name !== 'sqlite_sequence')
    .sort();
  const dump: Record<string, Record<string, unknown>[]> = {};
  for (const name of names) {
    dump[name] = sql.select(`SELECT * FROM ${name} ORDER BY rowid`);
  }
  return dump;
}

function dumpTables(sql: Sql, names: readonly string[]): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const name of names) {
    out[name] = sql.select(`SELECT * FROM ${name} ORDER BY rowid`);
  }
  return out;
}

function tableShapes(sql: Sql, names: readonly string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const name of names) {
    out[name] = sql.select(`PRAGMA table_info(${name})`);
  }
  return out;
}

function sampleVersions(): ManuscriptVersion[] {
  return [
    createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666661',
      chapter_id: 'ch-sample-doc-1',
      chapter_title_snapshot: '【範例】第一章　霧中燈號',
      content: '【範例】霧港北岬角的燈塔在夜裡閃爍，引水船緩緩進港。',
      note: '大改前留底',
      source: 'manual',
      saved_at_ms: 1_700_000_003_000,
      sort_order: 0,
    }),
    createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666662',
      chapter_id: 'ch-sample-doc-1',
      chapter_title_snapshot: '【範例】第一章　霧中燈號',
      content: '【範例】舊版段落：石階潮濕，鐘聲從霧裡傳來。',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
      source: 'auto-before-restore',
      saved_at_ms: 1_700_000_002_000,
      sort_order: 0,
    }),
    createManuscriptVersion({
      version_id: '22222222-3333-4444-8555-666666666663',
      chapter_id: 'ch-sample-doc-2',
      chapter_title_snapshot: '【範例】第二章　暗礁航道',
      content: '',
      note: '',
      source: 'manual',
      saved_at_ms: 1_700_000_001_000,
      sort_order: 0,
    }),
  ];
}

describe('WO-140 第 2 段：舊檔安全與零寫入保證', () => {
  it('v1、v14 與 desktopSampleDb：只讀回傳 absent、不建表、schema_version 維持 14 且零寫入', async () => {
    // 1. v1 舊檔升 v14（僅於記憶體開啟驗證）
    const { sql: sqlV1 } = openNodeSql();
    createVersion1(sqlV1);
    const loadedV1 = readFileProject(sqlV1);
    expect(CURRENT_SCHEMA_VERSION).toBe(14);
    expect(currentSchemaVersion(sqlV1)).toBe(14);
    expect(loadedV1.chapterVersions).toEqual({ kind: 'absent' });
    for (const table of CHAPTER_VERSION_TABLES) {
      expect(tableNames(sqlV1).has(table)).toBe(false);
    }

    // 2. v14 無附加表
    const { sql: sqlV14 } = openNodeSql();
    createVersion14Shell(sqlV14);
    sqlV14.run(
      'INSERT INTO project_info (title, logline, categories_meta) VALUES (?, ?, ?)',
      ['【範例】v14 舊檔', '', '{}'],
    );
    const beforeV14Versions = sqlV14.select('SELECT * FROM schema_version ORDER BY version');
    const loadedV14 = readFileProject(sqlV14);
    expect(loadedV14.chapterVersions).toEqual({ kind: 'absent' });
    expect(sqlV14.select('SELECT * FROM schema_version ORDER BY version')).toEqual(beforeV14Versions);
    for (const table of CHAPTER_VERSION_TABLES) {
      expect(tableNames(sqlV14).has(table)).toBe(false);
    }

    // 3. desktopSampleDb 開啟與未傳／空清單寫回：零 DDL、零 DML
    const db = await openDesktopSampleMemoryDb();
    try {
      const beforeAll = dumpAllTablesExceptSequence(db.sql);
      const beforeSnap = snapshotFingerprints(db.sql);
      const loadedDesktop = readFileProject(db.sql);
      expect(loadedDesktop.chapterVersions).toEqual({ kind: 'absent' });
      expect(currentSchemaVersion(db.sql)).toBe(14);
      expect(db.sql.select('SELECT version, applied_at FROM schema_version ORDER BY version')).toEqual(
        SAMPLE_DESKTOP_SCHEMA_VERSIONS.map((row) => ({ ...row })),
      );
      expect(dumpAllTablesExceptSequence(db.sql)).toEqual(beforeAll);

      const dmlStatements: string[] = [];
      const countingSql: Sql = {
        exec: (statement) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(statement)) {
            dmlStatements.push(statement);
          }
          db.sql.exec(statement);
        },
        run: (statement, params) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(statement)) {
            dmlStatements.push(statement);
          }
          db.sql.run(statement, params);
        },
        select: (statement, params) => db.sql.select(statement, params),
      };

      const changesBefore = Number(db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);
      writeFileProject(
        countingSql,
        loadedDesktop.info,
        loadedDesktop.tree,
        loadedDesktop.cards,
        loadedDesktop.logs,
      );
      writeFileProject(
        countingSql,
        loadedDesktop.info,
        loadedDesktop.tree,
        loadedDesktop.cards,
        loadedDesktop.logs,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
      );
      const changesAfter = Number(db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);

      expect(dmlStatements).toEqual([]);
      expect(changesAfter).toBe(changesBefore);
      expect(dumpAllTablesExceptSequence(db.sql)).toEqual(beforeAll);
      expect(snapshotFingerprints(db.sql)).toEqual(beforeSnap);
      for (const table of CHAPTER_VERSION_TABLES) {
        expect(tableNames(db.sql).has(table)).toBe(false);
      }
    } finally {
      db.close();
    }
  });
});

describe('WO-140 第 2 段：懶建立、往返、差異同步與 library 透傳', () => {
  it('第一次寫入才建表、9 欄與空白章往返一致、差異更新保留未知欄／未知表', async () => {
    const raw = await mutate(await generateDesktopSampleBytes(), (sql) => {
      sql.run(
        'INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES (?, ?, ?, ?, ?)',
        ['【範例】既有快照', '【範例】不可改動', '2026-11-26 10:00:00', 100, '{"snap":1}'],
      );
      sql.exec('CREATE TABLE desktop_future_table (id INTEGER PRIMARY KEY, payload BLOB, note TEXT)');
      sql.run('INSERT INTO desktop_future_table (id, payload, note) VALUES (1, ?, ?)', [
        new Uint8Array([3, 1, 4, 0, 5]),
        '【範例】電腦版未知表',
      ]);
    });

    const beforeCheck = await withDb(raw, (sql) => ({
      snapshots: snapshotFingerprints(sql),
      proofs: proofFingerprints(sql),
      futureTable: sql.select('SELECT * FROM desktop_future_table ORDER BY id'),
    }));

    const book = await readBookBytes('範例版本稿.db', raw, 'file-ver-roundtrip');
    expect(book.chapterVersions).toEqual({ kind: 'absent' });

    const versions = sampleVersions();
    const saved = await writeBookBytes(
      raw,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      undefined,
      versions,
    );

    const reopened = await readBookBytes('範例版本稿.db', saved, 'file-ver-reopen');
    expect(reopened.chapterVersions).toEqual({
      kind: 'ok',
      revision: CHAPTER_VERSION_FORMAT_REVISION,
      versions,
    });

    await withDb(saved, (sql) => {
      expect(sql.select(`SELECT * FROM ${CHAPTER_VERSION_META_TABLE}`)).toEqual([
        { id: 1, format_revision: CHAPTER_VERSION_FORMAT_REVISION },
      ]);
      expect(sql.select(`PRAGMA foreign_key_list(${CHAPTER_VERSIONS_TABLE})`)).toEqual([]);
      expect(snapshotFingerprints(sql)).toEqual(beforeCheck.snapshots);
      expect(proofFingerprints(sql)).toEqual(beforeCheck.proofs);
      expect(sql.select('SELECT * FROM desktop_future_table ORDER BY id')).toEqual(
        beforeCheck.futureTable,
      );
      const blob = sql.select('SELECT payload FROM desktop_future_table')[0]!.payload as SqlValue;
      expect(Array.from(blob as Uint8Array)).toEqual([3, 1, 4, 0, 5]);
    });

    // 在附加表加入未來未知欄位後，修改第二則備註為手寫並移除第三則：未知欄位必須原樣留著
    const withExtraCol = await mutate(saved, (sql) => {
      sql.exec(`ALTER TABLE ${CHAPTER_VERSIONS_TABLE} ADD COLUMN future_tag TEXT DEFAULT 'v2-keep'`);
    });
    const updatedVersions: ManuscriptVersion[] = [
      versions[0]!,
      { ...versions[1]!, note: '補寫的備註', source: 'manual' },
    ];

    const savedUpdated = await writeBookBytes(
      withExtraCol,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      undefined,
      updatedVersions,
    );

    await withDb(savedUpdated, (sql) => {
      expect(readChapterVersionData(sql)).toEqual({
        kind: 'ok',
        revision: CHAPTER_VERSION_FORMAT_REVISION,
        versions: updatedVersions,
      });
      expect(
        sql.select(
          `SELECT version_id, note, source, future_tag FROM ${CHAPTER_VERSIONS_TABLE} ORDER BY saved_at_ms DESC`,
        ),
      ).toEqual([
        {
          version_id: versions[0]!.version_id,
          note: '大改前留底',
          source: 'manual',
          future_tag: 'v2-keep',
        },
        {
          version_id: versions[1]!.version_id,
          note: '補寫的備註',
          source: 'manual',
          future_tag: 'v2-keep',
        },
      ]);
      expect(sql.select('SELECT * FROM desktop_future_table ORDER BY id')).toEqual(
        beforeCheck.futureTable,
      );
      // 再傳相同清單應回 skipped，零 DML
      expect(writeChapterVersionData(sql, updatedVersions)).toBe('skipped');
    });
  });

  it('saveBookBytes 與 loadStoredBooks 正確透傳 chapterVersions', async () => {
    const store = new Map<string, StoredBook>();
    vi.spyOn(browserSpace, 'appSpace').mockResolvedValue({
      put: async (book) => {
        store.set(book.key, book);
      },
      get: async (key) => store.get(key) ?? null,
      list: async () => [...store.values()],
      remove: async (key) => {
        store.delete(key);
      },
    });

    const raw = await generateDesktopSampleBytes();
    const book = await readBookBytes('範例本機庫.db', raw, 'book-lib-1');
    const versions = sampleVersions();

    await saveBookBytes(
      book.key,
      book.filename,
      book.title,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      versions,
    );

    const loaded = await loadStoredBooks();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.chapterVersions).toEqual({
      kind: 'ok',
      revision: CHAPTER_VERSION_FORMAT_REVISION,
      versions,
    });
  });
});

describe('WO-140 第 2 段：電腦版相容、決-3 刪章保留與共用表不變', () => {
  it('共用 8 表結構與 schema_version 不變、PRAGMA foreign_keys = ON 刪章不擋、決-3 不降級也不刪列', async () => {
    const raw = await generateDesktopSampleBytes();
    const desktopTables = [
      'project_info',
      'chapters',
      'cards',
      'writing_logs',
      'snapshots',
      'proofread_results',
      'proofread_ignored_rules',
      'schema_version',
    ];
    const beforeShapes = await withDb(raw, (sql) => tableShapes(sql, desktopTables));
    const beforeSnap = await withDb(raw, (sql) => snapshotFingerprints(sql));
    const book = await readBookBytes('相容稿.db', raw, 'file-compat');
    const versions = sampleVersions();

    const withVersions = await writeBookBytes(
      raw,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      undefined,
      versions,
    );

    // 模擬電腦版在 PRAGMA foreign_keys = ON 下刪除第一章，並修改第二章正文
    const afterDesktopDelete = await mutate(withVersions, (sql) => {
      sql.exec('PRAGMA foreign_keys = ON');
      expect(currentSchemaVersion(sql)).toBe(14);
      expect(
        sql.select('SELECT version, applied_at FROM schema_version ORDER BY version'),
      ).toEqual(SAMPLE_DESKTOP_SCHEMA_VERSIONS.map((row) => ({ ...row })));
      expect(tableShapes(sql, desktopTables)).toEqual(beforeShapes);
      expect(snapshotFingerprints(sql)).toEqual(beforeSnap);

      sql.run("DELETE FROM chapters WHERE id = 'ch-sample-doc-1'");
      sql.run("UPDATE chapters SET content = ? WHERE id = 'ch-sample-doc-2'", [
        '【範例】第二章更新後正文',
      ]);
    });

    // 舊版未傳 chapterVersions 寫回時，版本附加表原樣留著；且決-3 不把已刪章的 chapter_id 改成 NULL 也不刪列
    const reopenedByOld = await readBookBytes('舊版重存.db', afterDesktopDelete, 'file-old');
    expect(reopenedByOld.chapterVersions).toEqual({
      kind: 'ok',
      revision: CHAPTER_VERSION_FORMAT_REVISION,
      versions,
    });

    const resavedByOld = await writeBookBytes(
      afterDesktopDelete,
      reopenedByOld.info,
      reopenedByOld.tree,
      reopenedByOld.cards,
      reopenedByOld.logs,
    );

    await withDb(resavedByOld, (sql) => {
      const readBack = readChapterVersionData(sql);
      expect(readBack).toEqual({
        kind: 'ok',
        revision: CHAPTER_VERSION_FORMAT_REVISION,
        versions,
      });
      if (readBack.kind === 'ok') {
        const deletedChapterVersions = readBack.versions.filter(
          (v) => v.chapter_id === 'ch-sample-doc-1',
        );
        expect(deletedChapterVersions).toHaveLength(2);
        expect(deletedChapterVersions.every((v) => v.chapter_id === 'ch-sample-doc-1')).toBe(true);
      }
      expect(snapshotFingerprints(sql)).toEqual(beforeSnap);
      expect(currentSchemaVersion(sql)).toBe(14);
    });
  });
});

describe('WO-140 第 2 段：四態保護與交易回滾', () => {
  async function baseWithVersions(): Promise<Uint8Array> {
    const raw = await generateDesktopSampleBytes();
    const book = await readBookBytes('基底.db', raw, 'file-base');
    return writeBookBytes(
      raw,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      undefined,
      sampleVersions(),
    );
  }

  it('newer-revision（format_revision = 2）唯讀保留、不覆寫附加表、放行正文存檔', async () => {
    const newer = await mutate(await baseWithVersions(), (sql) => {
      sql.exec(`ALTER TABLE ${CHAPTER_VERSIONS_TABLE} ADD COLUMN future_note TEXT DEFAULT 'v2'`);
      sql.exec(`UPDATE ${CHAPTER_VERSION_META_TABLE} SET format_revision = 2`);
    });
    const beforeVersionTables = await withDb(newer, (sql) =>
      dumpTables(sql, CHAPTER_VERSION_TABLES),
    );

    await withDb(newer, (sql) => {
      const state = readChapterVersionData(sql);
      expect(state).toEqual({ kind: 'newer-revision', revision: 2 });
      expect(isExtensionReadOnlyPreserved(state.kind)).toBe(true);
      expect(shouldBlockSaveForExtension(state)).toBe(false);
      expect(() => assertChapterVersionDataWritable(sql)).not.toThrow();
      expect(writeChapterVersionData(sql, [])).toBe('newer-revision');
    });

    const book = await readBookBytes('較新版.db', newer, 'file-newer');
    const nextTree = structuredClone(book.tree);
    nextTree[0]!.children![0]!.content = '【範例】較新版版本表下修改的正文';
    const saved = await writeBookBytes(
      newer,
      book.info,
      nextTree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    );

    await withDb(saved, (sql) => {
      expect(dumpTables(sql, CHAPTER_VERSION_TABLES)).toEqual(beforeVersionTables);
      expect(readFileProject(sql).tree[0]!.children![0]!.content).toBe(
        '【範例】較新版版本表下修改的正文',
      );
    });
  });

  const corruptCases: Array<[string, (sql: Sql) => void]> = [
    ['format_revision = 0', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSION_META_TABLE} SET format_revision = 0`)],
    ['format_revision 非整數', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSION_META_TABLE} SET format_revision = 'v1'`)],
    ['中繼表被清空', (sql) => sql.exec(`DELETE FROM ${CHAPTER_VERSION_META_TABLE}`)],
    ['缺 jiufangm_chapter_version_meta', (sql) => sql.exec(`DROP TABLE ${CHAPTER_VERSION_META_TABLE}`)],
    ['缺 jiufangm_chapter_versions', (sql) => sql.exec(`DROP TABLE ${CHAPTER_VERSIONS_TABLE}`)],
    ['chapter_id 為空字串', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSIONS_TABLE} SET chapter_id = ''`)],
    ['word_count 為負數', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSIONS_TABLE} SET word_count = -1`)],
    ['saved_at_ms 為 0', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSIONS_TABLE} SET saved_at_ms = 0`)],
    ['source 為非法值', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSIONS_TABLE} SET source = 'other'`)],
    ['note 型別為 BLOB', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSIONS_TABLE} SET note = X'0102'`)],
    ['sort_order 為負數', (sql) => sql.exec(`UPDATE ${CHAPTER_VERSIONS_TABLE} SET sort_order = -1`)],
  ];

  it.each(corruptCases)(
    'corrupt 防護（%s）：不擋開檔、不覆寫原表、assertChapterVersionDataWritable 擋下存檔',
    async (_label, breakIt) => {
      const bad = await mutate(await baseWithVersions(), breakIt);
      const beforeTables = await withDb(bad, (sql) =>
        dumpTables(
          sql,
          CHAPTER_VERSION_TABLES.filter((name) => tableNames(sql).has(name)),
        ),
      );

      await withDb(bad, (sql) => {
        const loaded = readFileProject(sql);
        expect(loaded.chapterVersions.kind).toBe('corrupt');
        expect(isExtensionReadOnlyPreserved(loaded.chapterVersions.kind)).toBe(true);
        expect(shouldBlockSaveForExtension(loaded.chapterVersions)).toBe(true);
        expect(writeChapterVersionData(sql, [])).toBe('corrupt');
        expect(() => assertChapterVersionDataWritable(sql)).toThrow(ChapterVersionDataError);
      });

      const book = await readBookBytes('損壞稿.db', bad, 'file-bad');
      const nextTree = structuredClone(book.tree);
      nextTree[0]!.children![0]!.content = '【範例】損壞版本表下修改的正文';
      const saved = await writeBookBytes(
        bad,
        book.info,
        nextTree,
        book.cards,
        book.logs,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
      );

      await withDb(saved, (sql) => {
        expect(
          dumpTables(
            sql,
            CHAPTER_VERSION_TABLES.filter((name) => tableNames(sql).has(name)),
          ),
        ).toEqual(beforeTables);
        expect(readFileProject(sql).tree[0]!.children![0]!.content).toBe(
          '【範例】損壞版本表下修改的正文',
        );
        expect(() => assertChapterVersionDataWritable(sql)).toThrow(ChapterVersionDataError);
      });
    },
  );

  it('寫入驗證失敗或中途 SQL 拋錯時整筆交易 ROLLBACK', async () => {
    const raw = await generateDesktopSampleBytes();
    const book = await readBookBytes('回滾測試.db', raw, 'file-rb');

    await withDb(raw, (sql) => {
      const beforeAll = dumpAllTablesExceptSequence(sql);
      const invalidVersion = { ...sampleVersions()[0]!, chapter_id: '' };
      expect(() =>
        writeFileProject(
          sql,
          book.info,
          book.tree,
          book.cards,
          book.logs,
          undefined,
          undefined,
          undefined,
          undefined,
          [invalidVersion],
        ),
      ).toThrow(ChapterVersionDataError);
      expect(dumpAllTablesExceptSequence(sql)).toEqual(beforeAll);
      for (const table of CHAPTER_VERSION_TABLES) {
        expect(tableNames(sql).has(table)).toBe(false);
      }
    });

    await withDb(raw, (sql) => {
      const beforeAll = dumpAllTablesExceptSequence(sql);
      const modifiedInfo = { ...book.info, title: '【範例】不該留下的書名' };
      const failingSql: Sql = {
        exec: (s) => sql.exec(s),
        select: (s, p) => sql.select(s, p),
        run: (s, p) => {
          if (s.includes(`INSERT INTO ${CHAPTER_VERSIONS_TABLE}`)) {
            throw new Error('模擬寫入稿子版本失敗');
          }
          sql.run(s, p);
        },
      };
      expect(() =>
        writeFileProject(
          failingSql,
          modifiedInfo,
          book.tree,
          book.cards,
          book.logs,
          undefined,
          undefined,
          undefined,
          undefined,
          sampleVersions(),
        ),
      ).toThrow('模擬寫入稿子版本失敗');
      expect(dumpAllTablesExceptSequence(sql)).toEqual(beforeAll);
    });
  });
});
