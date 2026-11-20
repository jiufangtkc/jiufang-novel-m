import { columnNames, tableNames, type Sql } from './sql';

/**
 * WO-128：事件時間線附加資料寫進稿子的資料庫，跟著稿子走。
 *
 * 存法：稿子內兩張「獨立、具 jiufangm_ 命名空間」的附加資料表。
 * - 不在電腦版既有 cards 表加欄（維持固定 8 欄）、不污染 categories_meta 或 cards.sort_order。
 * - 不動 schema_version，CURRENT_SCHEMA_VERSION 維持 14；本單另有自己的附加格式修訂值（目前 1）。
 * - 刻意不宣告 SQLite FOREIGN KEY 指向 cards(id) 或 chapters(id)，避免電腦版開啟外鍵刪除時被擋下。
 * - 讀檔時只讀、不建表；建立與寫入只在存檔交易（writeFileProject）裡做，採懶建立（無時間線資料不建表）。
 *
 * jiufangm_timeline_meta：單列（id = 1）
 *   format_revision  時間線附加格式修訂值（目前 1）
 * jiufangm_timeline_events：每張有非預設時間線資料的卡片一列
 *   card_id          卡片代號（唯一主鍵，對應 cards.id）
 *   story_time       故事時間自由文字（預設空字串 ''）
 *   timeline_order   時間線故事順序位置（非負整數 0, 1, 2, ...，未排時為 NULL）
 *   chapter_id       連到的目錄章節代號（對應 chapters.id，未連章時為 NULL）
 */
export const TIMELINE_META_TABLE = 'jiufangm_timeline_meta';
export const TIMELINE_EVENTS_TABLE = 'jiufangm_timeline_events';
export const TIMELINE_TABLES = [TIMELINE_META_TABLE, TIMELINE_EVENTS_TABLE] as const;
export const TIMELINE_FORMAT_REVISION = 1;

const META_COLUMNS = ['id', 'format_revision'] as const;
const EVENT_COLUMNS = ['card_id', 'story_time', 'timeline_order', 'chapter_id'] as const;

export interface TimelineCardEntry {
  storyTime: string;
  timelineOrder: number | null;
  chapterId: string | null;
}

export interface TimelineWritableCard {
  id: string;
  storyTime?: string;
  timelineOrder?: number | null;
  chapterId?: string | null;
}

export type TimelineRead =
  /** 沒有附加表：這份檔尚未使用時間線附加資料（舊檔或未設定任何時間線屬性）。 */
  | { kind: 'absent' }
  /** 合法附加資料；entries 以 card_id 為鍵。 */
  | {
      kind: 'ok';
      revision: number;
      entries: Record<string, TimelineCardEntry>;
    }
  /** 附加資料損壞、結構不完整或不支援的修訂值：不可當作空資料覆寫。 */
  | { kind: 'invalid'; reason: string };

/** 時間線附加資料有破壞疑慮時丟出；存檔交易會整筆回復。 */
export class TimelineDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineDataError';
  }
}

