import { describe, expect, it } from 'vitest';
import { readBookBytes, writeBookBytes } from './library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion, ensureBaseTables } from './migrations';
import { readFileProject, writeFileProject } from './projectFile';
import { tableNames, type Sql, type SqlValue } from './sql';
import { generateDesktopSampleBytes, SAMPLE_DESKTOP_SCHEMA_VERSIONS } from './testing/desktopSampleDb';
import {
  assertTransferDataWritable,
  readTransferData,
  TRANSFER_EVENTS_TABLE,
  TRANSFER_FORMAT_REVISION,
  TRANSFER_META_TABLE,
  TRANSFER_TABLES,
  TransferDataError,
  writeTransferEvents,
  type TransferEvent,
} from './transferMeta';
import { openMemoryDb } from './wasmDb';

/**
 * WO-100：附加資料表（jiufangm_transfer_meta／jiufangm_transfer_events）的格式、錯誤與電腦版結構模型驗證。
 * 全部是程式產生的假 .db 與假正文，不碰真稿子或真 .db。
 * 注意：這是「結構模型」驗證（只認識舊欄位的 SELECT／固定欄數／明列欄位的 UPDATE、INSERT／保留未知表的存回），
 * 不是真實 Python 電腦版的完整測試。
 */

const EVENT_A: TransferEvent = { dayKey: '2026-11-10', atMs: 1_762_740_000_000 };
const EVENT_B: TransferEvent = { dayKey: '2026-11-12', atMs: 1_762_912_800_000 };

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

