import { describe, expect, it } from 'vitest';
import type { FileProjectInfo } from './projectFile';
import { columnNames } from './sql';
import { applyMigrations, currentSchemaVersion } from './migrations';
import { openNodeSql } from './nodeSql';
import { proofFingerprints, readFileProject, snapshotFingerprints, writeFileProject } from './projectFile';
import { createVersion1, createVersion14Shell } from './schemaFixture';
import { openMemoryDb } from './wasmDb';

describe('舊檔升級', () => {
  it('v1 範例書升到 v14 後，章名還在，新欄位也有', () => {
    const { sql } = openNodeSql();
    createVersion1(sql);
    applyMigrations(sql);
    expect(currentSchemaVersion(sql)).toBe(14);
    expect(columnNames(sql, 'project_info').has('last_opened_node_id')).toBe(true);
    expect(columnNames(sql, 'writing_logs').has('paste_large_count')).toBe(true);
    const loaded = readFileProject(sql);
    expect(loaded.tree.map((node) => node.title)).toEqual(['第一章　信']);
    expect(loaded.tree[0]?.content).toBe('【範例】霧港只有這一句。');
    expect(loaded.logs).toHaveLength(1);
  });
});

describe('讀不到書名', () => {
  it('空白或沒有書名時顯示未命名稿子', () => {
    const { sql } = openNodeSql();
    createVersion14Shell(sql);
    sql.run(
      'INSERT INTO project_info (title, target_word_count, daily_target_word_count, categories_meta) VALUES (?, ?, ?, ?)',
      [null, 1000, 300, '{}'],
    );
    expect(readFileProject(sql).info.title).toBe('未命名稿子');
    sql.run('UPDATE project_info SET title = ?', ['   ']);
    expect(readFileProject(sql).info.title).toBe('未命名稿子');
  });
});

describe('空白書檔', () => {
  it('沒有底層資料庫時先建表，寫入後可以再開', async () => {
    const info: FileProjectInfo = {
      title: '【範例】新書',
      logline: '',
      currentTheme: '',
      globalFontFamily: '',
      globalFontSize: 12,
      editorFontFamily: '',
      editorFontSize: 16,
      targetWordCount: 1000,
      dailyTargetWordCount: 300,
      categoryOrder: null,
      expandedCategories: null,
      categoriesMeta: '{}',
      lastOpenedNodeId: null,
      lastCursorPosition: 0,
    };
    const db = await openMemoryDb(new Uint8Array());
    writeFileProject(
      db.sql,
      info,
      [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　起筆',
          progress: 'Draft',
          content: '【範例】新書第一句。',
        },
      ],
      [],
      [],
    );
    const bytes = db.exportBytes();
    db.close();
    const again = await openMemoryDb(bytes);
    try {
      expect(currentSchemaVersion(again.sql)).toBe(14);
      const loaded = readFileProject(again.sql);
      expect(loaded.info.title).toBe('【範例】新書');
      expect(loaded.tree[0]?.title).toBe('第一章　起筆');
      expect(loaded.tree[0]?.content).toBe('【範例】新書第一句。');
      expect(loaded.tree[0]?.progress).toBe('Draft');
    } finally {
      again.close();
    }
  });
});

describe('另存時保留沒改到的表', () => {
  it('改了正文再寫回，快照與校對列不變', () => {
    const { sql } = openNodeSql();
    createVersion14Shell(sql);
    sql.run(
      'INSERT INTO project_info (title, target_word_count, daily_target_word_count, categories_meta) VALUES (?, ?, ?, ?)',
      ['【範例】另存測試', 1000, 300, '{}'],
    );
    sql.run(
      `INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, scene_summary, is_expanded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ch-1', null, '第一章　信', 'file', '【範例】原文。', 'Draft', 0, '範例摘要', 1],
    );
    sql.run(
      'INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['card-1', null, 'role', '【範例】角色', '範例卡片', '#61AFEF', 0, 0],
    );
    sql.run(
      'INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES (?, ?, ?, ?, ?)',
      ['範例快照', '不要丟', '2026-01-01', 3, '{"keep":true}'],
    );
    sql.run(
      `INSERT INTO proofread_results (id, category, node_id, chapter_name, char_offset, match_len, original_text, suggestion, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pr-1', 'demo', 'ch-1', '第一章　信', 0, 1, '原', '改', '範', 'open', '2026-01-01'],
    );
    const beforeSnap = snapshotFingerprints(sql);
    const beforeProof = proofFingerprints(sql);
    const loaded = readFileProject(sql);
    loaded.tree[0]!.content = '【範例】改過的一句。';
    writeFileProject(sql, loaded.info, loaded.tree, loaded.cards, loaded.logs);
    expect(snapshotFingerprints(sql)).toEqual(beforeSnap);
    expect(proofFingerprints(sql)).toEqual(beforeProof);
    const again = readFileProject(sql);
    expect(again.tree[0]?.content).toBe('【範例】改過的一句。');
    expect(again.tree[0]?.sceneSummary).toBe('範例摘要');
    expect(again.cards).toHaveLength(1);
    expect(again.cards[0]?.title).toBe('【範例】角色');
  });
});
