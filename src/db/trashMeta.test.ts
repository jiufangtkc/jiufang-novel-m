import { describe, expect, it } from 'vitest';
import { collectAliveWritableNodeIds, createTrashItem, type TrashItem } from '../domain/trash';
import { readBookBytes, writeBookBytes } from './library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion } from './migrations';
import { openNodeSql } from './nodeSql';
import { readFileProject, writeFileProject } from './projectFile';
import { createVersion1, createVersion14Shell } from './schemaFixture';
import { tableNames, type Sql } from './sql';
import { generateDesktopSampleBytes, openDesktopSampleMemoryDb } from './testing/desktopSampleDb';
import {
  assertTrashDataWritable,
  readTrashData,
  TRASH_FORMAT_REVISION,
  TRASH_ITEMS_TABLE,
  TRASH_META_TABLE,
  TRASH_TABLES,
  TrashDataError,
  writeTrashData,
} from './trashMeta';
import { openMemoryDb } from './wasmDb';

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

function tableShapes(sql: Sql, names: readonly string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const name of names) {
    out[name] = sql.select(`PRAGMA table_info(${name})`);
  }
  return out;
}

function sampleItems(): TrashItem[] {
  return [
    createTrashItem({
      itemId: '11111111-2222-4333-8444-555555555551',
      chapterId: 'ch-sample-doc-1',
      chapterTitleSnapshot: '第一章　霧中燈號',
      content: '【範例】' + '霧'.repeat(105),
      wordCount: 109,
      beforeAnchor: '她走到窗邊，',
      afterAnchor: '港口的鐘聲響了。',
      charOffset: 12,
      reason: '開場節奏偏慢',
      deletedAtMs: 1_700_000_002_000,
      sortOrder: 0,
    }),
    createTrashItem({
      itemId: '11111111-2222-4333-8444-555555555552',
      chapterId: 'sc-sample-1',
      chapterTitleSnapshot: '幕 1　燈塔階梯',
      content: '【範例】' + '海'.repeat(100),
      wordCount: 104,
      beforeAnchor: '石階潮濕，',
      afterAnchor: '',
      charOffset: 30,
      reason: '',
      deletedAtMs: 1_700_000_001_000,
      sortOrder: 0,
    }),
  ];
}

describe('WO-138 第 2 段：舊檔安全與零寫入', () => {
  it('v1、v14 無附加表與 desktopSampleDb：只讀回傳 absent、不建表、schema_version 維持 14', async () => {
    const { sql: sqlV1 } = openNodeSql();
    createVersion1(sqlV1);
    const loadedV1 = readFileProject(sqlV1);
    expect(CURRENT_SCHEMA_VERSION).toBe(14);
    expect(currentSchemaVersion(sqlV1)).toBe(14);
    expect(loadedV1.trash).toEqual({ kind: 'absent' });
    for (const table of TRASH_TABLES) {
      expect(tableNames(sqlV1).has(table)).toBe(false);
    }

    const { sql: sqlV14 } = openNodeSql();
    createVersion14Shell(sqlV14);
    sqlV14.run('INSERT INTO project_info (title, logline, categories_meta) VALUES (?, ?, ?)', [
      '【範例】v14 舊檔',
      '',
      '{}',
    ]);
    const loadedV14 = readFileProject(sqlV14);
    expect(loadedV14.trash).toEqual({ kind: 'absent' });
    for (const table of TRASH_TABLES) {
      expect(tableNames(sqlV14).has(table)).toBe(false);
    }

    const db = await openDesktopSampleMemoryDb();
    try {
      const beforeAll = dumpAllTablesExceptSequence(db.sql);
      const loadedDesktop = readFileProject(db.sql);
      expect(loadedDesktop.trash).toEqual({ kind: 'absent' });
      expect(dumpAllTablesExceptSequence(db.sql)).toEqual(beforeAll);

      // 不傳 trashItems 或傳空陣列寫回，皆不建表且零變動
      writeFileProject(
        db.sql,
        loadedDesktop.info,
        loadedDesktop.tree,
        loadedDesktop.cards,
        loadedDesktop.logs,
        undefined,
        undefined,
        undefined,
        [],
      );
      expect(dumpAllTablesExceptSequence(db.sql)).toEqual(beforeAll);
      for (const table of TRASH_TABLES) {
        expect(tableNames(db.sql).has(table)).toBe(false);
      }
    } finally {
      db.close();
    }
  });
});

