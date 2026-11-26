import { describe, expect, it } from 'vitest';
import { CATEGORY_CHARACTER, CATEGORY_TIMELINE } from '../domain/cardCategories';
import { addCard, updateCardTitle } from '../domain/cardOps';
import { manuscriptBytesOn, reduce, verifyBytesForSave } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { collectAliveEntityIds } from './extensionMeta';
import { readBookBytes, writeBookBytes } from './library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion } from './migrations';
import { openNodeSql } from './nodeSql';
import {
  proofFingerprints,
  readFileProject,
  snapshotFingerprints,
  writeFileProject,
  type FileCard,
} from './projectFile';
import { createVersion1, createVersion14Shell } from './schemaFixture';
import { tableNames, type Sql, type SqlValue } from './sql';
import {
  generateDesktopSampleBytes,
  openDesktopSampleMemoryDb,
  SAMPLE_CUSTOM_CATEGORY_CODE,
  SAMPLE_DEFAULT_COLOR,
  SAMPLE_DESKTOP_SCHEMA_VERSIONS,
  SAMPLE_NON_DEFAULT_COLOR,
} from './testing/desktopSampleDb';
import {
  assertTimelineDataWritable,
  readTimelineData,
  TIMELINE_EVENTS_TABLE,
  TIMELINE_FORMAT_REVISION,
  TIMELINE_META_TABLE,
  TIMELINE_TABLES,
  TimelineDataError,
  writeTimelineData,
} from './timelineMeta';
import { openMemoryDb } from './wasmDb';

/**
 * WO-128 第 2 段：事件時間線存檔附加表（jiufangm_timeline_meta／jiufangm_timeline_events）測試。
 * 涵蓋規劃 9.2 節全部項目：
 * 1. 舊檔安全（v1 升 v14、v14 無附加表、desktopSampleDb 開啟不建表、schema 維持 14、不改動直接寫回零 DML 與逐表逐列逐欄相同）
 * 2. 時間線資料往返（storyTime、timelineOrder、chapterId 讀寫還原、懶建立、差異同步、孤兒列清理、cards 8 欄與 ai_chat／未知欄／未知表／BLOB／快照保護）
 * 3. 電腦版 8 欄結構模型往返（模擬只認識 8 欄 cards 的電腦版讀取、修改並保留未知表存回後，手機版重開三欄完整保留）
 * 4. 損壞防護、newer-revision 放行與空參照容錯（format_revision = 0、缺表、欄位型別損壞 → corrupt；format_revision = 2 → newer-revision 唯讀保留並放行正文存檔；電腦版刪章刪卡空參照不壞檔）
 * 5. 升格往返（promote-stored 前已設時間線資料，升格寫入記憶體資料庫再讀回逐欄不變）
 *
 * 全數使用記憶體 SQLite 與程式產生的範例資料，不建立或讀取任何實體檔案。
 */

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

function existingTables(sql: Sql): string[] {
  return [...tableNames(sql)].filter((name) => name !== 'sqlite_sequence').sort();
}

