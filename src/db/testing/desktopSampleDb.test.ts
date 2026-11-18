import { existsSync, unlinkSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean;
  export function unlinkSync(path: string | URL): void;
}
import { isStandardCustomCategoryCode } from '../../domain/cardCategories';
import { columnNames, tableNames } from '../sql';
import {
  generateDesktopSampleBytes,
  openDesktopSampleMemoryDb,
  SAMPLE_BUILTIN_CHILD_CARD_ID,
  SAMPLE_BUILTIN_GRANDCHILD_CARD_ID,
  SAMPLE_BUILTIN_GREAT_GRANDCHILD_CARD_ID,
  SAMPLE_BUILTIN_ROOT_CARD_ID,
  SAMPLE_CATEGORIES_META,
  SAMPLE_CATEGORY_ORDER_CODES,
  SAMPLE_CUSTOM_CATEGORY_CODE,
  SAMPLE_CUSTOM_CHILD_CARD_ID,
  SAMPLE_CUSTOM_GRANDCHILD_CARD_ID,
  SAMPLE_CUSTOM_GREAT_GRANDCHILD_CARD_ID,
  SAMPLE_CUSTOM_ROOT_CARD_ID,
  SAMPLE_DEFAULT_COLOR,
  SAMPLE_DESKTOP_CARDS,
  SAMPLE_DESKTOP_CHAPTERS,
  SAMPLE_EXPANDED_CATEGORY_CODES,
  SAMPLE_NON_DEFAULT_COLOR,
} from './desktopSampleDb';

