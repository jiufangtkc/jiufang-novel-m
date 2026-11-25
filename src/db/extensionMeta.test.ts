import { describe, expect, it } from 'vitest';
import {
  UUID_V4_PATTERN,
  collectAliveEntityIds,
  filterAliveRecords,
  generateUuidV4,
  inspectExtensionMetaTable,
  isExtensionReadOnlyPreserved,
  isExtensionReadable,
  isJiufangmTableName,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isValidUuidV4,
  normalizeUuidV4,
  resolveAliveRef,
  selectKnownColumns,
  shouldBlockSaveForExtension,
  updateKnownColumns,
} from './extensionMeta';
import { openNodeSql } from './nodeSql';

describe('WO-137 第 1 段：extensionMeta 統一擴充規範工具', () => {
  describe('UUID v4 產生與格式驗證', () => {
    it('預設產生的 UUID 符合小寫 UUID v4 格式且具唯一性', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i += 1) {
        const id = generateUuidV4();
        expect(UUID_V4_PATTERN.test(id)).toBe(true);
        expect(isValidUuidV4(id)).toBe(true);
        expect(id).toBe(id.toLowerCase());
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    });

    it('支援 randomUUID、getRandomValues 與無 crypto 後備三層產生路徑', () => {
      const fromRandomUuid = generateUuidV4({
        randomUUID: () => '550E8400-E29B-41D4-A716-446655440000',
      });
      expect(fromRandomUuid).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(isValidUuidV4(fromRandomUuid)).toBe(true);

      const fromGetRandomValues = generateUuidV4({
        getRandomValues: (arr) => {
          const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
          for (let i = 0; i < bytes.length; i += 1) bytes[i] = i + 1;
          return arr;
        },
      });
      expect(isValidUuidV4(fromGetRandomValues)).toBe(true);

      const fromFallback = generateUuidV4({});
      expect(isValidUuidV4(fromFallback)).toBe(true);
    });

    it('正確辨識與正規化合法與不合法的 UUID v4', () => {
      expect(isValidUuidV4('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUuidV4('550E8400-E29B-41D4-A716-446655440000')).toBe(false);
      expect(isValidUuidV4('not-a-uuid')).toBe(false);
      expect(isValidUuidV4(null)).toBe(false);

      expect(normalizeUuidV4(' 550E8400-E29B-41D4-A716-446655440000 ')).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      );
      // version 非 4 或 variant 非 8/9/a/b 應判無效
      expect(normalizeUuidV4('550e8400-e29b-11d4-a716-446655440000')).toBeNull();
      expect(normalizeUuidV4('550e8400-e29b-41d4-0716-446655440000')).toBeNull();
    });
  });

  describe('命名與四態判別輔助', () => {
    it('識別 jiufangm_ 前綴與四態讀寫行為旗標', () => {
      expect(isJiufangmTableName('jiufangm_book_meta')).toBe(true);
      expect(isJiufangmTableName('jiufangm_future_notes')).toBe(true);
      expect(isJiufangmTableName('project_info')).toBe(false);

      expect(isExtensionReadable('ok')).toBe(true);
      expect(isExtensionReadable('absent')).toBe(false);
      expect(isExtensionReadable('newer-revision')).toBe(false);
      expect(isExtensionReadable('corrupt')).toBe(false);

      expect(isExtensionReadOnlyPreserved('newer-revision')).toBe(true);
      expect(isExtensionReadOnlyPreserved('corrupt')).toBe(true);
      expect(isExtensionReadOnlyPreserved('ok')).toBe(false);

      expect(shouldBlockSaveForExtension({ kind: 'absent' })).toBe(false);
      expect(shouldBlockSaveForExtension({ kind: 'ok' })).toBe(false);
      expect(shouldBlockSaveForExtension({ kind: 'newer-revision' })).toBe(false);
      expect(shouldBlockSaveForExtension({ kind: 'corrupt' })).toBe(true);

      expect(isPositiveSafeInteger(1)).toBe(true);
      expect(isPositiveSafeInteger(0)).toBe(false);
      expect(isNonNegativeSafeInteger(0)).toBe(true);
      expect(isNonNegativeSafeInteger(-1)).toBe(false);
    });

    it('inspectExtensionMetaTable 正確回傳 absent / ok / newer-revision / corrupt', () => {
      const { sql } = openNodeSql();
      const spec = {
        metaTable: 'jiufangm_sample_meta',
        requiredMetaColumns: ['id', 'format_revision', 'title_tag'],
        companionTables: [
          { table: 'jiufangm_sample_items', requiredColumns: ['item_id', 'label'] },
        ],
        supportedRevision: 1,
        label: '範例',
      };

      expect(inspectExtensionMetaTable(sql, spec)).toEqual({ kind: 'absent' });

      // 雙表缺一 -> corrupt
      sql.exec('CREATE TABLE jiufangm_sample_meta (id INTEGER PRIMARY KEY, format_revision INTEGER, title_tag TEXT)');
      expect(inspectExtensionMetaTable(sql, spec).kind).toBe('corrupt');

      // 補上附表但缺列 -> corrupt
      sql.exec('CREATE TABLE jiufangm_sample_items (item_id TEXT PRIMARY KEY, label TEXT)');
      expect(inspectExtensionMetaTable(sql, spec).kind).toBe('corrupt');

      // format_revision = 1 且帶未知欄位 -> ok
      sql.exec('ALTER TABLE jiufangm_sample_meta ADD COLUMN future_note TEXT');
      sql.run('INSERT INTO jiufangm_sample_meta (id, format_revision, title_tag, future_note) VALUES (1, 1, ?, ?)', [
        'v1',
        'keep-me',
      ]);
      const okRes = inspectExtensionMetaTable(sql, spec);
      expect(okRes.kind).toBe('ok');
      if (okRes.kind === 'ok') {
        expect(okRes.revision).toBe(1);
        expect(okRes.metaColumns.has('future_note')).toBe(true);
      }

      // 明確更新已知欄位時，保留未知欄位原值
      updateKnownColumns(
        sql,
        'jiufangm_sample_meta',
        [['title_tag', 'updated']],
        'id = ?',
        [1],
      );
      const rows = selectKnownColumns(sql, 'jiufangm_sample_meta', ['title_tag']);
      expect(rows).toEqual([{ title_tag: 'updated' }]);
      expect(sql.select('SELECT future_note FROM jiufangm_sample_meta')).toEqual([{ future_note: 'keep-me' }]);

      // format_revision = 2 -> newer-revision（不可視為 corrupt）
      sql.run('UPDATE jiufangm_sample_meta SET format_revision = 2 WHERE id = 1');
      expect(inspectExtensionMetaTable(sql, spec)).toEqual({
        kind: 'newer-revision',
        revision: 2,
      });

      // format_revision = 0 -> corrupt
      sql.run('UPDATE jiufangm_sample_meta SET format_revision = 0 WHERE id = 1');
      expect(inspectExtensionMetaTable(sql, spec).kind).toBe('corrupt');
    });
  });

  describe('空參照（懸空參照）檢驗工具', () => {
    it('收集現存章節／節點／卡片 ID，並對失效參照安全降級為 null 或過濾', () => {
      const tree = [
        {
          id: 'vol-1',
          type: 'folder',
          children: [
            {
              id: 'ch-1',
              type: 'file',
              children: [{ id: 'sc-1', type: 'scene' }],
            },
            { id: 'ch-2', type: 'chapter' },
          ],
        },
        { id: 'ch-3', type: 'file' },
      ];
      const cards = [{ id: 'card-1' }, { id: 'card-2' }];

      const alive = collectAliveEntityIds(tree, cards);
      expect(Array.from(alive.chapterIds)).toEqual(['ch-1', 'ch-2', 'ch-3']);
      expect(alive.nodeIds.has('vol-1')).toBe(true);
      expect(alive.nodeIds.has('sc-1')).toBe(true);
      expect(Array.from(alive.cardIds)).toEqual(['card-1', 'card-2']);

      expect(resolveAliveRef('ch-1', alive.chapterIds)).toBe('ch-1');
      expect(resolveAliveRef('deleted-ch', alive.chapterIds)).toBeNull();
      expect(resolveAliveRef('', alive.chapterIds)).toBeNull();
      expect(resolveAliveRef(null, alive.chapterIds)).toBeNull();
      expect(resolveAliveRef(undefined, alive.chapterIds)).toBeNull();

      const timelineRecords = [
        { cardId: 'card-1', label: '保留' },
        { cardId: 'deleted-card', label: '電腦版已刪卡片' },
      ];
      expect(filterAliveRecords(timelineRecords, (item) => item.cardId, alive.cardIds)).toEqual([
        { cardId: 'card-1', label: '保留' },
      ]);
    });
  });
});