describe('WO-138 第 2 段：懶建立、差異寫入與電腦版相容', () => {
  it('寫入與讀回 11 欄完整保留、差異更新原因與刪除項目，且保留未來未知欄位', async () => {
    const raw = await generateDesktopSampleBytes();
    const book = await readBookBytes('範例稿', raw, 'file-trash-roundtrip');
    const items = sampleItems();

    const saved = await writeBookBytes(
      raw,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      items,
    );

    const reopened = await readBookBytes('範例稿', saved, 'file-trash-reopen');
    expect(reopened.trash).toEqual({
      kind: 'ok',
      revision: TRASH_FORMAT_REVISION,
      items,
    });

    // 在附加表加入未來未知欄位後，只改第一則原因並移除第二則：未知欄位必須原樣留著
    const withExtraCol = await mutate(saved, (sql) => {
      sql.exec(`ALTER TABLE ${TRASH_ITEMS_TABLE} ADD COLUMN future_tag TEXT DEFAULT 'v2-keep'`);
    });
    const updatedItems = [{ ...items[0]!, reason: '改完大綱後不再需要' }];
    const savedUpdated = await writeBookBytes(
      withExtraCol,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      updatedItems,
    );

    await withDb(savedUpdated, (sql) => {
      expect(readTrashData(sql)).toEqual({
        kind: 'ok',
        revision: TRASH_FORMAT_REVISION,
        items: updatedItems,
      });
      expect(sql.select(`SELECT reason, future_tag FROM ${TRASH_ITEMS_TABLE}`)).toEqual([
        { reason: '改完大綱後不再需要', future_tag: 'v2-keep' },
      ]);
      // 再傳相同內容應回 skipped，不發無謂寫入
      expect(writeTrashData(sql, updatedItems)).toBe('skipped');
    });
  });

  it('電腦版 8 表結構不變、PRAGMA foreign_keys = ON 下刪章不被擋、舊版存回原樣保留刪稿表', async () => {
    const raw = await generateDesktopSampleBytes();
    const desktopTables = ['project_info', 'chapters', 'cards', 'writing_logs', 'snapshots', 'proofread_results', 'proofread_ignored_rules', 'schema_version'];
    const beforeShapes = await withDb(raw, (sql) => tableShapes(sql, desktopTables));
    const book = await readBookBytes('相容稿', raw, 'file-compat');
    const items = sampleItems();

    const withTrash = await writeBookBytes(
      raw,
      book.info,
      book.tree,
      book.cards,
      book.logs,
      undefined,
      undefined,
      undefined,
      items,
    );

    // 模擬電腦版／舊行動版開啟（不呼叫 writeTrashData）
    const afterDesktopEdit = await mutate(withTrash, (sql) => {
      sql.exec('PRAGMA foreign_keys = ON');
      expect(currentSchemaVersion(sql)).toBe(14);
      expect(tableShapes(sql, desktopTables)).toEqual(beforeShapes);
      sql.run("DELETE FROM chapters WHERE id = 'ch-sample-doc-1'");
    });

    // 舊版透過 writeFileProject 不傳 trashItems 存回時，刪稿資料原樣保留
    const reopenedByOld = await readBookBytes('舊版重存', afterDesktopEdit, 'file-old');
    const resavedByOld = await writeBookBytes(
      afterDesktopEdit,
      reopenedByOld.info,
      reopenedByOld.tree,
      reopenedByOld.cards,
      reopenedByOld.logs,
    );

    await withDb(resavedByOld, (sql) => {
      const readAll = readTrashData(sql);
      expect(readAll.kind).toBe('ok');
      if (readAll.kind === 'ok') {
        expect(readAll.items).toHaveLength(2);
      }

      // 驗證 aliveWritableNodeIds 含 file 與 scene，排除 folder 與已刪章
      const treeWithScene = [
        {
          id: 'vol-1',
          type: 'folder' as const,
          title: '第一卷',
          children: [
            { id: 'sc-sample-1', type: 'scene' as const, title: '幕 1　燈塔階梯', content: '' },
          ],
        },
      ];
      const alive = collectAliveWritableNodeIds(treeWithScene);
      const resolved = readTrashData(sql, alive);
      expect(resolved.kind).toBe('ok');
      if (resolved.kind === 'ok') {
        expect(resolved.items).toHaveLength(2);
        // 原章已刪者保留項目但 chapterId 安全降級為 null，snapshot 仍在
        expect(resolved.items[0]?.chapterId).toBeNull();
        expect(resolved.items[0]?.chapterTitleSnapshot).toBe('第一章　霧中燈號');
        // 活著的 scene 不可誤判為原章已刪
        expect(resolved.items[1]?.chapterId).toBe('sc-sample-1');
      }
    });
  });
});

