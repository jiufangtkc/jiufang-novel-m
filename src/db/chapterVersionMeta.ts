import {
  isManuscriptVersionSource,
  sortManuscriptVersions,
  type ManuscriptVersion,
} from '../domain/manuscriptVersions';
import {
  inspectExtensionMetaTable,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  selectKnownColumns,
  updateKnownColumns,
  type ExtensionReadState,
} from './extensionMeta';
import { type Sql } from './sql';

/**
 * WO-140：稿子版本寫進 .db 的獨立附加表（不改共用 8 表、不升 schema_version、不寫入 snapshots）。
 *
 * 存法：稿子內兩張「獨立、具 jiufangm_ 命名空間」的附加資料表。
 * - 不動 schema_version，CURRENT_SCHEMA_VERSION 維持 14；format_revision 維持 1。
 * - 不宣告 SQLite FOREIGN KEY 指向 chapters(id)，避免電腦版開啟外鍵刪除章節時被擋下。
 * - 決-3：讀寫都不做孤兒刪除，也不把已刪章的 chapter_id 改成 NULL。
 * - 讀檔時嚴格唯讀、不建表；寫入只在 writeFileProject 交易內採懶建立與差異同步。
 */
export const CHAPTER_VERSION_META_TABLE = 'jiufangm_chapter_version_meta';
export const CHAPTER_VERSIONS_TABLE = 'jiufangm_chapter_versions';
export const CHAPTER_VERSION_TABLES = [
  CHAPTER_VERSION_META_TABLE,
  CHAPTER_VERSIONS_TABLE,
] as const;
export const CHAPTER_VERSION_FORMAT_REVISION = 1;

const META_COLUMNS = ['id', 'format_revision'] as const;
const VERSION_COLUMNS = [
  'version_id',
  'chapter_id',
  'chapter_title_snapshot',
  'content',
  'word_count',
  'note',
  'source',
  'saved_at_ms',
  'sort_order',
] as const;

export type ChapterVersionRead = ExtensionReadState<{
  versions: ManuscriptVersion[];
}>;

export type ChapterVersionWriteResult =
  | 'written'
  | 'skipped'
  | 'newer-revision'
  | 'corrupt';

/** 稿子版本附加資料驗證或損壞保護錯誤；存檔交易會整筆回復。 */
export class ChapterVersionDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChapterVersionDataError';
  }
}

type Inspection =
  | { kind: 'absent' }
  | { kind: 'newer-revision'; revision: number }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'ok'; revision: number; rows: Map<string, ManuscriptVersion> };

function inspectChapterVersions(sql: Sql): Inspection {
  const inspection = inspectExtensionMetaTable(sql, {
    metaTable: CHAPTER_VERSION_META_TABLE,
    requiredMetaColumns: META_COLUMNS,
    companionTables: [
      {
        table: CHAPTER_VERSIONS_TABLE,
        requiredColumns: VERSION_COLUMNS,
        label: '稿子版本項目',
      },
    ],
    supportedRevision: CHAPTER_VERSION_FORMAT_REVISION,
    label: '稿子版本',
  });
  if (inspection.kind !== 'ok') {
    return inspection;
  }

  const rows = new Map<string, ManuscriptVersion>();
  for (const row of selectKnownColumns(sql, CHAPTER_VERSIONS_TABLE, VERSION_COLUMNS)) {
    const versionId = row.version_id;
    const chapterId = row.chapter_id;
    const chapterTitleSnapshot = row.chapter_title_snapshot;
    const content = row.content;
    const wordCount = row.word_count;
    const note = row.note;
    const source = row.source;
    const savedAtMs = row.saved_at_ms;
    const sortOrder = row.sort_order;

    if (typeof versionId !== 'string' || versionId.trim() === '') {
      return { kind: 'corrupt', reason: '稿子版本代號損壞' };
    }
    if (rows.has(versionId)) {
      return { kind: 'corrupt', reason: '稿子版本代號重複' };
    }
    if (typeof chapterId !== 'string' || chapterId.trim() === '') {
      return { kind: 'corrupt', reason: '稿子版本章節代號損壞' };
    }
    if (typeof chapterTitleSnapshot !== 'string') {
      return { kind: 'corrupt', reason: '稿子版本章名快照損壞' };
    }
    if (typeof content !== 'string') {
      return { kind: 'corrupt', reason: '稿子版本全文內容損壞' };
    }
    if (!isNonNegativeSafeInteger(wordCount)) {
      return { kind: 'corrupt', reason: '稿子版本字數損壞' };
    }
    if (typeof note !== 'string') {
      return { kind: 'corrupt', reason: '稿子版本備註損壞' };
    }
    if (!isManuscriptVersionSource(source)) {
      return { kind: 'corrupt', reason: '稿子版本來源損壞' };
    }
    if (!isPositiveSafeInteger(savedAtMs)) {
      return { kind: 'corrupt', reason: '稿子版本時間戳損壞' };
    }
    if (!isNonNegativeSafeInteger(sortOrder)) {
      return { kind: 'corrupt', reason: '稿子版本排序欄位損壞' };
    }

    rows.set(versionId, {
      version_id: versionId,
      chapter_id: chapterId,
      chapter_title_snapshot: chapterTitleSnapshot,
      content,
      word_count: wordCount,
      note,
      source,
      saved_at_ms: savedAtMs,
      sort_order: sortOrder,
    });
  }

  return { kind: 'ok', revision: inspection.revision, rows };
}

