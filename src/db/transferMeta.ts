import { columnNames, tableNames, type Sql } from './sql';

/**
 * WO-100：匯入／匯出事件寫進稿子的 .db，跟著稿子走。
 *
 * 存法：稿子內兩張「獨立、具 jiufangm_ 命名空間」的附加資料表。
 * - 不在電腦版既有表加欄、不借用 AI 欄位、不動 ai_details 或分類 JSON。
 * - 不動 schema_version，CURRENT_SCHEMA_VERSION 維持 14；本單另有自己的附加格式修訂值（目前 1）。
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

export type TransferRead =
  /** 沒有附加表：這份檔沒有檔內歷史（舊檔），交給本機遷移規則處理。 */
  | { kind: 'absent' }
  /** 合法附加資料；importEvents／exportEvents 為空代表已保存的 0。 */
  | {
      kind: 'ok';
      revision: number;
      exportCount: number | null;
      importEvents: Record<string, TransferEvent>;
      /** WO-103：成功匯出全文的事件。 */
      exportEvents: Record<string, TransferEvent>;
    }
  /** 附加資料損壞、結構不完整、同代號衝突或不支援的修訂值：不可當作 0，也不可覆寫。 */
  | { kind: 'invalid'; reason: string };

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
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; revision: number; exportCount: number | null; rows: Map<string, StoredRow> };

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function inspect(sql: Sql): Inspection {
  const tables = tableNames(sql);
  const hasMeta = tables.has(TRANSFER_META_TABLE);
  const hasEvents = tables.has(TRANSFER_EVENTS_TABLE);
  if (!hasMeta && !hasEvents) return { kind: 'absent' };
  if (!hasMeta || !hasEvents) return { kind: 'invalid', reason: '附加資料表不完整' };

  const metaCols = columnNames(sql, TRANSFER_META_TABLE);
  if (META_COLUMNS.some((col) => !metaCols.has(col))) return { kind: 'invalid', reason: '附加中繼資料欄位不完整' };
  const eventCols = columnNames(sql, TRANSFER_EVENTS_TABLE);
  if (EVENT_COLUMNS.some((col) => !eventCols.has(col))) return { kind: 'invalid', reason: '附加事件欄位不完整' };

  const metaRows = sql.select(`SELECT id, format_revision, export_count FROM ${TRANSFER_META_TABLE}`);
  if (metaRows.length !== 1) return { kind: 'invalid', reason: '附加中繼資料列數不對' };
  const meta = metaRows[0]!;
  if (meta.id !== 1) return { kind: 'invalid', reason: '附加中繼資料代號不對' };
  if (!isInteger(meta.format_revision)) return { kind: 'invalid', reason: '附加格式修訂值損壞' };
  if (meta.format_revision !== TRANSFER_FORMAT_REVISION) {
    return { kind: 'invalid', reason: `不支援的附加格式修訂值 ${meta.format_revision}` };
  }
  const exportCount = meta.export_count;
  if (exportCount !== null && !(isInteger(exportCount) && exportCount >= 0)) {
    return { kind: 'invalid', reason: '匯出次數預留欄損壞' };
  }

  const rows = new Map<string, StoredRow>();
  for (const row of sql.select(`SELECT event_id, kind, day_key, at_ms FROM ${TRANSFER_EVENTS_TABLE}`)) {
    const { event_id: id, kind, day_key: dayKey, at_ms: atMs } = row;
    if (typeof id !== 'string' || id === '') return { kind: 'invalid', reason: '事件代號損壞' };
    if (typeof kind !== 'string' || !EVENT_KINDS.has(kind)) return { kind: 'invalid', reason: '事件種類損壞' };
    if (typeof dayKey !== 'string' || !DAY_KEY.test(dayKey)) return { kind: 'invalid', reason: '事件寫作日損壞' };
    if (!isInteger(atMs)) return { kind: 'invalid', reason: '事件時間損壞' };
    if (rows.has(id)) return { kind: 'invalid', reason: '事件代號重複' };
    rows.set(id, { kind: kind as TransferEventKind, dayKey, atMs });
  }
  return { kind: 'ok', revision: meta.format_revision, exportCount, rows };
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
 * - 既有列一律不刪、不改；export_count 不碰（新建時為 NULL，既有值原樣保留）。
 * - 附加資料已損壞或修訂值不支援：不動附加表（不讀成 0 覆寫），回傳 'invalid'，由外部存檔驗證擋下。
 * - 寫完再讀回核對，缺任何一筆就丟出錯誤，讓交易回復。
 */
export function writeTransferEvents(
  sql: Sql,
  events: Readonly<Record<string, TransferEvent>>,
  exportEvents: Readonly<Record<string, TransferEvent>> = {},
): 'written' | 'skipped' | 'invalid' {
  const current = inspect(sql);
  if (current.kind === 'invalid') return 'invalid';
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
    if (typeof id !== 'string' || id === '' || !DAY_KEY.test(event.dayKey) || !isInteger(event.atMs)) {
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

/** 外部存檔前的檢查：附加資料有破壞疑慮就丟出錯誤，沿用既有「存檔失敗」處理。 */
export function assertTransferDataWritable(sql: Sql): void {
  const result = inspect(sql);
  if (result.kind === 'invalid') throw new TransferDataError(result.reason);
}