describe('WO-138 第 2 段：四態容錯與交易回滾', () => {
  async function baseWithTrash(): Promise<Uint8Array> {
    const raw = await generateDesktopSampleBytes();
    const book = await readBookBytes('基底', raw, 'file-base');
    return writeBookBytes(raw, book.info, book.tree, book.cards, book.logs, undefined, undefined, undefined, sampleItems());
  }

  it('newer-revision（format_revision = 2）唯讀保留且放行正文存檔', async () => {
    const newer = await mutate(await baseWithTrash(), (sql) => {
      sql.exec(`ALTER TABLE ${TRASH_ITEMS_TABLE} ADD COLUMN future_note TEXT DEFAULT 'v2'`);
      sql.exec(`UPDATE ${TRASH_META_TABLE} SET format_revision = 2`);
    });

    await withDb(newer, (sql) => {
      expect(readTrashData(sql)).toEqual({ kind: 'newer-revision', revision: 2 });
      expect(() => assertTrashDataWritable(sql)).not.toThrow();
      expect(writeTrashData(sql, [])).toBe('newer-revision');
      expect(sql.select(`SELECT future_note FROM ${TRASH_ITEMS_TABLE}`)).toHaveLength(2);
    });
  });

  const corruptCases: Array<[string, (sql: Sql) => void]> = [
    ['format_revision = 0', (sql) => sql.exec(`UPDATE ${TRASH_META_TABLE} SET format_revision = 0`)],
    ['中繼表被清空', (sql) => sql.exec(`DELETE FROM ${TRASH_META_TABLE}`)],
    ['缺 jiufangm_trash_meta', (sql) => sql.exec(`DROP TABLE ${TRASH_META_TABLE}`)],
    ['缺 jiufangm_trash_items', (sql) => sql.exec(`DROP TABLE ${TRASH_ITEMS_TABLE}`)],
    ['content 為空字串', (sql) => sql.exec(`UPDATE ${TRASH_ITEMS_TABLE} SET content = ''`)],
    ['word_count 為負數', (sql) => sql.exec(`UPDATE ${TRASH_ITEMS_TABLE} SET word_count = -1`)],
    ['deleted_at_ms 為 0', (sql) => sql.exec(`UPDATE ${TRASH_ITEMS_TABLE} SET deleted_at_ms = 0`)],
    ['reason 型別為 BLOB', (sql) => sql.exec(`UPDATE ${TRASH_ITEMS_TABLE} SET reason = X'0102'`)],
  ];

  it.each(corruptCases)('corrupt 防護（%s）：不擋開檔、不覆寫原表、assertTrashDataWritable 擋下外部存檔', async (_label, breakIt) => {
    const bad = await mutate(await baseWithTrash(), breakIt);
    await withDb(bad, (sql) => {
      const loaded = readFileProject(sql);
      expect(loaded.trash.kind).toBe('corrupt');
      expect(writeTrashData(sql, [])).toBe('corrupt');
      expect(() => assertTrashDataWritable(sql)).toThrow(TrashDataError);
    });
  });

  it('寫入驗證失敗或中途 SQL 拋錯時整筆交易 ROLLBACK', async () => {
    const raw = await generateDesktopSampleBytes();
    const book = await readBookBytes('回滾測試', raw, 'file-rb');

    await withDb(raw, (sql) => {
      const beforeAll = dumpAllTablesExceptSequence(sql);
      const invalidItem = { ...sampleItems()[0]!, content: '' };
      expect(() =>
        writeFileProject(sql, book.info, book.tree, book.cards, book.logs, undefined, undefined, undefined, [
          invalidItem,
        ]),
      ).toThrow(TrashDataError);
      expect(dumpAllTablesExceptSequence(sql)).toEqual(beforeAll);
      for (const table of TRASH_TABLES) {
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
          if (s.includes(`INSERT INTO ${TRASH_ITEMS_TABLE}`)) {
            throw new Error('模擬寫入刪稿項目失敗');
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
          sampleItems(),
        ),
      ).toThrow('模擬寫入刪稿項目失敗');
      expect(dumpAllTablesExceptSequence(sql)).toEqual(beforeAll);
    });
  });
});