/**
 * 讀出這份檔的稿子版本清單。嚴格唯讀，不建表、不改寫。
 * 遵守決-3：不做孤兒過濾，也不把已刪章的 chapter_id 降級為 NULL。
 */
export function readChapterVersionData(sql: Sql): ChapterVersionRead {
  const result = inspectChapterVersions(sql);
  if (result.kind !== 'ok') return result;

  return {
    kind: 'ok',
    revision: result.revision,
    versions: sortManuscriptVersions([...result.rows.values()]),
  };
}

function normalizeAndValidateWritableVersions(
  versions: readonly ManuscriptVersion[],
): Map<string, ManuscriptVersion> {
  const wanted = new Map<string, ManuscriptVersion>();
  for (const item of versions) {
    if (typeof item.version_id !== 'string' || item.version_id.trim() === '') {
      throw new ChapterVersionDataError('要寫入的稿子版本代號格式不對');
    }
    if (wanted.has(item.version_id)) {
      throw new ChapterVersionDataError('要寫入的稿子版本代號重複');
    }
    if (typeof item.chapter_id !== 'string' || item.chapter_id.trim() === '') {
      throw new ChapterVersionDataError('要寫入的稿子版本章節代號格式不對');
    }
    if (typeof item.chapter_title_snapshot !== 'string') {
      throw new ChapterVersionDataError('要寫入的稿子版本章名快照格式不對');
    }
    if (typeof item.content !== 'string') {
      throw new ChapterVersionDataError('要寫入的稿子版本全文內容格式不對');
    }
    if (!isNonNegativeSafeInteger(item.word_count)) {
      throw new ChapterVersionDataError('要寫入的稿子版本字數格式不對');
    }
    if (typeof item.note !== 'string') {
      throw new ChapterVersionDataError('要寫入的稿子版本備註格式不對');
    }
    if (!isManuscriptVersionSource(item.source)) {
      throw new ChapterVersionDataError('要寫入的稿子版本來源格式不對');
    }
    if (!isPositiveSafeInteger(item.saved_at_ms)) {
      throw new ChapterVersionDataError('要寫入的稿子版本時間戳格式不對');
    }
    if (!isNonNegativeSafeInteger(item.sort_order)) {
      throw new ChapterVersionDataError('要寫入的稿子版本排序格式不對');
    }

    wanted.set(item.version_id, {
      version_id: item.version_id,
      chapter_id: item.chapter_id,
      chapter_title_snapshot: item.chapter_title_snapshot,
      content: item.content,
      word_count: item.word_count,
      note: item.note,
      source: item.source,
      saved_at_ms: item.saved_at_ms,
      sort_order: item.sort_order,
    });
  }
  return wanted;
}

function manuscriptVersionEquals(a: ManuscriptVersion, b: ManuscriptVersion): boolean {
  return (
    a.version_id === b.version_id &&
    a.chapter_id === b.chapter_id &&
    a.chapter_title_snapshot === b.chapter_title_snapshot &&
    a.content === b.content &&
    a.word_count === b.word_count &&
    a.note === b.note &&
    a.source === b.source &&
    a.saved_at_ms === b.saved_at_ms &&
    a.sort_order === b.sort_order
  );
}

