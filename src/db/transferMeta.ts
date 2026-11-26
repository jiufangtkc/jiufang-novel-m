import {
  inspectExtensionMetaTable,
  isNonNegativeSafeInteger,
  isSafeInteger,
  selectKnownColumns,
  type ExtensionReadState,
} from './extensionMeta';
import { type Sql } from './sql';

/**
 * WO-100：匯入／匯出事件寫進稿子的 .db，跟著稿子走。
 * WO-137：對齊 jiufangm_* 統一四態擴充規範（absent / ok / newer-revision / corrupt）。
 *
 * 存法：稿子內兩張「獨立、具 jiufangm_ 命名空間」的附加資料表。
 * - 不在電腦版既有表加欄、不借用 AI 欄位、不動 ai_details 或分類 JSON。
 * - 不動 schema_version，CURRENT_SCHEMA_VERSION 維持 14；format_revision 維持 1（確保 0.4.4 可開）。
 * - 讀檔時只讀、不建表；建立與寫入只在存檔快照（writeFileProject 的交易）裡做，且可重複執行。
 *
 * jiufangm_transfer_meta：單列（id = 1）
 *   format_revision  附加格式修訂值（目前 1）
 *   export_count     匯出全文次數預留欄，預設 NULL。WO-103 起仍不寫、不改：NULL＝沒有未分配寫作日的歷史基數；
 *                    既有非 NULL 值無法證明是否已含檔內 export 事件，原樣保留、不加進畫面次數（見交接）。
 * jiufangm_transfer_events：每筆事件一列
 *   event_id  事件代號（唯一主鍵，沿用 WO-99 本機事件代號）
 *   kind      'import'（TXT 匯入）／'export'（WO-103 起：成功交付一次 Word 或 TXT 全文匯出）
 *   day_key   寫作日 YYYY-MM-DD（照事件發生當時記下，不重算）
 *   at_ms     發生時間（毫秒）
 */
export const TRANSFER_META_TABLE = 'jiufangm_transfer_meta';
export const TRANSFER_EVENTS_TABLE = 'jiufangm_transfer_events';
export const TRANSFER_TABLES = [TRANSFER_META_TABLE, TRANSFER_EVENTS_TABLE] as const;
export const TRANSFER_FORMAT_REVISION = 1;

const META_COLUMNS = ['id', 'format_revision', 'export_count'] as const;
const EVENT_COLUMNS = ['event_id', 'kind', 'day_key', 'at_ms'] as const;
const EVENT_KINDS = new Set(['import', 'export']);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface TransferEvent {
  dayKey: string;
  atMs: number;
}

export type TransferEventKind = 'import' | 'export';

export type TransferRead = ExtensionReadState<{
  exportCount: number | null;
  importEvents: Record<string, TransferEvent>;
  /** WO-103：成功匯出全文的事件。 */
  exportEvents: Record<string, TransferEvent>;
}>;

/** 附加資料有破壞疑慮時丟出；存檔交易會整筆回復。 */
export class TransferDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferDataError';
  }
}

interface StoredRow {
  kind: TransferEventKind;
  dayKey: string;
  atMs: number;
}

type Inspection =
  | { kind: 'absent' }
  | { kind: 'newer-revision'; revision: number }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'ok'; revision: number; exportCount: number | null; rows: Map<string, StoredRow> };

function inspect(sql: Sql): Inspection {
  const inspection = inspectExtensionMetaTable(sql, {
    metaTable: TRANSFER_META_TABLE,
    requiredMetaColumns: META_COLUMNS,
    companionTables: [
      {
        table: TRANSFER_EVENTS_TABLE,
        requiredColumns: EVENT_COLUMNS,
        label: '附加事件',
      },
    ],
    supportedRevision: TRANSFER_FORMAT_REVISION,
    label: '匯入匯出',
  });
  if (inspection.kind !== 'ok') {
    return inspection;
  }

  const metaRows = selectKnownColumns(sql, TRANSFER_META_TABLE, ['export_count'], 'id = ?', [1]);
  if (metaRows.length !== 1) return { kind: 'corrupt', reason: '附加中繼資料列數不對' };
  const exportCount = metaRows[0]!.export_count;
  if (exportCount !== null && !isNonNegativeSafeInteger(exportCount)) {
    return { kind: 'corrupt', reason: '匯出次數預留欄損壞' };
  }

  const rows = new Map<string, StoredRow>();
  for (const row of selectKnownColumns(sql, TRANSFER_EVENTS_TABLE, EVENT_COLUMNS)) {
    const { event_id: id, kind, day_key: dayKey, at_ms: atMs } = row;
    if (typeof id !== 'string' || id === '') return { kind: 'corrupt', reason: '事件代號損壞' };
    if (typeof kind !== 'string' || !EVENT_KINDS.has(kind)) return { kind: 'corrupt', reason: '事件種類損壞' };
    if (typeof dayKey !== 'string' || !DAY_KEY.test(dayKey)) return { kind: 'corrupt', reason: '事件寫作日損壞' };
    if (!isSafeInteger(atMs)) return { kind: 'corrupt', reason: '事件時間損壞' };
    if (rows.has(id)) return { kind: 'corrupt', reason: '事件代號重複' };
    rows.set(id, { kind: kind as TransferEventKind, dayKey, atMs });
  }
  return { kind: 'ok', revision: inspection.revision, exportCount, rows };
}

