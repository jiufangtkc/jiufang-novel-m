import { sortTrashItems, type TrashItem } from '../domain/trash';
import {
  inspectExtensionMetaTable,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  resolveAliveRef,
  selectKnownColumns,
  updateKnownColumns,
  type ExtensionReadState,
} from './extensionMeta';
import { type Sql } from './sql';

/**
 * WO-138：刪稿暫存區寫進 .db 的獨立附加表（不改共用 8 表、不升 schema_version）。
 *
 * 存法：稿子內兩張「獨立、具 jiufangm_ 命名空間」的附加資料表。
 * - 不動 schema_version，CURRENT_SCHEMA_VERSION 維持 14；format_revision 維持 1。
 * - 不宣告 SQLite FOREIGN KEY 指向 chapters(id)，避免電腦版開啟外鍵刪除章節時被擋下。
 * - 讀檔時嚴格唯讀、不建表；寫入只在 writeFileProject 交易內採懶建立與差異同步。
 */
export const TRASH_META_TABLE = 'jiufangm_trash_meta';
export const TRASH_ITEMS_TABLE = 'jiufangm_trash_items';
export const TRASH_TABLES = [TRASH_META_TABLE, TRASH_ITEMS_TABLE] as const;
export const TRASH_FORMAT_REVISION = 1;

const META_COLUMNS = ['id', 'format_revision'] as const;
const ITEM_COLUMNS = [
  'item_id',
  'chapter_id',
  'chapter_title_snapshot',
  'content',
  'word_count',
  'before_anchor',
  'after_anchor',
  'char_offset',
  'reason',
  'deleted_at_ms',
  'sort_order',
] as const;

export type TrashRead = ExtensionReadState<{
  items: TrashItem[];
}>;

export type TrashWriteResult = 'written' | 'skipped' | 'newer-revision' | 'corrupt';

/** 刪稿暫存區附加資料驗證或損壞保護錯誤；存檔交易會整筆回復。 */
export class TrashDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrashDataError';
  }
}

type Inspection =
  | { kind: 'absent' }
  | { kind: 'newer-revision'; revision: number }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'ok'; revision: number; rows: Map<string, TrashItem> };

function inspectTrash(sql: Sql): Inspection {
  const inspection = inspectExtensionMetaTable(sql, {
    metaTable: TRASH_META_TABLE,
    requiredMetaColumns: META_COLUMNS,
    companionTables: [
      {
        table: TRASH_ITEMS_TABLE,
        requiredColumns: ITEM_COLUMNS,
        label: '刪稿項目',
      },
    ],
    supportedRevision: TRASH_FORMAT_REVISION,
    label: '刪稿暫存區',
  });
  if (inspection.kind !== 'ok') {
    return inspection;
  }

  const rows = new Map<string, TrashItem>();
  for (const row of selectKnownColumns(sql, TRASH_ITEMS_TABLE, ITEM_COLUMNS)) {
    const itemId = row.item_id;
    const chapterId = row.chapter_id;
    const chapterTitleSnapshot = row.chapter_title_snapshot;
    const content = row.content;
    const wordCount = row.word_count;
    const beforeAnchor = row.before_anchor;
    const afterAnchor = row.after_anchor;
    const charOffset = row.char_offset;
    const reason = row.reason;
    const deletedAtMs = row.deleted_at_ms;
    const sortOrder = row.sort_order;

    if (typeof itemId !== 'string' || itemId === '') {
      return { kind: 'corrupt', reason: '刪稿項目代號損壞' };
    }
    if (rows.has(itemId)) {
      return { kind: 'corrupt', reason: '刪稿項目代號重複' };
    }
    if (chapterId !== null && typeof chapterId !== 'string') {
      return { kind: 'corrupt', reason: '刪稿章節代號損壞' };
    }
    if (typeof chapterTitleSnapshot !== 'string') {
      return { kind: 'corrupt', reason: '刪稿章名快照損壞' };
    }
    if (typeof content !== 'string' || content === '') {
      return { kind: 'corrupt', reason: '刪稿全文內容損壞' };
    }
    if (!isNonNegativeSafeInteger(wordCount)) {
      return { kind: 'corrupt', reason: '刪稿字數損壞' };
    }
    if (typeof beforeAnchor !== 'string' || typeof afterAnchor !== 'string') {
      return { kind: 'corrupt', reason: '刪稿前後文錨點損壞' };
    }
    if (!isNonNegativeSafeInteger(charOffset)) {
      return { kind: 'corrupt', reason: '刪稿字元位移損壞' };
    }
    if (typeof reason !== 'string') {
      return { kind: 'corrupt', reason: '刪稿原因欄位損壞' };
    }
    if (!isPositiveSafeInteger(deletedAtMs)) {
      return { kind: 'corrupt', reason: '刪稿時間戳損壞' };
    }
    if (!isNonNegativeSafeInteger(sortOrder)) {
      return { kind: 'corrupt', reason: '刪稿排序欄位損壞' };
    }

    rows.set(itemId, {
      itemId,
      chapterId: chapterId === '' ? null : chapterId,
      chapterTitleSnapshot,
      content,
      wordCount,
      beforeAnchor,
      afterAnchor,
      charOffset,
      reason,
      deletedAtMs,
      sortOrder,
    });
  }

  return { kind: 'ok', revision: inspection.revision, rows };
}