/**
 * 把稿子版本寫進附加表（必須在呼叫端的交易內執行）。
 *
 * - 未傳入 versions（null / undefined）時完全不建表、零寫入。
 * - current 為 absent 且 versions 為空時完全不建表、零寫入（維持舊檔與 P0-4 零寫入）。
 * - 遇到 newer-revision 或 corrupt 時原表不動，回傳對應狀態。
 * - 決-3：不針對 chapter_id 做孤兒清理。
 * - 差異同步寫入既有列時僅更新本版已知欄位，保留未知欄位原值。
 * - 寫完後於同一交易內讀回核對，不符即丟出 ChapterVersionDataError 觸發 ROLLBACK。
 */
export function writeChapterVersionData(
  sql: Sql,
  versions?: readonly ManuscriptVersion[] | null,
): ChapterVersionWriteResult {
  if (versions == null) return 'skipped';

  const wanted = normalizeAndValidateWritableVersions(versions);
  const current = inspectChapterVersions(sql);
  if (current.kind === 'newer-revision' || current.kind === 'corrupt') {
    return current.kind;
  }
  if (current.kind === 'absent' && wanted.size === 0) {
    return 'skipped';
  }

  if (current.kind === 'absent') {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${CHAPTER_VERSION_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_revision INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${CHAPTER_VERSIONS_TABLE} (
      version_id TEXT PRIMARY KEY NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_title_snapshot TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      saved_at_ms INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`);
    sql.run(
      `INSERT OR IGNORE INTO ${CHAPTER_VERSION_META_TABLE} (id, format_revision) VALUES (1, ?)`,
      [CHAPTER_VERSION_FORMAT_REVISION],
    );
  }

  const existing =
    current.kind === 'ok' ? current.rows : new Map<string, ManuscriptVersion>();
  let mutated = current.kind === 'absent';

  for (const existingVersionId of existing.keys()) {
    if (!wanted.has(existingVersionId)) {
      sql.run(`DELETE FROM ${CHAPTER_VERSIONS_TABLE} WHERE version_id = ?`, [
        existingVersionId,
      ]);
      mutated = true;
    }
  }

  for (const [versionId, entry] of wanted.entries()) {
    const found = existing.get(versionId);
    if (found) {
      if (manuscriptVersionEquals(found, entry)) {
        continue;
      }
      updateKnownColumns(
        sql,
        CHAPTER_VERSIONS_TABLE,
        [
          ['chapter_id', entry.chapter_id],
          ['chapter_title_snapshot', entry.chapter_title_snapshot],
          ['content', entry.content],
          ['word_count', entry.word_count],
          ['note', entry.note],
          ['source', entry.source],
          ['saved_at_ms', entry.saved_at_ms],
          ['sort_order', entry.sort_order],
        ],
        'version_id = ?',
        [versionId],
      );
      mutated = true;
      continue;
    }

    sql.run(
      `INSERT INTO ${CHAPTER_VERSIONS_TABLE} (
        version_id, chapter_id, chapter_title_snapshot, content, word_count,
        note, source, saved_at_ms, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.version_id,
        entry.chapter_id,
        entry.chapter_title_snapshot,
        entry.content,
        entry.word_count,
        entry.note,
        entry.source,
        entry.saved_at_ms,
        entry.sort_order,
      ],
    );
    mutated = true;
  }

  if (!mutated) return 'skipped';

  const after = readChapterVersionData(sql);
  if (after.kind !== 'ok') {
    throw new ChapterVersionDataError('稿子版本寫入後讀不回來');
  }
  if (after.versions.length !== wanted.size) {
    throw new ChapterVersionDataError('稿子版本寫入後筆數不符');
  }
  for (const back of after.versions) {
    const expected = wanted.get(back.version_id);
    if (!expected || !manuscriptVersionEquals(back, expected)) {
      throw new ChapterVersionDataError('稿子版本寫入後核對不符');
    }
  }

  return 'written';
}

/**
 * 外部存檔前檢查：僅當 jiufangm_chapter_version_* 真的損壞（corrupt）時丟出錯誤；
 * absent、ok 與較新修訂值（newer-revision）一律放行正文存檔。
 */
export function assertChapterVersionDataWritable(sql: Sql): void {
  const result = inspectChapterVersions(sql);
  if (result.kind === 'corrupt') {
    throw new ChapterVersionDataError(result.reason);
  }
}
