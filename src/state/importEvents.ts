import type { KeyValueStore } from '../domain/outline';

/**
 * WO-99：TXT 匯入次數（AI 誠信小指標）的本機紀錄。
 *
 * .db 沒有匯入次數專用欄位，也無法證明電腦版會原樣保留另加的資料，所以照工單的安全替代方案：
 * 不改 .db 結構、不借用 AI／大量貼上等欄位，改在這台裝置的瀏覽器本機儲存另記一份。
 *
 * - events：每次成功匯入一筆事件（事件代號 → 寫作日、時間）。次數就是「事件代號不重複的筆數」。
 * - byProject：稿子代號 → 事件代號。新稿升格成檔案時代號不變，所以不會因 draftIds 清理而漏掉。
 * - byFile：存成 .db 後那份檔的內容指紋（SHA-256）→ 事件代號。開回同一份檔時，新的稿子代號接回同一批事件。
 *
 * 全部以事件代號去重：重存、另存、重開都不會多算，也不會把本機與檔案的次數相加。
 * 這份紀錄不受另存時間指紋（最多 30 筆）淘汰影響。
 *
 * WO-100：次數改為以稿子 .db 內的附加表為攜帶依據（見 db/transferMeta.ts）。這份本機紀錄保留，
 * 角色改成「新匯入稿存檔前的暫存」與「舊檔遷移來源」；畫面次數 = 檔內事件 ∪ 可靠對應的本機事件（以事件代號取聯集）。
 */
export const IMPORT_EVENTS_KEY = 'jiufang-novel-m.import-events.v1';

export interface ImportEvent {
  /** 寫作日，YYYY-MM-DD（依一天結束時刻的寫作日規則）。 */
  dayKey: string;
  atMs: number;
}

export interface ImportEventRecord {
  events: Record<string, ImportEvent>;
  byProject: Record<string, string[]>;
  byFile: Record<string, string[]>;
}

