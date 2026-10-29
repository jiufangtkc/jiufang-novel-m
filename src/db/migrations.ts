import { columnNames, tableNames, type Sql } from './sql';

export const CURRENT_SCHEMA_VERSION = 14;

function hasColumn(sql: Sql, table: string, column: string): boolean {
  if (!tableNames(sql).has(table)) return false;
  return columnNames(sql, table).has(column);
}

/** 還沒有 schema_version 的舊檔，依欄位判斷目前停在哪一版。 */
export function detectLegacyVersion(sql: Sql): number {
  const tables = tableNames(sql);
  if (!tables.has('project_info') && !tables.has('chapters')) return 0;
  if (!hasColumn(sql, 'project_info', 'global_font_family')) return 1;
  if (!hasColumn(sql, 'chapters', 'scene_summary')) return 2;
  if (!tables.has('snapshots')) return 3;
  if (!hasColumn(sql, 'writing_logs', 'ai_continuation_count')) return 4;
  if (!hasColumn(sql, 'project_info', 'target_word_count')) return 5;
  if (!hasColumn(sql, 'project_info', 'category_order')) return 6;
  if (!tables.has('proofread_results')) return 7;
  if (!hasColumn(sql, 'chapters', 'is_expanded')) return 8;
  if (!hasColumn(sql, 'project_info', 'daily_target_word_count')) return 9;
  if (!hasColumn(sql, 'writing_logs', 'paste_large_count')) return 11;
  if (!hasColumn(sql, 'project_info', 'categories_meta')) return 12;
  if (!hasColumn(sql, 'project_info', 'last_opened_node_id')) return 13;
  return 14;
}

export function currentSchemaVersion(sql: Sql): number {
  if (!tableNames(sql).has('schema_version')) return 0;
  const row = sql.select('SELECT MAX(version) AS version FROM schema_version')[0];
  const version = row?.version;
  return typeof version === 'number' ? version : 0;
}

function addColumn(sql: Sql, table: string, column: string, definition: string) {
  if (!tableNames(sql).has(table)) return;
  if (columnNames(sql, table).has(column)) return;
  sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const steps: Array<(sql: Sql) => void> = [
  (sql) => {
    addColumn(sql, 'project_info', 'global_font_family', 'TEXT');
    addColumn(sql, 'project_info', 'global_font_size', 'INTEGER');
    addColumn(sql, 'project_info', 'editor_font_family', 'TEXT');
    addColumn(sql, 'project_info', 'editor_font_size', 'INTEGER');
  },
  (sql) => {
    addColumn(sql, 'chapters', 'scene_summary', "TEXT DEFAULT ''");
    addColumn(sql, 'chapters', 'scene_pov', "TEXT DEFAULT ''");
    addColumn(sql, 'chapters', 'scene_location', "TEXT DEFAULT ''");
  },
  (sql) => {
    sql.exec(`CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      note TEXT,
      timestamp TEXT,
      word_count INTEGER,
      project_data TEXT
    )`);
  },
  (sql) => {
    addColumn(sql, 'writing_logs', 'ai_continuation_count', 'INTEGER DEFAULT 0');
    addColumn(sql, 'writing_logs', 'ai_continuation_chars', 'INTEGER DEFAULT 0');
    addColumn(sql, 'writing_logs', 'ai_chat_count', 'INTEGER DEFAULT 0');
  },
  (sql) => addColumn(sql, 'project_info', 'target_word_count', 'INTEGER DEFAULT 100000'),
  (sql) => addColumn(sql, 'project_info', 'category_order', 'TEXT DEFAULT NULL'),
  (sql) => {
    sql.exec(`CREATE TABLE IF NOT EXISTS proofread_results (
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
    sql.exec(`CREATE TABLE IF NOT EXISTS proofread_ignored_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_type TEXT,
      target_word TEXT,
      created_at TEXT
    )`);
  },
  (sql) => {
    addColumn(sql, 'chapters', 'is_expanded', 'INTEGER DEFAULT 1');
    addColumn(sql, 'project_info', 'expanded_categories', 'TEXT DEFAULT NULL');
  },
  (sql) => addColumn(sql, 'project_info', 'daily_target_word_count', 'INTEGER DEFAULT 1000'),
  (sql) => addColumn(sql, 'writing_logs', 'ai_details', "TEXT DEFAULT '{}'"),
  (sql) => {
    addColumn(sql, 'writing_logs', 'paste_large_count', 'INTEGER DEFAULT 0');
    addColumn(sql, 'writing_logs', 'delete_large_count', 'INTEGER DEFAULT 0');
  },
  (sql) => addColumn(sql, 'project_info', 'categories_meta', "TEXT DEFAULT '{}'"),
  (sql) => {
    addColumn(sql, 'project_info', 'last_opened_node_id', 'TEXT DEFAULT NULL');
    addColumn(sql, 'project_info', 'last_cursor_position', 'INTEGER DEFAULT 0');
  },
];

/** 全新的書還沒有任何表。先建與舊版同一套底表，後面的升級才加得了欄位。 */
export function ensureBaseTables(sql: Sql): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS project_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    logline TEXT,
    current_theme TEXT
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT,
    node_type TEXT,
    content TEXT,
    mark TEXT,
    sort_order INTEGER
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    category TEXT,
    title TEXT,
    content TEXT,
    color TEXT,
    is_collapsed INTEGER,
    sort_order INTEGER
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS writing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,
    duration INTEGER,
    word_count INTEGER
  )`);
}

function appliedAt(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** 把 v1～v13 升到 v14。已是 v14 的檔案不會改到內文。 */
export function applyMigrations(sql: Sql): number {
  ensureBaseTables(sql);
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT
  )`);
  let version = currentSchemaVersion(sql);
  if (version === 0) version = detectLegacyVersion(sql);
  steps.forEach((step, index) => {
    const fromVersion = index + 1;
    if (version > fromVersion) return;
    step(sql);
    version = fromVersion + 1;
    sql.run('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)', [
      version,
      appliedAt(),
    ]);
  });
  sql.run('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)', [
    CURRENT_SCHEMA_VERSION,
    appliedAt(),
  ]);
  return CURRENT_SCHEMA_VERSION;
}
