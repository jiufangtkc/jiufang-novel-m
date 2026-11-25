import { describe, expect, it } from 'vitest';
import {
  BOOK_META_FORMAT_REVISION,
  BOOK_META_TABLE,
  BookMetaError,
  assertBookMetaWritable,
  writeBookMeta,
} from './bookMeta';
import { generateUuidV4 } from './extensionMeta';
import { currentSchemaVersion } from './migrations';
import { openNodeSql } from './nodeSql';
import { readFileProject, writeFileProject } from './projectFile';
import { createVersion1, createVersion14Shell } from './schemaFixture';
import { tableNames, type Sql } from './sql';
import { openDesktopSampleMemoryDb } from './testing/desktopSampleDb';
import { openMemoryDb } from './wasmDb';

describe('WO-137 第 2 段：jiufangm_book_meta 與 projectFile 接線', () => {
  it('讀取沒有 jiufangm_book_meta 的舊檔（v14／v1）嚴格唯讀、不建表、回傳 absent', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const beforeTables = tableNames(db.sql);
      expect(beforeTables.has(BOOK_META_TABLE)).toBe(false);

      const loaded = readFileProject(db.sql);
      expect(loaded.bookMeta).toEqual({ kind: 'absent' });
      expect(tableNames(db.sql).has(BOOK_META_TABLE)).toBe(false);
    } finally {
      db.close();
    }

    const { sql } = openNodeSql();
    createVersion1(sql);
    const v1Loaded = readFileProject(sql);
    expect(v1Loaded.bookMeta).toEqual({ kind: 'absent' });
    expect(tableNames(sql).has(BOOK_META_TABLE)).toBe(false);
  });

  it('writeFileProject 未傳入 bookMeta 時維持 P0-4 零寫入，完全不建也不碰 jiufangm_book_meta', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const dmlStatements: string[] = [];
      const countingSql: Sql = {
        exec: (statement) => {
          if (/\b(CREATE|UPDATE|DELETE|INSERT)\b/i.test(statement)) {
            dmlStatements.push(statement);
          }
          db.sql.exec(statement);
        },
        run: (statement, params) => {
          if (/\b(CREATE|UPDATE|DELETE|INSERT)\b/i.test(statement)) {
            dmlStatements.push(statement);
          }
          db.sql.run(statement, params);
        },
        select: (statement, params) => db.sql.select(statement, params),
      };

      const loaded = readFileProject(db.sql);
      const beforeChanges = Number(db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);
      writeFileProject(countingSql, loaded.info, loaded.tree, loaded.cards, loaded.logs);
      const afterChanges = Number(db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);

      expect(dmlStatements).toEqual([]);
      expect(afterChanges).toBe(beforeChanges);
      expect(tableNames(db.sql).has(BOOK_META_TABLE)).toBe(false);
    } finally {
      db.close();
    }
  });

  it('寫入 bookMeta 後重開可讀回相同身分證，且維持 schema_version = 14 與電腦版 8 表結構', async () => {
    const db = await openMemoryDb(new Uint8Array());
    const uuid = generateUuidV4();
    const originUuid = generateUuidV4();
    const createdAtMs = 1_764_000_000_000;

    writeFileProject(
      db.sql,
      {
        title: '【範例】有身分證的稿子',
        logline: '',
        currentTheme: '',
        globalFontFamily: '',
        globalFontSize: 12,
        editorFontFamily: '',
        editorFontSize: 16,
        targetWordCount: 1000,
        dailyTargetWordCount: 300,
        categoryOrder: null,
        expandedCategories: null,
        categoriesMeta: '{}',
        lastOpenedNodeId: null,
        lastCursorPosition: 0,
      },
      [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　燈塔',
          progress: 'Draft',
          content: '【範例】海風吹過石階。',
        },
      ],
      [],
      [],
      undefined,
      undefined,
      { bookUuid: uuid, createdAtMs, originBookUuid: originUuid },
    );

    const bytes = db.exportBytes();
    db.close();

    const reopened = await openMemoryDb(bytes);
    try {
      expect(currentSchemaVersion(reopened.sql)).toBe(14);
      const loaded = readFileProject(reopened.sql);
      expect(loaded.bookMeta).toEqual({
        kind: 'ok',
        revision: BOOK_META_FORMAT_REVISION,
        meta: {
          bookUuid: uuid,
          createdAtMs,
          originBookUuid: originUuid,
        },
      });

      // 相同身分證再次寫入不發任何 UPDATE
      const dml: string[] = [];
      const countingSql: Sql = {
        exec: (s) => {
          if (/\b(UPDATE|DELETE|INSERT)\b/i.test(s)) dml.push(s);
          reopened.sql.exec(s);
        },
        run: (s, p) => {
          if (/\b(UPDATE|DELETE|INSERT)\b/i.test(s)) dml.push(s);
          reopened.sql.run(s, p);
        },
        select: (s, p) => reopened.sql.select(s, p),
      };
      writeFileProject(
        countingSql,
        loaded.info,
        loaded.tree,
        loaded.cards,
        loaded.logs,
        undefined,
        undefined,
        { bookUuid: uuid, createdAtMs, originBookUuid: originUuid },
      );
      expect(dml).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('遇到未來較新版本（format_revision = 2）、未知欄與未知 jiufangm_* 表時：唯讀保留、不擋正文讀寫', () => {
    const { sql } = openNodeSql();
    createVersion14Shell(sql);
    sql.run(
      'INSERT INTO project_info (title, target_word_count, daily_target_word_count, categories_meta) VALUES (?, ?, ?, ?)',
      ['【範例】未來版稿子', 1000, 300, '{}'],
    );
    sql.run(
      'INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, is_expanded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['ch-1', null, '第一章　海港', 'file', '【範例】原文內容', 'Draft', 0, 1],
    );

    const uuidV1 = generateUuidV4();
    const uuidV2 = generateUuidV4();
    // 1) format_revision = 1 但帶未來未知欄位與未知 jiufangm_* 表
    sql.exec(`CREATE TABLE ${BOOK_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_revision INTEGER NOT NULL,
      book_uuid TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      origin_book_uuid TEXT DEFAULT NULL,
      future_device_tag TEXT DEFAULT NULL
    )`);
    sql.run(
      `INSERT INTO ${BOOK_META_TABLE} (id, format_revision, book_uuid, created_at_ms, origin_book_uuid, future_device_tag)
       VALUES (1, 1, ?, ?, NULL, ?)`,
      [uuidV1, 1_764_000_000_000, 'mac-mini-v2'],
    );
    sql.exec('CREATE TABLE jiufangm_future_notes (note_id TEXT PRIMARY KEY, body TEXT)');
    sql.run('INSERT INTO jiufangm_future_notes (note_id, body) VALUES (?, ?)', ['n1', '保留未來便利貼']);

    const loaded1 = readFileProject(sql);
    expect(loaded1.bookMeta.kind).toBe('ok');
    loaded1.tree[0]!.content = '【範例】修改後正文';
    writeFileProject(sql, loaded1.info, loaded1.tree, loaded1.cards, loaded1.logs, undefined, undefined, {
      bookUuid: uuidV2,
      createdAtMs: 1_764_000_001_000,
    });
    // 已知欄位已更新，未知欄位與未知表原樣保留
    expect(sql.select(`SELECT future_device_tag FROM ${BOOK_META_TABLE}`)).toEqual([
      { future_device_tag: 'mac-mini-v2' },
    ]);
    expect(sql.select('SELECT note_id, body FROM jiufangm_future_notes')).toEqual([
      { note_id: 'n1', body: '保留未來便利貼' },
    ]);

    // 2) format_revision = 2（newer-revision）：唯讀保留、不擋正文讀寫與存檔檢查
    sql.run(`UPDATE ${BOOK_META_TABLE} SET format_revision = 2 WHERE id = 1`);
    const loaded2 = readFileProject(sql);
    expect(loaded2.bookMeta).toEqual({ kind: 'newer-revision', revision: 2 });
    expect(loaded2.tree[0]?.content).toBe('【範例】修改後正文');
    expect(() => assertBookMetaWritable(sql)).not.toThrow();

    loaded2.tree[0]!.content = '【範例】再度修改正文';
    const attemptUuid = generateUuidV4();
    writeFileProject(sql, loaded2.info, loaded2.tree, loaded2.cards, loaded2.logs, undefined, undefined, {
      bookUuid: attemptUuid,
      createdAtMs: 1_764_000_002_000,
    });
    // newer-revision 原表絕不被覆寫，正文正常存回
    expect(sql.select(`SELECT format_revision, book_uuid FROM ${BOOK_META_TABLE}`)).toEqual([
      { format_revision: 2, book_uuid: uuidV2 },
    ]);
    expect(readFileProject(sql).tree[0]?.content).toBe('【範例】再度修改正文');
  });

  it('jiufangm_book_meta 損壞時不擋正文開啟，且 writeBookMeta 絕不當成空白覆寫', () => {
    const { sql } = openNodeSql();
    createVersion14Shell(sql);
    sql.run(
      'INSERT INTO project_info (title, target_word_count, daily_target_word_count, categories_meta) VALUES (?, ?, ?, ?)',
      ['【範例】損壞測試', 1000, 300, '{}'],
    );
    sql.run(
      'INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, is_expanded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['ch-1', null, '第一章　救回', 'file', '【範例】寶貴正文', 'Draft', 0, 1],
    );
    sql.exec(`CREATE TABLE ${BOOK_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_revision INTEGER NOT NULL,
      book_uuid TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      origin_book_uuid TEXT DEFAULT NULL
    )`);
    sql.run(
      `INSERT INTO ${BOOK_META_TABLE} (id, format_revision, book_uuid, created_at_ms) VALUES (1, 1, ?, ?)`,
      ['not-a-valid-uuid', 1_764_000_000_000],
    );

    // 讀取不擋正文
    const loaded = readFileProject(sql);
    expect(loaded.bookMeta.kind).toBe('corrupt');
    expect(loaded.tree[0]?.content).toBe('【範例】寶貴正文');

    // writeBookMeta 絕不把損壞資料覆寫掉
    expect(
      writeBookMeta(sql, {
        bookUuid: generateUuidV4(),
        createdAtMs: 1_764_000_000_000,
      }),
    ).toBe('corrupt');
    expect(sql.select(`SELECT book_uuid FROM ${BOOK_META_TABLE}`)).toEqual([
      { book_uuid: 'not-a-valid-uuid' },
    ]);

    expect(() => assertBookMetaWritable(sql)).toThrow(BookMetaError);
  });

  it('傳入不合法的 bookMeta 寫入時會拋出 BookMetaError 並觸發交易 ROLLBACK', () => {
    const { sql } = openNodeSql();
    createVersion14Shell(sql);
    sql.run(
      'INSERT INTO project_info (title, target_word_count, daily_target_word_count, categories_meta) VALUES (?, ?, ?, ?)',
      ['【範例】交易回滾', 1000, 300, '{}'],
    );
    sql.run(
      'INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, is_expanded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['ch-1', null, '第一章　原本', 'file', '【範例】原本正文', 'Draft', 0, 1],
    );

    const loaded = readFileProject(sql);
    loaded.tree[0]!.content = '【範例】不應寫入的修改';
    expect(() =>
      writeFileProject(sql, loaded.info, loaded.tree, loaded.cards, loaded.logs, undefined, undefined, {
        bookUuid: 'invalid-uuid',
        createdAtMs: 1_764_000_000_000,
      }),
    ).toThrow(BookMetaError);

    expect(readFileProject(sql).tree[0]?.content).toBe('【範例】原本正文');
    expect(tableNames(sql).has(BOOK_META_TABLE)).toBe(false);
  });
});
