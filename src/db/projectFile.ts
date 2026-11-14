import type { ChapterNode } from '../data/demo';
import { countManuscriptWords } from '../domain/manuscriptWords';
import type { ProgressCode } from '../domain/labels';
import {
  applyMigrations,
  CURRENT_SCHEMA_VERSION,
  currentSchemaVersion,
  detectLegacyVersion,
} from './migrations';
import { columnNames, tableNames, type Sql, type SqlValue } from './sql';

const PROGRESS = new Set<string>(['Draft', '1st Edit', '2nd Edit', 'Final', 'Discarded']);

const KNOWN_PROJECT_INFO_COLUMNS = new Set<string>([
  'id',
  'title',
  'logline',
  'current_theme',
  'global_font_family',
  'global_font_size',
  'editor_font_family',
  'editor_font_size',
  'target_word_count',
  'daily_target_word_count',
  'category_order',
  'expanded_categories',
  'categories_meta',
  'last_opened_node_id',
  'last_cursor_position',
]);

const KNOWN_CHAPTER_COLUMNS = new Set<string>([
  'id',
  'parent_id',
  'name',
  'node_type',
  'content',
  'mark',
  'sort_order',
  'scene_summary',
  'scene_pov',
  'scene_location',
  'is_expanded',
]);

const KNOWN_CARD_COLUMNS = new Set<string>([
  'id',
  'parent_id',
  'category',
  'title',
  'content',
  'color',
  'is_collapsed',
  'sort_order',
]);

const REQUIRED_V14_TABLES = [
  'project_info',
  'chapters',
  'cards',
  'writing_logs',
  'snapshots',
  'proofread_results',
  'proofread_ignored_rules',
  'schema_version',
] as const;

export interface FileProjectInfo {
  title: string;
  logline: string;
  currentTheme: string;
  globalFontFamily: string;
  globalFontSize: number;
  editorFontFamily: string;
  editorFontSize: number;
  targetWordCount: number;
  dailyTargetWordCount: number;
  categoryOrder: string | null;
  expandedCategories: string | null;
  categoriesMeta: string;
  lastOpenedNodeId: string | null;
  lastCursorPosition: number;
  /** 已知欄位以外的未知欄位，讀入時原樣保留 */
  extraColumns?: Record<string, SqlValue>;
  /**
   * 讀入時的資料庫已知欄位原始值快照（可序列化、隨展開複製與 JSON 重載保留），
   * 用於區分「原檔為 NULL 且未改動」與「手機端已將欄位改為預設值」。
   */
  rawColumns?: Record<string, SqlValue>;
}

export interface FileCard {
  id: string;
  parent_id: string | null;
  category: string;
  title: string;
  content: string;
  color: string;
  is_collapsed: number;
  sort_order: number;
  /** 已知 8 欄以外的未知欄位，讀入時原樣保留 */
  extraColumns?: Record<string, SqlValue>;
}

export interface FileLog {
  date: string;
  duration: number;
  word_count: number;
  ai_continuation_count: number;
  ai_continuation_chars: number;
  ai_chat_count: number;
  ai_details: string;
  paste_large_count: number;
  delete_large_count: number;
  extraColumns?: Record<string, SqlValue>;
}

export interface LoadedFile {
  info: FileProjectInfo;
  tree: ChapterNode[];
  cards: FileCard[];
  logs: FileLog[];
  wordCount: number;
}

type ChapterNodeWithRaw = ChapterNode & {
  rawColumns?: Record<string, SqlValue>;
};

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 舊檔讀不到書名時，跟開新稿子、書名刪光用同一個名稱。 */
function manuscriptTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '未命名稿子';
  return value;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function progressOf(mark: string): ProgressCode | undefined {
  return PROGRESS.has(mark) ? (mark as ProgressCode) : undefined;
}

function isSerializedByteObject(value: unknown): value is Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const k = String(i);
    if (keys[i] !== k) return false;
    const byte = (value as Record<string, unknown>)[k];
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      return false;
    }
  }
  return true;
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value).slice();
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (isSerializedByteObject(value)) {
    const len = Object.keys(value).length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = value[String(i)]!;
    }
    return bytes;
  }
  return String(value);
}

function sqlValueEquals(a: SqlValue, b: SqlValue): boolean {
  if (a === b) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return false;
}

