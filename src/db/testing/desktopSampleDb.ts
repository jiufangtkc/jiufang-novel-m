import type { Sql } from '../sql';
import { openMemoryDb, type MemoryDb } from '../wasmDb';

/**
 * 工單 WO-58：電腦版範例資料庫測試產生器
 * 依「範例db結構摘要.md」在記憶體中建立與電腦版規格相同的資料庫，回傳 Uint8Array 或 MemoryDb。
 * 僅供測試使用，不被正式程式碼匯入。
 */

/** 自訂分類代碼：custom_ 後接 8 碼小寫十六進位（全新產生，非原檔代碼） */
export const SAMPLE_CUSTOM_CATEGORY_CODE = 'custom_7f8a9b0c';
/** 自訂分類名稱 */
export const SAMPLE_CUSTOM_CATEGORY_NAME = '自訂分類001';

/** 非預設深色色碼 */
export const SAMPLE_NON_DEFAULT_COLOR = '#41040d';
/** 預設色碼 */
export const SAMPLE_DEFAULT_COLOR = '#3C3F41';

/** 自訂分類 4 層卡片 ID */
export const SAMPLE_CUSTOM_ROOT_CARD_ID = 'a1000000-0000-4000-8000-000000000001';
export const SAMPLE_CUSTOM_CHILD_CARD_ID = 'a1000000-0000-4000-8000-000000000002';
export const SAMPLE_CUSTOM_GRANDCHILD_CARD_ID = 'a1000000-0000-4000-8000-000000000003';
export const SAMPLE_CUSTOM_GREAT_GRANDCHILD_CARD_ID = 'a1000000-0000-4000-8000-000000000004';

/** 電腦版內建分類（character）4 層卡片 ID */
export const SAMPLE_BUILTIN_ROOT_CARD_ID = 'b2000000-0000-4000-8000-000000000001';
export const SAMPLE_BUILTIN_CHILD_CARD_ID = 'b2000000-0000-4000-8000-000000000002';
export const SAMPLE_BUILTIN_GRANDCHILD_CARD_ID = 'b2000000-0000-4000-8000-000000000003';
export const SAMPLE_BUILTIN_GREAT_GRANDCHILD_CARD_ID = 'b2000000-0000-4000-8000-000000000004';

export const SAMPLE_CATEGORY_ORDER_CODES = [
  'summary',
  'character',
  'world',
  'timeline',
  'ai_chat',
  SAMPLE_CUSTOM_CATEGORY_CODE,
] as const;

export const SAMPLE_EXPANDED_CATEGORY_CODES = [
  'summary',
  'character',
  'world',
  'timeline',
  'ai_chat',
  SAMPLE_CUSTOM_CATEGORY_CODE,
] as const;

export const SAMPLE_CATEGORIES_META: Record<string, string> = {
  [SAMPLE_CUSTOM_CATEGORY_CODE]: SAMPLE_CUSTOM_CATEGORY_NAME,
};

export interface DesktopSampleCard {
  id: string;
  parent_id: string | null;
  category: string;
  title: string;
  content: string;
  color: string;
  is_collapsed: number;
  sort_order: number;
}

/** 範例卡片資料：包含自訂分類 4 層樹與內建分類 4 層樹，涵蓋非預設色與預設色 */
export const SAMPLE_DESKTOP_CARDS: readonly DesktopSampleCard[] = [
  // 自訂分類：母卡 -> 子卡 -> 孫卡 -> 曾孫卡（共 4 層）
  {
    id: SAMPLE_CUSTOM_ROOT_CARD_ID,
    parent_id: null,
    category: SAMPLE_CUSTOM_CATEGORY_CODE,
    title: '【範例】自訂分類母卡',
    content: '【範例】自訂分類第一層母卡說明內容。',
    color: SAMPLE_NON_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },
  {
    id: SAMPLE_CUSTOM_CHILD_CARD_ID,
    parent_id: SAMPLE_CUSTOM_ROOT_CARD_ID,
    category: SAMPLE_CUSTOM_CATEGORY_CODE,
    title: '【範例】自訂分類子卡',
    content: '【範例】自訂分類第二層子卡說明內容。',
    color: SAMPLE_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },
  {
    id: SAMPLE_CUSTOM_GRANDCHILD_CARD_ID,
    parent_id: SAMPLE_CUSTOM_CHILD_CARD_ID,
    category: SAMPLE_CUSTOM_CATEGORY_CODE,
    title: '【範例】自訂分類孫卡',
    content: '【範例】自訂分類第三層孫卡說明內容。',
    color: SAMPLE_NON_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },
  {
    id: SAMPLE_CUSTOM_GREAT_GRANDCHILD_CARD_ID,
    parent_id: SAMPLE_CUSTOM_GRANDCHILD_CARD_ID,
    category: SAMPLE_CUSTOM_CATEGORY_CODE,
    title: '【範例】自訂分類曾孫卡',
    content: '【範例】自訂分類第四層曾孫卡說明內容。',
    color: SAMPLE_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },

  // 內建分類（character）：母卡 -> 子卡 -> 孫卡 -> 曾孫卡（共 4 層）
  {
    id: SAMPLE_BUILTIN_ROOT_CARD_ID,
    parent_id: null,
    category: 'character',
    title: '【範例】主要人物母卡',
    content: '【範例】主要角色檔案設定。',
    color: SAMPLE_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },
  {
    id: SAMPLE_BUILTIN_CHILD_CARD_ID,
    parent_id: SAMPLE_BUILTIN_ROOT_CARD_ID,
    category: 'character',
    title: '【範例】隨身舊懷錶子卡',
    content: '【範例】停在三點十七分的指針紀錄。',
    color: SAMPLE_NON_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },
  {
    id: SAMPLE_BUILTIN_GRANDCHILD_CARD_ID,
    parent_id: SAMPLE_BUILTIN_CHILD_CARD_ID,
    category: 'character',
    title: '【範例】懷錶夾層孫卡',
    content: '【範例】暗層刻劃的方位標記。',
    color: SAMPLE_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },
  {
    id: SAMPLE_BUILTIN_GREAT_GRANDCHILD_CARD_ID,
    parent_id: SAMPLE_BUILTIN_GRANDCHILD_CARD_ID,
    category: 'character',
    title: '【範例】方位標記曾孫卡',
    content: '【範例】指向霧港北外海的無名暗礁。',
    color: SAMPLE_NON_DEFAULT_COLOR,
    is_collapsed: 0,
    sort_order: 0,
  },
];

