import { describe, expect, it } from 'vitest';
import { columnNames } from './sql';
import { applyMigrations, currentSchemaVersion } from './migrations';
import { openNodeSql } from './nodeSql';
import { proofFingerprints, readFileProject, snapshotFingerprints, writeFileProject } from './projectFile';
import { createVersion1, createVersion14Shell } from './schemaFixture';

describe('舊檔升級', () => {
  it('v1 假書升到 v14 後，章名還在，新欄位也有', () => {
    const { sql } = openNodeSql();
    createVersion1(sql);
    applyMigrations(sql);
    expect(currentSchemaVersion(sql)).toBe(14);
    expect(columnNames(sql, 'project_info').has('last_opened_node_id')).toBe(true);
    expect(columnNames(sql, 'writing_logs').has('paste_large_count')).toBe(true);
    const loaded = readFileProject(sql);
    expect(loaded.tree.map((node) => node.title)).toEqual(['第一章　假信']);
    expect(loaded.tree[0]?.content).toBe('【示範】霧港只有這句假話。');
    expect(loaded.logs).toHaveLength(1);
  });
});

describe('另存時保留沒改到的表', () => {
  it('改了正文再寫回，快照與校對列不變', () => {
    const { sql } = openNodeSql();
    createVersion14Shell(sql);
    sql.run(
      'INSERT INTO project_info (title, target_word_count, daily_target_word_count, categories_meta) VALUES (?, ?, ?, ?)',
      ['【示範】另存測試', 1000, 300, '{}'],
    );
    sql.run(
      `INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, scene_summary, is_expanded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ch-1', null, '第一章　假信', 'file', '【示範】原文。', 'Draft', 0, '假摘要', 1],
    );
    sql.run(
      'INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['card-1', null, 'role', '【示範】角色', '假卡片', '#61AFEF', 0, 0],
    );
    sql.run(
      'INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES (?, ?, ?, ?, ?)',
      ['假快照', '不要丟', '2026-01-01', 3, '{"keep":true}'],
    );
    sql.run(
      `INSERT INTO proofread_results (id, category, node_id, chapter_name, char_offset, match_len, original_text, suggestion, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pr-1', 'demo', 'ch-1', '第一章　假信', 0, 1, '原', '改', '假', 'open', '2026-01-01'],
    );
    const beforeSnap = snapshotFingerprints(sql);
    const beforeProof = proofFingerprints(sql);
    const loaded = readFileProject(sql);
    loaded.tree[0]!.content = '【示範】改過的假句。';
    writeFileProject(sql, loaded.info, loaded.tree, loaded.cards, loaded.logs);
    expect(snapshotFingerprints(sql)).toEqual(beforeSnap);
    expect(proofFingerprints(sql)).toEqual(beforeProof);
    const again = readFileProject(sql);
    expect(again.tree[0]?.content).toBe('【示範】改過的假句。');
    expect(again.tree[0]?.sceneSummary).toBe('假摘要');
    expect(again.cards).toHaveLength(1);
    expect(again.cards[0]?.title).toBe('【示範】角色');
  });
});