export function emptyImportEvents(): ImportEventRecord {
  return { events: {}, byProject: {}, byFile: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanIdLists(value: unknown, events: Record<string, ImportEvent>): Record<string, string[]> {
  if (!isObject(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const ids = [...new Set(list.filter((id): id is string => typeof id === 'string' && id in events))];
    if (ids.length > 0) out[key] = ids;
  }
  return out;
}

/**
 * WO-103：匯出全文（Word／TXT）事件的本機紀錄。結構與匯入紀錄完全相同、但放在另一個鍵，
 * 兩種事件各自計次，不混在同一份；角色同 WO-100（新稿存檔前的暫存與 .db 寫不進去時的可靠保留）。
 */
export const EXPORT_EVENTS_KEY = 'jiufang-novel-m.export-events.v1';

/** WO-103：匯入與匯出共用的事件紀錄型別（名稱沿用 WO-99 的 ImportEventRecord）。 */
export type TransferEventRecord = ImportEventRecord;

/** 讀回本機紀錄。沒有或壞掉時回傳空紀錄（次數從 0 起算，不捏造）。 */
export function readImportEvents(store: KeyValueStore | null): ImportEventRecord {
  return readEventRecord(store, IMPORT_EVENTS_KEY);
}

/** WO-103：讀回匯出事件的本機紀錄。 */
export function readExportEvents(store: KeyValueStore | null): TransferEventRecord {
  return readEventRecord(store, EXPORT_EVENTS_KEY);
}

/** WO-103：寫入匯出事件的本機紀錄。寫不進去時照樣丟出錯誤。 */
export function writeExportEvents(store: KeyValueStore, record: TransferEventRecord): void {
  store.setItem(EXPORT_EVENTS_KEY, JSON.stringify(record));
}

/**
 * WO-103：兩份紀錄以事件代號取聯集（同代號以 primary 為準）。
 * 用在「本機曾寫不進去、只留在記憶體」的事件：下次成功寫入時一起補寫，不會因為重讀本機而消失。
 */
export function mergeEventRecords(primary: TransferEventRecord, other: TransferEventRecord): TransferEventRecord {
  const events = { ...other.events, ...primary.events };
  const mergeLists = (a: Record<string, string[]>, b: Record<string, string[]>) => {
    const out: Record<string, string[]> = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ids = union(a[key], b[key] ?? []).filter((id) => id in events);
      if (ids.length > 0) out[key] = ids;
    }
    return out;
  };
  return {
    events,
    byProject: mergeLists(primary.byProject, other.byProject),
    byFile: mergeLists(primary.byFile, other.byFile),
  };
}

function readEventRecord(store: KeyValueStore | null, key: string): ImportEventRecord {
  if (!store) return emptyImportEvents();
  try {
    const raw = store.getItem(key);
    if (!raw) return emptyImportEvents();
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || !isObject(parsed.events)) return emptyImportEvents();
    const events: Record<string, ImportEvent> = {};
    for (const [id, event] of Object.entries(parsed.events)) {
      if (!isObject(event)) continue;
      const { dayKey, atMs } = event;
      if (typeof dayKey !== 'string' || typeof atMs !== 'number' || !Number.isFinite(atMs)) continue;
      events[id] = { dayKey, atMs };
    }
    return {
      events,
      byProject: cleanIdLists(parsed.byProject, events),
      byFile: cleanIdLists(parsed.byFile, events),
    };
  } catch {
    return emptyImportEvents();
  }
}

/** 寫入本機紀錄。寫不進去時照樣丟出錯誤，由呼叫端決定怎麼處理。 */
export function writeImportEvents(store: KeyValueStore, record: ImportEventRecord): void {
  store.setItem(IMPORT_EVENTS_KEY, JSON.stringify(record));
}

function union(left: readonly string[] | undefined, right: readonly string[]): string[] {
  return [...new Set([...(left ?? []), ...right])];
}

/** 多記一筆成功匯入，掛在新稿子代號下。 */
export function withImportEvent(
  record: ImportEventRecord,
  projectId: string,
  eventId: string,
  event: ImportEvent,
): ImportEventRecord {
  return {
    events: { ...record.events, [eventId]: event },
    byProject: { ...record.byProject, [projectId]: union(record.byProject[projectId], [eventId]) },
    byFile: record.byFile,
  };
}

/** 存成 .db 成功後：把這份稿子的事件對應到那份檔的內容指紋。沒有事件的稿子不記，紀錄不白白長大。 */
export function withFileLink(record: ImportEventRecord, projectId: string, fingerprint: string): ImportEventRecord {
  const ids = record.byProject[projectId];
  if (!ids || ids.length === 0) return record;
  const merged = union(record.byFile[fingerprint], ids);
  if (record.byFile[fingerprint] && merged.length === record.byFile[fingerprint].length) return record;
  return { ...record, byFile: { ...record.byFile, [fingerprint]: merged } };
}

/** 開回 .db：內容指紋對得上就把同一批事件接到新的稿子代號（同一事件不重複）。 */
export function withAdoptedFile(record: ImportEventRecord, fingerprint: string, projectId: string): ImportEventRecord {
  const ids = record.byFile[fingerprint];
  if (!ids || ids.length === 0) return record;
  const merged = union(record.byProject[projectId], ids);
  if (record.byProject[projectId] && merged.length === record.byProject[projectId].length) return record;
  return { ...record, byProject: { ...record.byProject, [projectId]: merged } };
}

/** 這份稿子的全書匯入次數。 */
export function importCountOf(record: ImportEventRecord, projectId: string | null | undefined): number {
  if (!projectId) return 0;
  return record.byProject[projectId]?.length ?? 0;
}

/** 這份稿子某一個寫作日的匯入次數。 */
export function importCountOn(
  record: ImportEventRecord,
  projectId: string | null | undefined,
  dayKey: string,
): number {
  if (!projectId) return 0;
  let count = 0;
  for (const id of record.byProject[projectId] ?? []) {
    if (record.events[id]?.dayKey === dayKey) count += 1;
  }
  return count;
}

/** 讀最新的本機紀錄、套上變更、寫回。寫不進去時丟出錯誤，本機原本內容不變。 */
export function updateImportEvents(
  store: KeyValueStore,
  change: (record: ImportEventRecord) => ImportEventRecord,
): ImportEventRecord {
  const current = readImportEvents(store);
  const next = change(current);
  if (next !== current) writeImportEvents(store, next);
  return next;
}

/** WO-103：匯出事件版的 updateImportEvents。 */
export function updateExportEvents(
  store: KeyValueStore,
  change: (record: TransferEventRecord) => TransferEventRecord,
): TransferEventRecord {
  const current = readExportEvents(store);
  const next = change(current);
  if (next !== current) writeExportEvents(store, next);
  return next;
}

/** WO-100：一份稿子的事件集合（事件代號 → 寫作日、時間）。統計頁與紀錄卡共用同一份。 */
export type ProjectImportEvents = Record<string, ImportEvent>;

/**
 * WO-100：這份稿子的事件集合 = 檔內事件 ∪ 本機可靠對應（byProject）的事件，以事件代號去重。
 * 同代號內容不同時以檔內為準，不把兩邊相加、不取較大值冒充遷移。
 */
export function projectImportEvents(
  record: ImportEventRecord,
  projectId: string | null | undefined,
  fileEvents?: Readonly<Record<string, ImportEvent>> | null,
): ProjectImportEvents {
  const out: ProjectImportEvents = {};
  if (!projectId) return out;
  for (const id of record.byProject[projectId] ?? []) {
    const event = record.events[id];
    if (event) out[id] = { dayKey: event.dayKey, atMs: event.atMs };
  }
  if (fileEvents) {
    for (const [id, event] of Object.entries(fileEvents)) out[id] = { dayKey: event.dayKey, atMs: event.atMs };
  }
  return out;
}

/** WO-100：本機事件與檔內事件同代號卻內容不同的代號（交接與測試用；畫面以檔內為準）。 */
export function conflictingEventIds(
  record: ImportEventRecord,
  projectId: string,
  fileEvents: Readonly<Record<string, ImportEvent>>,
): string[] {
  return (record.byProject[projectId] ?? []).filter((id) => {
    const local = record.events[id];
    const inFile = fileEvents[id];
    return Boolean(local && inFile && (local.dayKey !== inFile.dayKey || local.atMs !== inFile.atMs));
  });
}

export function countImportEvents(events: Readonly<ProjectImportEvents>): number {
  return Object.keys(events).length;
}

export function countImportEventsOn(events: Readonly<ProjectImportEvents>, dayKey: string): number {
  let count = 0;
  for (const event of Object.values(events)) if (event.dayKey === dayKey) count += 1;
  return count;
}

/**
 * WO-100：有匯入事件、卻沒有寫作紀錄列的寫作日，補一張只供顯示的空白日卡，事件不會憑空消失。
 * 只用在畫面，不寫回檔案、不改既有紀錄列。
 */
export function importOnlyDays(logDates: readonly string[], events: Readonly<ProjectImportEvents>): string[] {
  const have = new Set(logDates);
  const days = new Set<string>();
  for (const event of Object.values(events)) if (!have.has(event.dayKey)) days.add(event.dayKey);
  return [...days].sort();
}
