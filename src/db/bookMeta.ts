import {
  inspectExtensionMetaTable,
  isPositiveSafeInteger,
  isValidUuidV4,
  selectKnownColumns,
  updateKnownColumns,
  type ExtensionReadState,
} from './extensionMeta';
import { type Sql } from './sql';

/**
 * WO-137：稿子固定身分證寫進 .db 的獨立附加表（不改共用 8 表、不升 schema_version）。
 *
 * jiufangm_book_meta：單列（id = 1）
 *   format_revision   附加格式修訂值（目前 1）
 *   book_uuid         標準小寫 UUID v4（36 字元）
 *   created_at_ms     首次核發時間（正安全整數毫秒）
 *   origin_book_uuid  另存分枝來源的原稿 UUID v4，或 NULL
 */
export const BOOK_META_TABLE = 'jiufangm_book_meta';
export const BOOK_META_FORMAT_REVISION = 1;

const META_COLUMNS = [
  'id',
  'format_revision',
  'book_uuid',
  'created_at_ms',
  'origin_book_uuid',
] as const;

export interface BookMeta {
  bookUuid: string;
  createdAtMs: number;
  originBookUuid: string | null;
}

export interface BookMetaWritable {
  bookUuid: string;
  createdAtMs: number;
  originBookUuid?: string | null;
}

export type BookMetaRead = ExtensionReadState<{
  meta: BookMeta;
}>;

export type BookMetaWriteResult = 'written' | 'skipped' | 'newer-revision' | 'corrupt';

/** 稿件身分證寫入驗證或損壞保護錯誤；存檔交易會整筆回復。 */
export class BookMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookMetaError';
  }
}

/** 讀出這份檔的稿件固定身分證。嚴格唯讀，不建表、不改寫。 */
export function readBookMeta(sql: Sql): BookMetaRead {
  const inspection = inspectExtensionMetaTable(sql, {
    metaTable: BOOK_META_TABLE,
    requiredMetaColumns: META_COLUMNS,
    supportedRevision: BOOK_META_FORMAT_REVISION,
    label: '稿件身分證',
  });
  if (inspection.kind !== 'ok') {
    return inspection;
  }

  const rows = selectKnownColumns(
    sql,
    BOOK_META_TABLE,
    ['book_uuid', 'created_at_ms', 'origin_book_uuid'],
    'id = ?',
    [1],
  );
  if (rows.length !== 1) {
    return { kind: 'corrupt', reason: '稿件身分證資料列數不對' };
  }
  const row = rows[0]!;
  if (!isValidUuidV4(row.book_uuid)) {
    return { kind: 'corrupt', reason: '稿件身分證 UUID 格式損壞' };
  }
  if (!isPositiveSafeInteger(row.created_at_ms)) {
    return { kind: 'corrupt', reason: '稿件身分證建立時間損壞' };
  }
  if (row.origin_book_uuid !== null && !isValidUuidV4(row.origin_book_uuid)) {
    return { kind: 'corrupt', reason: '原稿身分證 UUID 格式損壞' };
  }

  return {
    kind: 'ok',
    revision: inspection.revision,
    meta: {
      bookUuid: row.book_uuid,
      createdAtMs: row.created_at_ms,
      originBookUuid: row.origin_book_uuid,
    },
  };
}

/**
 * 把稿件固定身分證寫進附加表（必須在呼叫端的交易內執行）。
 *
 * - 未傳入 input（null / undefined）時完全不建表、不寫 DML（維持 P0-4 零寫入）。
 * - 遇到較新修訂值（newer-revision）或已損壞（corrupt）時保留原表不動，絕不覆寫。
 * - 既有一致資料時略過 UPDATE，避免不必要寫入。
 * - 更新既有列時只寫入已知欄位，保留未來未知欄位原值。
 */
export function writeBookMeta(
  sql: Sql,
  input?: BookMetaWritable | null,
): BookMetaWriteResult {
  if (input == null) return 'skipped';

  if (!isValidUuidV4(input.bookUuid)) {
    throw new BookMetaError('要寫入的稿件身分證 UUID 格式不對');
  }
  if (!isPositiveSafeInteger(input.createdAtMs)) {
    throw new BookMetaError('要寫入的稿件身分證建立時間不對');
  }
  const originBookUuid = input.originBookUuid ?? null;
  if (originBookUuid !== null && !isValidUuidV4(originBookUuid)) {
    throw new BookMetaError('要寫入的原稿身分證 UUID 格式不對');
  }

  const current = readBookMeta(sql);
  if (current.kind === 'newer-revision') return 'newer-revision';
  if (current.kind === 'corrupt') return 'corrupt';

  if (current.kind === 'absent') {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${BOOK_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_revision INTEGER NOT NULL,
      book_uuid TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      origin_book_uuid TEXT DEFAULT NULL
    )`);
    sql.run(
      `INSERT INTO ${BOOK_META_TABLE} (id, format_revision, book_uuid, created_at_ms, origin_book_uuid)
       VALUES (1, ?, ?, ?, ?)`,
      [BOOK_META_FORMAT_REVISION, input.bookUuid, input.createdAtMs, originBookUuid],
    );
  } else {
    if (
      current.meta.bookUuid === input.bookUuid &&
      current.meta.createdAtMs === input.createdAtMs &&
      current.meta.originBookUuid === originBookUuid
    ) {
      return 'skipped';
    }
    updateKnownColumns(
      sql,
      BOOK_META_TABLE,
      [
        ['book_uuid', input.bookUuid],
        ['created_at_ms', input.createdAtMs],
        ['origin_book_uuid', originBookUuid],
      ],
      'id = ?',
      [1],
    );
  }

  const after = readBookMeta(sql);
  if (
    after.kind !== 'ok' ||
    after.meta.bookUuid !== input.bookUuid ||
    after.meta.createdAtMs !== input.createdAtMs ||
    after.meta.originBookUuid !== originBookUuid
  ) {
    throw new BookMetaError('稿件身分證寫入後核對不符');
  }

  return 'written';
}

/**
 * 外部存檔前檢查：僅當 jiufangm_book_meta 真的損壞（corrupt）時丟出錯誤；
 * absent、ok 與較新版本（newer-revision）一律放行正文存檔。
 */
export function assertBookMetaWritable(sql: Sql): void {
  const result = readBookMeta(sql);
  if (result.kind === 'corrupt') {
    throw new BookMetaError(result.reason);
  }
}
