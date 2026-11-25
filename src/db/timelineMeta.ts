import {
  inspectExtensionMetaTable,
  isNonNegativeSafeInteger,
  resolveAliveRef,
  selectKnownColumns,
  updateKnownColumns,
  type AliveEntityIds,
  type ExtensionReadState,
} from './extensionMeta';
import { type Sql } from './sql';

/**
 * WO-128：事件時間線附加資料寫進稿子的資料庫，跟著稿子走。
 * WO-137：對齊 jiufangm_* 統一四態擴充規範（absent / ok / newer-revision / corrupt）。
 *
 * 存法：稿子內兩張「獨立、具 jiufangm_ 命名空間」的附加資料表。
 * - 不在電腦版既有 cards 表加欄（維持固定 8 欄）、不污染 categories_meta 或 cards.sort_order。
 * - 不動 schema_version，CURRENT_SCHEMA_VERSION 維持 14；format_revision 維持 1（確保 0.4.4 可開）。
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

export type TimelineRead = ExtensionReadState<{
  entries: Record<string, TimelineCardEntry>;
}>;

/** 時間線附加資料有破壞疑慮時丟出；存檔交易會整筆回復。 */
export class TimelineDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineDataError';
  }
}

type Inspection =
  | { kind: 'absent' }
  | { kind: 'newer-revision'; revision: number }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'ok'; revision: number; rows: Map<string, TimelineCardEntry> };

function inspectTimeline(sql: Sql): Inspection {
  const inspection = inspectExtensionMetaTable(sql, {
    metaTable: TIMELINE_META_TABLE,
    requiredMetaColumns: META_COLUMNS,
    companionTables: [
      {
        table: TIMELINE_EVENTS_TABLE,
        requiredColumns: EVENT_COLUMNS,
        label: '時間線事件',
      },
    ],
    supportedRevision: TIMELINE_FORMAT_REVISION,
    label: '時間線',
  });
  if (inspection.kind !== 'ok') {
    return inspection;
  }

  const rows = new Map<string, TimelineCardEntry>();
  for (const row of selectKnownColumns(sql, TIMELINE_EVENTS_TABLE, EVENT_COLUMNS)) {
    const {
      card_id: cardId,
      story_time: storyTime,
      timeline_order: timelineOrder,
      chapter_id: chapterId,
    } = row;
    if (typeof cardId !== 'string' || cardId === '') {
      return { kind: 'corrupt', reason: '時間線卡片代號損壞' };
    }
    if (typeof storyTime !== 'string') {
      return { kind: 'corrupt', reason: '時間線故事時間損壞' };
    }
    if (timelineOrder !== null && !isNonNegativeSafeInteger(timelineOrder)) {
      return { kind: 'corrupt', reason: '時間線順序損壞' };
    }
    if (chapterId !== null && typeof chapterId !== 'string') {
      return { kind: 'corrupt', reason: '時間線章節代號損壞' };
    }
    if (rows.has(cardId)) {
      return { kind: 'corrupt', reason: '時間線卡片代號重複' };
    }
    rows.set(cardId, {
      storyTime,
      timelineOrder,
      chapterId: chapterId === '' ? null : chapterId,
    });
  }

  return { kind: 'ok', revision: inspection.revision, rows };
}

/**
 * 讀出這份檔的時間線附加資料。只讀，不建表、不改寫。
 * 若提供 alive（現存章節與卡片 ID），會將已刪卡片紀錄略過、已刪章節的 chapterId 安全降級為 null。
 */
export function readTimelineData(
  sql: Sql,
  alive?: Pick<AliveEntityIds, 'cardIds' | 'chapterIds'>,
): TimelineRead {
  const result = inspectTimeline(sql);
  if (result.kind !== 'ok') return result;
  const entries: Record<string, TimelineCardEntry> = {};
  for (const [cardId, row] of result.rows) {
    if (alive && !alive.cardIds.has(cardId)) {
      continue;
    }
    entries[cardId] = {
      storyTime: row.storyTime,
      timelineOrder: row.timelineOrder,
      chapterId: alive ? resolveAliveRef(row.chapterId, alive.chapterIds) : row.chapterId,
    };
  }
  return { kind: 'ok', revision: result.revision, entries };
}

/**
 * 把卡片上的時間線資料（storyTime、timelineOrder、chapterId）同步寫進附加表（必須在呼叫端的交易內執行）。
 *
 * - 懶建立：沒有附加表且所有卡片都沒有非預設時間線資料時，什麼都不做、不建表，確保舊檔與 P0-4 零寫入。
 * - 差異同步：只針對有變動的列發 INSERT／UPDATE／DELETE；已刪除或已清空全部三欄的卡片會移除其附加列。
 * - 更新既有列只明確寫入本版已知欄位，保留未來未知欄位原值。
 * - 較新修訂值（newer-revision）或已損壞（corrupt）：原表完全不動，回傳對應狀態。
 * - 寫完於交易內讀回核對，不符即丟出 TimelineDataError 觸發 ROLLBACK。
 */
export function writeTimelineData(
  sql: Sql,
  cards: readonly TimelineWritableCard[],
): 'written' | 'skipped' | 'newer-revision' | 'corrupt' {
  const current = inspectTimeline(sql);
  if (current.kind === 'newer-revision' || current.kind === 'corrupt') return current.kind;

  const wanted = new Map<string, TimelineCardEntry>();
  const seenCardIds = new Set<string>();

  for (const card of cards) {
    if (card.storyTime !== undefined && typeof card.storyTime !== 'string') {
      throw new TimelineDataError('要寫入的時間線故事時間格式不對');
    }
    if (
      card.timelineOrder !== undefined &&
      card.timelineOrder !== null &&
      !isNonNegativeSafeInteger(card.timelineOrder)
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
  let mutated = current.kind === 'absent';

  for (const existingCardId of existing.keys()) {
    if (!wanted.has(existingCardId)) {
      sql.run(`DELETE FROM ${TIMELINE_EVENTS_TABLE} WHERE card_id = ?`, [existingCardId]);
      mutated = true;
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
      updateKnownColumns(
        sql,
        TIMELINE_EVENTS_TABLE,
        [
          ['story_time', entry.storyTime],
          ['timeline_order', entry.timelineOrder],
          ['chapter_id', entry.chapterId],
        ],
        'card_id = ?',
        [cardId],
      );
      mutated = true;
      continue;
    }
    sql.run(
      `INSERT INTO ${TIMELINE_EVENTS_TABLE} (card_id, story_time, timeline_order, chapter_id)
       VALUES (?, ?, ?, ?)`,
      [cardId, entry.storyTime, entry.timelineOrder, entry.chapterId],
    );
    mutated = true;
  }

  if (!mutated) return 'skipped';

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

/**
 * 外部存檔前的檢查：僅當時間線附加資料真的損壞（corrupt）時丟出錯誤；
 * absent、ok 與較新修訂值（newer-revision）一律放行正文存檔。
 */
export function assertTimelineDataWritable(sql: Sql): void {
  const result = inspectTimeline(sql);
  if (result.kind === 'corrupt') throw new TimelineDataError(result.reason);
}
