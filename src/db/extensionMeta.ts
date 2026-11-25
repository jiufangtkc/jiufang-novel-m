import { columnNames, tableNames, type Sql, type SqlValue } from './sql';

/** 行動版專屬附加表統一前綴（不改共用 8 表、不升 schema_version）。 */
export const JIUFANGM_TABLE_PREFIX = 'jiufangm_';

/** 標準小寫 UUID v4 格式。 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** jiufangm_* 擴充模組讀取的四態結果。 */
export type ExtensionStateKind = 'absent' | 'ok' | 'newer-revision' | 'corrupt';

export type ExtensionReadState<
  TOk extends Record<string, unknown> = Record<string, never>,
> =
  | { kind: 'absent' }
  | ({ kind: 'ok'; revision: number } & TOk)
  | { kind: 'newer-revision'; revision: number }
  | { kind: 'corrupt'; reason: string };

export interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

export interface ExtensionCompanionTableSpec {
  table: string;
  requiredColumns: readonly string[];
  label?: string;
}

export interface InspectExtensionOptions {
  metaTable: string;
  requiredMetaColumns: readonly string[];
  companionTables?: readonly ExtensionCompanionTableSpec[];
  supportedRevision: number;
  label?: string;
}

export type ExtensionInspection =
  | { kind: 'absent' }
  | {
      kind: 'ok';
      revision: number;
      metaColumns: Set<string>;
      companionColumns: Map<string, Set<string>>;
    }
  | { kind: 'newer-revision'; revision: number }
  | { kind: 'corrupt'; reason: string };

export interface EntityTreeNode {
  id: string;
  type?: string;
  children?: readonly EntityTreeNode[];
}

export interface EntityWithId {
  id: string;
}

export interface AliveEntityIds {
  nodeIds: Set<string>;
  chapterIds: Set<string>;
  cardIds: Set<string>;
}

/** 判斷資料表名稱是否屬於行動版 jiufangm_* 擴充命名空間。 */
export function isJiufangmTableName(name: string): boolean {
  return name.startsWith(JIUFANGM_TABLE_PREFIX);
}

/** 判斷是否為安全整數。 */
export function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** 判斷是否為正安全整數（>= 1）。 */
export function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 1;
}

/** 判斷是否為非負安全整數（>= 0）。 */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

/** 驗證是否為標準小寫 UUID v4 字串。 */
export function isValidUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

/** 正規化為小寫 UUID v4；不合法時回傳 null。 */
export function normalizeUuidV4(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(lowered) ? lowered : null;
}

function bytesToUuidV4(bytes: Uint8Array): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 產生標準小寫 UUID v4：
 * 1. 優先呼叫 crypto.randomUUID()
 * 2. 次以 crypto.getRandomValues 依 RFC 4122 v4 組出
 * 3. 最末層以時間戳與 Math.random 補齊
 */
export function generateUuidV4(cryptoSource: CryptoLike | undefined = globalThis.crypto): string {
  if (cryptoSource && typeof cryptoSource.randomUUID === 'function') {
    const candidate = normalizeUuidV4(cryptoSource.randomUUID());
    if (candidate) return candidate;
  }

  const bytes = new Uint8Array(16);
  if (cryptoSource && typeof cryptoSource.getRandomValues === 'function') {
    cryptoSource.getRandomValues(bytes);
    return bytesToUuidV4(bytes);
  }

  let seed = Date.now();
  for (let i = 0; i < bytes.length; i += 1) {
    const rand = Math.floor(Math.random() * 256);
    bytes[i] = (seed + rand) & 0xff;
    seed = Math.floor(seed / 2) ^ (rand * 31);
  }
  return bytesToUuidV4(bytes);
}

/** 是否為可讀取狀態（目前僅 ok）。 */
export function isExtensionReadable(kind: ExtensionStateKind): boolean {
  return kind === 'ok';
}

/** 是否為應唯讀保留原表的狀態（newer-revision 或 corrupt）。 */
export function isExtensionReadOnlyPreserved(kind: ExtensionStateKind): boolean {
  return kind === 'newer-revision' || kind === 'corrupt';
}

/** 存檔前檢驗：僅 corrupt 觸發模組保護，newer-revision / absent / ok 皆放行。 */
export function shouldBlockSaveForExtension(state: { kind: ExtensionStateKind }): boolean {
  return state.kind === 'corrupt';
}

function assertSqlIdentifier(identifier: string, label: string): string {
  if (!SQL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`非法的 ${label} 識別字：${identifier}`);
  }
  return identifier;
}

/**
 * 依統一四態契約檢查 jiufangm_* 擴充中繼表與附屬表：
 * - 完全沒有相關表 → absent
 * - 雙表／多表缺一、缺少 id／format_revision、單列約束錯誤或修訂值非正整數 → corrupt
 * - format_revision > supportedRevision → newer-revision（唯讀保留、不擋正文）
 * - format_revision <= supportedRevision 且必要欄位齊備（允許額外未知欄位）→ ok
 */