export interface DesktopSampleChapter {
  id: string;
  parent_id: string | null;
  name: string;
  node_type: string;
  content: string;
  mark: string;
  sort_order: number;
  scene_summary: string;
  scene_pov: string;
  scene_location: string;
  is_expanded: number;
}

/** 範例章節節點：共 3 個節點，正文一律為空（content: ''） */
export const SAMPLE_DESKTOP_CHAPTERS: readonly DesktopSampleChapter[] = [
  {
    id: 'ch-sample-vol-1',
    parent_id: null,
    name: '【範例】第一卷　海潮起時',
    node_type: 'volume',
    content: '',
    mark: '',
    sort_order: 0,
    scene_summary: '',
    scene_pov: '',
    scene_location: '',
    is_expanded: 1,
  },
  {
    id: 'ch-sample-doc-1',
    parent_id: 'ch-sample-vol-1',
    name: '【範例】第一章　霧中燈號',
    node_type: 'chapter',
    content: '',
    mark: 'Draft',
    sort_order: 0,
    scene_summary: '',
    scene_pov: '',
    scene_location: '',
    is_expanded: 1,
  },
  {
    id: 'ch-sample-doc-2',
    parent_id: 'ch-sample-vol-1',
    name: '【範例】第二章　暗礁航道',
    node_type: 'chapter',
    content: '',
    mark: 'Draft',
    sort_order: 1,
    scene_summary: '',
    scene_pov: '',
    scene_location: '',
    is_expanded: 1,
  },
];

export const SAMPLE_DESKTOP_PROJECT_INFO = {
  id: 1,
  title: '【範例】測試卡片專案',
  logline: '',
  current_theme: '',
  global_font_family: '',
  global_font_size: 14,
  editor_font_family: '',
  editor_font_size: 16,
  target_word_count: 100000,
  daily_target_word_count: 1000,
  category_order: JSON.stringify(SAMPLE_CATEGORY_ORDER_CODES),
  expanded_categories: JSON.stringify(SAMPLE_EXPANDED_CATEGORY_CODES),
  categories_meta: JSON.stringify(SAMPLE_CATEGORIES_META),
  last_opened_node_id: null,
  last_cursor_position: 0,
} as const;

export const SAMPLE_DESKTOP_SCHEMA_VERSIONS = [
  { version: 12, applied_at: '2026-01-01 00:00:00' },
  { version: 13, applied_at: '2026-01-01 00:00:00' },
  { version: 14, applied_at: '2026-01-01 00:00:00' },
] as const;