type Inspection =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; revision: number; rows: Map<string, TimelineCardEntry> };

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function inspectTimeline(sql: Sql): Inspection {
  const tables = tableNames(sql);
  const hasMeta = tables.has(TIMELINE_META_TABLE);
  const hasEvents = tables.has(TIMELINE_EVENTS_TABLE);
  if (!hasMeta && !hasEvents) return { kind: 'absent' };
  if (!hasMeta || !hasEvents) return { kind: 'invalid', reason: '時間線附加資料表不完整' };

  const metaCols = columnNames(sql, TIMELINE_META_TABLE);
  if (META_COLUMNS.some((col) => !metaCols.has(col))) {
    return { kind: 'invalid', reason: '時間線中繼資料欄位不完整' };
  }
  const eventCols = columnNames(sql, TIMELINE_EVENTS_TABLE);
  if (EVENT_COLUMNS.some((col) => !eventCols.has(col))) {
    return { kind: 'invalid', reason: '時間線事件欄位不完整' };
  }

  const metaRows = sql.select(`SELECT id, format_revision FROM ${TIMELINE_META_TABLE}`);
  if (metaRows.length !== 1) return { kind: 'invalid', reason: '時間線中繼資料列數不對' };
  const meta = metaRows[0]!;
  if (meta.id !== 1) return { kind: 'invalid', reason: '時間線中繼資料代號不對' };
  if (!isInteger(meta.format_revision)) {
    return { kind: 'invalid', reason: '時間線格式修訂值損壞' };
  }
  if (meta.format_revision !== TIMELINE_FORMAT_REVISION) {
    return { kind: 'invalid', reason: `不支援的時間線格式修訂值 ${meta.format_revision}` };
  }

  const rows = new Map<string, TimelineCardEntry>();
  for (const row of sql.select(
    `SELECT card_id, story_time, timeline_order, chapter_id FROM ${TIMELINE_EVENTS_TABLE}`,
  )) {
    const {
      card_id: cardId,
      story_time: storyTime,
      timeline_order: timelineOrder,
      chapter_id: chapterId,
    } = row;
    if (typeof cardId !== 'string' || cardId === '') {
      return { kind: 'invalid', reason: '時間線卡片代號損壞' };
    }
    if (typeof storyTime !== 'string') {
      return { kind: 'invalid', reason: '時間線故事時間損壞' };
    }
    if (timelineOrder !== null && (!isInteger(timelineOrder) || timelineOrder < 0)) {
      return { kind: 'invalid', reason: '時間線順序損壞' };
    }
    if (chapterId !== null && typeof chapterId !== 'string') {
      return { kind: 'invalid', reason: '時間線章節代號損壞' };
    }
    if (rows.has(cardId)) {
      return { kind: 'invalid', reason: '時間線卡片代號重複' };
    }
    rows.set(cardId, {
      storyTime,
      timelineOrder,
      chapterId: chapterId === '' ? null : chapterId,
    });
  }

  return { kind: 'ok', revision: meta.format_revision, rows };
}

/** 讀出這份檔的時間線附加資料。只讀，不建表、不改寫。 */
export function readTimelineData(sql: Sql): TimelineRead {
  const result = inspectTimeline(sql);
  if (result.kind !== 'ok') return result;
  const entries: Record<string, TimelineCardEntry> = {};
  for (const [cardId, row] of result.rows) {
    entries[cardId] = {
      storyTime: row.storyTime,
      timelineOrder: row.timelineOrder,
      chapterId: row.chapterId,
    };
  }
  return { kind: 'ok', revision: result.revision, entries };
}

/**
 * 把卡片上的時間線資料（storyTime、timelineOrder、chapterId）同步寫進附加表（必須在呼叫端的交易內執行）。
 *
 * - 懶建立：沒有附加表且所有卡片都沒有非預設時間線資料時，什麼都不做、不建表，確保舊檔與 P0-4 零寫入。
 * - 差異同步：只針對有變動的列發 INSERT／UPDATE／DELETE；已刪除或已清空全部三欄的卡片會移除其附加列。
 * - 損壞或未知修訂值防護：當 inspectTimeline 為 invalid 時不動原附加表（不讀成空資料覆寫），回傳 'invalid'。
 * - 寫完於交易內讀回核對，不符即丟出 TimelineDataError 觸發 ROLLBACK。
 */
