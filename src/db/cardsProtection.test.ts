import { describe, expect, it } from 'vitest';
import {
  parseCategoriesMeta,
  parseCategoryOrder,
  resolveVisibleCategories,
  serializeCategoriesMeta,
  serializeCategoryOrder,
  setCustomCategoryName,
} from '../domain/cardCategories';
import {
  addCard,
  addSubCard,
  DEFAULT_CARD_COLOR,
  deleteCard,
  moveCardDown,
  moveCardUp,
  updateCardColor,
  updateCardContent,
  updateCardTitle,
} from '../domain/cardOps';
import { filterVisibleCategories, isCategoryHidden } from '../domain/cards';
import { renameNode } from '../domain/chapterOps';
import { createState, reduce } from '../state/sampleStore';
import { openNodeSql } from './nodeSql';
import {
  idsInChildFirstDeleteOrder,
  proofFingerprints,
  readFileProject,
  snapshotFingerprints,
  writeFileProject,
  type FileCard,
} from './projectFile';
import { createVersion1, createVersion14Shell } from './schemaFixture';
import { tableNames, type Sql } from './sql';
import {
  openDesktopSampleMemoryDb,
  SAMPLE_CATEGORY_ORDER_CODES,
  SAMPLE_CUSTOM_CATEGORY_CODE,
  SAMPLE_CUSTOM_CATEGORY_NAME,
  SAMPLE_CUSTOM_CHILD_CARD_ID,
  SAMPLE_CUSTOM_ROOT_CARD_ID,
  SAMPLE_DEFAULT_COLOR,
  SAMPLE_DESKTOP_CARDS,
  SAMPLE_NON_DEFAULT_COLOR,
} from './testing/desktopSampleDb';
import { openMemoryDb } from './wasmDb';

function dumpAllTablesExceptSequence(sql: Sql): Record<string, Record<string, unknown>[]> {
  const names = [...tableNames(sql)]
    .filter((name) => name !== 'sqlite_sequence')
    .sort();
  const dump: Record<string, Record<string, unknown>[]> = {};
  for (const name of names) {
    dump[name] = sql.select(`SELECT * FROM ${name}`);
  }
  return dump;
}