/** 讀出這份檔的附加資料。只讀，不建表、不改寫。 */
export function readTransferData(sql: Sql): TransferRead {
  const result = inspect(sql);
  if (result.kind !== 'ok') return result;
  const importEvents: Record<string, TransferEvent> = {};
  const exportEvents: Record<string, TransferEvent> = {};
  for (const [id, row] of result.rows) {
    if (row.kind === 'import') importEvents[id] = { dayKey: row.dayKey, atMs: row.atMs };
    if (row.kind === 'export') exportEvents[id] = { dayKey: row.dayKey, atMs: row.atMs };
  }
  return { kind: 'ok', revision: result.revision, exportCount: result.exportCount, importEvents, exportEvents };
}

/**
 * 把這份稿子的匯入（與 WO-103 起的匯出）事件寫進附加表（必須在呼叫端的交易內執行）。
 *
 * - 沒有附加表又沒有事件：什麼都不做，電腦版原檔結構原樣不動。
 * - 只新增檔內還沒有的事件；同代號同種類同內容略過；同代號但種類或內容不同丟出 TransferDataError（不覆寫）。
 * - 既有列一律不刪、不改；export_count 與未來未知欄位原樣保留。
 * - 較新修訂值（newer-revision）或已損壞（corrupt）：原表完全不動，回傳對應狀態。
 * - 寫完再讀回核對，缺任何一筆就丟出錯誤，讓交易回復。
 */
export function writeTransferEvents(
  sql: Sql,
  events: Readonly<Record<string, TransferEvent>>,
  exportEvents: Readonly<Record<string, TransferEvent>> = {},
): 'written' | 'skipped' | 'newer-revision' | 'corrupt' {
  const current = inspect(sql);
  if (current.kind === 'newer-revision' || current.kind === 'corrupt') return current.kind;
  const wanted: Array<{ id: string; kind: TransferEventKind; event: TransferEvent }> = [
    ...Object.entries(events).map(([id, event]) => ({ id, kind: 'import' as const, event })),
    ...Object.entries(exportEvents).map(([id, event]) => ({ id, kind: 'export' as const, event })),
  ];
  if (current.kind === 'absent' && wanted.length === 0) return 'skipped';

  const seen = new Map<string, TransferEventKind>();
  for (const { id, kind } of wanted) {
    if (seen.has(id)) throw new TransferDataError('同一個事件代號同時是匯入與匯出');
    seen.set(id, kind);
  }

  if (current.kind === 'absent') {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${TRANSFER_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      format_revision INTEGER NOT NULL,
      export_count INTEGER DEFAULT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${TRANSFER_EVENTS_TABLE} (
      event_id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('import', 'export')),
      day_key TEXT NOT NULL,
      at_ms INTEGER NOT NULL
    )`);
    sql.run(`INSERT OR IGNORE INTO ${TRANSFER_META_TABLE} (id, format_revision, export_count) VALUES (1, ?, NULL)`, [
      TRANSFER_FORMAT_REVISION,
    ]);
  }
  const existing = current.kind === 'ok' ? current.rows : new Map<string, StoredRow>();

  for (const { id, kind, event } of wanted) {
    if (typeof id !== 'string' || id === '' || !DAY_KEY.test(event.dayKey) || !isSafeInteger(event.atMs)) {
      throw new TransferDataError('要寫入的事件格式不對');
    }
    const found = existing.get(id);
    if (found) {
      if (found.kind !== kind || found.dayKey !== event.dayKey || found.atMs !== event.atMs) {
        throw new TransferDataError('事件代號相同但內容不同');
      }
      continue;
    }
    sql.run(`INSERT INTO ${TRANSFER_EVENTS_TABLE} (event_id, kind, day_key, at_ms) VALUES (?, ?, ?, ?)`, [
      id,
      kind,
      event.dayKey,
      event.atMs,
    ]);
  }

  const after = readTransferData(sql);
  if (after.kind !== 'ok') throw new TransferDataError('附加資料寫入後讀不回來');
  for (const { id, kind, event } of wanted) {
    const back = kind === 'import' ? after.importEvents[id] : after.exportEvents[id];
    if (!back || back.dayKey !== event.dayKey || back.atMs !== event.atMs) {
      throw new TransferDataError('附加事件寫入後核對不符');
    }
  }
  return 'written';
}

/**
 * 外部存檔前的檢查：僅當附加資料真的損壞（corrupt）時丟出錯誤；
 * absent、ok 與較新修訂值（newer-revision）一律放行正文存檔。
 */
export function assertTransferDataWritable(sql: Sql): void {
  const result = inspect(sql);
  if (result.kind === 'corrupt') throw new TransferDataError(result.reason);
}