export function writeTimelineData(
  sql: Sql,
  cards: readonly TimelineWritableCard[],
): 'written' | 'skipped' | 'invalid' {
  const current = inspectTimeline(sql);
  if (current.kind === 'invalid') return 'invalid';

  const wanted = new Map<string, TimelineCardEntry>();
  const seenCardIds = new Set<string>();

  for (const card of cards) {
    if (card.storyTime !== undefined && typeof card.storyTime !== 'string') {
      throw new TimelineDataError('要寫入的時間線故事時間格式不對');
    }
    if (
      card.timelineOrder !== undefined &&
      card.timelineOrder !== null &&
      (!isInteger(card.timelineOrder) || card.timelineOrder < 0)
    ) {
      throw new TimelineDataError('要寫入的時間線順序格式不對');
    }
    if (
      card.chapterId !== undefined &&
      card.chapterId !== null &&
      typeof card.chapterId !== 'string'
    ) {
      throw new TimelineDataError('要寫入的時間線章節代號格式不對');
    }

    const storyTime = card.storyTime ?? '';
    const timelineOrder = card.timelineOrder ?? null;
    const chapterId =
      card.chapterId === undefined || card.chapterId === null || card.chapterId === ''
        ? null
        : card.chapterId;

    const hasTimelineData = storyTime !== '' || timelineOrder !== null || chapterId !== null;
    if (!hasTimelineData) continue;

    if (typeof card.id !== 'string' || card.id === '') {
      throw new TimelineDataError('要寫入的時間線卡片代號格式不對');
    }
    if (seenCardIds.has(card.id)) {
      throw new TimelineDataError('要寫入的時間線卡片代號重複');
    }
    seenCardIds.add(card.id);
    wanted.set(card.id, { storyTime, timelineOrder, chapterId });
  }

  if (current.kind === 'absent' && wanted.size === 0) return 'skipped';

  if (current.kind === 'absent') {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${TIMELINE_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_revision INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${TIMELINE_EVENTS_TABLE} (
      card_id TEXT PRIMARY KEY NOT NULL,
      story_time TEXT NOT NULL DEFAULT '',
      timeline_order INTEGER DEFAULT NULL,
      chapter_id TEXT DEFAULT NULL
    )`);
    sql.run(`INSERT OR IGNORE INTO ${TIMELINE_META_TABLE} (id, format_revision) VALUES (1, ?)`, [
      TIMELINE_FORMAT_REVISION,
    ]);
  }

  const existing = current.kind === 'ok' ? current.rows : new Map<string, TimelineCardEntry>();

  for (const existingCardId of existing.keys()) {
    if (!wanted.has(existingCardId)) {
      sql.run(`DELETE FROM ${TIMELINE_EVENTS_TABLE} WHERE card_id = ?`, [existingCardId]);
    }
  }

  for (const [cardId, entry] of wanted.entries()) {
    const found = existing.get(cardId);
    if (found) {
      if (
        found.storyTime === entry.storyTime &&
        found.timelineOrder === entry.timelineOrder &&
        found.chapterId === entry.chapterId
      ) {
        continue;
      }
      sql.run(
        `UPDATE ${TIMELINE_EVENTS_TABLE}
         SET story_time = ?, timeline_order = ?, chapter_id = ?
         WHERE card_id = ?`,
        [entry.storyTime, entry.timelineOrder, entry.chapterId, cardId],
      );
      continue;
    }
    sql.run(
      `INSERT INTO ${TIMELINE_EVENTS_TABLE} (card_id, story_time, timeline_order, chapter_id)
       VALUES (?, ?, ?, ?)`,
      [cardId, entry.storyTime, entry.timelineOrder, entry.chapterId],
    );
  }

  const after = readTimelineData(sql);
  if (after.kind !== 'ok') {
    throw new TimelineDataError('時間線附加資料寫入後讀不回來');
  }
  const afterKeys = Object.keys(after.entries);
  if (afterKeys.length !== wanted.size) {
    throw new TimelineDataError('時間線附加資料寫入後筆數不符');
  }
  for (const [cardId, entry] of wanted.entries()) {
    const back = after.entries[cardId];
    if (
      !back ||
      back.storyTime !== entry.storyTime ||
      back.timelineOrder !== entry.timelineOrder ||
      back.chapterId !== entry.chapterId
    ) {
      throw new TimelineDataError('時間線附加資料寫入後核對不符');
    }
  }
  return 'written';
}

/** 外部存檔前的檢查：時間線附加資料有破壞疑慮就丟出錯誤，沿用既有「存檔失敗」處理。 */
export function assertTimelineDataWritable(sql: Sql): void {
  const result = inspectTimeline(sql);
  if (result.kind === 'invalid') throw new TimelineDataError(result.reason);
}