/**
 * 讀出這份檔的刪稿暫存區。嚴格唯讀，不建表、不改寫。
 * 若提供 aliveWritableNodeIds（包含 file 與 scene），會把已刪或無效的 chapterId 安全降級為 null，
 * 但絕不跟著刪掉該則刪稿項目。
 */
export function readTrashData(
  sql: Sql,
  aliveWritableNodeIds?: ReadonlySet<string>,
): TrashRead {
  const result = inspectTrash(sql);
  if (result.kind !== 'ok') return result;

  const items: TrashItem[] = [];
  for (const item of result.rows.values()) {
    items.push({
      ...item,
      chapterId: aliveWritableNodeIds
        ? resolveAliveRef(item.chapterId, aliveWritableNodeIds)
        : item.chapterId,
    });
  }

  return {
    kind: 'ok',
    revision: result.revision,
    items: sortTrashItems(items),
  };
}

function normalizeAndValidateWritableItems(items: readonly TrashItem[]): Map<string, TrashItem> {
  const wanted = new Map<string, TrashItem>();
  for (const item of items) {
    if (typeof item.itemId !== 'string' || item.itemId.trim() === '') {
      throw new TrashDataError('要寫入的刪稿項目代號格式不對');
    }
    if (wanted.has(item.itemId)) {
      throw new TrashDataError('要寫入的刪稿項目代號重複');
    }
    if (item.chapterId !== null && typeof item.chapterId !== 'string') {
      throw new TrashDataError('要寫入的刪稿章節代號格式不對');
    }
    if (typeof item.chapterTitleSnapshot !== 'string') {
      throw new TrashDataError('要寫入的刪稿章名快照格式不對');
    }
    if (typeof item.content !== 'string' || item.content === '') {
      throw new TrashDataError('要寫入的刪稿全文內容不可為空');
    }
    if (!isNonNegativeSafeInteger(item.wordCount)) {
      throw new TrashDataError('要寫入的刪稿字數格式不對');
    }
    if (typeof item.beforeAnchor !== 'string' || typeof item.afterAnchor !== 'string') {
      throw new TrashDataError('要寫入的刪稿前後文錨點格式不對');
    }
    if (!isNonNegativeSafeInteger(item.charOffset)) {
      throw new TrashDataError('要寫入的刪稿字元位移格式不對');
    }
    if (typeof item.reason !== 'string') {
      throw new TrashDataError('要寫入的刪稿原因格式不對');
    }
    if (!isPositiveSafeInteger(item.deletedAtMs)) {
      throw new TrashDataError('要寫入的刪稿時間戳格式不對');
    }
    if (!isNonNegativeSafeInteger(item.sortOrder)) {
      throw new TrashDataError('要寫入的刪稿排序格式不對');
    }

    wanted.set(item.itemId, {
      itemId: item.itemId,
      chapterId: item.chapterId === null || item.chapterId === '' ? null : item.chapterId,
      chapterTitleSnapshot: item.chapterTitleSnapshot,
      content: item.content,
      wordCount: item.wordCount,
      beforeAnchor: item.beforeAnchor,
      afterAnchor: item.afterAnchor,
      charOffset: item.charOffset,
      reason: item.reason,
      deletedAtMs: item.deletedAtMs,
      sortOrder: item.sortOrder,
    });
  }
  return wanted;
}

function trashItemEquals(a: TrashItem, b: TrashItem): boolean {
  return (
    a.itemId === b.itemId &&
    a.chapterId === b.chapterId &&
    a.chapterTitleSnapshot === b.chapterTitleSnapshot &&
    a.content === b.content &&
    a.wordCount === b.wordCount &&
    a.beforeAnchor === b.beforeAnchor &&
    a.afterAnchor === b.afterAnchor &&
    a.charOffset === b.charOffset &&
    a.reason === b.reason &&
    a.deletedAtMs === b.deletedAtMs &&
    a.sortOrder === b.sortOrder
  );
}