/** 建立與電腦版規格相同的全部資料表 */
export function createDesktopSampleSchema(sql: Sql): void {
  sql.exec(`CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    category TEXT,
    title TEXT,
    content TEXT,
    color TEXT,
    is_collapsed INTEGER,
    sort_order INTEGER,
    FOREIGN KEY (parent_id) REFERENCES cards(id)
  )`);

  sql.exec(`CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT,
    node_type TEXT,
    content TEXT,
    mark TEXT,
    sort_order INTEGER,
    scene_summary TEXT DEFAULT '',
    scene_pov TEXT DEFAULT '',
    scene_location TEXT DEFAULT '',
    is_expanded INTEGER DEFAULT 1,
    FOREIGN KEY (parent_id) REFERENCES chapters(id)
  )`);

  sql.exec(`CREATE TABLE project_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    logline TEXT,
    current_theme TEXT,
    global_font_family TEXT,
    global_font_size INTEGER,
    editor_font_family TEXT,
    editor_font_size INTEGER,
    target_word_count INTEGER DEFAULT 100000,
    daily_target_word_count INTEGER DEFAULT 1000,
    category_order TEXT DEFAULT NULL,
    expanded_categories TEXT DEFAULT NULL,
    categories_meta TEXT DEFAULT NULL,
    last_opened_node_id TEXT DEFAULT NULL,
    last_cursor_position INTEGER DEFAULT 0
  )`);

  sql.exec(`CREATE TABLE proofread_ignored_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_type TEXT,
    target_word TEXT,
    created_at TEXT
  )`);

  sql.exec(`CREATE TABLE proofread_results (
    id TEXT PRIMARY KEY,
    category TEXT,
    node_id TEXT,
    chapter_name TEXT,
    char_offset INTEGER,
    match_len INTEGER,
    original_text TEXT,
    suggestion TEXT,
    reason TEXT,
    status TEXT,
    created_at TEXT
  )`);

  sql.exec(`CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT
  )`);

  sql.exec(`CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    note TEXT,
    timestamp TEXT,
    word_count INTEGER,
    project_data TEXT
  )`);

  sql.exec(`CREATE TABLE writing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,
    duration INTEGER,
    word_count INTEGER,
    ai_continuation_count INTEGER DEFAULT 0,
    ai_continuation_chars INTEGER DEFAULT 0,
    ai_chat_count INTEGER DEFAULT 0,
    ai_details TEXT DEFAULT '{}'
, paste_large_count INTEGER DEFAULT 0, delete_large_count INTEGER DEFAULT 0)`);
}

/** 填入符合摘要結構與統計的範例初始列 */
export function insertDesktopSampleData(sql: Sql): void {
  // 1. project_info (1 列)
  sql.run(
    `INSERT INTO project_info (
      title, logline, current_theme, global_font_family, global_font_size,
      editor_font_family, editor_font_size, target_word_count, daily_target_word_count,
      category_order, expanded_categories, categories_meta, last_opened_node_id, last_cursor_position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      SAMPLE_DESKTOP_PROJECT_INFO.title,
      SAMPLE_DESKTOP_PROJECT_INFO.logline,
      SAMPLE_DESKTOP_PROJECT_INFO.current_theme,
      SAMPLE_DESKTOP_PROJECT_INFO.global_font_family,
      SAMPLE_DESKTOP_PROJECT_INFO.global_font_size,
      SAMPLE_DESKTOP_PROJECT_INFO.editor_font_family,
      SAMPLE_DESKTOP_PROJECT_INFO.editor_font_size,
      SAMPLE_DESKTOP_PROJECT_INFO.target_word_count,
      SAMPLE_DESKTOP_PROJECT_INFO.daily_target_word_count,
      SAMPLE_DESKTOP_PROJECT_INFO.category_order,
      SAMPLE_DESKTOP_PROJECT_INFO.expanded_categories,
      SAMPLE_DESKTOP_PROJECT_INFO.categories_meta,
      SAMPLE_DESKTOP_PROJECT_INFO.last_opened_node_id,
      SAMPLE_DESKTOP_PROJECT_INFO.last_cursor_position,
    ],
  );

  // 2. schema_version (3 列)
  for (const row of SAMPLE_DESKTOP_SCHEMA_VERSIONS) {
    sql.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
      row.version,
      row.applied_at,
    ]);
  }

  // 3. chapters (3 列，無正文，父節點優先插入)
  for (const ch of SAMPLE_DESKTOP_CHAPTERS) {
    sql.run(
      `INSERT INTO chapters (
        id, parent_id, name, node_type, content, mark, sort_order,
        scene_summary, scene_pov, scene_location, is_expanded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ch.id,
        ch.parent_id,
        ch.name,
        ch.node_type,
        ch.content,
        ch.mark,
        ch.sort_order,
        ch.scene_summary,
        ch.scene_pov,
        ch.scene_location,
        ch.is_expanded,
      ],
    );
  }

  // 4. cards (8 列，父卡優先於子卡插入，滿足外鍵條件)
  for (const card of SAMPLE_DESKTOP_CARDS) {
    sql.run(
      `INSERT INTO cards (
        id, parent_id, category, title, content, color, is_collapsed, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        card.id,
        card.parent_id,
        card.category,
        card.title,
        card.content,
        card.color,
        card.is_collapsed,
        card.sort_order,
      ],
    );
  }
}

let cachedSampleBytes: Uint8Array | null = null;

/**
 * 於記憶體建立與電腦版規格相同的資料庫位元組（Uint8Array）。
 * 產出固定且已快取，確保測試可重現且執行迅速。
 */
export async function generateDesktopSampleBytes(): Promise<Uint8Array> {
  if (cachedSampleBytes) {
    return cachedSampleBytes.slice();
  }
  const mem = await openMemoryDb(new Uint8Array(0));
  try {
    createDesktopSampleSchema(mem.sql);
    insertDesktopSampleData(mem.sql);
    const bytes = mem.exportBytes();
    cachedSampleBytes = bytes;
    return bytes.slice();
  } finally {
    mem.close();
  }
}

/**
 * 開啟一個載入電腦版範例資料的獨立記憶體資料庫實例。
 */
export async function openDesktopSampleMemoryDb(): Promise<MemoryDb> {
  const bytes = await generateDesktopSampleBytes();
  return openMemoryDb(bytes);
}