/** 程式產生的「電腦版」假庫：v14 結構、非空正文、卡片、AI 明細與次數、大量貼上／刪除、未知欄、未知表與 BLOB。 */
async function richDesktopBytes(): Promise<Uint8Array> {
  return mutate(await generateDesktopSampleBytes(), (sql) => {
    sql.run("UPDATE chapters SET content = ? WHERE id = 'ch-sample-doc-1'", ['假正文第一章：霧裡的燈一閃一閃。']);
    sql.run("UPDATE chapters SET content = ? WHERE id = 'ch-sample-doc-2'", ['假正文第二章：船沿著暗礁慢慢前進。']);
    sql.exec("ALTER TABLE chapters ADD COLUMN desktop_future_note TEXT DEFAULT '未來欄'");
    sql.exec('ALTER TABLE project_info ADD COLUMN desktop_future_flag INTEGER DEFAULT 7');
    sql.exec('ALTER TABLE cards ADD COLUMN desktop_future_blob BLOB');
    sql.run('UPDATE cards SET desktop_future_blob = ?', [new Uint8Array([0, 1, 2, 254, 255])]);
    sql.run(
      `INSERT INTO writing_logs (date, duration, word_count, ai_continuation_count, ai_continuation_chars,
        ai_chat_count, ai_details, paste_large_count, delete_large_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['2026-11-10', 900, 1234, 3, 456, 2, '{"續寫":[{"字數":456}]}', 4, 5],
    );
    sql.exec('CREATE TABLE desktop_future_table (id INTEGER PRIMARY KEY, payload BLOB, note TEXT)');
    sql.run('INSERT INTO desktop_future_table (id, payload, note) VALUES (1, ?, ?)', [
      new Uint8Array([9, 8, 7, 0, 6]),
      '電腦版未知表',
    ]);
  });
}

function tableShapes(sql: Sql, names: readonly string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const name of names) out[name] = sql.select(`PRAGMA table_info(${name})`);
  return out;
}

function dumpTables(sql: Sql, names: readonly string[]): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const name of names) out[name] = sql.select(`SELECT * FROM ${name} ORDER BY rowid`);
  return out;
}

function existingTables(sql: Sql): string[] {
  return [...tableNames(sql)].filter((name) => name !== 'sqlite_sequence').sort();
}

/** 新程式的開檔＋存檔：讀出（不建表）→ 原資料庫上差異寫入，帶這份稿子的事件。 */
async function openAndSave(bytes: Uint8Array, events: Record<string, TransferEvent>): Promise<Uint8Array> {
  const book = await readBookBytes('假.db', bytes, 'file-test');
  return writeBookBytes(bytes, book.info, book.tree, book.cards, book.logs, events);
}

describe('WO-100 附加資料表格式', () => {
  it('WO-100：缺表＝沒有檔內歷史；只讀開檔不建表、不改位元組內容', async () => {
    const bytes = await richDesktopBytes();
    await withDb(bytes, (sql) => {
      expect(readTransferData(sql)).toEqual({ kind: 'absent' });
      const loaded = readFileProject(sql);
      expect(loaded.transfer).toEqual({ kind: 'absent' });
      for (const name of TRANSFER_TABLES) expect(tableNames(sql).has(name)).toBe(false);
    });
  });

  it('WO-100：沒有事件的存檔不建附加表（電腦版原檔結構原樣）；有事件才建，修訂值 1、export_count 為 NULL', async () => {
    const plain = await openAndSave(await richDesktopBytes(), {});
    await withDb(plain, (sql) => {
      for (const name of TRANSFER_TABLES) expect(tableNames(sql).has(name)).toBe(false);
    });
    const withEvent = await openAndSave(await richDesktopBytes(), { 'imp-a': EVENT_A });
    await withDb(withEvent, (sql) => {
      expect(sql.select(`SELECT * FROM ${TRANSFER_META_TABLE}`)).toEqual([
        { id: 1, format_revision: TRANSFER_FORMAT_REVISION, export_count: null },
      ]);
      expect(sql.select(`SELECT * FROM ${TRANSFER_EVENTS_TABLE}`)).toEqual([
        { event_id: 'imp-a', kind: 'import', day_key: EVENT_A.dayKey, at_ms: EVENT_A.atMs },
      ]);
      expect(readTransferData(sql)).toEqual({
        kind: 'ok',
        revision: 1,
        exportCount: null,
        importEvents: { 'imp-a': EVENT_A },
        // WO-103：讀出也帶匯出事件；只寫匯入時是空的。
        exportEvents: {},
      });
    });
  });

  it('WO-100：合法空表＝已保存的 0（不是缺資料）', async () => {
    const withEvent = await openAndSave(await richDesktopBytes(), { 'imp-a': EVENT_A });
    const emptied = await mutate(withEvent, (sql) => sql.exec(`DELETE FROM ${TRANSFER_EVENTS_TABLE}`));
    await withDb(emptied, (sql) => {
      expect(readTransferData(sql)).toEqual({ kind: 'ok', revision: 1, exportCount: null, importEvents: {}, exportEvents: {} });
      expect(() => assertTransferDataWritable(sql)).not.toThrow();
    });
  });

  it('WO-100：重複寫入同一批事件不重複、可重複執行；新事件只追加，舊列不刪不改', async () => {
    let bytes = await openAndSave(await richDesktopBytes(), { 'imp-a': EVENT_A });
    bytes = await openAndSave(bytes, { 'imp-a': EVENT_A });
    bytes = await openAndSave(bytes, { 'imp-a': EVENT_A, 'imp-b': EVENT_B });
    bytes = await openAndSave(bytes, { 'imp-b': EVENT_B });
    await withDb(bytes, (sql) => {
      const read = readTransferData(sql);
      expect(read.kind === 'ok' && read.importEvents).toEqual({ 'imp-a': EVENT_A, 'imp-b': EVENT_B });
      expect(sql.select(`SELECT COUNT(*) AS n FROM ${TRANSFER_EVENTS_TABLE}`)[0]!.n).toBe(2);
      expect(sql.select(`SELECT COUNT(*) AS n FROM ${TRANSFER_META_TABLE}`)[0]!.n).toBe(1);
    });
  });

  it('WO-100：export_count 預設 NULL，重存保留；已有的值（假設日後電腦版寫入）也原樣保留；不產生匯出事件', async () => {
    let bytes = await openAndSave(await richDesktopBytes(), { 'imp-a': EVENT_A });
    bytes = await openAndSave(bytes, { 'imp-a': EVENT_A, 'imp-b': EVENT_B });
    await withDb(bytes, (sql) => {
      expect(sql.select(`SELECT export_count FROM ${TRANSFER_META_TABLE}`)[0]!.export_count).toBeNull();
      expect(sql.select(`SELECT DISTINCT kind FROM ${TRANSFER_EVENTS_TABLE}`)).toEqual([{ kind: 'import' }]);
    });
    const preset = await mutate(bytes, (sql) => sql.exec(`UPDATE ${TRANSFER_META_TABLE} SET export_count = 3`));
    const resaved = await openAndSave(preset, { 'imp-a': EVENT_A, 'imp-b': EVENT_B });
    await withDb(resaved, (sql) => {
      expect(sql.select(`SELECT export_count FROM ${TRANSFER_META_TABLE}`)[0]!.export_count).toBe(3);
    });
  });
});

describe('WO-100 附加資料錯誤：不可讀成 0 後覆寫', () => {
  async function baseWithEvent(): Promise<Uint8Array> {
    return openAndSave(await richDesktopBytes(), { 'imp-a': EVENT_A });
  }

  const broken: Array<[string, (sql: Sql) => void]> = [
    ['未知附加修訂值', (sql) => sql.exec(`UPDATE ${TRANSFER_META_TABLE} SET format_revision = 2`)],
    ['事件寫作日損壞', (sql) => sql.exec(`UPDATE ${TRANSFER_EVENTS_TABLE} SET day_key = '十一月十日'`)],
    ['事件時間損壞', (sql) => sql.exec(`UPDATE ${TRANSFER_EVENTS_TABLE} SET at_ms = 'abc'`)],
    ['中繼資料列不見', (sql) => sql.exec(`DELETE FROM ${TRANSFER_META_TABLE}`)],
    ['只剩一張附加表', (sql) => sql.exec(`DROP TABLE ${TRANSFER_META_TABLE}`)],
    ['匯出預留欄損壞', (sql) => sql.exec(`UPDATE ${TRANSFER_META_TABLE} SET export_count = -1`)],
  ];

  it.each(broken)('WO-100：%s → 讀為 invalid；存檔不動附加表；外部存檔前檢查擋下', async (_label, breakIt) => {
    const bad = await mutate(await baseWithEvent(), breakIt);
    const before = await withDb(bad, (sql) => dumpTables(sql, TRANSFER_TABLES.filter((name) => tableNames(sql).has(name))));
    await withDb(bad, (sql) => {
      expect(readTransferData(sql).kind).toBe('invalid');
      expect(readFileProject(sql).transfer.kind).toBe('invalid');
    });
    // 本機副本照常存正文，但附加表原樣不動（不當 0 覆寫、不補寫新事件）
    const book = await readBookBytes('壞.db', bad, 'file-bad');
    const tree = structuredClone(book.tree);
    tree[0]!.children![0]!.content = '改過的假正文';
    const saved = await writeBookBytes(bad, book.info, tree, book.cards, book.logs, { 'imp-a': EVENT_A, 'imp-b': EVENT_B });
    await withDb(saved, (sql) => {
      expect(dumpTables(sql, TRANSFER_TABLES.filter((name) => tableNames(sql).has(name)))).toEqual(before);
      expect(readFileProject(sql).tree[0]!.children![0]!.content).toBe('改過的假正文');
      expect(() => assertTransferDataWritable(sql)).toThrow(TransferDataError);
    });
  });

  it('WO-100：同代號內容不同＝衝突；整筆交易回復，正文也不會只存一半', async () => {
    const bytes = await baseWithEvent();
    const book = await readBookBytes('衝突.db', bytes, 'file-conflict');
    const tree = structuredClone(book.tree);
    tree[0]!.children![0]!.content = '不該被存進去的假正文';
    await withDb(bytes, (sql) => {
      expect(() =>
        writeFileProject(sql, book.info, tree, book.cards, book.logs, {
          'imp-a': { dayKey: '2026-11-11', atMs: EVENT_A.atMs },
        }),
      ).toThrow(TransferDataError);
      const after = readFileProject(sql);
      expect(after.tree[0]!.children![0]!.content).toBe('假正文第一章：霧裡的燈一閃一閃。');
      expect(after.transfer).toEqual({ kind: 'ok', revision: 1, exportCount: null, importEvents: { 'imp-a': EVENT_A }, exportEvents: {} });
    });
  });

  it('WO-100：交易中途失敗（寫事件時出錯）→ 正文、附加表都回到寫入前，不留半成品', async () => {
    const bytes = await richDesktopBytes();
    const book = await readBookBytes('中途.db', bytes, 'file-mid');
    const tree = structuredClone(book.tree);
    tree[0]!.children![0]!.content = '寫到一半的假正文';
    await withDb(bytes, (sql) => {
      const failing: Sql = {
        exec: (statement) => sql.exec(statement),
        select: (statement, params) => sql.select(statement, params),
        run: (statement, params) => {
          if (statement.includes(`INSERT INTO ${TRANSFER_EVENTS_TABLE}`)) throw new Error('模擬寫入失敗');
          sql.run(statement, params);
        },
      };
      expect(() => writeFileProject(failing, book.info, tree, book.cards, book.logs, { 'imp-a': EVENT_A })).toThrow('模擬寫入失敗');
      const after = readFileProject(sql);
      expect(after.tree[0]!.children![0]!.content).toBe('假正文第一章：霧裡的燈一閃一閃。');
      expect(after.transfer).toEqual({ kind: 'absent' });
      for (const name of TRANSFER_TABLES) expect(tableNames(sql).has(name)).toBe(false);
    });
  });

  it('WO-100：要寫入的事件本身格式不對時丟出錯誤，不寫進檔案', async () => {
    await withDb(await richDesktopBytes(), (sql) => {
      sql.exec('BEGIN');
      expect(() => writeTransferEvents(sql, { 'imp-x': { dayKey: 'bad', atMs: 1 } })).toThrow(TransferDataError);
      sql.exec('ROLLBACK');
      expect(readTransferData(sql)).toEqual({ kind: 'absent' });
    });
  });
});

describe('WO-100 電腦版結構模型驗證（不是真實 Python 版測試）', () => {
  it('WO-100：desktopSampleDb 假庫（非空正文、卡片、AI、大量貼上／刪除、未知欄／表、BLOB）開啟存回：既有表欄順序與數量、資料、v14 版本與時間全部不變，事件在', async () => {
    const original = await richDesktopBytes();
    const { names, shapes, dump } = await withDb(original, (sql) => {
      const list = existingTables(sql);
      return { names: list, shapes: tableShapes(sql, list), dump: dumpTables(sql, list) };
    });
    const saved = await openAndSave(original, { 'imp-a': EVENT_A, 'imp-b': EVENT_B });
    await withDb(saved, (sql) => {
      const after = existingTables(sql);
      expect(after.filter((name) => !(TRANSFER_TABLES as readonly string[]).includes(name))).toEqual(names);
      expect(after.filter((name) => (TRANSFER_TABLES as readonly string[]).includes(name)).sort()).toEqual([...TRANSFER_TABLES].sort());
      expect(tableShapes(sql, names)).toEqual(shapes);
      expect(dumpTables(sql, names)).toEqual(dump);
      expect(currentSchemaVersion(sql)).toBe(14);
      expect(CURRENT_SCHEMA_VERSION).toBe(14);
      expect(sql.select('SELECT version, applied_at FROM schema_version ORDER BY version')).toEqual(
        SAMPLE_DESKTOP_SCHEMA_VERSIONS.map((row) => ({ ...row })),
      );
      const blob = sql.select('SELECT payload FROM desktop_future_table')[0]!.payload as SqlValue;
      expect(Array.from(blob as Uint8Array)).toEqual([9, 8, 7, 0, 6]);
      const read = readTransferData(sql);
      expect(read.kind === 'ok' && read.importEvents).toEqual({ 'imp-a': EVENT_A, 'imp-b': EVENT_B });
    });
  });

  it('WO-100：舊讀法模型——只認識舊欄位的 SELECT、SELECT * 固定欄數、明列欄位的 UPDATE／INSERT、保留未知表的存回，再清本機用新程式重開，正文與事件仍在', async () => {
    const original = await richDesktopBytes();
    const columnCounts = await withDb(original, (sql) => {
      const out: Record<string, number> = {};
      for (const name of existingTables(sql)) out[name] = sql.select(`PRAGMA table_info(${name})`).length;
      return out;
    });
    const saved = await openAndSave(original, { 'imp-a': EVENT_A });

    // 模擬只認識舊欄位、照固定欄位解包、明列欄位寫入、保留未知表的舊程式
    const oldProgramSaved = await mutate(saved, (sql) => {
      const chapters = sql.select('SELECT id, parent_id, name, node_type, content, mark, sort_order FROM chapters ORDER BY sort_order, id');
      expect(chapters.map((row) => row.name)).toContain('【範例】第一章　霧中燈號');
      for (const [name, count] of Object.entries(columnCounts)) {
        const rows = sql.select(`SELECT * FROM ${name} LIMIT 1`);
        if (rows[0]) expect(Object.keys(rows[0]).length, `${name} 欄數`).toBe(count);
      }
      sql.run("UPDATE chapters SET content = ? WHERE id = 'ch-sample-doc-2'", ['舊程式改過的假正文']);
      sql.run(
        `INSERT INTO writing_logs (date, duration, word_count, ai_continuation_count, ai_continuation_chars,
          ai_chat_count, ai_details, paste_large_count, delete_large_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['2026-11-13', 60, 10, 0, 0, 0, '{}', 0, 0],
      );
      sql.run('UPDATE project_info SET title = ?, logline = ? WHERE id = 1', ['舊程式存回的書名', '']);
    });

    // 清本機（這裡本來就沒有本機紀錄），只用新程式重開那份檔
    const reopened = await readBookBytes('舊程式存回.db', oldProgramSaved, 'file-reopen');
    expect(reopened.transfer).toEqual({ kind: 'ok', revision: 1, exportCount: null, importEvents: { 'imp-a': EVENT_A }, exportEvents: {} });
    expect(reopened.tree[0]!.children!.map((node) => node.content)).toEqual([
      '假正文第一章：霧裡的燈一閃一閃。',
      '舊程式改過的假正文',
    ]);
    expect(reopened.logs.map((log) => log.date)).toEqual(['2026-11-10', '2026-11-13']);
    expect(reopened.title).toBe('舊程式存回的書名');
  });

  it('WO-100：可遷移的舊格式（沒有 schema_version 的早期結構）：讀為缺表 0；有事件存檔後升到 v14 並帶附加表', async () => {
    const legacy = await mutate(new Uint8Array(), (sql) => {
      ensureBaseTables(sql);
      sql.run('INSERT INTO project_info (title, logline, current_theme) VALUES (?, ?, ?)', ['早期假稿', '', '']);
      sql.run("INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order) VALUES ('c1', NULL, '第一章　', 'file', '早期假正文', 'Draft', 0)");
      sql.run("INSERT INTO writing_logs (date, duration, word_count) VALUES ('2026-01-02', 30, 5)");
    });
    const book = await readBookBytes('早期.db', legacy, 'file-legacy');
    expect(book.transfer).toEqual({ kind: 'absent' });
    expect(book.tree[0]!.content).toBe('早期假正文');
    const saved = await writeBookBytes(legacy, book.info, book.tree, book.cards, book.logs, { 'imp-a': EVENT_A });
    await withDb(saved, (sql) => {
      expect(currentSchemaVersion(sql)).toBe(14);
      expect(readFileProject(sql).tree[0]!.content).toBe('早期假正文');
      expect(readFileProject(sql).logs[0]).toMatchObject({ date: '2026-01-02', duration: 30, word_count: 5 });
      const read = readTransferData(sql);
      expect(read.kind === 'ok' && read.importEvents).toEqual({ 'imp-a': EVENT_A });
    });
  });
});