/** 程式產生的豐富電腦版範例庫：v14 結構、非空正文、時間軸卡、ai_chat 卡、寫作紀錄、快照、校對、未知欄、未知表與 BLOB。 */
async function richDesktopBytesWithTimelineCards(): Promise<Uint8Array> {
  return mutate(await generateDesktopSampleBytes(), (sql) => {
    sql.run("UPDATE chapters SET content = ? WHERE id = 'ch-sample-doc-1'", [
      '【範例】第一章正文：霧港北岬角的燈塔在夜裡閃爍。',
    ]);
    sql.run("UPDATE chapters SET content = ? WHERE id = 'ch-sample-doc-2'", [
      '【範例】第二章正文：引水船穿過暗礁航道。',
    ]);
    sql.run(
      `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'tl-event-1',
        null,
        CATEGORY_TIMELINE,
        '【範例】舊館大火，沈家小女兒失蹤',
        '【範例】十年前冬夜的火災紀錄。',
        '#e06c75',
        0,
        0,
        'tl-event-2',
        null,
        CATEGORY_TIMELINE,
        '【範例】沈伯謙偷偷改了遺囑',
        '【範例】案發前三個月的密談。',
        '#e5c07b',
        0,
        1,
        'tl-event-3',
        null,
        CATEGORY_TIMELINE,
        '【範例】女傭阿蘋發現書房反鎖',
        '【範例】隔天清晨的第一現場。',
        '#61afef',
        0,
        2,
        'ai-chat-card-1',
        null,
        'ai_chat',
        '【範例】AI 對話紀錄卡',
        '{"messages":[{"role":"user","text":"範例提問"}]}',
        '#1e293b',
        0,
        0,
      ],
    );
    sql.run(
      `INSERT INTO writing_logs (date, duration, word_count, ai_continuation_count, ai_continuation_chars,
        ai_chat_count, ai_details, paste_large_count, delete_large_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['2026-11-10', 900, 1234, 3, 456, 2, '{"續寫":[{"字數":456}]}', 4, 5],
    );
    sql.run(
      'INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES (?, ?, ?, ?, ?)',
      ['【範例】快照一', '【範例】備註', '2026-11-10 12:00:00', 1234, '{"snap":1}'],
    );
    sql.run(
      `INSERT INTO proofread_results (id, category, node_id, chapter_name, char_offset, match_len, original_text, suggestion, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'pr-sample-1',
        'typo',
        'ch-sample-doc-1',
        '【範例】第一章　霧中燈號',
        2,
        2,
        '範例',
        '範例',
        '【範例】理由',
        'pending',
        '2026-11-10',
      ],
    );
    sql.exec('CREATE TABLE desktop_future_table (id INTEGER PRIMARY KEY, payload BLOB, note TEXT)');
    sql.run('INSERT INTO desktop_future_table (id, payload, note) VALUES (1, ?, ?)', [
      new Uint8Array([9, 8, 7, 0, 6]),
      '【範例】電腦版未知表',
    ]);
  });
}

describe('WO-128 9.2.1 舊檔安全與 P0-4 零寫入保證', () => {
  it('v1 升 v14、v14 無附加表、desktopSampleDb 開啟：只讀不建附加表、CURRENT_SCHEMA_VERSION 維持 14、schema_version 紀錄不變', async () => {
    // 1. v1 舊檔升 v14
    const { sql: sqlV1 } = openNodeSql();
    createVersion1(sqlV1);
    const loadedV1 = readFileProject(sqlV1);
    expect(CURRENT_SCHEMA_VERSION).toBe(14);
    expect(currentSchemaVersion(sqlV1)).toBe(14);
    expect(loadedV1.timeline).toEqual({ kind: 'absent' });
    for (const name of TIMELINE_TABLES) {
      expect(tableNames(sqlV1).has(name)).toBe(false);
    }

    // 2. v14 無附加表
    const { sql: sqlV14 } = openNodeSql();
    createVersion14Shell(sqlV14);
    sqlV14.run(
      'INSERT INTO project_info (title, logline, categories_meta) VALUES (?, ?, ?)',
      ['【範例】v14 無附加表', '', '{}'],
    );
    sqlV14.run(
      `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['c-tl-1', null, CATEGORY_TIMELINE, '【範例】事件一', '', '#3C3F41', 0, 0],
    );
    const beforeV14Versions = sqlV14.select('SELECT * FROM schema_version ORDER BY version');
    const loadedV14 = readFileProject(sqlV14);
    expect(loadedV14.timeline).toEqual({ kind: 'absent' });
    expect(loadedV14.cards[0]?.storyTime).toBeUndefined();
    expect(loadedV14.cards[0]?.timelineOrder).toBeUndefined();
    expect(loadedV14.cards[0]?.chapterId).toBeUndefined();
    expect(sqlV14.select('SELECT * FROM schema_version ORDER BY version')).toEqual(beforeV14Versions);
    for (const name of TIMELINE_TABLES) {
      expect(tableNames(sqlV14).has(name)).toBe(false);
    }

    // 3. desktopSampleDb 開啟
    const db = await openDesktopSampleMemoryDb();
    try {
      expect(readTimelineData(db.sql)).toEqual({ kind: 'absent' });
      const loadedDesktop = readFileProject(db.sql);
      expect(loadedDesktop.timeline).toEqual({ kind: 'absent' });
      expect(currentSchemaVersion(db.sql)).toBe(14);
      expect(db.sql.select('SELECT version, applied_at FROM schema_version ORDER BY version')).toEqual(
        SAMPLE_DESKTOP_SCHEMA_VERSIONS.map((row) => ({ ...row })),
      );
      for (const card of loadedDesktop.cards) {
        expect(card.storyTime).toBeUndefined();
        expect(card.timelineOrder).toBeUndefined();
        expect(card.chapterId).toBeUndefined();
      }
      for (const name of TIMELINE_TABLES) {
        expect(tableNames(db.sql).has(name)).toBe(false);
      }
    } finally {
      db.close();
    }
  });

  it('不做改動直接寫回：不建附加表、零 DML（不發任何 UPDATE／DELETE／INSERT／CREATE）、逐表逐列逐欄與原檔完全相同', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const beforeTables = dumpAllTablesExceptSequence(db.sql);
      const beforeSnap = snapshotFingerprints(db.sql);
      const beforeProof = proofFingerprints(db.sql);

      const statements: string[] = [];
      const countingSql: Sql = {
        exec: (statement) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(statement)) {
            statements.push(statement);
          }
          db.sql.exec(statement);
        },
        run: (statement, params) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(statement)) {
            statements.push(statement);
          }
          db.sql.run(statement, params);
        },
        select: (statement, params) => db.sql.select(statement, params),
      };

      const loaded = readFileProject(db.sql);
      const changesBefore = Number(db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);
      writeFileProject(countingSql, loaded.info, loaded.tree, loaded.cards, loaded.logs);
      const changesAfter = Number(db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);

      expect(statements).toEqual([]);
      expect(changesAfter).toBe(changesBefore);
      expect(dumpAllTablesExceptSequence(db.sql)).toEqual(beforeTables);
      expect(snapshotFingerprints(db.sql)).toEqual(beforeSnap);
      expect(proofFingerprints(db.sql)).toEqual(beforeProof);
      for (const name of TIMELINE_TABLES) {
        expect(tableNames(db.sql).has(name)).toBe(false);
      }
    } finally {
      db.close();
    }
  });

  it('卡片即使帶有預設空值（storyTime 為空字串、timelineOrder 為 null、chapterId 為 null）也不建附加表', async () => {
    const baseBytes = await generateDesktopSampleBytes();
    const book = await readBookBytes('範例稿', baseBytes, 'file-empty-timeline');
    const cardsWithDefaultProps: FileCard[] = book.cards.map((card) => ({
      ...card,
      storyTime: '',
      timelineOrder: null,
      chapterId: null,
    }));
    const saved = await writeBookBytes(baseBytes, book.info, book.tree, cardsWithDefaultProps, book.logs);
    await withDb(saved, (sql) => {
      expect(readTimelineData(sql)).toEqual({ kind: 'absent' });
      for (const name of TIMELINE_TABLES) {
        expect(tableNames(sql).has(name)).toBe(false);
      }
    });
  });

  it('審查 1 (1)：檔案原本沒有附加表、且所有卡片皆無時間線資料時，即使非時間線卡片帶有空 id 或重複 id 也直接放行回 skipped 不擋存檔；只對真的要寫入時間線的卡片檢查 id', async () => {
    const baseBytes = await generateDesktopSampleBytes();
    await withDb(baseBytes, (sql) => {
      // 無附加表且無時間線資料：即使傳入空 id 或重複 id 的卡片，直接回 skipped 不丟錯、不建表
      expect(
        writeTimelineData(sql, [
          { id: '', storyTime: '', timelineOrder: null, chapterId: null },
          { id: 'dup-id' },
          { id: 'dup-id', storyTime: '' },
        ]),
      ).toBe('skipped');
      for (const name of TIMELINE_TABLES) {
        expect(tableNames(sql).has(name)).toBe(false);
      }

      // 若真的要寫入時間線資料的卡片 id 為空或重複，才丟出 TimelineDataError
      sql.exec('BEGIN');
      expect(() =>
        writeTimelineData(sql, [{ id: '', storyTime: '十年前・冬', timelineOrder: 0, chapterId: null }]),
      ).toThrow(TimelineDataError);
      sql.exec('ROLLBACK');

      sql.exec('BEGIN');
      expect(() =>
        writeTimelineData(sql, [
          { id: 'dup-tl', storyTime: '十年前', timelineOrder: 0, chapterId: null },
          { id: 'dup-tl', storyTime: '五年前', timelineOrder: 1, chapterId: null },
        ]),
      ).toThrow(TimelineDataError);
      sql.exec('ROLLBACK');
    });
  });
});