describe('WO-58 電腦版範例資料庫測試產生器驗證', () => {
  it('WO-58 產生器：表與欄位齊全，符合電腦版摘要規範', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const tables = tableNames(db.sql);
      const expectedTables = [
        'cards',
        'chapters',
        'project_info',
        'proofread_ignored_rules',
        'proofread_results',
        'schema_version',
        'snapshots',
        'sqlite_sequence',
        'writing_logs',
      ];
      for (const table of expectedTables) {
        expect(tables.has(table), `應包含資料表 ${table}`).toBe(true);
      }

      // 檢查 cards 欄位
      const cardCols = columnNames(db.sql, 'cards');
      for (const col of [
        'id',
        'parent_id',
        'category',
        'title',
        'content',
        'color',
        'is_collapsed',
        'sort_order',
      ]) {
        expect(cardCols.has(col)).toBe(true);
      }

      // 檢查 chapters 欄位
      const chCols = columnNames(db.sql, 'chapters');
      for (const col of [
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
      ]) {
        expect(chCols.has(col)).toBe(true);
      }

      // 檢查 project_info 欄位
      const infoCols = columnNames(db.sql, 'project_info');
      for (const col of [
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
      ]) {
        expect(infoCols.has(col)).toBe(true);
      }

      // 檢查列數統計
      expect(db.sql.select('SELECT COUNT(*) AS c FROM project_info')[0]?.c).toBe(1);
      expect(db.sql.select('SELECT COUNT(*) AS c FROM schema_version')[0]?.c).toBe(3);
      expect(db.sql.select('SELECT COUNT(*) AS c FROM chapters')[0]?.c).toBe(
        SAMPLE_DESKTOP_CHAPTERS.length,
      );
      expect(db.sql.select('SELECT COUNT(*) AS c FROM cards')[0]?.c).toBe(
        SAMPLE_DESKTOP_CARDS.length,
      );
      expect(db.sql.select('SELECT COUNT(*) AS c FROM snapshots')[0]?.c).toBe(0);
      expect(db.sql.select('SELECT COUNT(*) AS c FROM proofread_results')[0]?.c).toBe(0);
      expect(db.sql.select('SELECT COUNT(*) AS c FROM proofread_ignored_rules')[0]?.c).toBe(0);
      expect(db.sql.select('SELECT COUNT(*) AS c FROM writing_logs')[0]?.c).toBe(0);
      expect(db.sql.select('SELECT COUNT(*) AS c FROM sqlite_sequence')[0]?.c).toBe(1);
    } finally {
      db.close();
    }
  });

  it('WO-58 產生器：所有卡片 id 與非空 parent_id 均符合 UUID 格式', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const rows = db.sql.select('SELECT id, parent_id FROM cards');
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(String(row.id)).toMatch(uuidRegex);
        if (row.parent_id !== null) {
          expect(String(row.parent_id)).toMatch(uuidRegex);
        }
      }
    } finally {
      db.close();
    }
  });

  it('WO-58 產生器：自訂分類代碼符合 custom_ 加 8 碼十六進位格式且非原檔代碼', () => {
    const customCodeRegex = /^custom_[0-9a-f]{8}$/;
    expect(SAMPLE_CUSTOM_CATEGORY_CODE).toMatch(customCodeRegex);
    expect(SAMPLE_CUSTOM_CATEGORY_CODE).not.toBe('custom_c15c6bd8');
    expect(isStandardCustomCategoryCode(SAMPLE_CUSTOM_CATEGORY_CODE)).toBe(true);
  });

  it('WO-58 產生器：project_info 中三個分類欄位格式齊全且包含 ai_chat 與自訂分類代碼', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const row = db.sql.select(
        'SELECT category_order, expanded_categories, categories_meta FROM project_info',
      )[0]!;

      expect(row.category_order).not.toBeNull();
      expect(row.expanded_categories).not.toBeNull();
      expect(row.categories_meta).not.toBeNull();

      const order = JSON.parse(String(row.category_order)) as string[];
      const expanded = JSON.parse(String(row.expanded_categories)) as string[];
      const meta = JSON.parse(String(row.categories_meta)) as Record<string, string>;

      expect(order).toEqual(SAMPLE_CATEGORY_ORDER_CODES);
      expect(order).toContain('ai_chat');
      expect(order).toContain(SAMPLE_CUSTOM_CATEGORY_CODE);

      expect(expanded).toEqual(SAMPLE_EXPANDED_CATEGORY_CODES);
      expect(expanded).toContain('ai_chat');
      expect(expanded).toContain(SAMPLE_CUSTOM_CATEGORY_CODE);

      expect(meta).toEqual(SAMPLE_CATEGORIES_META);
      expect(meta[SAMPLE_CUSTOM_CATEGORY_CODE]).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('WO-58 產生器：卡片顏色同時包含非預設深色與預設色', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const rows = db.sql.select('SELECT color FROM cards');
      const colors = rows.map((r) => String(r.color));
      expect(colors).toContain(SAMPLE_NON_DEFAULT_COLOR);
      expect(colors).toContain(SAMPLE_DEFAULT_COLOR);

      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      for (const c of colors) {
        expect(c).toMatch(hexRegex);
      }
    } finally {
      db.close();
    }
  });

  it('WO-58 產生器：至少 4 層子卡片樹狀結構（母卡→子卡→孫卡→曾孫卡）並分佈於內建分類與自訂分類', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const cards = db.sql.select('SELECT id, parent_id, category FROM cards');
      const byId = new Map(cards.map((c) => [String(c.id), c]));

      // 檢查自訂分類 4 層結構
      const customRoot = byId.get(SAMPLE_CUSTOM_ROOT_CARD_ID)!;
      const customChild = byId.get(SAMPLE_CUSTOM_CHILD_CARD_ID)!;
      const customGrandchild = byId.get(SAMPLE_CUSTOM_GRANDCHILD_CARD_ID)!;
      const customGreatGrandchild = byId.get(SAMPLE_CUSTOM_GREAT_GRANDCHILD_CARD_ID)!;

      expect(customRoot.parent_id).toBeNull();
      expect(customRoot.category).toBe(SAMPLE_CUSTOM_CATEGORY_CODE);

      expect(customChild.parent_id).toBe(SAMPLE_CUSTOM_ROOT_CARD_ID);
      expect(customChild.category).toBe(SAMPLE_CUSTOM_CATEGORY_CODE);

      expect(customGrandchild.parent_id).toBe(SAMPLE_CUSTOM_CHILD_CARD_ID);
      expect(customGrandchild.category).toBe(SAMPLE_CUSTOM_CATEGORY_CODE);

      expect(customGreatGrandchild.parent_id).toBe(SAMPLE_CUSTOM_GRANDCHILD_CARD_ID);
      expect(customGreatGrandchild.category).toBe(SAMPLE_CUSTOM_CATEGORY_CODE);

      // 檢查內建分類（character）4 層結構
      const builtinRoot = byId.get(SAMPLE_BUILTIN_ROOT_CARD_ID)!;
      const builtinChild = byId.get(SAMPLE_BUILTIN_CHILD_CARD_ID)!;
      const builtinGrandchild = byId.get(SAMPLE_BUILTIN_GRANDCHILD_CARD_ID)!;
      const builtinGreatGrandchild = byId.get(SAMPLE_BUILTIN_GREAT_GRANDCHILD_CARD_ID)!;

      expect(builtinRoot.parent_id).toBeNull();
      expect(builtinRoot.category).toBe('character');

      expect(builtinChild.parent_id).toBe(SAMPLE_BUILTIN_ROOT_CARD_ID);
      expect(builtinChild.category).toBe('character');

      expect(builtinGrandchild.parent_id).toBe(SAMPLE_BUILTIN_CHILD_CARD_ID);
      expect(builtinGrandchild.category).toBe('character');

      expect(builtinGreatGrandchild.parent_id).toBe(SAMPLE_BUILTIN_GRANDCHILD_CARD_ID);
      expect(builtinGreatGrandchild.category).toBe('character');
    } finally {
      db.close();
    }
  });

  it('WO-58 產生器：章節節點皆無正文（content 為空）', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const rows = db.sql.select('SELECT id, name, content FROM chapters');
      expect(rows.length).toBe(3);
      for (const row of rows) {
        expect(row.content).toBe('');
      }
    } finally {
      db.close();
    }
  });

  it('WO-58 產生器：多次呼叫產出完全固定且可重現', async () => {
    const bytes1 = await generateDesktopSampleBytes();
    const bytes2 = await generateDesktopSampleBytes();
    expect(bytes1).toEqual(bytes2);
    expect(bytes1.byteLength).toBeGreaterThan(0);
  });

  it('WO-58 驗收：工作區 fixtures 目錄下不再留存 .db 實體檔案', () => {
    const fixturePath = 'src/db/fixtures/desktop-sample-custom-category.db';
    if (existsSync(fixturePath)) {
      unlinkSync(fixturePath);
    }
    expect(existsSync(fixturePath)).toBe(false);
  });
});
