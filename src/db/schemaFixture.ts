import type { Sql } from './sql';

/** 給自動測試用的假書，不是任何人的作品。 */
export function createVersion1(sql: Sql) {
  sql.exec(`CREATE TABLE project_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    logline TEXT,
    current_theme TEXT
  )`);
  sql.exec(`CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT,
    node_type TEXT,
    content TEXT,
    mark TEXT,
    sort_order INTEGER
  )`);
  sql.exec(`CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    category TEXT,
    title TEXT,
    content TEXT,
    color TEXT,
    is_collapsed INTEGER,
    sort_order INTEGER
  )`);
  sql.exec(`CREATE TABLE writing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,
    duration INTEGER,
    word_count INTEGER
  )`);
  sql.run('INSERT INTO project_info (title, logline, current_theme) VALUES (?, ?, ?)', [
    '【示範】舊檔',
    '',
    '',
  ]);
  sql.run(
    'INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['ch-1', null, '第一章　假信', 'file', '【示範】霧港只有這句假話。', 'Draft', 0],
  );
  sql.run(
    'INSERT INTO writing_logs (date, duration, word_count) VALUES (?, ?, ?)',
    ['2026-01-02', 60, 10],
  );
}

export function createVersion14Shell(sql: Sql) {
  sql.exec(`CREATE TABLE project_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT, logline TEXT, current_theme TEXT,
    global_font_family TEXT, global_font_size INTEGER,
    editor_font_family TEXT, editor_font_size INTEGER,
    target_word_count INTEGER DEFAULT 100000,
    daily_target_word_count INTEGER DEFAULT 1000,
    category_order TEXT, expanded_categories TEXT,
    categories_meta TEXT DEFAULT '{}',
    last_opened_node_id TEXT, last_cursor_position INTEGER DEFAULT 0
  )`);
  sql.exec(`CREATE TABLE chapters (
    id TEXT PRIMARY KEY, parent_id TEXT, name TEXT, node_type TEXT,
    content TEXT, mark TEXT, sort_order INTEGER,
    scene_summary TEXT DEFAULT '', scene_pov TEXT DEFAULT '',
    scene_location TEXT DEFAULT '', is_expanded INTEGER DEFAULT 1
  )`);
  sql.exec(`CREATE TABLE cards (
    id TEXT PRIMARY KEY, parent_id TEXT, category TEXT, title TEXT,
    content TEXT, color TEXT, is_collapsed INTEGER, sort_order INTEGER
  )`);
  sql.exec(`CREATE TABLE writing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE,
    duration INTEGER, word_count INTEGER,
    ai_continuation_count INTEGER DEFAULT 0,
    ai_continuation_chars INTEGER DEFAULT 0,
    ai_chat_count INTEGER DEFAULT 0,
    ai_details TEXT DEFAULT '{}',
    paste_large_count INTEGER DEFAULT 0,
    delete_large_count INTEGER DEFAULT 0
  )`);
  sql.exec(`CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, note TEXT,
    timestamp TEXT, word_count INTEGER, project_data TEXT
  )`);
  sql.exec(`CREATE TABLE proofread_results (
    id TEXT PRIMARY KEY, category TEXT, node_id TEXT, chapter_name TEXT,
    char_offset INTEGER, match_len INTEGER, original_text TEXT,
    suggestion TEXT, reason TEXT, status TEXT, created_at TEXT
  )`);
  sql.exec(`CREATE TABLE proofread_ignored_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, rule_type TEXT, target_word TEXT, created_at TEXT
  )`);
  sql.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT)`);
  sql.run('INSERT INTO schema_version (version, applied_at) VALUES (14, ?)', ['2026-01-01 00:00:00']);
}