describe('WO-128 9.2.2 時間線資料往返與既有資料保護', () => {
  it('寫入 storyTime、timelineOrder、chapterId 後經 writeBookBytes 重開：三欄逐一還原，cards 維持 8 欄，ai_chat／未知欄／未知表／BLOB／快照／校對／寫作紀錄逐列不變', async () => {
    const baseBytes = await mutate(await richDesktopBytesWithTimelineCards(), (sql) => {
      sql.exec("ALTER TABLE cards ADD COLUMN desktop_future_blob BLOB");
      sql.run('UPDATE cards SET desktop_future_blob = ?', [new Uint8Array([0, 1, 2, 254, 255])]);
      sql.exec("ALTER TABLE chapters ADD COLUMN desktop_future_note TEXT DEFAULT '未來章欄'");
      sql.exec('ALTER TABLE project_info ADD COLUMN desktop_future_flag INTEGER DEFAULT 7');
    });

    const beforeCheck = await withDb(baseBytes, (sql) => ({
      aiRows: sql.select("SELECT * FROM cards WHERE category = 'ai_chat' ORDER BY id"),
      futureTable: sql.select('SELECT * FROM desktop_future_table ORDER BY id'),
      snapshots: snapshotFingerprints(sql),
      proofs: proofFingerprints(sql),
      logs: sql.select('SELECT * FROM writing_logs ORDER BY id'),
      schemaVersions: sql.select('SELECT * FROM schema_version ORDER BY version'),
    }));

    const book = await readBookBytes('範例時間線稿', baseBytes, 'file-tl-roundtrip');
    expect(book.timeline).toEqual({ kind: 'absent' });

    const nextCards: FileCard[] = book.cards.map((card) => {
      if (card.id === 'tl-event-1') {
        return {
          ...card,
          storyTime: '十年前・冬',
          timelineOrder: 0,
          chapterId: 'ch-sample-doc-2',
        };
      }
      if (card.id === 'tl-event-2') {
        return {
          ...card,
          storyTime: '案發前三個月',
          timelineOrder: 1,
          chapterId: null,
        };
      }
      if (card.id === 'tl-event-3') {
        return {
          ...card,
          storyTime: '',
          timelineOrder: 2,
          chapterId: 'ch-sample-doc-1',
        };
      }
      return card;
    });

    const savedBytes = await writeBookBytes(baseBytes, book.info, book.tree, nextCards, book.logs);
    await verifyBytesForSave(savedBytes);

    await withDb(savedBytes, (sql) => {
      // 1. 驗證附加表結構、format_revision = 1、無外鍵約束
      expect(sql.select(`SELECT * FROM ${TIMELINE_META_TABLE}`)).toEqual([
        { id: 1, format_revision: TIMELINE_FORMAT_REVISION },
      ]);
      expect(sql.select(`PRAGMA foreign_key_list(${TIMELINE_EVENTS_TABLE})`)).toEqual([]);

      // 2. 驗證 cards 表本身維持原本欄位（8 個標準欄 + 測試加的 1 個未知欄，無時間線欄位）
      const cardColNames = sql
        .select('PRAGMA table_info(cards)')
        .map((r) => String(r.name));
      expect(cardColNames).toEqual([
        'id',
        'parent_id',
        'category',
        'title',
        'content',
        'color',
        'is_collapsed',
        'sort_order',
        'desktop_future_blob',
      ]);

      // 3. 驗證各保護表與欄位完全未受影響
      expect(sql.select("SELECT * FROM cards WHERE category = 'ai_chat' ORDER BY id")).toEqual(
        beforeCheck.aiRows,
      );
      expect(sql.select('SELECT * FROM desktop_future_table ORDER BY id')).toEqual(
        beforeCheck.futureTable,
      );
      const blob = sql.select('SELECT payload FROM desktop_future_table')[0]!.payload as SqlValue;
      expect(Array.from(blob as Uint8Array)).toEqual([9, 8, 7, 0, 6]);
      expect(snapshotFingerprints(sql)).toEqual(beforeCheck.snapshots);
      expect(proofFingerprints(sql)).toEqual(beforeCheck.proofs);
      expect(sql.select('SELECT * FROM writing_logs ORDER BY id')).toEqual(beforeCheck.logs);
      expect(sql.select('SELECT * FROM schema_version ORDER BY version')).toEqual(
        beforeCheck.schemaVersions,
      );
    });

    const reopened = await readBookBytes('範例時間線稿', savedBytes, 'file-tl-reopen');
    expect(reopened.timeline).toEqual({
      kind: 'ok',
      revision: 1,
      entries: {
        'tl-event-1': {
          storyTime: '十年前・冬',
          timelineOrder: 0,
          chapterId: 'ch-sample-doc-2',
        },
        'tl-event-2': {
          storyTime: '案發前三個月',
          timelineOrder: 1,
          chapterId: null,
        },
        'tl-event-3': {
          storyTime: '',
          timelineOrder: 2,
          chapterId: 'ch-sample-doc-1',
        },
      },
    });

    const ev1 = reopened.cards.find((c) => c.id === 'tl-event-1')!;
    const ev2 = reopened.cards.find((c) => c.id === 'tl-event-2')!;
    const ev3 = reopened.cards.find((c) => c.id === 'tl-event-3')!;
    const charCard = reopened.cards.find((c) => c.category === CATEGORY_CHARACTER)!;

    expect(ev1.storyTime).toBe('十年前・冬');
    expect(ev1.timelineOrder).toBe(0);
    expect(ev1.chapterId).toBe('ch-sample-doc-2');
    expect(Array.from(ev1.extraColumns?.desktop_future_blob as Uint8Array)).toEqual([
      0, 1, 2, 254, 255,
    ]);

    expect(ev2.storyTime).toBe('案發前三個月');
    expect(ev2.timelineOrder).toBe(1);
    expect(ev2.chapterId).toBeNull();

    expect(ev3.storyTime).toBe('');
    expect(ev3.timelineOrder).toBe(2);
    expect(ev3.chapterId).toBe('ch-sample-doc-1');

    // 未設定時間線資料的卡片，三欄維持 undefined
    expect(charCard.storyTime).toBeUndefined();
    expect(charCard.timelineOrder).toBeUndefined();
    expect(charCard.chapterId).toBeUndefined();
  });

  it('有時間線附加表的檔案讀入後不改動直接寫回：零 DML；修改、清空三欄或刪除卡片時正確差異更新與清理孤兒列', async () => {
    const baseBytes = await richDesktopBytesWithTimelineCards();
    const book = await readBookBytes('範例差異同步稿', baseBytes, 'file-diff');
    const initialCards = book.cards.map((card) =>
      card.id === 'tl-event-1'
        ? { ...card, storyTime: '十年前・冬', timelineOrder: 0, chapterId: 'ch-sample-doc-1' }
        : card.id === 'tl-event-2'
          ? { ...card, storyTime: '案發當晚', timelineOrder: 1, chapterId: 'ch-sample-doc-2' }
          : card,
    );
    const savedWithTimeline = await writeBookBytes(
      baseBytes,
      book.info,
      book.tree,
      initialCards,
      book.logs,
    );

    // 1. 讀入後不改動直接寫回 → 0 DML
    await withDb(savedWithTimeline, (sql) => {
      const loaded = readFileProject(sql);
      const dml: string[] = [];
      const countingSql: Sql = {
        exec: (statement) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(statement)) dml.push(statement);
          sql.exec(statement);
        },
        run: (statement, params) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(statement)) dml.push(statement);
          sql.run(statement, params);
        },
        select: (statement, params) => sql.select(statement, params),
      };
      const beforeChanges = Number(sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);
      writeFileProject(countingSql, loaded.info, loaded.tree, loaded.cards, loaded.logs);
      const afterChanges = Number(sql.select('SELECT total_changes() AS total')[0]?.total ?? 0);
      expect(dml).toEqual([]);
      expect(afterChanges).toBe(beforeChanges);
    });

    // 2. 模擬資料庫裡有一筆孤兒 card_id，且手機端把 tl-event-2 清空三欄、把 tl-event-1 改時間
    const withOrphan = await mutate(savedWithTimeline, (sql) => {
      sql.run(
        `INSERT INTO ${TIMELINE_EVENTS_TABLE} (card_id, story_time, timeline_order, chapter_id)
         VALUES ('orphan-deleted-on-desktop', '孤兒時間', 99, NULL)`,
      );
    });

    const loadedOrphan = await readBookBytes('範例孤兒稿', withOrphan, 'file-orphan');
    // 讀取時孤兒列不會造成錯誤，也不會多出幽靈卡片
    expect(loadedOrphan.cards.some((c) => c.id === 'orphan-deleted-on-desktop')).toBe(false);

    const updatedCards = loadedOrphan.cards.map((card) => {
      if (card.id === 'tl-event-1') {
        return { ...card, storyTime: '十年前・深冬（修訂）', timelineOrder: 0, chapterId: null };
      }
      if (card.id === 'tl-event-2') {
        // 清空三欄回預設值
        return { ...card, storyTime: '', timelineOrder: null, chapterId: null };
      }
      return card;
    });

    const cleanedBytes = await writeBookBytes(
      withOrphan,
      loadedOrphan.info,
      loadedOrphan.tree,
      updatedCards,
      loadedOrphan.logs,
    );
    await withDb(cleanedBytes, (sql) => {
      // 孤兒列與已清空三欄的 tl-event-2 都被清除，只剩 tl-event-1
      expect(sql.select(`SELECT * FROM ${TIMELINE_EVENTS_TABLE}`)).toEqual([
        {
          card_id: 'tl-event-1',
          story_time: '十年前・深冬（修訂）',
          timeline_order: 0,
          chapter_id: null,
        },
      ]);
    });
  });
});