function extractExtraColumns(
  row: Record<string, unknown> | undefined,
  knownColumns: ReadonlySet<string>,
): Record<string, SqlValue> | undefined {
  if (!row) return undefined;
  const extra: Record<string, SqlValue> = {};
  let hasExtra = false;
  for (const [key, val] of Object.entries(row)) {
    if (!knownColumns.has(key)) {
      extra[key] = toSqlValue(val);
      hasExtra = true;
    }
  }
  return hasExtra ? extra : undefined;
}

function extractProjectInfoSpecialRawColumns(
  row: Record<string, unknown> | undefined,
): Record<string, SqlValue> | undefined {
  if (!row) return undefined;
  const raw: Record<string, SqlValue> = {};
  let hasSpecial = false;

  const nullableCols = [
    'title',
    'logline',
    'current_theme',
    'global_font_family',
    'global_font_size',
    'editor_font_family',
    'editor_font_size',
    'target_word_count',
    'daily_target_word_count',
    'categories_meta',
    'last_cursor_position',
  ] as const;

  for (const col of nullableCols) {
    if (col in row && row[col] === null) {
      raw[col] = null;
      hasSpecial = true;
    }
  }
  if (typeof row.title === 'string' && row.title.trim() === '') {
    raw.title = row.title;
    hasSpecial = true;
  }
  return hasSpecial ? raw : undefined;
}

function toRawSqlRecord(row: Record<string, unknown> | undefined): Record<string, SqlValue> {
  if (!row) return {};
  const result: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(row)) {
    result[k] = toSqlValue(v);
  }
  return result;
}

function safeIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function bindNullFallbackProperty<T extends object, K extends keyof T>(
  target: T,
  propKey: K,
  fallbackValue: T[K],
  onSet: (newValue: T[K]) => void,
): void {
  let currentValue = fallbackValue;
  Object.defineProperty(target, propKey, {
    get() {
      return currentValue;
    },
    set(newValue: T[K]) {
      currentValue = newValue;
      onSet(newValue);
      Object.defineProperty(target, propKey, {
        value: newValue,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
    enumerable: false,
    configurable: true,
  });
}

function needsMigration(sql: Sql): boolean {
  const existingTables = tableNames(sql);
  for (const reqTable of REQUIRED_V14_TABLES) {
    if (!existingTables.has(reqTable)) return true;
  }
  if (currentSchemaVersion(sql) < CURRENT_SCHEMA_VERSION) return true;
  if (detectLegacyVersion(sql) < CURRENT_SCHEMA_VERSION) return true;
  return false;
}

/**
 * 執行資料庫遷移；若資料庫原本已具備完整 v14 結構與版本紀錄則不重跑，
 * 避免單純讀寫時發送多餘的 schema_version 寫入語句。
 */
function runMigrationsPreservingExistingTimestamps(sql: Sql): void {
  if (!needsMigration(sql)) {
    return;
  }
  const existingVersions = new Map<number, SqlValue>();
  if (tableNames(sql).has('schema_version')) {
    for (const row of sql.select('SELECT version, applied_at FROM schema_version')) {
      if (typeof row.version === 'number') {
        existingVersions.set(row.version, toSqlValue(row.applied_at));
      }
    }
  }
  applyMigrations(sql);
  for (const [ver, appliedAt] of existingVersions.entries()) {
    const current = sql.select('SELECT applied_at FROM schema_version WHERE version = ?', [ver])[0];
    if (current && !sqlValueEquals(toSqlValue(current.applied_at), appliedAt)) {
      sql.run('UPDATE schema_version SET applied_at = ? WHERE version = ?', [appliedAt, ver]);
    }
  }
}

export function readFileProject(sql: Sql): LoadedFile {
  runMigrationsPreservingExistingTimestamps(sql);
  const infoRow = sql.select('SELECT * FROM project_info ORDER BY id LIMIT 1')[0];
  const infoExtra = extractExtraColumns(infoRow, KNOWN_PROJECT_INFO_COLUMNS);
  const infoRaw = extractProjectInfoSpecialRawColumns(infoRow);

  const info: FileProjectInfo = {
    title: manuscriptTitle(infoRow?.title),
    logline: text(infoRow?.logline),
    currentTheme: text(infoRow?.current_theme),
    globalFontFamily: text(infoRow?.global_font_family),
    globalFontSize: num(infoRow?.global_font_size, 12),
    editorFontFamily: text(infoRow?.editor_font_family),
    editorFontSize: num(infoRow?.editor_font_size, 12),
    targetWordCount: num(infoRow?.target_word_count, 100000),
    dailyTargetWordCount: num(infoRow?.daily_target_word_count, 1000),
    categoryOrder: infoRow?.category_order == null ? null : text(infoRow.category_order),
    expandedCategories: infoRow?.expanded_categories == null ? null : text(infoRow.expanded_categories),
    categoriesMeta: text(infoRow?.categories_meta, '{}'),
    lastOpenedNodeId: infoRow?.last_opened_node_id == null ? null : text(infoRow.last_opened_node_id),
    lastCursorPosition: num(infoRow?.last_cursor_position, 0),
    ...(infoExtra ? { extraColumns: infoExtra } : {}),
    ...(infoRaw ? { rawColumns: infoRaw } : {}),
  };

  if (infoRaw) {
    const infoPropToCol: Array<[keyof FileProjectInfo, string]> = [
      ['title', 'title'],
      ['logline', 'logline'],
      ['currentTheme', 'current_theme'],
      ['globalFontFamily', 'global_font_family'],
      ['globalFontSize', 'global_font_size'],
      ['editorFontFamily', 'editor_font_family'],
      ['editorFontSize', 'editor_font_size'],
      ['targetWordCount', 'target_word_count'],
      ['dailyTargetWordCount', 'daily_target_word_count'],
      ['categoriesMeta', 'categories_meta'],
      ['lastCursorPosition', 'last_cursor_position'],
    ];
    for (const [propKey, colName] of infoPropToCol) {
      if (colName in infoRaw) {
        bindNullFallbackProperty(info, propKey, info[propKey], (newVal) => {
          if (info.rawColumns) {
            info.rawColumns = { ...info.rawColumns, [colName]: toSqlValue(newVal) };
          }
        });
      }
    }
  }

  const chapterRows = sql.select('SELECT * FROM chapters ORDER BY sort_order, id');
  const tree = buildTree(chapterRows);

  const cards = sql.select('SELECT * FROM cards ORDER BY sort_order, id').map((row): FileCard => {
    const extra = extractExtraColumns(row, KNOWN_CARD_COLUMNS);
    return {
      id: text(row.id),
      parent_id: row.parent_id == null ? null : text(row.parent_id),
      category: text(row.category),
      title: text(row.title),
      content: text(row.content),
      color: text(row.color),
      is_collapsed: num(row.is_collapsed),
      sort_order: num(row.sort_order),
      ...(extra ? { extraColumns: extra } : {}),
    };
  });

  const logs = sql
    .select(
      `SELECT date, duration, word_count, ai_continuation_count, ai_continuation_chars,
              ai_chat_count, ai_details, paste_large_count, delete_large_count
       FROM writing_logs ORDER BY date`,
    )
    .map((row) => ({
      date: text(row.date),
      duration: num(row.duration),
      word_count: num(row.word_count),
      ai_continuation_count: num(row.ai_continuation_count),
      ai_continuation_chars: num(row.ai_continuation_chars),
      ai_chat_count: num(row.ai_chat_count),
      ai_details: text(row.ai_details, '{}'),
      paste_large_count: num(row.paste_large_count),
      delete_large_count: num(row.delete_large_count),
    }));

  return { info, tree, cards, logs, wordCount: treeWordCount(tree) };
}

function extractChapterSpecialRawColumns(
  row: Record<string, unknown>,
): Record<string, SqlValue> | undefined {
  const raw: Record<string, SqlValue> = {};
  let hasSpecial = false;

  const nullableCols = ['content', 'mark', 'scene_summary', 'scene_pov', 'scene_location', 'is_expanded'] as const;
  for (const col of nullableCols) {
    if (col in row && row[col] === null) {
      raw[col] = null;
      hasSpecial = true;
    }
  }
  if (typeof row.mark === 'string' && row.mark !== '' && !PROGRESS.has(row.mark)) {
    raw.mark = row.mark;
    hasSpecial = true;
  }
  return hasSpecial ? raw : undefined;
}

function buildTree(rows: Record<string, unknown>[]): ChapterNode[] {
  const ordered = [...rows].sort((a, b) => num(a.sort_order) - num(b.sort_order));
  const nodes = new Map<string, ChapterNode>();
  for (const row of ordered) {
    const extra = extractExtraColumns(row, KNOWN_CHAPTER_COLUMNS);
    const specialRaw = extractChapterSpecialRawColumns(row);
    const node: ChapterNodeWithRaw = {
      id: text(row.id),
      type: text(row.node_type, 'file') as ChapterNode['type'],
      title: text(row.name),
      progress: progressOf(text(row.mark)),
      content: text(row.content),
      expanded: num(row.is_expanded, 1) !== 0,
      children: [],
      sceneSummary: text(row.scene_summary),
      scenePov: text(row.scene_pov),
      sceneLocation: text(row.scene_location),
      ...(extra ? { extraColumns: extra } : {}),
      ...(specialRaw ? { rawColumns: specialRaw } : {}),
    };

    if (specialRaw) {
      if ('content' in specialRaw) {
        bindNullFallbackProperty(node, 'content', node.content, (v) => {
          if (node.rawColumns) node.rawColumns = { ...node.rawColumns, content: v ?? '' };
        });
      }
      if ('mark' in specialRaw) {
        bindNullFallbackProperty(node, 'progress', node.progress, (v) => {
          if (node.rawColumns) node.rawColumns = { ...node.rawColumns, mark: v ?? '' };
        });
      }
      if ('is_expanded' in specialRaw) {
        bindNullFallbackProperty(node, 'expanded', node.expanded, (v) => {
          if (node.rawColumns) {
            node.rawColumns = { ...node.rawColumns, is_expanded: v === false ? 0 : 1 };
          }
        });
      }
      if ('scene_summary' in specialRaw) {
        bindNullFallbackProperty(node, 'sceneSummary', node.sceneSummary, (v) => {
          if (node.rawColumns) node.rawColumns = { ...node.rawColumns, scene_summary: v ?? '' };
        });
      }
      if ('scene_pov' in specialRaw) {
        bindNullFallbackProperty(node, 'scenePov', node.scenePov, (v) => {
          if (node.rawColumns) node.rawColumns = { ...node.rawColumns, scene_pov: v ?? '' };
        });
      }
      if ('scene_location' in specialRaw) {
        bindNullFallbackProperty(node, 'sceneLocation', node.sceneLocation, (v) => {
          if (node.rawColumns) node.rawColumns = { ...node.rawColumns, scene_location: v ?? '' };
        });
      }
    }

    nodes.set(text(row.id), node);
  }
  const roots: ChapterNode[] = [];
  for (const row of ordered) {
    const node = nodes.get(text(row.id));
    if (!node) continue;
    const parent = row.parent_id == null ? '' : text(row.parent_id);
    if (parent && nodes.has(parent)) nodes.get(parent)?.children?.push(node);
    else roots.push(node);
  }
  return roots;
}

export function treeWordCount(nodes: readonly ChapterNode[]): number {
  return nodes.reduce((sum, node) => {
    const own = node.type === 'folder' ? 0 : countManuscriptWords(node.content ?? '');
    return sum + own + treeWordCount(node.children ?? []);
  }, 0);
}

/** 確保父卡先於子卡寫入；孤兒或循環參照亦不遺漏。 */
function cardsInParentOrder(cards: readonly FileCard[]): FileCard[] {
  const pending = [...cards];
  const written = new Set<string>();
  const ordered: FileCard[] = [];
  while (pending.length) {
    const next = pending.findIndex((card) => !card.parent_id || written.has(card.parent_id));
    const index = next === -1 ? 0 : next;
    const card = pending.splice(index, 1)[0];
    if (!card) break;
    ordered.push(card);
    written.add(card.id);
  }
  return ordered;
}

/**
 * 依 parent_id 拓撲排序計算「子孫先於父」的刪除順序：
 * - 不依賴資料表實體列順序，也不依賴外鍵開關
 * - 確保所有子孫節點一定先於父節點刪除
 * - 循環參照（含自我參照與多節點迴圈）不會當機或漏刪
 */
export function idsInChildFirstDeleteOrder(
  rowsToDelete: ReadonlyArray<{ id: string; parent_id: string | null }>,
): string[] {
  const pending = rowsToDelete.filter((row) => Boolean(row.id));
  const ordered: string[] = [];

  while (pending.length > 0) {
    const referencedParentIds = new Set<string>();
    for (const item of pending) {
      if (item.parent_id && item.parent_id !== item.id) {
        referencedParentIds.add(item.parent_id);
      }
    }
    const nextIndex = pending.findIndex((item) => !referencedParentIds.has(item.id));
    const pickIndex = nextIndex === -1 ? 0 : nextIndex;
    const [picked] = pending.splice(pickIndex, 1);
    if (!picked) break;
    ordered.push(picked.id);
  }

  return ordered;
}

interface FlatChapterEntry {
  node: ChapterNodeWithRaw;
  parentId: string | null;
  sortOrder: number;
}

function flattenChaptersInParentOrder(
  nodes: readonly ChapterNode[],
  parentId: string | null = null,
  out: FlatChapterEntry[] = [],
): FlatChapterEntry[] {
  nodes.forEach((node, index) => {
    out.push({ node: node as ChapterNodeWithRaw, parentId, sortOrder: index });
    if (node.children && node.children.length > 0) {
      flattenChaptersInParentOrder(node.children, node.id, out);
    }
  });
  return out;
}

function writeProjectInfoDiff(sql: Sql, info: FileProjectInfo): void {
  const existingRow = sql.select('SELECT * FROM project_info ORDER BY id LIMIT 1')[0];
  const tableCols = columnNames(sql, 'project_info');
  const rawCols = info.rawColumns;

  const isPropExplicit = (propKey: keyof FileProjectInfo): boolean =>
    Object.prototype.propertyIsEnumerable.call(info, propKey);

  const resolveTextOrRawNull = (
    propKey: keyof FileProjectInfo,
    defaultFallback: string,
    colName: string,
  ): SqlValue => {
    const currentVal =
      typeof info[propKey] === 'string' ? (info[propKey] as string) : defaultFallback;
    if (
      rawCols &&
      colName in rawCols &&
      rawCols[colName] === null &&
      !isPropExplicit(propKey) &&
      currentVal === defaultFallback
    ) {
      return null;
    }
    return currentVal;
  };

  const resolveNumOrRawNull = (
    propKey: keyof FileProjectInfo,
    defaultFallback: number,
    colName: string,
  ): SqlValue => {
    const currentVal =
      typeof info[propKey] === 'number' ? (info[propKey] as number) : defaultFallback;
    if (
      rawCols &&
      colName in rawCols &&
      rawCols[colName] === null &&
      !isPropExplicit(propKey) &&
      currentVal === defaultFallback
    ) {
      return null;
    }
    return currentVal;
  };

  let titleVal: SqlValue = typeof info.title === 'string' ? info.title : '未命名稿子';
  if (
    rawCols &&
    'title' in rawCols &&
    !isPropExplicit('title') &&
    (rawCols.title === null || (typeof rawCols.title === 'string' && rawCols.title.trim() === '')) &&
    titleVal === '未命名稿子'
  ) {
    titleVal = rawCols.title;
  }

  const knownColumnValues: Array<[string, SqlValue]> = [
    ['title', titleVal],
    ['logline', resolveTextOrRawNull('logline', '', 'logline')],
    ['current_theme', resolveTextOrRawNull('currentTheme', '', 'current_theme')],
    ['global_font_family', resolveTextOrRawNull('globalFontFamily', '', 'global_font_family')],
    ['global_font_size', resolveNumOrRawNull('globalFontSize', 12, 'global_font_size')],
    ['editor_font_family', resolveTextOrRawNull('editorFontFamily', '', 'editor_font_family')],
    ['editor_font_size', resolveNumOrRawNull('editorFontSize', 12, 'editor_font_size')],
    ['target_word_count', resolveNumOrRawNull('targetWordCount', 100000, 'target_word_count')],
    [
      'daily_target_word_count',
      resolveNumOrRawNull('dailyTargetWordCount', 1000, 'daily_target_word_count'),
    ],
    ['category_order', info.categoryOrder ?? null],
    ['expanded_categories', info.expandedCategories ?? null],
    ['categories_meta', resolveTextOrRawNull('categoriesMeta', '{}', 'categories_meta')],
    ['last_opened_node_id', info.lastOpenedNodeId ?? null],
    ['last_cursor_position', resolveNumOrRawNull('lastCursorPosition', 0, 'last_cursor_position')],
  ];

  if (existingRow && existingRow.id != null) {
    const existingRaw = toRawSqlRecord(existingRow);
    const changedCols = knownColumnValues.filter(
      ([col, val]) => tableCols.has(col) && !sqlValueEquals(existingRaw[col] ?? null, val),
    );
    if (changedCols.length === 0) {
      return;
    }
    const rowId = toSqlValue(existingRow.id);
    const setClause = changedCols.map(([col]) => `${col} = ?`).join(', ');
    const params: SqlValue[] = [...changedCols.map(([, val]) => val), rowId];
    sql.run(`UPDATE project_info SET ${setClause} WHERE id = ?`, params);
  } else {
    const insertValues: Array<[string, SqlValue]> = knownColumnValues.filter(([col]) =>
      tableCols.has(col),
    );
    if (info.extraColumns) {
      for (const [col, val] of Object.entries(info.extraColumns)) {
        if (!KNOWN_PROJECT_INFO_COLUMNS.has(col) && tableCols.has(col) && safeIdentifier(col)) {
          insertValues.push([col, toSqlValue(val)]);
        }
      }
    }
    const cols = insertValues.map(([col]) => col).join(', ');
    const placeholders = insertValues.map(() => '?').join(', ');
    const params = insertValues.map(([, val]) => val);
    sql.run(`INSERT INTO project_info (${cols}) VALUES (${placeholders})`, params);
  }
}

function writeChaptersDiff(sql: Sql, tree: readonly ChapterNode[]): void {
  const existingRows = sql.select('SELECT * FROM chapters');
  const existingById = new Map<string, Record<string, SqlValue>>();
  for (const row of existingRows) {
    const id = text(row.id);
    if (id) existingById.set(id, toRawSqlRecord(row));
  }

  const tableCols = columnNames(sql, 'chapters');
  const flatEntries = flattenChaptersInParentOrder(tree);
  const nextIds = new Set(flatEntries.map((e) => e.node.id));

  // 先依 parent_id 拓撲排序刪除手機端已移除的章節（確保子孫節點先於父節點刪除）
  const toDeleteRows = existingRows
    .map((row) => ({
      id: text(row.id),
      parent_id: row.parent_id == null ? null : text(row.parent_id),
    }))
    .filter((row) => row.id && !nextIds.has(row.id));
  const toDeleteIds = idsInChildFirstDeleteOrder(toDeleteRows);
  for (const id of toDeleteIds) {
    sql.run('DELETE FROM chapters WHERE id = ?', [id]);
  }

  for (const { node, parentId, sortOrder } of flatEntries) {
    const existing = existingById.get(node.id);
    const rawCols = node.rawColumns;

    const isNodePropExplicit = (propKey: keyof ChapterNode): boolean =>
      Object.prototype.propertyIsEnumerable.call(node, propKey);

    const resolveMark = (): SqlValue => {
      if (node.progress !== undefined) return node.progress;
      if (rawCols && 'mark' in rawCols && !isNodePropExplicit('progress')) {
        const rawMark = rawCols.mark;
        if (rawMark === null || (typeof rawMark === 'string' && !PROGRESS.has(rawMark))) {
          return rawMark;
        }
      }
      return '';
    };

    const resolveTextCol = (propKey: keyof ChapterNode, colName: string): SqlValue => {
      const val = node[propKey];
      const str = typeof val === 'string' ? val : '';
      if (
        rawCols &&
        colName in rawCols &&
        rawCols[colName] === null &&
        !isNodePropExplicit(propKey) &&
        str === ''
      ) {
        return null;
      }
      return str;
    };

    const resolveExpanded = (): SqlValue => {
      const expandedBool = node.expanded !== false;
      if (
        rawCols &&
        'is_expanded' in rawCols &&
        rawCols.is_expanded === null &&
        !isNodePropExplicit('expanded') &&
        expandedBool
      ) {
        return null;
      }
      return expandedBool ? 1 : 0;
    };

    const knownColValues: Array<[string, SqlValue]> = [
      ['parent_id', parentId],
      ['name', node.title],
      ['node_type', node.type],
      ['content', resolveTextCol('content', 'content')],
      ['mark', resolveMark()],
      ['sort_order', sortOrder],
      ['scene_summary', resolveTextCol('sceneSummary', 'scene_summary')],
      ['scene_pov', resolveTextCol('scenePov', 'scene_pov')],
      ['scene_location', resolveTextCol('sceneLocation', 'scene_location')],
      ['is_expanded', resolveExpanded()],
    ];

    if (existing) {
      const changedCols = knownColValues.filter(
        ([col, val]) => tableCols.has(col) && !sqlValueEquals(existing[col] ?? null, val),
      );
      if (changedCols.length === 0) {
        continue;
      }
      const setClause = changedCols.map(([col]) => `${col} = ?`).join(', ');
      const params: SqlValue[] = [...changedCols.map(([, val]) => val), node.id];
      sql.run(`UPDATE chapters SET ${setClause} WHERE id = ?`, params);
    } else {
      const insertColValues: Array<[string, SqlValue]> = knownColValues.filter(([col]) =>
        tableCols.has(col),
      );
      if (node.extraColumns) {
        for (const [col, val] of Object.entries(node.extraColumns)) {
          if (!KNOWN_CHAPTER_COLUMNS.has(col) && tableCols.has(col) && safeIdentifier(col)) {
            insertColValues.push([col, toSqlValue(val)]);
          }
        }
      }
      const insertCols = ['id', ...insertColValues.map(([col]) => col)].join(', ');
      const placeholders = ['?', ...insertColValues.map(() => '?')].join(', ');
      const params: SqlValue[] = [node.id, ...insertColValues.map(([, val]) => val)];
      sql.run(`INSERT INTO chapters (${insertCols}) VALUES (${placeholders})`, params);
    }
  }
}

function writeCardsDiff(sql: Sql, cards: readonly FileCard[]): void {
  const existingRows = sql.select('SELECT * FROM cards');
  const existingById = new Map<string, Record<string, SqlValue>>();
  for (const row of existingRows) {
    const id = text(row.id);
    if (id) existingById.set(id, toRawSqlRecord(row));
  }

  const tableCols = columnNames(sql, 'cards');
  const orderedCards = cardsInParentOrder(cards);
  const nextIds = new Set(orderedCards.map((c) => c.id));

  // 先依 parent_id 拓撲排序刪除手機端已移除的卡片（確保子孫卡先於父卡刪除）
  const toDeleteRows = existingRows
    .map((row) => ({
      id: text(row.id),
      parent_id: row.parent_id == null ? null : text(row.parent_id),
    }))
    .filter((row) => row.id && !nextIds.has(row.id));
  const toDeleteIds = idsInChildFirstDeleteOrder(toDeleteRows);
  for (const id of toDeleteIds) {
    sql.run('DELETE FROM cards WHERE id = ?', [id]);
  }

  // 依父卡先於子卡順序寫入：已存在則只 UPDATE 值有變動的已知欄位，新增則 INSERT（含 extraColumns）
  for (const card of orderedCards) {
    const existing = existingById.get(card.id);
    const knownColValues: Array<[string, SqlValue]> = [
      ['parent_id', card.parent_id],
      ['category', card.category],
      ['title', card.title],
      ['content', card.content],
      ['color', card.color],
      ['is_collapsed', card.is_collapsed],
      ['sort_order', card.sort_order],
    ];

    if (existing) {
      const changedCols = knownColValues.filter(
        ([col, val]) => tableCols.has(col) && !sqlValueEquals(existing[col] ?? null, val),
      );
      if (changedCols.length === 0) {
        continue;
      }
      const setClause = changedCols.map(([col]) => `${col} = ?`).join(', ');
      const params: SqlValue[] = [...changedCols.map(([, val]) => val), card.id];
      sql.run(`UPDATE cards SET ${setClause} WHERE id = ?`, params);
    } else {
      const insertColValues: Array<[string, SqlValue]> = knownColValues.filter(([col]) =>
        tableCols.has(col),
      );
      if (card.extraColumns) {
        for (const [col, val] of Object.entries(card.extraColumns)) {
          if (!KNOWN_CARD_COLUMNS.has(col) && tableCols.has(col) && safeIdentifier(col)) {
            insertColValues.push([col, toSqlValue(val)]);
          }
        }
      }
      const insertCols = ['id', ...insertColValues.map(([col]) => col)].join(', ');
      const placeholders = ['?', ...insertColValues.map(() => '?')].join(', ');
      const params: SqlValue[] = [card.id, ...insertColValues.map(([, val]) => val)];
      sql.run(`INSERT INTO cards (${insertCols}) VALUES (${placeholders})`, params);
    }
  }
}

function writeLogsDiff(sql: Sql, logs: readonly FileLog[]): void {
  const existingRows = sql.select('SELECT * FROM writing_logs');
  const existingByDate = new Map<string, Record<string, SqlValue>>();
  for (const row of existingRows) {
    const date = text(row.date);
    if (date) existingByDate.set(date, toRawSqlRecord(row));
  }

  for (const log of logs) {
    const existing = existingByDate.get(log.date);
    const knownColValues: Array<[string, SqlValue]> = [
      ['duration', log.duration],
      ['word_count', log.word_count],
      ['ai_continuation_count', log.ai_continuation_count],
      ['ai_continuation_chars', log.ai_continuation_chars],
      ['ai_chat_count', log.ai_chat_count],
      ['ai_details', log.ai_details],
      ['paste_large_count', log.paste_large_count],
      ['delete_large_count', log.delete_large_count],
    ];

    if (existing) {
      const changedCols = knownColValues.filter(
        ([col, val]) => !sqlValueEquals(existing[col] ?? null, val),
      );
      if (changedCols.length === 0) {
        continue;
      }
      const setClause = changedCols.map(([col]) => `${col} = ?`).join(', ');
      const params: SqlValue[] = [...changedCols.map(([, val]) => val), log.date];
      sql.run(`UPDATE writing_logs SET ${setClause} WHERE date = ?`, params);
      const updated = { ...existing };
      for (const [col, val] of changedCols) {
        updated[col] = val;
      }
      existingByDate.set(log.date, updated);
    } else {
      sql.run(
        `INSERT INTO writing_logs (
          date, duration, word_count, ai_continuation_count, ai_continuation_chars,
          ai_chat_count, ai_details, paste_large_count, delete_large_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          log.date,
          log.duration,
          log.word_count,
          log.ai_continuation_count,
          log.ai_continuation_chars,
          log.ai_chat_count,
          log.ai_details,
          log.paste_large_count,
          log.delete_large_count,
        ],
      );
      existingByDate.set(log.date, {
        date: log.date,
        duration: log.duration,
        word_count: log.word_count,
        ai_continuation_count: log.ai_continuation_count,
        ai_continuation_chars: log.ai_continuation_chars,
        ai_chat_count: log.ai_chat_count,
        ai_details: log.ai_details,
        paste_large_count: log.paste_large_count,
        delete_large_count: log.delete_large_count,
      });
    }
  }
}

export function writeFileProject(
  sql: Sql,
  info: FileProjectInfo,
  tree: readonly ChapterNode[],
  cards: readonly FileCard[],
  logs: readonly FileLog[],
): void {
  const fkRow = sql.select('PRAGMA foreign_keys')[0];
  const prevForeignKeys = fkRow && Number(fkRow.foreign_keys) ? 1 : 0;

  sql.exec('PRAGMA foreign_keys = OFF');
  sql.exec('BEGIN IMMEDIATE');
  try {
    runMigrationsPreservingExistingTimestamps(sql);
    writeProjectInfoDiff(sql, info);
    writeChaptersDiff(sql, tree);
    writeCardsDiff(sql, cards);
    writeLogsDiff(sql, logs);
    sql.exec('COMMIT');
  } catch (error) {
    try {
      sql.exec('ROLLBACK');
    } catch {
      // 忽略 ROLLBACK 次要例外，拋出原始錯誤
    }
    throw error;
  } finally {
    try {
      sql.exec(`PRAGMA foreign_keys = ${prevForeignKeys ? 'ON' : 'OFF'}`);
    } catch {
      // 忽略還原 PRAGMA 時的次要例外
    }
  }
}

export function snapshotFingerprints(sql: Sql): string[] {
  return sql
    .select('SELECT id, name, note, timestamp, word_count, project_data FROM snapshots ORDER BY id')
    .map((row) => JSON.stringify(row));
}

export function proofFingerprints(sql: Sql): string[] {
  return sql
    .select('SELECT id, category, node_id, char_offset, match_len, status, created_at FROM proofread_results ORDER BY id')
    .map((row) => JSON.stringify(row));
}

export type { SqlValue };