/**
 * 把刪稿暫存區寫進附加表（必須在呼叫端的交易內執行）。
 *
 * - 未傳入 items（null / undefined）時完全不建表、零寫入。
 * - current 為 absent 且 items 為空時完全不建表、零寫入（維持舊檔與 P0-4 零寫入）。
 * - 遇到 newer-revision 或 corrupt 時原表不動，回傳對應狀態。
 * - 差異同步寫入既有列時僅更新本版已知欄位，保留未知欄位原值。
 * - 寫完後於同一交易內讀回核對，不符即丟出 TrashDataError 觸發 ROLLBACK。
 */
export function writeTrashData(
  sql: Sql,
  items?: readonly TrashItem[] | null,
): TrashWriteResult {
  if (items == null) return 'skipped';

  const wanted = normalizeAndValidateWritableItems(items);
  const current = inspectTrash(sql);
  if (current.kind === 'newer-revision' || current.kind === 'corrupt') {
    return current.kind;
  }
  if (current.kind === 'absent' && wanted.size === 0) {
    return 'skipped';
  }

  if (current.kind === 'absent') {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${TRASH_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_revision INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${TRASH_ITEMS_TABLE} (
      item_id TEXT PRIMARY KEY NOT NULL,
      chapter_id TEXT DEFAULT NULL,
      chapter_title_snapshot TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      before_anchor TEXT NOT NULL DEFAULT '',
      after_anchor TEXT NOT NULL DEFAULT '',
      char_offset INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      deleted_at_ms INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`);
    sql.run(`INSERT OR IGNORE INTO ${TRASH_META_TABLE} (id, format_revision) VALUES (1, ?)`, [
      TRASH_FORMAT_REVISION,
    ]);
  }

  const existing = current.kind === 'ok' ? current.rows : new Map<string, TrashItem>();
  let mutated = current.kind === 'absent';

  for (const existingItemId of existing.keys()) {
    if (!wanted.has(existingItemId)) {
      sql.run(`DELETE FROM ${TRASH_ITEMS_TABLE} WHERE item_id = ?`, [existingItemId]);
      mutated = true;
    }
  }

  for (const [itemId, entry] of wanted.entries()) {
    const found = existing.get(itemId);
    if (found) {
      if (trashItemEquals(found, entry)) {
        continue;
      }
      updateKnownColumns(
        sql,
        TRASH_ITEMS_TABLE,
        [
          ['chapter_id', entry.chapterId],
          ['chapter_title_snapshot', entry.chapterTitleSnapshot],
          ['content', entry.content],
          ['word_count', entry.wordCount],
          ['before_anchor', entry.beforeAnchor],
          ['after_anchor', entry.afterAnchor],
          ['char_offset', entry.charOffset],
          ['reason', entry.reason],
          ['deleted_at_ms', entry.deletedAtMs],
          ['sort_order', entry.sortOrder],
        ],
        'item_id = ?',
        [itemId],
      );
      mutated = true;
      continue;
    }

    sql.run(
      `INSERT INTO ${TRASH_ITEMS_TABLE} (
        item_id, chapter_id, chapter_title_snapshot, content, word_count,
        before_anchor, after_anchor, char_offset, reason, deleted_at_ms, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.itemId,
        entry.chapterId,
        entry.chapterTitleSnapshot,
        entry.content,
        entry.wordCount,
        entry.beforeAnchor,
        entry.afterAnchor,
        entry.charOffset,
        entry.reason,
        entry.deletedAtMs,
        entry.sortOrder,
      ],
    );
    mutated = true;
  }

  if (!mutated) return 'skipped';

  const after = readTrashData(sql);
  if (after.kind !== 'ok') {
    throw new TrashDataError('刪稿暫存區寫入後讀不回來');
  }
  if (after.items.length !== wanted.size) {
    throw new TrashDataError('刪稿暫存區寫入後筆數不符');
  }
  for (const back of after.items) {
    const expected = wanted.get(back.itemId);
    if (!expected || !trashItemEquals(back, expected)) {
      throw new TrashDataError('刪稿暫存區寫入後核對不符');
    }
  }

  return 'written';
}

/**
 * 外部存檔前檢查：僅當 jiufangm_trash_* 真的損壞（corrupt）時丟出錯誤；
 * absent、ok 與較新修訂值（newer-revision）一律放行正文存檔。
 */
export function assertTrashDataWritable(sql: Sql): void {
  const result = inspectTrash(sql);
  if (result.kind === 'corrupt') {
    throw new TrashDataError(result.reason);
  }
}