describe('WO-51 卡片讀寫邏輯與 .db 保護（P0 / P1 / 回歸測試）', () => {
  it('P0-7 範例檔基本讀取：讀出卡片、父子關係、自訂分類名稱與順序正確', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const loaded = readFileProject(db.sql);
      expect(loaded.cards).toHaveLength(SAMPLE_DESKTOP_CARDS.length);

      const parentCard = loaded.cards.find((c) => c.id === SAMPLE_CUSTOM_ROOT_CARD_ID);
      const childCard = loaded.cards.find((c) => c.id === SAMPLE_CUSTOM_CHILD_CARD_ID);
      expect(parentCard).toBeDefined();
      expect(childCard).toBeDefined();
      expect(childCard?.parent_id).toBe(parentCard?.id);
      expect(childCard?.category).toBe(parentCard?.category);

      const order = parseCategoryOrder(loaded.info.categoryOrder);
      expect(order.codes).toEqual(SAMPLE_CATEGORY_ORDER_CODES);

      const meta = parseCategoriesMeta(loaded.info.categoriesMeta);
      expect(meta.names[SAMPLE_CUSTOM_CATEGORY_CODE]).toBe(SAMPLE_CUSTOM_CATEGORY_NAME);

      const visibleCats = resolveVisibleCategories({
        categoryOrder: loaded.info.categoryOrder,
        categoriesMeta: loaded.info.categoriesMeta,
        cards: loaded.cards,
      });
      expect(visibleCats.map((c) => c.id)).toEqual([
        'summary',
        'character',
        'world',
        'timeline',
        SAMPLE_CUSTOM_CATEGORY_CODE,
      ]);
      expect(visibleCats.find((c) => c.id === SAMPLE_CUSTOM_CATEGORY_CODE)?.name).toBe(
        SAMPLE_CUSTOM_CATEGORY_NAME,
      );
    } finally {
      db.close();
    }
  });

  it('P0-4 原樣寫回逐欄相同：用範例檔讀入後不做任何改動直接寫回，每張表每一列每一欄與原檔完全相同，且不發任何 UPDATE／DELETE／INSERT', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const beforeTables = dumpAllTablesExceptSequence(db.sql);
      const beforeSnap = snapshotFingerprints(db.sql);
      const beforeProof = proofFingerprints(db.sql);
      const beforeLogs = db.sql.select('SELECT * FROM writing_logs ORDER BY id');

      const dmlStatements: string[] = [];
      const countingSql: Sql = {
        exec: (statement) => {
          if (/\b(UPDATE|DELETE|INSERT)\b/i.test(statement)) {
            dmlStatements.push(statement);
          }
          db.sql.exec(statement);
        },
        run: (statement, params) => {
          if (/\b(UPDATE|DELETE|INSERT)\b/i.test(statement)) {
            dmlStatements.push(statement);
          }
          db.sql.run(statement, params);
        },
        select: (statement, params) => db.sql.select(statement, params),
      };

      const loaded = readFileProject(db.sql);
      const totalChangesBefore = Number(
        db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0,
      );
      writeFileProject(countingSql, loaded.info, loaded.tree, loaded.cards, loaded.logs);
      const totalChangesAfter = Number(
        db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0,
      );
      expect(dmlStatements).toEqual([]);
      expect(totalChangesAfter).toBe(totalChangesBefore);

      const afterTables = dumpAllTablesExceptSequence(db.sql);
      expect(afterTables).toEqual(beforeTables);
      expect(afterTables.project_info?.[0]?.id).toBe(1);
      expect(afterTables.project_info?.[0]?.expanded_categories).not.toBeNull();
      expect(snapshotFingerprints(db.sql)).toEqual(beforeSnap);
      expect(proofFingerprints(db.sql)).toEqual(beforeProof);
      expect(db.sql.select('SELECT * FROM writing_logs ORDER BY id')).toEqual(beforeLogs);

      // 確認當 chapters.mark 為 NULL 時，讀入後不做改動寫回仍維持 NULL（不可變成空字串），且同樣不發任何 UPDATE／DELETE／INSERT
      db.sql.run('UPDATE chapters SET mark = NULL');
      const tablesWithNullMark = dumpAllTablesExceptSequence(db.sql);
      expect(tablesWithNullMark.chapters?.every((r) => r.mark === null)).toBe(true);
      const loadedNullMark = readFileProject(db.sql);
      dmlStatements.length = 0;
      const changesBeforeNullMark = Number(
        db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0,
      );
      writeFileProject(
        countingSql,
        loadedNullMark.info,
        loadedNullMark.tree,
        loadedNullMark.cards,
        loadedNullMark.logs,
      );
      const changesAfterNullMark = Number(
        db.sql.select('SELECT total_changes() AS total')[0]?.total ?? 0,
      );
      expect(dmlStatements).toEqual([]);
      expect(changesAfterNullMark).toBe(changesBeforeNullMark);
      expect(dumpAllTablesExceptSequence(db.sql)).toEqual(tablesWithNullMark);
    } finally {
      db.close();
    }
  });

  it('P0-1 AI 對話分類與卡片完整保留：加入 ai_chat 卡片後改別張卡並寫回再讀，ai_chat 卡片逐欄 JSON 完全相同且 category_order 原位保留', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      // 在範例資料庫加入 ai_chat 卡片（含子卡片、不同顏色）
      db.sql.run(
        `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['ai-card-root', null, 'ai_chat', '【範例】AI 對話主卡', '【範例】對話紀錄內容 A', '#1e293b', 0, 0],
      );
      db.sql.run(
        `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['ai-card-child', 'ai-card-root', 'ai_chat', '【範例】AI 對話子卡', '【範例】對話紀錄內容 B', '#61AFEF', 1, 0],
      );

      const beforeAiRows = db.sql
        .select("SELECT * FROM cards WHERE category = 'ai_chat' ORDER BY id")
        .map((r) => JSON.stringify(r));

      const loaded = readFileProject(db.sql);
      const nonAiCards = loaded.cards.filter((c) => c.category !== 'ai_chat');
      expect(nonAiCards.length).toBeGreaterThanOrEqual(2);
      const rootNonAi = nonAiCards.find((c) => c.parent_id === null)!;
      const childNonAi = nonAiCards.find((c) => c.parent_id !== null)!;

      // 對別張卡執行：改字、改色、新增、刪除、排序
      let nextCards = loaded.cards;
      nextCards = updateCardTitle(nextCards, rootNonAi.id, '【範例】修改後主卡標題');
      nextCards = updateCardContent(nextCards, rootNonAi.id, '【範例】修改後主卡內容');
      nextCards = updateCardColor(nextCards, rootNonAi.id, '#98c379');
      nextCards = deleteCard(nextCards, childNonAi.id);
      nextCards = addCard(nextCards, {
        id: 'sample-added-1',
        category: rootNonAi.category,
        title: '【範例】新增同層卡 1',
        content: '【範例】新增內容 1',
      });
      nextCards = addCard(nextCards, {
        id: 'sample-added-2',
        category: rootNonAi.category,
        title: '【範例】新增同層卡 2',
        content: '【範例】新增內容 2',
      });
      nextCards = moveCardUp(nextCards, 'sample-added-2');
      nextCards = moveCardDown(nextCards, rootNonAi.id);

      writeFileProject(db.sql, loaded.info, loaded.tree, nextCards, loaded.logs);

      const afterAiRows = db.sql
        .select("SELECT * FROM cards WHERE category = 'ai_chat' ORDER BY id")
        .map((r) => JSON.stringify(r));
      expect(afterAiRows).toEqual(beforeAiRows);

      const reloaded = readFileProject(db.sql);
      const reloadedAi = reloaded.cards
        .filter((c) => c.category === 'ai_chat')
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(reloadedAi.map((c) => JSON.stringify(c))).toEqual(
        loaded.cards
          .filter((c) => c.category === 'ai_chat')
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((c) => JSON.stringify(c)),
      );

      // category_order 裡的 ai_chat 還在原位置（索引 4）
      const orderAfter = parseCategoryOrder(reloaded.info.categoryOrder);
      expect(orderAfter.codes.indexOf('ai_chat')).toBe(4);

      // 手機畫面層（cards.ts 的過濾）仍看不到 ai_chat
      expect(isCategoryHidden('ai_chat')).toBe(true);
      const allCategoriesForFilter = orderAfter.codes.map((code, idx) => ({
        id: code,
        name: code,
        sort_order: idx + 1,
      }));
      const visibleAfterFilter = filterVisibleCategories(allCategoriesForFilter);
      expect(visibleAfterFilter.some((c) => c.id === 'ai_chat')).toBe(false);
    } finally {
      db.close();
    }
  });

  it('P0-2 category_order／expanded_categories／categories_meta 不被覆蓋或清空：未改原樣寫回（含 NULL）、淺層改名保留未知鍵、非法 JSON 原文寫回', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      // 1. 沒改分類時寫回與原文字串完全相同
      const loaded1 = readFileProject(db.sql);
      const origOrder = loaded1.info.categoryOrder;
      const origExpanded = loaded1.info.expandedCategories;
      const origMeta = loaded1.info.categoriesMeta;
      writeFileProject(db.sql, loaded1.info, loaded1.tree, loaded1.cards, loaded1.logs);
      const row1 = db.sql.select('SELECT category_order, expanded_categories, categories_meta FROM project_info')[0]!;
      expect(row1.category_order).toBe(origOrder);
      expect(row1.expanded_categories).toBe(origExpanded);
      expect(row1.categories_meta).toBe(origMeta);

      // 2. 當欄位為 NULL 時，未改動寫回仍維持 NULL
      db.sql.run('UPDATE project_info SET category_order = NULL, expanded_categories = NULL');
      const loadedNull = readFileProject(db.sql);
      expect(loadedNull.info.categoryOrder).toBeNull();
      expect(loadedNull.info.expandedCategories).toBeNull();
      writeFileProject(db.sql, loadedNull.info, loadedNull.tree, loadedNull.cards, loadedNull.logs);
      const rowNull = db.sql.select('SELECT category_order, expanded_categories FROM project_info')[0]!;
      expect(rowNull.category_order).toBeNull();
      expect(rowNull.expanded_categories).toBeNull();

      // 3. 改了自訂分類名稱時，其他鍵與未知鍵都在
      const metaWithUnknown = JSON.stringify({
        [SAMPLE_CUSTOM_CATEGORY_CODE]: SAMPLE_CUSTOM_CATEGORY_NAME,
        custom_99887766: '【範例】分類二',
        desktop_only_config: { pinned: true, count: 3 },
      });
      db.sql.run('UPDATE project_info SET categories_meta = ?', [metaWithUnknown]);
      const loadedMeta = readFileProject(db.sql);
      const parsedMeta = parseCategoriesMeta(loadedMeta.info.categoriesMeta);
      const updatedMeta = setCustomCategoryName(
        parsedMeta,
        SAMPLE_CUSTOM_CATEGORY_CODE,
        '【範例】改名後的自訂分類',
      );
      const nextMetaStr = serializeCategoriesMeta(updatedMeta) ?? '{}';
      writeFileProject(
        db.sql,
        { ...loadedMeta.info, categoriesMeta: nextMetaStr },
        loadedMeta.tree,
        loadedMeta.cards,
        loadedMeta.logs,
      );
      const rowMeta = db.sql.select('SELECT categories_meta FROM project_info')[0]!;
      expect(JSON.parse(String(rowMeta.categories_meta))).toEqual({
        [SAMPLE_CUSTOM_CATEGORY_CODE]: '【範例】改名後的自訂分類',
        custom_99887766: '【範例】分類二',
        desktop_only_config: { pinned: true, count: 3 },
      });

      // 4. 非法 JSON 原文寫回
      const brokenOrder = '["summary", broken';
      const brokenMeta = `{"${SAMPLE_CUSTOM_CATEGORY_CODE}": unclosed`;
      db.sql.run('UPDATE project_info SET category_order = ?, categories_meta = ?', [brokenOrder, brokenMeta]);
      const loadedBroken = readFileProject(db.sql);
      const tryOrder = parseCategoryOrder(loadedBroken.info.categoryOrder);
      const tryMeta = setCustomCategoryName(
        parseCategoriesMeta(loadedBroken.info.categoriesMeta),
        SAMPLE_CUSTOM_CATEGORY_CODE,
        '【範例】不會寫入',
      );
      writeFileProject(
        db.sql,
        {
          ...loadedBroken.info,
          categoryOrder: serializeCategoryOrder(tryOrder),
          categoriesMeta: serializeCategoriesMeta(tryMeta) ?? '',
        },
        loadedBroken.tree,
        loadedBroken.cards,
        loadedBroken.logs,
      );
      const rowBroken = db.sql.select('SELECT category_order, categories_meta FROM project_info')[0]!;
      expect(rowBroken.category_order).toBe(brokenOrder);
      expect(rowBroken.categories_meta).toBe(brokenMeta);
    } finally {
      db.close();
    }
  });

  it('P0-3 未知欄位與未知資料表不被洗掉：ALTER TABLE 新增未知欄位並另建未知資料表，讀入改卡片寫回後逐列不變', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      db.sql.exec("ALTER TABLE cards ADD COLUMN desktop_card_extra TEXT DEFAULT 'card_default'");
      db.sql.exec('ALTER TABLE project_info ADD COLUMN desktop_info_extra INTEGER DEFAULT 77');
      db.sql.exec("ALTER TABLE chapters ADD COLUMN desktop_chapter_extra TEXT DEFAULT 'ch_default'");
      db.sql.exec(`CREATE TABLE desktop_future_feature (
        id TEXT PRIMARY KEY,
        payload TEXT,
        created_num INTEGER
      )`);

      db.sql.run('UPDATE cards SET desktop_card_extra = ? WHERE parent_id IS NULL', ['【範例】父卡未知欄']);
      db.sql.run('UPDATE cards SET desktop_card_extra = ? WHERE parent_id IS NOT NULL', ['【範例】子卡未知欄']);
      db.sql.run('UPDATE project_info SET desktop_info_extra = ?', [888]);
      db.sql.run('UPDATE chapters SET desktop_chapter_extra = ?', ['【範例】章節未知欄']);
      db.sql.run(
        'INSERT INTO desktop_future_feature (id, payload, created_num) VALUES (?, ?, ?)',
        ['f-1', '【範例】未來功能資料列一', 101],
      );
      db.sql.run(
        'INSERT INTO desktop_future_feature (id, payload, created_num) VALUES (?, ?, ?)',
        ['f-2', '【範例】未來功能資料列二', 202],
      );

      const beforeFutureTable = db.sql.select('SELECT * FROM desktop_future_feature ORDER BY id');
      const beforeChapterExtras = db.sql.select('SELECT id, desktop_chapter_extra FROM chapters ORDER BY id');

      const loaded = readFileProject(db.sql);
      // 驗證 cards.extraColumns 也有把未知欄位讀出來
      const parentCard = loaded.cards.find((c) => c.parent_id === null)!;
      expect(parentCard.extraColumns?.desktop_card_extra).toBe('【範例】父卡未知欄');

      // 修改卡片內容再寫回
      const updatedCards = updateCardTitle(loaded.cards, parentCard.id, '【範例】改過標題但保留未知欄');
      writeFileProject(db.sql, loaded.info, loaded.tree, updatedCards, loaded.logs);

      // 驗證未知資料表逐列不變
      const afterFutureTable = db.sql.select('SELECT * FROM desktop_future_feature ORDER BY id');
      expect(afterFutureTable).toEqual(beforeFutureTable);

      // 驗證三張表的未知欄位值完全不變
      const afterInfoExtra = db.sql.select('SELECT desktop_info_extra FROM project_info')[0];
      expect(afterInfoExtra?.desktop_info_extra).toBe(888);

      const afterChapterExtras = db.sql.select('SELECT id, desktop_chapter_extra FROM chapters ORDER BY id');
      expect(afterChapterExtras).toEqual(beforeChapterExtras);

      const afterParentCardRow = db.sql.select(
        'SELECT title, desktop_card_extra FROM cards WHERE id = ?',
        [parentCard.id],
      )[0];
      expect(afterParentCardRow?.title).toBe('【範例】改過標題但保留未知欄');
      expect(afterParentCardRow?.desktop_card_extra).toBe('【範例】父卡未知欄');

      const afterChildCardRow = db.sql.select(
        'SELECT desktop_card_extra FROM cards WHERE parent_id = ?',
        [parentCard.id],
      )[0];
      expect(afterChildCardRow?.desktop_card_extra).toBe('【範例】子卡未知欄');
    } finally {
      db.close();
    }
  });

  it('P0-5 顏色格式與電腦版相同：範例檔的非預設色與預設色寫回大小寫不變；手機改色存成 #rrggbb；新卡預設 #3C3F41；不合格色碼不寫入', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const loaded = readFileProject(db.sql);
      const colorsBefore = loaded.cards.map((c) => c.color);
      expect(colorsBefore).toContain(SAMPLE_NON_DEFAULT_COLOR);
      expect(colorsBefore).toContain(SAMPLE_DEFAULT_COLOR);

      // 原樣寫回大小寫不變
      writeFileProject(db.sql, loaded.info, loaded.tree, loaded.cards, loaded.logs);
      const rowsAfterUnchanged = db.sql.select('SELECT id, color FROM cards');
      expect(rowsAfterUnchanged.map((r) => r.color)).toContain(SAMPLE_NON_DEFAULT_COLOR);
      expect(rowsAfterUnchanged.map((r) => r.color)).toContain(SAMPLE_DEFAULT_COLOR);

      // 新卡預設 #3C3F41
      const parentCard = loaded.cards.find((c) => c.parent_id === null)!;
      let cards = addSubCard(loaded.cards, parentCard.id, {
        id: 'new-sub-card',
        title: '【範例】新子卡',
      });
      expect(cards.find((c) => c.id === 'new-sub-card')?.color).toBe(DEFAULT_CARD_COLOR);
      expect(DEFAULT_CARD_COLOR).toBe('#3C3F41');

      // 不合格色碼不寫入
      cards = updateCardColor(cards, parentCard.id, '#410');
      cards = updateCardColor(cards, parentCard.id, 'red');
      expect(cards.find((c) => c.id === parentCard.id)?.color).toBe(parentCard.color);

      // 手機改色存成 #rrggbb
      cards = updateCardColor(cards, 'new-sub-card', '#61afef');
      writeFileProject(db.sql, loaded.info, loaded.tree, cards, loaded.logs);

      const newCardRow = db.sql.select('SELECT color FROM cards WHERE id = ?', ['new-sub-card'])[0];
      expect(newCardRow?.color).toBe('#61afef');
    } finally {
      db.close();
    }
  });

  it('P0-6 交易：寫回中途故意讓一筆失敗，資料庫回到寫之前的狀態（卡片、章節、project_info 都沒少）', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const beforeTables = dumpAllTablesExceptSequence(db.sql);
      const beforeFk = db.sql.select('PRAGMA foreign_keys')[0]?.foreign_keys;
      const loaded = readFileProject(db.sql);

      // 包裝 Sql，在寫回 cards 的中途故意拋出例外
      let cardWriteCount = 0;
      const failingSql: Sql = {
        exec: (statement) => db.sql.exec(statement),
        select: (statement, params) => db.sql.select(statement, params),
        run: (statement, params) => {
          if (statement.includes('INTO cards') || statement.includes('UPDATE cards')) {
            cardWriteCount += 1;
            if (cardWriteCount >= 2) {
              throw new Error('【範例】模擬寫回卡片中途失敗');
            }
          }
          db.sql.run(statement, params);
        },
      };

      const modifiedInfo = { ...loaded.info, title: '【範例】不應留下的書名' };
      const modifiedTree = loaded.tree.map((node, i) =>
        i === 0 ? { ...node, title: '【範例】不應留下的章名', content: '【範例】不應留下的正文' } : node,
      );
      const modifiedCards = addCard(
        updateCardTitle(loaded.cards, loaded.cards[0]!.id, '【範例】不應留下的卡名'),
        {
          id: 'should-rollback-card',
          category: 'summary',
          title: '【範例】不應留下的新卡',
        },
      );

      expect(() => {
        writeFileProject(failingSql, modifiedInfo, modifiedTree, modifiedCards, loaded.logs);
      }).toThrow('【範例】模擬寫回卡片中途失敗');

      // 驗證資料庫完整 ROLLBACK 回到寫之前的狀態，且 PRAGMA foreign_keys 前後一致
      const afterTables = dumpAllTablesExceptSequence(db.sql);
      expect(afterTables).toEqual(beforeTables);
      const afterFk = db.sql.select('PRAGMA foreign_keys')[0]?.foreign_keys;
      expect(afterFk).toBe(beforeFk);
    } finally {
      db.close();
    }
  });

  it('P1-1 範例書與新開的稿子在升格（promote-stored）前已有卡片時，升格後卡片與分類設定都還在，寫進 .db 再讀回逐欄相同', async () => {
    const sampleCards: FileCard[] = [
      {
        id: '11111111-2222-4333-8444-555555555555',
        parent_id: null,
        category: SAMPLE_CUSTOM_CATEGORY_CODE,
        title: '【範例】升格前主卡片',
        content: '【範例】升格前主卡內容',
        color: SAMPLE_NON_DEFAULT_COLOR,
        is_collapsed: 0,
        sort_order: 0,
      },
      {
        id: '66666666-7777-4888-9999-aaaaaaaaaaaa',
        parent_id: '11111111-2222-4333-8444-555555555555',
        category: SAMPLE_CUSTOM_CATEGORY_CODE,
        title: '【範例】升格前子卡片',
        content: '【範例】升格前子卡內容',
        color: SAMPLE_DEFAULT_COLOR,
        is_collapsed: 1,
        sort_order: 0,
      },
    ];
    const sampleOrderRaw = JSON.stringify(SAMPLE_CATEGORY_ORDER_CODES);
    const sampleExpandedRaw = JSON.stringify([SAMPLE_CUSTOM_CATEGORY_CODE]);
    const sampleMetaRaw = JSON.stringify({ [SAMPLE_CUSTOM_CATEGORY_CODE]: '【範例】自訂分類' });

    // 1. 測試範例書（fog）在升格前已有卡片與分類設定
    let state = createState(new Date('2026-11-11T10:00:00Z'));
    state = {
      ...state,
      projects: state.projects.map((p) =>
        p.id === 'fog'
          ? {
              ...p,
              cards: sampleCards,
              categoryOrderRaw: sampleOrderRaw,
              expandedCategoriesRaw: sampleExpandedRaw,
              categoriesMetaRaw: sampleMetaRaw,
            }
          : p,
      ),
    };
    state = reduce(state, {
      type: 'promote-stored',
      projectId: 'fog',
      key: 'fog-db-key',
      filename: '【範例】霧港紀事.db',
    });

    const fogExtras = state.fileExtras['fog-db-key'];
    expect(fogExtras).toBeDefined();
    expect(fogExtras!.cards).toEqual(sampleCards);
    expect(fogExtras!.info.categoryOrder).toBe(sampleOrderRaw);
    expect(fogExtras!.info.expandedCategories).toBe(sampleExpandedRaw);
    expect(fogExtras!.info.categoriesMeta).toBe(sampleMetaRaw);

    // 2. 測試新開的稿子在升格前已有卡片與分類設定，並寫進 .db 再讀回逐欄相同
    state = reduce(state, {
      type: 'add-project',
      id: 'new-book-1',
      title: '【範例】新開的稿子',
      shape: 'novel',
    });
    state = {
      ...state,
      projects: state.projects.map((p) =>
        p.id === 'new-book-1'
          ? {
              ...p,
              cards: sampleCards,
              categoryOrderRaw: sampleOrderRaw,
              expandedCategoriesRaw: sampleExpandedRaw,
              categoriesMetaRaw: sampleMetaRaw,
            }
          : p,
      ),
    };
    state = reduce(state, {
      type: 'promote-stored',
      projectId: 'new-book-1',
      key: 'new-book-1-key',
      filename: '【範例】新開的稿子.db',
    });

    const newBookProject = state.projects.find((p) => p.id === 'new-book-1')!;
    const newBookExtras = state.fileExtras['new-book-1-key']!;
    expect(newBookExtras.cards).toEqual(sampleCards);

    const memDb = await openMemoryDb(new Uint8Array());
    try {
      writeFileProject(
        memDb.sql,
        newBookExtras.info,
        newBookProject.nodes,
        newBookExtras.cards,
        newBookExtras.logs,
      );
      const reloaded = readFileProject(memDb.sql);
      expect(reloaded.cards).toEqual(sampleCards);
      expect(reloaded.info.categoryOrder).toBe(sampleOrderRaw);
      expect(reloaded.info.expandedCategories).toBe(sampleExpandedRaw);
      expect(reloaded.info.categoriesMeta).toBe(sampleMetaRaw);
    } finally {
      memDb.close();
    }
  });

  it('既有存檔回歸：舊格式範例書（v1 升 v14）存回後章節、正文、寫作紀錄與快照校對表皆不變', () => {
    const { sql } = openNodeSql();
    createVersion1(sql);
    const loadedFromV1 = readFileProject(sql);
    expect(loadedFromV1.info.title).toBe('【範例】舊檔');
    expect(loadedFromV1.tree).toHaveLength(1);
    expect(loadedFromV1.tree[0]?.title).toBe('第一章　信');
    expect(loadedFromV1.tree[0]?.content).toBe('【範例】霧港只有這一句。');
    expect(loadedFromV1.logs).toHaveLength(1);
    expect(loadedFromV1.logs[0]?.date).toBe('2026-01-02');
    expect(loadedFromV1.logs[0]?.duration).toBe(60);
    expect(loadedFromV1.logs[0]?.word_count).toBe(10);

    // 存回後再讀出，章節、正文、寫作紀錄全部不變
    writeFileProject(
      sql,
      loadedFromV1.info,
      loadedFromV1.tree,
      loadedFromV1.cards,
      loadedFromV1.logs,
    );
    const reloaded = readFileProject(sql);
    expect(reloaded.info.title).toBe('【範例】舊檔');
    expect(reloaded.tree).toEqual(loadedFromV1.tree);
    expect(reloaded.logs).toEqual(loadedFromV1.logs);

    // 同時驗證 v14 完整章節樹、幕資訊、寫作紀錄、快照、校對表存回後都不變
    const { sql: sql14 } = openNodeSql();
    createVersion14Shell(sql14);
    sql14.run(
      `INSERT INTO project_info (title, logline, target_word_count, daily_target_word_count, categories_meta, last_opened_node_id, last_cursor_position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['【範例】回歸測試書', '【範例】大綱一句話', 80000, 1500, '{}', 'sc-1', 12],
    );
    sql14.run(
      `INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, scene_summary, scene_pov, scene_location, is_expanded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ch-1', null, '第一章　起風', 'file', '【範例】第一章正文。', '2nd Edit', 0, '', '', '', 1],
    );
    sql14.run(
      `INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, scene_summary, scene_pov, scene_location, is_expanded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['sc-1', 'ch-1', '幕 1　碼頭', 'scene', '【範例】第一幕正文。', 'Draft', 0, '【範例】幕摘要', '沈雨晴', '霧港北碼頭', 1],
    );
    sql14.run(
      `INSERT INTO writing_logs (date, duration, word_count, ai_continuation_count, ai_continuation_chars, ai_chat_count, ai_details, paste_large_count, delete_large_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['2026-11-01', 1800, 500, 1, 120, 2, '{"model":"demo"}', 1, 0],
    );
    sql14.run(
      'INSERT INTO snapshots (name, note, timestamp, word_count, project_data) VALUES (?, ?, ?, ?, ?)',
      ['【範例】快照一', '【範例】備註', '2026-11-01 12:00:00', 500, '{"snap":1}'],
    );
    sql14.run(
      `INSERT INTO proofread_results (id, category, node_id, chapter_name, char_offset, match_len, original_text, suggestion, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pr-1', 'typo', 'sc-1', '幕 1　碼頭', 2, 2, '範例', '範例', '【範例】理由', 'pending', '2026-11-01'],
    );

    const snapBefore = snapshotFingerprints(sql14);
    const proofBefore = proofFingerprints(sql14);
    const loaded14 = readFileProject(sql14);
    writeFileProject(sql14, loaded14.info, loaded14.tree, loaded14.cards, loaded14.logs);
    const after14 = readFileProject(sql14);

    expect(after14.info).toEqual(loaded14.info);
    expect(after14.tree).toEqual(loaded14.tree);
    expect(after14.tree[0]?.children?.[0]?.sceneSummary).toBe('【範例】幕摘要');
    expect(after14.tree[0]?.children?.[0]?.scenePov).toBe('沈雨晴');
    expect(after14.tree[0]?.children?.[0]?.sceneLocation).toBe('霧港北碼頭');
    expect(after14.logs).toEqual(loaded14.logs);
    expect(snapshotFingerprints(sql14)).toEqual(snapBefore);
    expect(proofFingerprints(sql14)).toEqual(proofBefore);
  });

  it('WO-52 (a) 空值與預設值、章節未知欄位：原欄為 NULL 改為預設值必寫入，未改維持 NULL（含展開複製與 JSON 重載），且章節 extraColumns 跨實例 INSERT 不遺失', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      // 1. 將 project_info 與 chapters 多個欄位設為 NULL
      db.sql.run(
        `UPDATE project_info
         SET target_word_count = NULL,
             daily_target_word_count = NULL,
             global_font_size = NULL,
             editor_font_size = NULL,
             logline = NULL`,
      );
      db.sql.run(
        `UPDATE chapters
         SET scene_summary = NULL,
             scene_pov = NULL,
             scene_location = NULL,
             is_expanded = NULL,
             mark = NULL`,
      );
      db.sql.exec("ALTER TABLE chapters ADD COLUMN desktop_ch_extra TEXT DEFAULT 'ch_def'");
      db.sql.exec('ALTER TABLE chapters ADD COLUMN desktop_ch_num INTEGER DEFAULT 0');
      db.sql.run('UPDATE chapters SET desktop_ch_extra = ?, desktop_ch_num = ?', [
        '【範例】章節跨實例未知欄',
        42,
      ]);

      const loaded = readFileProject(db.sql);
      // 讀出時提供預設值供畫面層使用
      expect(loaded.info.targetWordCount).toBe(100000);
      expect(loaded.info.dailyTargetWordCount).toBe(1000);
      expect(loaded.info.globalFontSize).toBe(12);
      expect(loaded.info.editorFontSize).toBe(12);
      expect(loaded.info.logline).toBe('');
      expect(loaded.tree[0]?.sceneSummary).toBe('');
      expect(loaded.tree[0]?.expanded).toBe(true);
      expect(loaded.tree[0]?.extraColumns).toEqual({
        desktop_ch_extra: '【範例】章節跨實例未知欄',
        desktop_ch_num: 42,
      });

      // 2. 經過 { ...info }、renameNode（{ ...node }）展開複製與 JSON 序列化／反序列化，只改書名與章名，未改動的 NULL 欄位仍維持 NULL
      const spreadInfo = JSON.parse(
        JSON.stringify({ ...loaded.info, title: '【範例】展開與序列化後書名' }),
      );
      const renamedTree = JSON.parse(
        JSON.stringify(renameNode(loaded.tree, loaded.tree[0]!.id, '【範例】展開與序列化後章名')!),
      );
      writeFileProject(db.sql, spreadInfo, renamedTree, loaded.cards, loaded.logs);

      const infoAfterUnchangedNull = db.sql.select('SELECT * FROM project_info')[0]!;
      expect(infoAfterUnchangedNull.title).toBe('【範例】展開與序列化後書名');
      expect(infoAfterUnchangedNull.target_word_count).toBeNull();
      expect(infoAfterUnchangedNull.daily_target_word_count).toBeNull();
      expect(infoAfterUnchangedNull.global_font_size).toBeNull();
      expect(infoAfterUnchangedNull.editor_font_size).toBeNull();
      expect(infoAfterUnchangedNull.logline).toBeNull();

      const chAfterUnchangedNull = db.sql.select(
        'SELECT * FROM chapters WHERE id = ?',
        [loaded.tree[0]!.id],
      )[0]!;
      expect(chAfterUnchangedNull.name).toBe('【範例】展開與序列化後章名');
      expect(chAfterUnchangedNull.scene_summary).toBeNull();
      expect(chAfterUnchangedNull.scene_pov).toBeNull();
      expect(chAfterUnchangedNull.scene_location).toBeNull();
      expect(chAfterUnchangedNull.is_expanded).toBeNull();
      expect(chAfterUnchangedNull.mark).toBeNull();

      // 3. 手機端將原為 NULL 的欄位明確改成「剛好等於預設值」（含展開複製與 JSON 重載後設定），寫回必須真正寫入該預設值，不可留 NULL
      const reloaded2 = readFileProject(db.sql);
      const infoSetToDefaults = {
        ...JSON.parse(JSON.stringify(reloaded2.info)),
        targetWordCount: 100000,
        dailyTargetWordCount: 1000,
        globalFontSize: 12,
      };
      const treeSetToDefaults = reloaded2.tree.map((node, idx) =>
        idx === 0
          ? {
              ...JSON.parse(JSON.stringify({ ...node })),
              sceneSummary: '',
              expanded: true,
            }
          : node,
      );
      writeFileProject(db.sql, infoSetToDefaults, treeSetToDefaults, reloaded2.cards, reloaded2.logs);

      const infoAfterSetDefaults = db.sql.select('SELECT * FROM project_info')[0]!;
      expect(infoAfterSetDefaults.target_word_count).toBe(100000);
      expect(infoAfterSetDefaults.daily_target_word_count).toBe(1000);
      expect(infoAfterSetDefaults.global_font_size).toBe(12);
      // 未改動的 editor_font_size 與 logline 仍維持 NULL
      expect(infoAfterSetDefaults.editor_font_size).toBeNull();
      expect(infoAfterSetDefaults.logline).toBeNull();

      // 也驗證直接屬性賦值（reloaded3.info.editorFontSize = 12）
      const reloaded3 = readFileProject(db.sql);
      reloaded3.info.editorFontSize = 12;
      writeFileProject(db.sql, reloaded3.info, reloaded3.tree, reloaded3.cards, reloaded3.logs);
      const infoAfterDirectSet = db.sql.select('SELECT * FROM project_info')[0]!;
      expect(infoAfterDirectSet.editor_font_size).toBe(12);
      expect(infoAfterDirectSet.logline).toBeNull();

      const chAfterSetDefaults = db.sql.select(
        'SELECT * FROM chapters WHERE id = ?',
        [reloaded2.tree[0]!.id],
      )[0]!;
      expect(chAfterSetDefaults.scene_summary).toBe('');
      expect(chAfterSetDefaults.is_expanded).toBe(1);
      // 未改動的 scene_pov、scene_location、mark 仍維持 NULL
      expect(chAfterSetDefaults.scene_pov).toBeNull();
      expect(chAfterSetDefaults.scene_location).toBeNull();
      expect(chAfterSetDefaults.mark).toBeNull();

      // 4. 章節 extraColumns 經過 { ...node } 複製與 JSON.stringify／JSON.parse 後，寫入另一個尚無該列但有相同未知欄位的資料庫實例（走 INSERT）仍完整保留
      const clonedTreeForNewDb = JSON.parse(
        JSON.stringify(reloaded3.tree.map((node) => ({ ...node }))),
      );
      const { sql: targetSql } = openNodeSql();
      createVersion14Shell(targetSql);
      targetSql.exec("ALTER TABLE chapters ADD COLUMN desktop_ch_extra TEXT DEFAULT 'ch_def'");
      targetSql.exec('ALTER TABLE chapters ADD COLUMN desktop_ch_num INTEGER DEFAULT 0');

      writeFileProject(
        targetSql,
        reloaded3.info,
        clonedTreeForNewDb,
        reloaded3.cards,
        reloaded3.logs,
      );

      const insertedChapters = targetSql.select(
        'SELECT id, desktop_ch_extra, desktop_ch_num FROM chapters ORDER BY sort_order, id',
      );
      expect(insertedChapters.length).toBeGreaterThan(0);
      for (const row of insertedChapters) {
        expect(row.desktop_ch_extra).toBe('【範例】章節跨實例未知欄');
        expect(row.desktop_ch_num).toBe(42);
      }
    } finally {
      db.close();
    }
  });

  it('WO-52 (b) 更新既有列只寫已知且有變的欄位，且二進位（BLOB）未知欄位在 node:sqlite 與 wasm 皆原樣保留（含 typeof 為 blob）', async () => {
    const sampleBlob = new Uint8Array([0x00, 0xff, 0x10, 0x42, 0x7f]);

    const runBlobAndPartialUpdateCheck = (sql: Sql, targetEmptySql: Sql) => {
      sql.exec('ALTER TABLE cards ADD COLUMN raw_blob BLOB');
      sql.exec('ALTER TABLE chapters ADD COLUMN raw_blob BLOB');
      sql.exec('ALTER TABLE project_info ADD COLUMN raw_blob BLOB');

      sql.run('UPDATE cards SET raw_blob = ?', [sampleBlob]);
      sql.run('UPDATE chapters SET raw_blob = ?', [sampleBlob]);
      sql.run('UPDATE project_info SET raw_blob = ?', [sampleBlob]);

      expect(sql.select('SELECT typeof(raw_blob) AS t FROM project_info')[0]?.t).toBe('blob');
      expect(sql.select('SELECT typeof(raw_blob) AS t FROM chapters LIMIT 1')[0]?.t).toBe('blob');
      expect(sql.select('SELECT typeof(raw_blob) AS t FROM cards LIMIT 1')[0]?.t).toBe('blob');

      const loaded = readFileProject(sql);
      // 確認畫面層已知欄位不會拿到 Uint8Array
      expect(loaded.info.title).not.toBeInstanceOf(Uint8Array);
      expect(loaded.tree[0]?.title).not.toBeInstanceOf(Uint8Array);
      expect(loaded.cards[0]?.title).not.toBeInstanceOf(Uint8Array);

      const updateStatements: string[] = [];
      const trackingSql: Sql = {
        exec: (statement) => sql.exec(statement),
        select: (statement, params) => sql.select(statement, params),
        run: (statement, params) => {
          if (/^\s*UPDATE\b/i.test(statement)) {
            updateStatements.push(statement);
          }
          sql.run(statement, params);
        },
      };

      // 只修改 project_info 的 title、第 1 章的章名、第 1 張卡的標題
      const nextInfo = { ...loaded.info, title: '【範例】測試局部更新書名' };
      const nextTree = renameNode(loaded.tree, loaded.tree[0]!.id, '【範例】測試局部更新章名')!;
      const nextCards = updateCardTitle(loaded.cards, loaded.cards[0]!.id, '【範例】測試局部更新卡名');

      writeFileProject(trackingSql, nextInfo, nextTree, nextCards, loaded.logs);

      // 驗證 UPDATE 語句只出現真正有變動的已知欄位，不包含未變欄位與 raw_blob
      const infoUpdates = updateStatements.filter((s) => s.includes('UPDATE project_info'));
      const chapterUpdates = updateStatements.filter((s) => s.includes('UPDATE chapters'));
      const cardUpdates = updateStatements.filter((s) => s.includes('UPDATE cards'));

      expect(infoUpdates).toEqual(['UPDATE project_info SET title = ? WHERE id = ?']);
      expect(chapterUpdates).toEqual(['UPDATE chapters SET name = ? WHERE id = ?']);
      expect(cardUpdates).toEqual(['UPDATE cards SET title = ? WHERE id = ?']);
      expect(updateStatements.some((s) => s.includes('raw_blob'))).toBe(false);

      // 驗證寫回後三張表的 raw_blob 型別仍是 blob（未變成 text），且位元組內容完全相同
      const infoBlobRow = sql.select('SELECT raw_blob, typeof(raw_blob) AS t FROM project_info')[0]!;
      expect(infoBlobRow.t).toBe('blob');
      expect(new Uint8Array(infoBlobRow.raw_blob as Uint8Array)).toEqual(sampleBlob);

      for (const row of sql.select('SELECT raw_blob, typeof(raw_blob) AS t FROM chapters')) {
        expect(row.t).toBe('blob');
        expect(new Uint8Array(row.raw_blob as Uint8Array)).toEqual(sampleBlob);
      }
      for (const row of sql.select('SELECT raw_blob, typeof(raw_blob) AS t FROM cards')) {
        expect(row.t).toBe('blob');
        expect(new Uint8Array(row.raw_blob as Uint8Array)).toEqual(sampleBlob);
      }

      // 同時驗證新列（INSERT）帶 extraColumns 時，BLOB 寫進新資料庫實例也維持 blob 型別與相同位元組
      createVersion14Shell(targetEmptySql);
      targetEmptySql.exec('ALTER TABLE cards ADD COLUMN raw_blob BLOB');
      targetEmptySql.exec('ALTER TABLE chapters ADD COLUMN raw_blob BLOB');
      targetEmptySql.exec('ALTER TABLE project_info ADD COLUMN raw_blob BLOB');
      // 先清空預設 project_info 列以測試 INSERT 路徑
      targetEmptySql.exec('DELETE FROM project_info');

      writeFileProject(targetEmptySql, nextInfo, nextTree, nextCards, loaded.logs);

      const insertedInfoBlob = targetEmptySql.select(
        'SELECT raw_blob, typeof(raw_blob) AS t FROM project_info',
      )[0]!;
      expect(insertedInfoBlob.t).toBe('blob');
      expect(new Uint8Array(insertedInfoBlob.raw_blob as Uint8Array)).toEqual(sampleBlob);

      const insertedChapterBlob = targetEmptySql.select(
        'SELECT raw_blob, typeof(raw_blob) AS t FROM chapters LIMIT 1',
      )[0]!;
      expect(insertedChapterBlob.t).toBe('blob');
      expect(new Uint8Array(insertedChapterBlob.raw_blob as Uint8Array)).toEqual(sampleBlob);

      const insertedCardBlob = targetEmptySql.select(
        'SELECT raw_blob, typeof(raw_blob) AS t FROM cards LIMIT 1',
      )[0]!;
      expect(insertedCardBlob.t).toBe('blob');
      expect(new Uint8Array(insertedCardBlob.raw_blob as Uint8Array)).toEqual(sampleBlob);
    };

    // 1. wasm（openMemoryDb）環境驗證
    const wasmDb = await openDesktopSampleMemoryDb();
    const wasmTargetDb = await openMemoryDb(new Uint8Array());
    try {
      runBlobAndPartialUpdateCheck(wasmDb.sql, wasmTargetDb.sql);
    } finally {
      wasmDb.close();
      wasmTargetDb.close();
    }

    // 2. node:sqlite（openNodeSql）環境驗證
    const { sql: nodeSql } = openNodeSql();
    const { sql: nodeTargetSql } = openNodeSql();
    createVersion14Shell(nodeSql);
    nodeSql.run(
      'INSERT INTO project_info (title, logline, categories_meta) VALUES (?, ?, ?)',
      ['【範例】Node 書籍', '【範例】簡介', '{}'],
    );
    nodeSql.run(
      `INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, scene_summary, scene_pov, scene_location, is_expanded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'ch-n1', null, '第一章', 'file', '【範例】內文一', 'Draft', 0, '', '', '', 1,
        'ch-n2', null, '第二章', 'file', '【範例】內文二', 'Draft', 1, '', '', '', 1,
      ],
    );
    nodeSql.run(
      `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'card-n1', null, 'character', '【範例】卡一', '內容一', '#3C3F41', 0, 0,
        'card-n2', null, 'world', '【範例】卡二', '內容二', '#3C3F41', 0, 1,
      ],
    );
    runBlobAndPartialUpdateCheck(nodeSql, nodeTargetSql);
  });

  it('WO-52 (c) categories_meta 中非自訂分類代碼的鍵不當成分類顯示，但寫回資料庫時照原樣保留；孤兒分類代碼仍附在最後（ai_chat 除外）', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const metaRaw = JSON.stringify({
        [SAMPLE_CUSTOM_CATEGORY_CODE]: SAMPLE_CUSTOM_CATEGORY_NAME,
        custom_a1b2c3d4: '【範例】第二自訂分類',
        theme_preference: 'dark',
        panel_layout: 'compact',
        custom_short: '太短不合規則',
        custom_UPPER123: '大寫不合規則',
      });
      db.sql.run('UPDATE project_info SET categories_meta = ?', [metaRaw]);
      db.sql.run(
        `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?),
                (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'orphan-card-1', null, 'legacy_orphan_cat', '【範例】孤兒分類卡', '', '#3C3F41', 0, 10,
          'ai-card-hidden', null, 'ai_chat', '【範例】AI 對話卡', '', '#3C3F41', 0, 11,
        ],
      );

      const loaded = readFileProject(db.sql);
      const visible = resolveVisibleCategories({
        categoryOrder: loaded.info.categoryOrder,
        categoriesMeta: loaded.info.categoriesMeta,
        cards: loaded.cards,
      });

      const visibleIds = visible.map((c) => c.id);
      expect(visibleIds).toEqual([
        'summary',
        'character',
        'world',
        'timeline',
        SAMPLE_CUSTOM_CATEGORY_CODE,
        'custom_a1b2c3d4',
        'legacy_orphan_cat',
      ]);
      expect(visibleIds).not.toContain('theme_preference');
      expect(visibleIds).not.toContain('panel_layout');
      expect(visibleIds).not.toContain('custom_short');
      expect(visibleIds).not.toContain('custom_UPPER123');
      expect(visibleIds).not.toContain('ai_chat');

      // 改名自訂分類後寫回，非分類字串鍵照原樣保留
      const updatedMeta = setCustomCategoryName(
        parseCategoriesMeta(loaded.info.categoriesMeta),
        SAMPLE_CUSTOM_CATEGORY_CODE,
        '【範例】改名後分類001',
      );
      writeFileProject(
        db.sql,
        { ...loaded.info, categoriesMeta: serializeCategoriesMeta(updatedMeta) ?? '{}' },
        loaded.tree,
        loaded.cards,
        loaded.logs,
      );

      const savedMetaRow = db.sql.select('SELECT categories_meta FROM project_info')[0]!;
      expect(JSON.parse(String(savedMetaRow.categories_meta))).toEqual({
        [SAMPLE_CUSTOM_CATEGORY_CODE]: '【範例】改名後分類001',
        custom_a1b2c3d4: '【範例】第二自訂分類',
        theme_preference: 'dark',
        panel_layout: 'compact',
        custom_short: '太短不合規則',
        custom_UPPER123: '大寫不合規則',
      });
    } finally {
      db.close();
    }
  });

  it('WO-52 (d) 刪除時子項先於父項：依 parent_id 拓撲排序，子列實體順序在父列之前且外鍵開啟時仍正確刪除，循環參照不當機', () => {
    // 1. 純函式驗證：子孫在父之前、多層結構、自我參照與多節點循環參照皆不當機且不漏刪
    expect(
      idsInChildFirstDeleteOrder([
        { id: 'grandchild', parent_id: 'child' },
        { id: 'child', parent_id: 'parent' },
        { id: 'parent', parent_id: null },
      ]),
    ).toEqual(['grandchild', 'child', 'parent']);

    expect(
      idsInChildFirstDeleteOrder([
        { id: 'parent', parent_id: null },
        { id: 'child', parent_id: 'parent' },
        { id: 'grandchild', parent_id: 'child' },
      ]),
    ).toEqual(['grandchild', 'child', 'parent']);

    const cycleResult = idsInChildFirstDeleteOrder([
      { id: 'self-loop', parent_id: 'self-loop' },
      { id: 'cycle-a', parent_id: 'cycle-b' },
      { id: 'cycle-b', parent_id: 'cycle-c' },
      { id: 'cycle-c', parent_id: 'cycle-a' },
    ]);
    expect(cycleResult).toHaveLength(4);
    expect(new Set(cycleResult)).toEqual(new Set(['self-loop', 'cycle-a', 'cycle-b', 'cycle-c']));

    // 2. 資料庫實測：造出「子列實體順序（rowid）在父列之前」且定義自我參照外鍵 ON DELETE RESTRICT，在外鍵強制開啟下仍正確刪除
    const { sql } = openNodeSql();
    createVersion14Shell(sql);
    sql.exec('DROP TABLE chapters');
    sql.exec(`CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES chapters(id) ON DELETE RESTRICT,
      name TEXT NOT NULL DEFAULT '',
      node_type TEXT NOT NULL DEFAULT 'file',
      content TEXT NOT NULL DEFAULT '',
      mark TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      scene_summary TEXT NOT NULL DEFAULT '',
      scene_pov TEXT NOT NULL DEFAULT '',
      scene_location TEXT NOT NULL DEFAULT '',
      is_expanded INTEGER NOT NULL DEFAULT 1
    )`);
    sql.exec('DROP TABLE cards');
    sql.exec(`CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES cards(id) ON DELETE RESTRICT,
      category TEXT NOT NULL DEFAULT 'character',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#3C3F41',
      is_collapsed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`);
    sql.run(
      'INSERT INTO project_info (title, logline, categories_meta) VALUES (?, ?, ?)',
      ['【範例】外鍵刪除順序測試書', '', '{}'],
    );

    // 刻意先插入孫列（rowid=1）、再插入子列（rowid=2）、最後插入父列（rowid=3），使子孫列實體順序在父列之前
    sql.exec('PRAGMA foreign_keys = OFF');
    sql.run(
      'INSERT INTO chapters (id, parent_id, name, node_type, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['ch-grandchild', 'ch-child', '【範例】幕（rowid=1）', 'scene', 0],
    );
    sql.run(
      'INSERT INTO chapters (id, parent_id, name, node_type, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['ch-child', 'ch-parent', '【範例】章（rowid=2）', 'file', 0],
    );
    sql.run(
      'INSERT INTO chapters (id, parent_id, name, node_type, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['ch-parent', null, '【範例】卷（rowid=3）', 'folder', 0],
    );
    sql.run(
      'INSERT INTO chapters (id, parent_id, name, node_type, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['ch-keep', null, '【範例】保留章（rowid=4）', 'file', 1],
    );

    sql.run(
      'INSERT INTO cards (id, parent_id, category, title, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['card-grandchild', 'card-child', 'character', '【範例】孫卡（rowid=1）', 0],
    );
    sql.run(
      'INSERT INTO cards (id, parent_id, category, title, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['card-child', 'card-parent', 'character', '【範例】子卡（rowid=2）', 0],
    );
    sql.run(
      'INSERT INTO cards (id, parent_id, category, title, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['card-parent', null, 'character', '【範例】父卡（rowid=3）', 0],
    );
    sql.run(
      'INSERT INTO cards (id, parent_id, category, title, sort_order) VALUES (?, ?, ?, ?, ?)',
      ['card-keep', null, 'character', '【範例】保留卡（rowid=4）', 1],
    );

    // 驗證實體列順序確實是孫 -> 子 -> 父
    expect(sql.select('SELECT id FROM chapters ORDER BY rowid').map((r) => r.id)).toEqual([
      'ch-grandchild',
      'ch-child',
      'ch-parent',
      'ch-keep',
    ]);
    expect(sql.select('SELECT id FROM cards ORDER BY rowid').map((r) => r.id)).toEqual([
      'card-grandchild',
      'card-child',
      'card-parent',
      'card-keep',
    ]);

    const loaded = readFileProject(sql);

    // 開啟外鍵，並以包裝 Sql 攔截 PRAGMA foreign_keys = OFF，確保整個刪除過程外鍵嚴格維持 ON
    sql.exec('PRAGMA foreign_keys = ON');
    const deletedChapterOrder: string[] = [];
    const deletedCardOrder: string[] = [];
    const strictFkSql: Sql = {
      exec: (statement) => {
        if (/PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(statement)) {
          return;
        }
        sql.exec(statement);
      },
      select: (statement, params) => sql.select(statement, params),
      run: (statement, params) => {
        if (statement.startsWith('DELETE FROM chapters')) {
          deletedChapterOrder.push(String(params?.[0]));
        }
        if (statement.startsWith('DELETE FROM cards')) {
          deletedCardOrder.push(String(params?.[0]));
        }
        sql.run(statement, params);
      },
    };

    const nextTree = loaded.tree.filter((n) => n.id === 'ch-keep');
    const nextCards = loaded.cards.filter((c) => c.id === 'card-keep');

    writeFileProject(strictFkSql, loaded.info, nextTree, nextCards, loaded.logs);

    expect(deletedChapterOrder).toEqual(['ch-grandchild', 'ch-child', 'ch-parent']);
    expect(deletedCardOrder).toEqual(['card-grandchild', 'card-child', 'card-parent']);
    expect(sql.select('SELECT id FROM chapters').map((r) => r.id)).toEqual(['ch-keep']);
    expect(sql.select('SELECT id FROM cards').map((r) => r.id)).toEqual(['card-keep']);
  });

  it('WO-53 追加 1：含空與非空二進位的 extraColumns 經 JSON.parse(JSON.stringify(...)) 後 INSERT 到新資料庫，typeof() 仍是 blob、內容相同', async () => {
    const emptyBlob = new Uint8Array(0);
    const nonEmptyBlob = new Uint8Array([0x00, 0xff, 0x10, 0x42, 0x7f]);

    const verifyJsonRoundTripBlobs = (sourceSql: Sql, targetSql: Sql) => {
      createVersion14Shell(sourceSql);
      sourceSql.exec('ALTER TABLE project_info ADD COLUMN empty_blob BLOB');
      sourceSql.exec('ALTER TABLE project_info ADD COLUMN data_blob BLOB');
      sourceSql.exec('ALTER TABLE chapters ADD COLUMN empty_blob BLOB');
      sourceSql.exec('ALTER TABLE chapters ADD COLUMN data_blob BLOB');
      sourceSql.exec('ALTER TABLE cards ADD COLUMN empty_blob BLOB');
      sourceSql.exec('ALTER TABLE cards ADD COLUMN data_blob BLOB');

      sourceSql.run(
        'INSERT INTO project_info (title, logline, categories_meta, empty_blob, data_blob) VALUES (?, ?, ?, ?, ?)',
        ['【範例】二進位序列化測試書', '【範例】簡介', '{}', emptyBlob, nonEmptyBlob],
      );
      sourceSql.run(
        `INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order, empty_blob, data_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['ch-blob-1', null, '第一章　霧港', 'file', '【範例】正文', 'Draft', 0, emptyBlob, nonEmptyBlob],
      );
      sourceSql.run(
        `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order, empty_blob, data_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          '11111111-2222-4333-8444-555555555555',
          null,
          'character',
          '【範例】沈雨晴',
          '【範例】內容',
          '#3C3F41',
          0,
          0,
          emptyBlob,
          nonEmptyBlob,
        ],
      );

      const loaded = readFileProject(sourceSql);
      // 經 JSON.stringify / JSON.parse 重載（空 Uint8Array 會變成 {}，非空變成 {"0":0,...}）
      const reloadedInfo = JSON.parse(JSON.stringify(loaded.info));
      const reloadedTree = JSON.parse(JSON.stringify(loaded.tree));
      const reloadedCards = JSON.parse(JSON.stringify(loaded.cards));
      expect(reloadedInfo.extraColumns.empty_blob).toEqual({});
      expect(reloadedTree[0].extraColumns.empty_blob).toEqual({});
      expect(reloadedCards[0].extraColumns.empty_blob).toEqual({});

      // 準備新資料庫並刪除預設 project_info 以走完整 INSERT 路徑
      createVersion14Shell(targetSql);
      targetSql.exec('ALTER TABLE project_info ADD COLUMN empty_blob BLOB');
      targetSql.exec('ALTER TABLE project_info ADD COLUMN data_blob BLOB');
      targetSql.exec('ALTER TABLE chapters ADD COLUMN empty_blob BLOB');
      targetSql.exec('ALTER TABLE chapters ADD COLUMN data_blob BLOB');
      targetSql.exec('ALTER TABLE cards ADD COLUMN empty_blob BLOB');
      targetSql.exec('ALTER TABLE cards ADD COLUMN data_blob BLOB');
      targetSql.exec('DELETE FROM project_info');

      writeFileProject(targetSql, reloadedInfo, reloadedTree, reloadedCards, loaded.logs);

      for (const table of ['project_info', 'chapters', 'cards']) {
        const row = targetSql.select(
          `SELECT empty_blob, typeof(empty_blob) AS empty_type, length(empty_blob) AS empty_len,
                  data_blob, typeof(data_blob) AS data_type
           FROM ${table} LIMIT 1`,
        )[0]!;
        expect(row.empty_type).toBe('blob');
        expect(row.empty_len).toBe(0);
        expect(new Uint8Array(row.empty_blob as Uint8Array)).toEqual(emptyBlob);
        expect(row.data_type).toBe('blob');
        expect(new Uint8Array(row.data_blob as Uint8Array)).toEqual(nonEmptyBlob);
      }
    };

    const { sql: nodeSource } = openNodeSql();
    const { sql: nodeTarget } = openNodeSql();
    verifyJsonRoundTripBlobs(nodeSource, nodeTarget);

    const wasmSource = await openMemoryDb(new Uint8Array());
    const wasmTarget = await openMemoryDb(new Uint8Array());
    try {
      verifyJsonRoundTripBlobs(wasmSource.sql, wasmTarget.sql);
    } finally {
      wasmSource.close();
      wasmTarget.close();
    }
  });
});
