import type { ChapterNode } from '../data/demo';
import { countManuscriptWords } from '../domain/manuscriptWords';
import type { ProgressCode } from '../domain/labels';
import { applyMigrations } from './migrations';
import type { Sql, SqlValue } from './sql';

const PROGRESS = new Set<string>(['Draft', '1st Edit', '2nd Edit', 'Final', 'Discarded']);

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
}

export interface LoadedFile {
  info: FileProjectInfo;
  tree: ChapterNode[];
  cards: FileCard[];
  logs: FileLog[];
  wordCount: number;
}

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

export function readFileProject(sql: Sql): LoadedFile {
  applyMigrations(sql);
  const infoRow = sql.select('SELECT * FROM project_info ORDER BY id LIMIT 1')[0];
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
  };
  const chapterRows = sql.select(
    `SELECT id, parent_id, name, node_type, content, mark, sort_order,
            scene_summary, scene_pov, scene_location, is_expanded
     FROM chapters ORDER BY sort_order, id`,
  );
  const tree = buildTree(chapterRows);
  const cards = sql.select(
    `SELECT id, parent_id, category, title, content, color, is_collapsed, sort_order
     FROM cards ORDER BY sort_order, id`,
  ).map((row) => ({
    id: text(row.id),
    parent_id: row.parent_id == null ? null : text(row.parent_id),
    category: text(row.category),
    title: text(row.title),
    content: text(row.content),
    color: text(row.color),
    is_collapsed: num(row.is_collapsed),
    sort_order: num(row.sort_order),
  }));
  const logs = sql.select(
    `SELECT date, duration, word_count, ai_continuation_count, ai_continuation_chars,
            ai_chat_count, ai_details, paste_large_count, delete_large_count
     FROM writing_logs ORDER BY date`,
  ).map((row) => ({
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

function buildTree(rows: Record<string, unknown>[]): ChapterNode[] {
  const ordered = [...rows].sort((a, b) => num(a.sort_order) - num(b.sort_order));
  const nodes = new Map<string, ChapterNode>();
  for (const row of ordered) {
    nodes.set(text(row.id), {
      id: text(row.id),
      type: (text(row.node_type, 'file') as ChapterNode['type']),
      title: text(row.name),
      progress: progressOf(text(row.mark)),
      content: text(row.content),
      expanded: num(row.is_expanded, 1) !== 0,
      children: [],
      sceneSummary: text(row.scene_summary),
      scenePov: text(row.scene_pov),
      sceneLocation: text(row.scene_location),
    });
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

/** 全量覆寫專案、章節、卡片；寫作紀錄依日期更新。快照與校對表不動。 */
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

export function writeFileProject(
  sql: Sql,
  info: FileProjectInfo,
  tree: readonly ChapterNode[],
  cards: readonly FileCard[],
  logs: readonly FileLog[],
): void {
  applyMigrations(sql);
  sql.exec('PRAGMA foreign_keys = OFF');
  sql.exec('DELETE FROM project_info');
  sql.run(
    `INSERT INTO project_info (
      title, logline, current_theme,
      global_font_family, global_font_size,
      editor_font_family, editor_font_size,
      target_word_count, daily_target_word_count,
      category_order, expanded_categories, categories_meta,
      last_opened_node_id, last_cursor_position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      info.title,
      info.logline,
      info.currentTheme,
      info.globalFontFamily,
      info.globalFontSize,
      info.editorFontFamily,
      info.editorFontSize,
      info.targetWordCount,
      info.dailyTargetWordCount,
      info.categoryOrder,
      info.expandedCategories,
      info.categoriesMeta,
      info.lastOpenedNodeId,
      info.lastCursorPosition,
    ],
  );
  sql.exec('DELETE FROM chapters');
  const writeNode = (node: ChapterNode, parentId: string | null, sortOrder: number) => {
    sql.run(
      `INSERT INTO chapters (
        id, parent_id, name, node_type, content, mark, sort_order,
        scene_summary, scene_pov, scene_location, is_expanded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        node.id,
        parentId,
        node.title,
        node.type,
        node.content ?? '',
        node.progress ?? '',
        sortOrder,
        node.sceneSummary ?? '',
        node.scenePov ?? '',
        node.sceneLocation ?? '',
        node.expanded === false ? 0 : 1,
      ],
    );
    (node.children ?? []).forEach((child, index) => writeNode(child, node.id, index));
  };
  tree.forEach((node, index) => writeNode(node, null, index));
  sql.exec('DELETE FROM cards');
  for (const card of cardsInParentOrder(cards)) {
    sql.run(
      `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  for (const log of logs) {
    sql.run(
      `INSERT INTO writing_logs (
        date, duration, word_count, ai_continuation_count, ai_continuation_chars,
        ai_chat_count, ai_details, paste_large_count, delete_large_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        duration = excluded.duration,
        word_count = excluded.word_count,
        ai_continuation_count = excluded.ai_continuation_count,
        ai_continuation_chars = excluded.ai_continuation_chars,
        ai_chat_count = excluded.ai_chat_count,
        ai_details = excluded.ai_details,
        paste_large_count = excluded.paste_large_count,
        delete_large_count = excluded.delete_large_count`,
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