describe('WO-128 9.2.3 電腦版 8 欄結構模型往返驗證', () => {
  it('電腦版結構模型：固定 8 欄 cards 解包、開啟外鍵刪卡刪章不被擋、明列欄位更新並保留未知表存回後，手機版重開三項時間線資料完整保留', async () => {
    const original = await richDesktopBytesWithTimelineCards();
    const { names, shapes } = await withDb(original, (sql) => {
      const list = existingTables(sql);
      return { names: list, shapes: tableShapes(sql, list) };
    });

    const book = await readBookBytes('範例電腦往返稿', original, 'file-desktop-model');
    const cardsWithTimeline = book.cards.map((card) => {
      if (card.id === 'tl-event-1') {
        return {
          ...card,
          storyTime: '十年前・冬',
          timelineOrder: 0,
          chapterId: 'ch-sample-doc-2',
        };
      }
      if (card.id === 'tl-event-2') {
        return {
          ...card,
          storyTime: '案發前三個月',
          timelineOrder: 1,
          chapterId: null,
        };
      }
      if (card.id === 'tl-event-3') {
        return {
          ...card,
          storyTime: '隔天清晨',
          timelineOrder: 2,
          chapterId: 'ch-sample-doc-1',
        };
      }
      return card;
    });

    const mobileSaved = await writeBookBytes(
      original,
      book.info,
      book.tree,
      cardsWithTimeline,
      book.logs,
    );

    // 模擬電腦版開啟該檔案：
    // 1. 既有表結構與欄數完全沒變（cards 固定 8 欄）
    // 2. 開啟 PRAGMA foreign_keys = ON 下可直接更新正文、修改卡片標題、甚至刪除卡片而不被附加表外鍵阻擋
    // 3. 保留未知的 jiufangm_timeline_* 資料表原樣存回
    const desktopSaved = await mutate(mobileSaved, (sql) => {
      sql.exec('PRAGMA foreign_keys = ON');
      expect(tableShapes(sql, names)).toEqual(shapes);
      expect(currentSchemaVersion(sql)).toBe(14);

      const cardRows = sql.select('SELECT * FROM cards ORDER BY sort_order, id');
      expect(cardRows.length).toBeGreaterThan(0);
      for (const row of cardRows) {
        expect(Object.keys(row)).toEqual([
          'id',
          'parent_id',
          'category',
          'title',
          'content',
          'color',
          'is_collapsed',
          'sort_order',
        ]);
      }

      sql.run("UPDATE chapters SET content = ? WHERE id = 'ch-sample-doc-2'", [
        '【範例】電腦版修改後的第二章正文',
      ]);
      sql.run("UPDATE cards SET title = ? WHERE id = 'tl-event-1'", [
        '【範例】電腦版微調標題：舊館大火',
      ]);

      // 實際在 PRAGMA foreign_keys = ON 下對連有時間線事件的 cards 與 chapters 執行 DELETE 再還原，確認完全不被附加表外鍵阻擋
      const savedCardRow = sql.select("SELECT * FROM cards WHERE id = 'tl-event-3'")[0]!;
      const savedChapterRow = sql.select("SELECT * FROM chapters WHERE id = 'ch-sample-doc-1'")[0]!;
      sql.run("DELETE FROM cards WHERE id = 'tl-event-3'");
      sql.run("DELETE FROM chapters WHERE id = 'ch-sample-doc-1'");
      expect(sql.select("SELECT id FROM cards WHERE id = 'tl-event-3'")).toEqual([]);
      expect(sql.select("SELECT id FROM chapters WHERE id = 'ch-sample-doc-1'")).toEqual([]);
      // 還原該卡與該章，讓後續驗證重開時三件事件仍可對照
      sql.run(
        `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          savedCardRow.id as SqlValue,
          savedCardRow.parent_id as SqlValue,
          savedCardRow.category as SqlValue,
          savedCardRow.title as SqlValue,
          savedCardRow.content as SqlValue,
          savedCardRow.color as SqlValue,
          savedCardRow.is_collapsed as SqlValue,
          savedCardRow.sort_order as SqlValue,
        ],
      );
      const chapterCols = Object.keys(savedChapterRow);
      sql.run(
        `INSERT INTO chapters (${chapterCols.join(', ')}) VALUES (${chapterCols.map(() => '?').join(', ')})`,
        chapterCols.map((col) => savedChapterRow[col] as SqlValue),
      );
    });

    // 手機版重新開啟電腦版存回的檔案
    const reopened = await readBookBytes('電腦版存回稿', desktopSaved, 'file-desktop-reopen');
    expect(reopened.tree[0]!.children![1]!.content).toBe('【範例】電腦版修改後的第二章正文');

    const ev1 = reopened.cards.find((c) => c.id === 'tl-event-1')!;
    const ev2 = reopened.cards.find((c) => c.id === 'tl-event-2')!;
    const ev3 = reopened.cards.find((c) => c.id === 'tl-event-3')!;

    expect(ev1.title).toBe('【範例】電腦版微調標題：舊館大火');
    expect(ev1.storyTime).toBe('十年前・冬');
    expect(ev1.timelineOrder).toBe(0);
    expect(ev1.chapterId).toBe('ch-sample-doc-2');

    expect(ev2.storyTime).toBe('案發前三個月');
    expect(ev2.timelineOrder).toBe(1);
    expect(ev2.chapterId).toBeNull();

    expect(ev3.storyTime).toBe('隔天清晨');
    expect(ev3.timelineOrder).toBe(2);
    expect(ev3.chapterId).toBe('ch-sample-doc-1');
  });
});

describe('WO-128 9.2.4 損壞與未知版本防護、交易回滾原子性', () => {
  async function baseWithTimeline(): Promise<Uint8Array> {
    const raw = await richDesktopBytesWithTimelineCards();
    const book = await readBookBytes('基底稿', raw, 'file-base');
    const cards = book.cards.map((card) =>
      card.id === 'tl-event-1'
        ? { ...card, storyTime: '十年前・冬', timelineOrder: 0, chapterId: 'ch-sample-doc-1' }
        : card,
    );
    return writeBookBytes(raw, book.info, book.tree, cards, book.logs);
  }

  const brokenCases: Array<[string, (sql: Sql) => void]> = [
    ['修訂值非正整數（0）', (sql) => sql.exec(`UPDATE ${TIMELINE_META_TABLE} SET format_revision = 0`)],
    ['修訂值非整數', (sql) => sql.exec(`UPDATE ${TIMELINE_META_TABLE} SET format_revision = 'v1'`)],
    ['中繼資料列被清空', (sql) => sql.exec(`DELETE FROM ${TIMELINE_META_TABLE}`)],
    ['缺 jiufangm_timeline_meta 表', (sql) => sql.exec(`DROP TABLE ${TIMELINE_META_TABLE}`)],
    ['缺 jiufangm_timeline_events 表', (sql) => sql.exec(`DROP TABLE ${TIMELINE_EVENTS_TABLE}`)],
    ['story_time 欄位型別損壞（二進位 BLOB）', (sql) => sql.exec(`UPDATE ${TIMELINE_EVENTS_TABLE} SET story_time = X'0102'`)],
    ['timeline_order 欄位型別損壞（字串）', (sql) => sql.exec(`UPDATE ${TIMELINE_EVENTS_TABLE} SET timeline_order = 'first'`)],
    ['timeline_order 為負數', (sql) => sql.exec(`UPDATE ${TIMELINE_EVENTS_TABLE} SET timeline_order = -1`)],
    ['chapter_id 欄位型別損壞（二進位 BLOB）', (sql) => sql.exec(`UPDATE ${TIMELINE_EVENTS_TABLE} SET chapter_id = X'ff00'`)],
  ];

  it.each(brokenCases)(
    '損壞防護：%s → 讀為 corrupt、本機寫入不覆寫原附加表、verifyBytesForSave 與 assertTimelineDataWritable 擋下外部存檔',
    async (_label, breakIt) => {
      const bad = await mutate(await baseWithTimeline(), breakIt);
      const beforeTimelineTables = await withDb(bad, (sql) =>
        dumpTables(
          sql,
          TIMELINE_TABLES.filter((name) => tableNames(sql).has(name)),
        ),
      );

      await withDb(bad, (sql) => {
        expect(readTimelineData(sql).kind).toBe('corrupt');
        expect(readFileProject(sql).timeline.kind).toBe('corrupt');
      });

      // 本機暫存可正常寫入正文與卡片，但絕不把損壞的時間線附加表當成空資料覆寫
      const book = await readBookBytes('損壞稿', bad, 'file-bad');
      const nextTree = structuredClone(book.tree);
      nextTree[0]!.children![0]!.content = '【範例】本機暫存修改後的正文';
      const nextCards = book.cards.map((card) =>
        card.id === 'tl-event-2'
          ? { ...card, storyTime: '不應覆寫進壞表的時間', timelineOrder: 1, chapterId: null }
          : card,
      );
      const saved = await writeBookBytes(bad, book.info, nextTree, nextCards, book.logs);

      await withDb(saved, (sql) => {
        expect(
          dumpTables(
            sql,
            TIMELINE_TABLES.filter((name) => tableNames(sql).has(name)),
          ),
        ).toEqual(beforeTimelineTables);
        expect(readFileProject(sql).tree[0]!.children![0]!.content).toBe(
          '【範例】本機暫存修改後的正文',
        );
        expect(() => assertTimelineDataWritable(sql)).toThrow(TimelineDataError);
      });

      // 外部存檔前驗證必須擋下
      await expect(verifyBytesForSave(saved)).rejects.toThrow(TimelineDataError);
    },
  );

  it('WO-137：較新修訂值（format_revision = 2）＋未知欄位讀為 newer-revision，唯讀保留且 verifyBytesForSave 放行正文存檔', async () => {
    const newer = await mutate(await baseWithTimeline(), (sql) => {
      sql.exec(`ALTER TABLE ${TIMELINE_EVENTS_TABLE} ADD COLUMN future_tag TEXT DEFAULT 'v2-tag'`);
      sql.exec(`UPDATE ${TIMELINE_META_TABLE} SET format_revision = 2`);
    });
    const beforeTimelineTables = await withDb(newer, (sql) => dumpTables(sql, TIMELINE_TABLES));

    await withDb(newer, (sql) => {
      expect(readTimelineData(sql)).toEqual({ kind: 'newer-revision', revision: 2 });
      expect(() => assertTimelineDataWritable(sql)).not.toThrow();
    });

    const book = await readBookBytes('較新版時間線', newer, 'file-tl-newer');
    const nextTree = structuredClone(book.tree);
    nextTree[0]!.children![0]!.content = '【範例】較新版時間線下修改的正文';
    const saved = await writeBookBytes(newer, book.info, nextTree, book.cards, book.logs);

    await expect(verifyBytesForSave(saved)).resolves.toBeUndefined();
    await withDb(saved, (sql) => {
      expect(dumpTables(sql, TIMELINE_TABLES)).toEqual(beforeTimelineTables);
      expect(readFileProject(sql).tree[0]!.children![0]!.content).toBe(
        '【範例】較新版時間線下修改的正文',
      );
    });
  });

  it('WO-137：已知表帶未來未知欄位時更新不清空未知欄；電腦版刪章刪卡後空參照讀取不壞檔不改寫，下次存檔清理孤兒卡', async () => {
    const base = await baseWithTimeline();
    const withExtraAndDangling = await mutate(base, (sql) => {
      sql.exec(`ALTER TABLE ${TIMELINE_EVENTS_TABLE} ADD COLUMN future_note TEXT DEFAULT 'keep-note'`);
      // 加入一張將被電腦版刪除的卡片及其時間線列，與指向將被刪除章節的連章
      sql.run(
        'INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['tl-orphan-card', null, CATEGORY_TIMELINE, '【範例】即將被電腦版刪除的事件', '', SAMPLE_DEFAULT_COLOR, 0, 9],
      );
      sql.run(
        `INSERT INTO ${TIMELINE_EVENTS_TABLE} (card_id, story_time, timeline_order, chapter_id, future_note)
         VALUES (?, ?, ?, ?, ?)`,
        ['tl-orphan-card', '會被電腦版刪掉的事件', 5, 'ch-sample-doc-1', 'orphan-note'],
      );
      // 模擬電腦版刪除卡片與對應章節
      sql.run("DELETE FROM cards WHERE id = 'tl-orphan-card'");
      sql.run("DELETE FROM chapters WHERE id = 'ch-sample-doc-1'");
    });

    // 1) 開檔讀取：不拋錯、不判 corrupt、不主動改寫，且以 alive 檢驗安全降級
    await withDb(withExtraAndDangling, (sql) => {
      const loaded = readFileProject(sql);
      expect(loaded.timeline.kind).toBe('ok');
      const alive = collectAliveEntityIds(loaded.tree, loaded.cards);
      const safeTimeline = readTimelineData(sql, alive);
      expect(safeTimeline.kind).toBe('ok');
      if (safeTimeline.kind === 'ok') {
        expect(safeTimeline.entries['tl-orphan-card']).toBeUndefined();
        expect(safeTimeline.entries['tl-event-1']?.chapterId).toBeNull();
      }
      // 原資料庫列未被讀檔改動
      expect(sql.select(`SELECT card_id FROM ${TIMELINE_EVENTS_TABLE} WHERE card_id = 'tl-orphan-card'`)).toHaveLength(1);
    });

    // 2) 下次實質修改並存檔：保留未知欄位 future_note，並自動清理孤兒卡片列
    const book = await readBookBytes('空參照稿', withExtraAndDangling, 'file-dangling');
    const updatedCards = book.cards.map((card) =>
      card.id === 'tl-event-1'
        ? { ...card, storyTime: '十年前・更新後', timelineOrder: 0, chapterId: null }
        : card,
    );
    const saved = await writeBookBytes(withExtraAndDangling, book.info, book.tree, updatedCards, book.logs);
    await withDb(saved, (sql) => {
      expect(sql.select(`SELECT card_id FROM ${TIMELINE_EVENTS_TABLE} WHERE card_id = 'tl-orphan-card'`)).toEqual([]);
      expect(sql.select(`SELECT story_time, future_note FROM ${TIMELINE_EVENTS_TABLE} WHERE card_id = 'tl-event-1'`)).toEqual([
        { story_time: '十年前・更新後', future_note: 'keep-note' },
      ]);
    });
  });

  it('交易回滾：寫入時間線附加表中途拋錯時，整筆交易 ROLLBACK，正文、卡片與附加表全部回到寫入前狀態', async () => {
    const bytes = await richDesktopBytesWithTimelineCards();
    const book = await readBookBytes('中途失敗稿', bytes, 'file-rollback');

    await withDb(bytes, (sql) => {
      const beforeAll = dumpAllTablesExceptSequence(sql);
      const beforeFk = sql.select('PRAGMA foreign_keys')[0]?.foreign_keys;

      const modifiedInfo = { ...book.info, title: '【範例】不該留下的書名' };
      const modifiedTree = structuredClone(book.tree);
      modifiedTree[0]!.children![0]!.content = '【範例】不該留下的正文';
      const modifiedCards = addCard(
        updateCardTitle(book.cards, 'tl-event-1', '【範例】不該留下的卡名').map((card) =>
          card.id === 'tl-event-1'
            ? { ...card, storyTime: '十年前・冬', timelineOrder: 0, chapterId: 'ch-sample-doc-1' }
            : card,
        ),
        {
          id: 'tl-should-rollback',
          category: CATEGORY_TIMELINE,
          title: '【範例】不該留下的新事件卡',
        },
      );

      const failingSql: Sql = {
        exec: (statement) => sql.exec(statement),
        select: (statement, params) => sql.select(statement, params),
        run: (statement, params) => {
          if (statement.includes(`INSERT INTO ${TIMELINE_EVENTS_TABLE}`)) {
            throw new Error('【範例】模擬寫入時間線事件表失敗');
          }
          sql.run(statement, params);
        },
      };

      expect(() =>
        writeFileProject(failingSql, modifiedInfo, modifiedTree, modifiedCards, book.logs),
      ).toThrow('【範例】模擬寫入時間線事件表失敗');

      expect(dumpAllTablesExceptSequence(sql)).toEqual(beforeAll);
      expect(readTimelineData(sql)).toEqual({ kind: 'absent' });
      for (const name of TIMELINE_TABLES) {
        expect(tableNames(sql).has(name)).toBe(false);
      }
      expect(sql.select('PRAGMA foreign_keys')[0]?.foreign_keys).toBe(beforeFk);
    });
  });

  it('要寫入的卡片時間線欄位格式不合法時丟出 TimelineDataError 並回滾，不寫進資料庫', async () => {
    const bytes = await richDesktopBytesWithTimelineCards();
    const book = await readBookBytes('格式錯誤稿', bytes, 'file-invalid-input');

    await withDb(bytes, (sql) => {
      const beforeAll = dumpAllTablesExceptSequence(sql);
      const badCards = book.cards.map((card) =>
        card.id === 'tl-event-1'
          ? { ...card, storyTime: '十年前', timelineOrder: -5, chapterId: null }
          : card,
      );

      expect(() =>
        writeFileProject(sql, book.info, book.tree, badCards, book.logs),
      ).toThrow(TimelineDataError);
      expect(dumpAllTablesExceptSequence(sql)).toEqual(beforeAll);
      expect(readTimelineData(sql)).toEqual({ kind: 'absent' });
    });

    await withDb(bytes, (sql) => {
      sql.exec('BEGIN');
      expect(() =>
        writeTimelineData(sql, [
          { id: 'c1', storyTime: '十年前', timelineOrder: 1.5, chapterId: null },
        ]),
      ).toThrow(TimelineDataError);
      sql.exec('ROLLBACK');
    });
  });
});

describe('WO-128 9.2.5 升格（promote-stored）往返驗證', () => {
  it('新開稿子與範例書在升格前已設時間線資料，升格後寫進記憶體資料庫再讀回逐欄不變', async () => {
    const sampleCards: FileCard[] = [
      {
        id: '11111111-2222-4333-8444-555555555555',
        parent_id: null,
        category: CATEGORY_TIMELINE,
        title: '【範例】升格前事件一：舊館大火',
        content: '【範例】事件一內容',
        color: SAMPLE_NON_DEFAULT_COLOR,
        is_collapsed: 0,
        sort_order: 0,
        storyTime: '十年前・冬',
        timelineOrder: 0,
        chapterId: 'ch-1',
      },
      {
        id: '22222222-3333-4444-8555-666666666666',
        parent_id: null,
        category: CATEGORY_TIMELINE,
        title: '【範例】升格前事件二：偷改遺囑',
        content: '【範例】事件二內容',
        color: SAMPLE_DEFAULT_COLOR,
        is_collapsed: 0,
        sort_order: 1,
        storyTime: '案發前三個月',
        timelineOrder: 1,
        chapterId: null,
      },
      {
        id: '33333333-4444-4555-8666-777777777777',
        parent_id: null,
        category: SAMPLE_CUSTOM_CATEGORY_CODE,
        title: '【範例】升格前一般自訂分類卡片',
        content: '【範例】無時間線欄位的卡片',
        color: SAMPLE_DEFAULT_COLOR,
        is_collapsed: 0,
        sort_order: 2,
      },
    ];

    let state = demoFixtureState(new Date('2026-11-20T01:00:00Z'));
    state = reduce(state, {
      type: 'add-project',
      id: 'new-timeline-book',
      title: '【範例】霧港旅館事件簿',
      shape: 'novel',
    });
    state = reduce(state, {
      type: 'set-cards',
      projectId: 'new-timeline-book',
      cards: sampleCards,
    });
    state = reduce(state, {
      type: 'promote-stored',
      projectId: 'new-timeline-book',
      key: 'new-timeline-book-key',
      filename: '【範例】霧港旅館事件簿.db',
    });

    const promotedProject = state.projects.find((p) => p.id === 'new-timeline-book')!;
    const promotedExtras = state.fileExtras['new-timeline-book-key']!;
    expect(promotedExtras.cards).toEqual(sampleCards);

    const bytes = await manuscriptBytesOn(state, promotedProject, null);
    await verifyBytesForSave(bytes);

    await withDb(bytes, (sql) => {
      expect(currentSchemaVersion(sql)).toBe(14);
      const reloaded = readFileProject(sql);
      expect(reloaded.cards).toEqual(sampleCards);
      expect(reloaded.timeline).toEqual({
        kind: 'ok',
        revision: 1,
        entries: {
          '11111111-2222-4333-8444-555555555555': {
            storyTime: '十年前・冬',
            timelineOrder: 0,
            chapterId: 'ch-1',
          },
          '22222222-3333-4444-8555-666666666666': {
            storyTime: '案發前三個月',
            timelineOrder: 1,
            chapterId: null,
          },
        },
      });
    });
  });
});