export function inspectExtensionMetaTable(
  sql: Sql,
  options: InspectExtensionOptions,
): ExtensionInspection {
  const label = options.label ?? '擴充';
  const companions = options.companionTables ?? [];
  const metaTable = assertSqlIdentifier(options.metaTable, 'metaTable');
  const companionNames = companions.map((spec) => assertSqlIdentifier(spec.table, 'companionTable'));

  const tables = tableNames(sql);
  const hasMeta = tables.has(metaTable);
  const hasCompanionFlags = companionNames.map((name) => tables.has(name));

  if (!hasMeta && hasCompanionFlags.every((flag) => !flag)) {
    return { kind: 'absent' };
  }
  if (!hasMeta || hasCompanionFlags.some((flag) => !flag)) {
    return { kind: 'corrupt', reason: `${label}附加資料表不完整` };
  }

  const metaCols = columnNames(sql, metaTable);
  if (!metaCols.has('id') || !metaCols.has('format_revision')) {
    return { kind: 'corrupt', reason: `${label}中繼資料欄位不完整` };
  }

  const metaRows = sql.select(`SELECT id, format_revision FROM ${metaTable}`);
  if (metaRows.length !== 1) {
    return { kind: 'corrupt', reason: `${label}中繼資料列數不對` };
  }
  const meta = metaRows[0]!;
  if (meta.id !== 1) {
    return { kind: 'corrupt', reason: `${label}中繼資料代號不對` };
  }
  if (!isPositiveSafeInteger(meta.format_revision)) {
    return { kind: 'corrupt', reason: `${label}格式修訂值損壞` };
  }
  if (meta.format_revision > options.supportedRevision) {
    return { kind: 'newer-revision', revision: meta.format_revision };
  }

  if (options.requiredMetaColumns.some((col) => !metaCols.has(col))) {
    return { kind: 'corrupt', reason: `${label}中繼資料欄位不完整` };
  }

  const companionColumns = new Map<string, Set<string>>();
  for (const spec of companions) {
    const cols = columnNames(sql, spec.table);
    if (spec.requiredColumns.some((col) => !cols.has(col))) {
      return { kind: 'corrupt', reason: `${spec.label ?? label}欄位不完整` };
    }
    companionColumns.set(spec.table, cols);
  }

  return {
    kind: 'ok',
    revision: meta.format_revision,
    metaColumns: metaCols,
    companionColumns,
  };
}

/** 明確列出已知欄位查詢資料列，避免 SELECT * 誤讀未來未知欄位。 */
export function selectKnownColumns(
  sql: Sql,
  table: string,
  columns: readonly string[],
  whereClause?: string,
  params?: SqlValue[],
): Record<string, unknown>[] {
  const safeTable = assertSqlIdentifier(table, 'table');
  if (columns.length === 0) {
    throw new Error('selectKnownColumns 至少需要一個欄位');
  }
  const safeCols = columns.map((col) => assertSqlIdentifier(col, 'column')).join(', ');
  const whereSql = whereClause ? ` WHERE ${whereClause}` : '';
  return sql.select(`SELECT ${safeCols} FROM ${safeTable}${whereSql}`, params);
}

/** 明確只 UPDATE 本版認識的欄位，保留較新版附加在既有列上的未知欄位原值。 */
export function updateKnownColumns(
  sql: Sql,
  table: string,
  assignments: ReadonlyArray<readonly [column: string, value: SqlValue]>,
  whereClause: string,
  whereParams: readonly SqlValue[],
): void {
  const safeTable = assertSqlIdentifier(table, 'table');
  if (assignments.length === 0) return;
  const setSql = assignments
    .map(([col]) => `${assertSqlIdentifier(col, 'column')} = ?`)
    .join(', ');
  const values = assignments.map(([, value]) => value);
  sql.run(`UPDATE ${safeTable} SET ${setSql} WHERE ${whereClause}`, [...values, ...whereParams]);
}

function isChapterNodeType(type: string | undefined): boolean {
  return type === 'file' || type === 'chapter';
}

/**
 * 收集目前目錄樹與卡片清單中仍存在的實體 ID，
 * 供附加表在讀取降級／寫入保守清理時核對空參照（懸空參照）。
 */
export function collectAliveEntityIds(
  nodes: readonly EntityTreeNode[],
  cards: readonly EntityWithId[],
): AliveEntityIds {
  const nodeIds = new Set<string>();
  const chapterIds = new Set<string>();

  const walk = (list: readonly EntityTreeNode[]) => {
    for (const node of list) {
      if (typeof node.id === 'string' && node.id !== '') {
        nodeIds.add(node.id);
        if (isChapterNodeType(node.type)) {
          chapterIds.add(node.id);
        }
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(nodes);

  const cardIds = new Set<string>();
  for (const card of cards) {
    if (typeof card.id === 'string' && card.id !== '') {
      cardIds.add(card.id);
    }
  }

  return { nodeIds, chapterIds, cardIds };
}

/** 驗證參照目標是否仍存在；空字串、null、undefined 或不存在目標一律降級回傳 null。 */
export function resolveAliveRef(
  refId: string | null | undefined,
  aliveIds: ReadonlySet<string>,
): string | null {
  if (typeof refId !== 'string' || refId === '') return null;
  return aliveIds.has(refId) ? refId : null;
}

/** 過濾保留參照實體仍存在的屬性附著型項目（不修改原陣列）。 */
export function filterAliveRecords<T>(
  items: readonly T[],
  getId: (item: T) => string,
  aliveIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => {
    const id = getId(item);
    return typeof id === 'string' && id !== '' && aliveIds.has(id);
  });
}
