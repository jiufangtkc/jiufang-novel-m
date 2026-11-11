import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
  DEMO_CATEGORIES_META_RAW,
  DEMO_CATEGORY_ORDER_RAW,
} from '../data/demoCards';
import { createArchiveClient } from '../db/chapterArchive';
import { openNodeSql } from '../db/nodeSql';
import { readFileProject, writeFileProject, type FileCard } from '../db/projectFile';
import { createVersion14Shell } from '../db/schemaFixture';
import {
  appendCategoryToOrder,
  parseCategoriesMeta,
  parseCategoryOrder,
  removeCategoryFromOrder,
  removeCustomCategoryName,
  resolveVisibleCategories,
  serializeCategoriesMeta,
  serializeCategoryOrder,
  setCustomCategoryName,
} from '../domain/cardCategories';
import { addCard } from '../domain/cardOps';
import { renameNode } from '../domain/chapterOps';
import { emptyArchive, type BookArchive } from '../domain/chapterVersions';
import { loadProjects, OUTLINE_STORAGE_KEY, saveProjects, type KeyValueStore } from '../domain/outline';
import {
  getStoredWritingCardsView,
  saveStoredWritingCardsView,
} from '../domain/writingCards';
import {
  buildFileProjectInfo,
  createState,
  deleteProjectCardWithArchive,
  getProjectCards,
  getProjectCategorySettings,
  reduce,
  restoreProjectCardFromArchive,
  type Action,
} from './sampleStore';
import {
  openDesktopSampleMemoryDb,
  SAMPLE_DEFAULT_COLOR,
  SAMPLE_DESKTOP_CARDS,
  SAMPLE_NON_DEFAULT_COLOR,
} from '../db/testing/desktopSampleDb';

function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  return {
    data: { ...initial },
    getItem(key: string) {
      return this.data[key] ?? null;
    },
    setItem(key: string, value: string) {
      this.data[key] = value;
    },
  };
}

function createMemoryArchive() {
  const store = new Map<string, BookArchive>();
  return createArchiveClient({
    async read(bookId) {
      return structuredClone(store.get(bookId) ?? emptyArchive());
    },
    async write(bookId, archive) {
      store.set(bookId, structuredClone(archive));
    },
  });
}

describe('WO-53 卡片狀態管理、最近刪除、跨書隔離與追加修復（sampleStore）', () => {
  it('WO-53：卡片狀態與範例書／新開稿子讀寫、localStorage 存取、以及升格成檔案（promote-stored）', () => {
    let state = createState(new Date('2026-11-11T12:00:00Z'));

    // 1. 範例書初始具有 18 張範例卡片與 5 個可見分類設定
    const fogCards = getProjectCards(state, 'fog');
    expect(fogCards).toHaveLength(18);
    const fogSettings = getProjectCategorySettings(state, 'fog');
    expect(fogSettings.categoryOrder).toBe(DEMO_CATEGORY_ORDER_RAW);
    expect(fogSettings.categoriesMeta).toBe(DEMO_CATEGORIES_META_RAW);

    // 2. 在範例書上新增卡片、修改卡片標題／內容／顏色、更新分類設定
    const withNewCard = addCard(fogCards, {
      category: 'character',
      title: '【範例】新登場船長',
      content: '【範例】老船長設定',
      color: '#2b5b84',
    });
    const addedCardId = withNewCard[withNewCard.length - 1]!.id;

    state = reduce(state, {
      type: 'set-cards',
      projectId: 'fog',
      cards: withNewCard,
    });
    expect(getProjectCards(state, 'fog')).toHaveLength(19);

    state = reduce(state, {
      type: 'update-card',
      projectId: 'fog',
      cardId: addedCardId,
      patch: {
        title: '【範例】老船長周海',
        color: '#8B0000',
      },
    });
    const updatedCard = getProjectCards(state, 'fog').find((c) => c.id === addedCardId)!;
    expect(updatedCard.title).toBe('【範例】老船長周海');
    expect(updatedCard.color).toBe('#8B0000');

    // 新增一個自訂分類並透過 set-card-categories 原子更新
    const newCatCode = 'custom_1234abcd';
    const nextOrderRaw = serializeCategoryOrder(
      appendCategoryToOrder(parseCategoryOrder(fogSettings.categoryOrder), newCatCode),
    );
    const nextMetaRaw =
      serializeCategoriesMeta(
        setCustomCategoryName(
          parseCategoriesMeta(fogSettings.categoriesMeta),
          newCatCode,
          '【範例】船隻圖鑑',
        ),
      ) ?? '{}';

    state = reduce(state, {
      type: 'set-card-categories',
      projectId: 'fog',
      categoryOrder: nextOrderRaw,
      categoriesMeta: nextMetaRaw,
    });

    // 寫入 localStorage 再由 loadProjects 讀回，卡片與分類設定皆完整保留
    const kv = createMemoryStore();
    saveProjects(
      kv,
      state.projects.filter((p) => p.origin !== 'file'),
    );
    const reloaded = loadProjects(kv)!;
    const reloadedFog = reloaded.find((p) => p.id === 'fog')!;
    expect(reloadedFog.cards).toHaveLength(19);
    expect(reloadedFog.cards!.find((c) => c.id === addedCardId)?.title).toBe('【範例】老船長周海');
    expect(reloadedFog.categoryOrderRaw).toBe(nextOrderRaw);
    expect(reloadedFog.categoriesMetaRaw).toBe(nextMetaRaw);

    // 3. 新開稿子（add-project）初始狀態與升格成檔案（promote-stored）
    state = reduce(state, {
      type: 'add-project',
      id: 'new-book-1',
      title: '【範例】新開長篇',
      shape: 'novel',
    });
    const newBook = state.projects.find((p) => p.id === 'new-book-1')!;
    expect(newBook.cards).toEqual([]);
    expect(newBook.categoryOrderRaw).toBe(DEFAULT_PROJECT_CATEGORY_ORDER_RAW);
    expect(newBook.expandedCategoriesRaw).toBeNull();
    expect(newBook.categoriesMetaRaw).toBe('{}');

    // 在升格前先加一張卡片，升格後驗證 fileExtras 完整接手
    const cardsBeforePromote = addCard([], {
      category: 'summary',
      title: '【範例】第一卷大綱',
      content: '【範例】升格前新增的卡片內容',
    });
    state = reduce(state, {
      type: 'set-cards',
      projectId: 'new-book-1',
      cards: cardsBeforePromote,
    });
    state = reduce(state, {
      type: 'promote-stored',
      projectId: 'new-book-1',
      key: 'db-new-book-1',
      filename: '新開長篇.db',
    });
    expect(state.fileExtras['db-new-book-1']?.cards).toHaveLength(1);
    expect(state.fileExtras['db-new-book-1']?.cards[0]?.title).toBe('【範例】第一卷大綱');
    expect(state.fileExtras['db-new-book-1']?.info.categoryOrder).toBe(
      DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
    );
  });

  it('WO-53：顏色可讀寫：讀入電腦版範例檔、驗證原本的非預設色與預設色不變、改色寫回再讀回一致且不合格色碼被拒', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const parsed = readFileProject(db.sql);
      let state = createState(new Date('2026-11-11T12:00:00Z'));

      state = reduce(state, {
        type: 'attach-file',
        project: {
          id: 'desktop-db',
          dbKey: 'desktop-db',
          title: parsed.info.title,
          updatedLabel: '剛剛',
          bookGoal: parsed.info.targetWordCount,
          nodes: parsed.tree,
          origin: 'file',
        },
        schedule: state.schedule,
        extras: {
          info: parsed.info,
          cards: parsed.cards,
          logs: parsed.logs,
        },
      });

      const cards = getProjectCards(state, 'desktop-db');
      expect(cards).toHaveLength(SAMPLE_DESKTOP_CARDS.length);
      // 驗證電腦版範例檔原本的非預設色與預設色碼原樣保留
      const colors = new Set(cards.map((c) => c.color));
      expect(colors.has(SAMPLE_NON_DEFAULT_COLOR)).toBe(true);
      expect(colors.has(SAMPLE_DEFAULT_COLOR)).toBe(true);

      const cardNonDefault = cards.find((c) => c.color === SAMPLE_NON_DEFAULT_COLOR)!;
      const cardDefault = cards.find((c) => c.color === SAMPLE_DEFAULT_COLOR)!;
      expect(cardNonDefault).toBeDefined();
      expect(cardDefault).toBeDefined();

      // 新增一張卡片用來測試改色，確保原本兩張卡的非預設色／預設色完全不變
      const withExtra = addCard(cards, {
        category: 'character',
        title: '【範例】測試改色角色',
        color: '#8b0000',
      });
      const targetCard = withExtra[withExtra.length - 1]!;
      state = reduce(state, {
        type: 'set-cards',
        projectId: 'desktop-db',
        cards: withExtra,
      });
      const originalColor = targetCard.color;

      // 不合格色碼（如 'red'、'#123'、''）必須拒絕，不覆蓋原色
      for (const badColor of ['red', '#123', '', '#GGGGGG', 'rgb(1,2,3)']) {
        state = reduce(state, {
          type: 'update-card',
          projectId: 'desktop-db',
          cardId: targetCard.id,
          patch: { color: badColor },
        });
        expect(getProjectCards(state, 'desktop-db').find((c) => c.id === targetCard.id)?.color).toBe(
          originalColor,
        );
      }

      // 合法 6 碼十六進位色碼（大小寫原樣保留）可成功更新，並同步寫入 fileExtras
      state = reduce(state, {
        type: 'update-card',
        projectId: 'desktop-db',
        cardId: targetCard.id,
        patch: {
          color: '#AbCdEf',
          title: '【範例】已改色卡片',
        },
      });
      expect(getProjectCards(state, 'desktop-db').find((c) => c.id === targetCard.id)?.color).toBe(
        '#AbCdEf',
      );
      expect(
        state.fileExtras['desktop-db']?.cards.find((c) => c.id === targetCard.id)?.color,
      ).toBe('#AbCdEf');

      // 寫回 SQLite 再讀回，驗證色碼、標題與分類設定完全一致
      const project = state.projects.find((p) => p.id === 'desktop-db')!;
      const extra = state.fileExtras['desktop-db']!;
      writeFileProject(
        db.sql,
        buildFileProjectInfo(state, project),
        project.nodes,
        extra.cards,
        extra.logs,
      );

      const reparsed = readFileProject(db.sql);
      const savedCard = reparsed.cards.find((c) => c.id === targetCard.id)!;
      expect(savedCard.color).toBe('#AbCdEf');
      expect(savedCard.title).toBe('【範例】已改色卡片');
      // 原本的非預設色與預設色完全不變
      expect(reparsed.cards.find((c) => c.id === cardNonDefault.id)?.color).toBe(
        SAMPLE_NON_DEFAULT_COLOR,
      );
      expect(reparsed.cards.find((c) => c.id === cardDefault.id)?.color).toBe(SAMPLE_DEFAULT_COLOR);
    } finally {
      db.close();
    }
  });

  it('WO-53：隱藏分類 ai_chat 卡片保護：即使透過 set-cards、update-card、delete-card 操作，ai_chat 卡片亦原封不動', () => {
    let state = createState(new Date('2026-11-11T12:00:00Z'));
    const aiCard: FileCard = {
      id: '90000000-0000-4000-8000-000000000099',
      category: 'ai_chat',
      parent_id: null,
      title: '【範例】電腦版對話紀錄',
      content: '【範例】不可被手機端修改或刪除的對話內容',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 0,
    };
    const charCard: FileCard = {
      id: '20000000-0000-4000-8000-000000000088',
      category: 'character',
      parent_id: null,
      title: '【範例】可見角色',
      content: '【範例】角色說明',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 0,
    };

    state = reduce(state, {
      type: 'set-cards',
      projectId: 'fog',
      cards: [charCard, aiCard],
    });

    // 嘗試對 ai_chat 卡片執行 update-card 與 delete-card，必須被拒絕
    state = reduce(state, {
      type: 'update-card',
      projectId: 'fog',
      cardId: aiCard.id,
      patch: { title: '被竄改的標題' },
    });
    state = reduce(state, {
      type: 'delete-card',
      projectId: 'fog',
      cardId: aiCard.id,
    });
    expect(getProjectCards(state, 'fog').find((c) => c.id === aiCard.id)?.title).toBe(
      '【範例】電腦版對話紀錄',
    );

    // 即使前端只把可見卡片傳給 set-cards，ai_chat 卡片也會自動保留不遺失
    state = reduce(state, {
      type: 'set-cards',
      projectId: 'fog',
      cards: [charCard],
    });
    expect(getProjectCards(state, 'fog').some((c) => c.id === aiCard.id)).toBe(true);
  });

  it('WO-53：切換書不殘留：書 A 與書 B 的卡片清單、寫作時看卡片記憶位置、最近刪除紀錄完全隔離', async () => {
    let state = createState(new Date('2026-11-11T12:00:00Z'));
    const archive = createMemoryArchive();
    const storage = {
      data: {} as Record<string, string>,
      getItem(k: string) {
        return this.data[k] ?? null;
      },
      setItem(k: string, v: string) {
        this.data[k] = v;
      },
      removeItem(k: string) {
        delete this.data[k];
      },
    };

    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    // 聚焦書 A（fog），修改卡片、記錄寫作時看卡片位置、刪除一張卡片進 archive
    dispatch({ type: 'focus-project', id: 'fog' });
    dispatch({
      type: 'update-card',
      projectId: 'fog',
      cardId: '20000000-0000-4000-8000-000000000001',
      patch: { title: '【範例】沈雨晴（書 A 已改）' },
    });
    saveStoredWritingCardsView(
      'fog',
      { categoryId: 'world', cardId: '30000000-0000-4000-8000-000000000001' },
      storage,
    );
    await deleteProjectCardWithArchive(
      state,
      dispatch,
      'fog',
      '10000000-0000-4000-8000-000000000001',
      { archive, deletedAt: 1000, recordId: 'del-fog-1' },
    );

    // 切換到書 B（second）
    dispatch({ type: 'focus-project', id: 'second' });
    expect(state.activeProjectId).toBe('second');

    // 1. 書 B 的卡片清單維持原樣（18 張，沈雨晴標題未被書 A 影響）
    const secondCards = getProjectCards(state, 'second');
    expect(secondCards).toHaveLength(18);
    expect(
      secondCards.find((c) => c.id === '20000000-0000-4000-8000-000000000001')?.title,
    ).toBe('【範例】沈雨晴');

    // 2. 書 B 的寫作看卡片記憶位置為預設值（character / null），不殘留書 A 的 world
    const secondView = getStoredWritingCardsView('second', storage);
    expect(secondView).toEqual({ categoryId: 'character', cardId: null });

    // 3. 書 B 的 bookArchive 最近刪除卡片為空，不殘留書 A 的刪除紀錄
    const secondArchive = await archive.read('second');
    expect(secondArchive.deletedCards).toEqual([]);
    const fogArchive = await archive.read('fog');
    expect(fogArchive.deletedCards).toHaveLength(1);
    expect(fogArchive.deletedCards![0]?.id).toBe('del-fog-1');
  });

  it('WO-53：最近刪除可找回：在 sampleStore 中刪除含 2 層子卡片的母卡 → 期間修改其他卡片 → 復原後子孫完整補回且不覆蓋期間修改', async () => {
    let state = createState(new Date('2026-11-11T12:00:00Z'));
    const archive = createMemoryArchive();
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    // 刪除「沈雨晴」（含子卡「隨身舊懷錶」與孫卡「懷錶夾層的黑白照片」，共 3 張）
    const record = await deleteProjectCardWithArchive(
      state,
      dispatch,
      'fog',
      '20000000-0000-4000-8000-000000000001',
      { archive, deletedAt: 5000, recordId: 'del-shen' },
    );
    expect(record).not.toBeNull();
    expect(record!.cards).toHaveLength(3);
    expect(getProjectCards(state, 'fog')).toHaveLength(15);

    const savedArchive = await archive.read('fog');
    expect(savedArchive.deletedCards).toHaveLength(1);
    expect(savedArchive.deletedCards![0]?.id).toBe('del-shen');

    // 在刪除期間修改同分類另一張卡片「陸明遠」的標題與內容
    dispatch({
      type: 'update-card',
      projectId: 'fog',
      cardId: '20000000-0000-4000-8000-000000000004',
      patch: {
        title: '【範例】陸明遠（升任紀錄員）',
        content: '【範例】刪除期間更新的內容，復原時不可被覆蓋。',
      },
    });

    // 呼叫復原動作
    const restoredCards = await restoreProjectCardFromArchive(
      state,
      dispatch,
      'fog',
      'del-shen',
      { archive },
    );
    expect(restoredCards).not.toBeNull();
    expect(getProjectCards(state, 'fog')).toHaveLength(18);

    // 驗證「沈雨晴」與子孫皆已回到清單，且「陸明遠」的修改完好無損
    const currentCards = getProjectCards(state, 'fog');
    expect(currentCards.some((c) => c.id === '20000000-0000-4000-8000-000000000001')).toBe(true);
    expect(currentCards.some((c) => c.id === '20000000-0000-4000-8000-000000000002')).toBe(true);
    expect(currentCards.some((c) => c.id === '20000000-0000-4000-8000-000000000003')).toBe(true);
    const luCard = currentCards.find((c) => c.id === '20000000-0000-4000-8000-000000000004')!;
    expect(luCard.title).toBe('【範例】陸明遠（升任紀錄員）');
    expect(luCard.content).toContain('刪除期間更新的內容');

    // 驗證 bookArchive 中該筆刪除紀錄已移除
    const afterRestoreArchive = await archive.read('fog');
    expect(afterRestoreArchive.deletedCards).toEqual([]);
  });

  it('WO-53：當自訂分類被刪除後復原該分類的已刪卡片，自動歸入第一個可見分類（不含 ai_chat）的頂層末尾', async () => {
    let state = createState(new Date('2026-11-11T12:00:00Z'));
    const archive = createMemoryArchive();
    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    // 1. 先刪除自訂分類 custom_5ce4e001 下的一張卡片
    const customCardId = '50000000-0000-4000-8000-000000000001';
    const record = await deleteProjectCardWithArchive(state, dispatch, 'fog', customCardId, {
      archive,
      deletedAt: 6000,
      recordId: 'del-custom-card',
    });
    expect(record).not.toBeNull();

    // 2. 接著刪除 custom_5ce4e001 自訂分類（連同更新 categoryOrder 與 categoriesMeta）
    const settings = getProjectCategorySettings(state, 'fog');
    const nextOrderRaw = serializeCategoryOrder(
      removeCategoryFromOrder(parseCategoryOrder(settings.categoryOrder), 'custom_5ce4e001'),
    );
    const nextMetaRaw =
      serializeCategoriesMeta(
        removeCustomCategoryName(parseCategoriesMeta(settings.categoriesMeta), 'custom_5ce4e001'),
      ) ?? '{}';
    const remainingCards = getProjectCards(state, 'fog').filter(
      (c) => c.category !== 'custom_5ce4e001',
    );
    dispatch({
      type: 'set-card-categories',
      projectId: 'fog',
      categoryOrder: nextOrderRaw,
      categoriesMeta: nextMetaRaw,
      cards: remainingCards,
    });

    // 3. 復原剛才刪掉的自訂分類卡片：因為原分類 custom_5ce4e001 已不存在，應轉入第一個可見分類 summary 頂層末尾
    await restoreProjectCardFromArchive(state, dispatch, 'fog', 'del-custom-card', { archive });
    const restored = getProjectCards(state, 'fog').find((c) => c.id === customCardId)!;
    expect(restored).toBeDefined();
    expect(restored.category).toBe('summary');
    expect(restored.parent_id).toBeNull();
  });

  it('WO-53：舊版 localStorage 升版：無 cards 欄位的範例書載入後自動補入 DEMO_CARDS；cards: []（已刪光）載入後仍為 []', () => {
    const legacyProjects = [
      {
        id: 'fog',
        title: '【範例】霧港紀事（舊版無 cards）',
        updatedLabel: '昨天',
        bookGoal: 100000,
        nodes: [],
        // 模擬舊版 localStorage 沒有 cards 欄位
      },
      {
        id: 'second',
        title: '【範例】第二本專案（已刪光卡片）',
        updatedLabel: '剛剛',
        bookGoal: 50000,
        nodes: [],
        cards: [],
      },
    ];

    const kv = createMemoryStore({
      [OUTLINE_STORAGE_KEY]: JSON.stringify(legacyProjects),
    });

    const loaded = loadProjects(kv)!;
    expect(loaded).toHaveLength(2);

    // 1. 無 cards 欄位 -> 自動補入 18 張 DEMO_CARDS 與預設分類設定
    const loadedFog = loaded.find((p) => p.id === 'fog')!;
    expect(loadedFog.cards).toBeDefined();
    expect(loadedFog.cards).toHaveLength(18);
    expect(loadedFog.categoryOrderRaw).toBe(DEMO_CATEGORY_ORDER_RAW);
    expect(loadedFog.categoriesMetaRaw).toBe(DEMO_CATEGORIES_META_RAW);
    const visibleCats = resolveVisibleCategories({
      categoryOrder: loadedFog.categoryOrderRaw,
      categoriesMeta: loadedFog.categoriesMetaRaw,
      cards: loadedFog.cards,
    });
    expect(visibleCats.map((c) => c.id)).toEqual([
      'summary',
      'character',
      'world',
      'timeline',
      'custom_5ce4e001',
    ]);

    // 2. cards: []（使用者已刪光）-> 保留空陣列 []，不會被重塞預設卡片
    const loadedSecond = loaded.find((p) => p.id === 'second')!;
    expect(loadedSecond.cards).toEqual([]);
  });

  it('WO-53 追加 2-1：is_expanded 為 NULL 的章節經 renameNode（物件展開）後再 toggle，寫回 .db 應變成 0（收合）而非 1', () => {
    const { db, sql } = openNodeSql();
    try {
      createVersion14Shell(sql);
      sql.run(
        `INSERT INTO chapters (id, parent_id, node_type, name, content, sort_order, is_expanded)
         VALUES ('vol-null', NULL, 'folder', '【範例】第一卷', '', 0, NULL)`,
      );

      const parsed = readFileProject(sql);
      expect(parsed.tree[0]?.expanded).toBe(true);

      let state = createState(new Date('2026-11-11T12:00:00Z'));
      state = reduce(state, {
        type: 'attach-file',
        project: {
          id: 'null-exp-book',
          dbKey: 'null-exp-book',
          title: parsed.info.title,
          updatedLabel: '剛剛',
          bookGoal: parsed.info.targetWordCount,
          nodes: parsed.tree,
          origin: 'file',
        },
        schedule: state.schedule,
        extras: { info: parsed.info, cards: parsed.cards, logs: parsed.logs },
      });

      // 1. 先對該卷執行 renameNode（內部使用 { ...node, title } 展開，使 non-enumerable 的 expanded 變成 undefined）
      const renamedNodes = renameNode(
        state.projects.find((p) => p.id === 'null-exp-book')!.nodes,
        'vol-null',
        '【範例】第一卷（改名）',
      )!;
      state = reduce(state, {
        type: 'set-nodes',
        projectId: 'null-exp-book',
        nodes: renamedNodes,
      });

      // 此時節點在畫面上仍是展開狀態（node.expanded !== false 為 true）
      const nodeBeforeToggle = state.projects.find((p) => p.id === 'null-exp-book')!.nodes[0]!;
      expect(nodeBeforeToggle.expanded !== false).toBe(true);

      // 2. 使用者按一下收合（dispatch toggle）
      state = reduce(state, {
        type: 'toggle',
        projectId: 'null-exp-book',
        nodeId: 'vol-null',
      });

      const nodeAfterToggle = state.projects.find((p) => p.id === 'null-exp-book')!.nodes[0]!;
      expect(nodeAfterToggle.expanded).toBe(false);

      // 3. 寫回資料庫，驗證 is_expanded 為 0（收合），而非 1
      const project = state.projects.find((p) => p.id === 'null-exp-book')!;
      const extra = state.fileExtras['null-exp-book']!;
      writeFileProject(
        sql,
        buildFileProjectInfo(state, project),
        project.nodes,
        extra.cards,
        extra.logs,
      );

      const row = sql.select(`SELECT name, is_expanded FROM chapters WHERE id = 'vol-null'`)[0]!;
      expect(row.name).toBe('【範例】第一卷（改名）');
      expect(row.is_expanded).toBe(0);
    } finally {
      db.close();
    }
  });

  it('WO-53 追加 2-2：editor_font_size 與 global_font_size 為 NULL 的專案經 remember-place / commit-text 與存檔寫回後，仍維持 NULL 不被 16 或 12 覆寫', () => {
    const { db, sql } = openNodeSql();
    try {
      createVersion14Shell(sql);
      sql.run('DELETE FROM project_info');
      sql.run(
        `INSERT INTO project_info (
          id, title, logline, current_theme,
          global_font_family, global_font_size,
          editor_font_family, editor_font_size,
          target_word_count, daily_target_word_count,
          category_order, expanded_categories, categories_meta,
          last_opened_node_id, last_cursor_position
        ) VALUES (
          1, NULL, NULL, NULL,
          NULL, NULL,
          NULL, NULL,
          NULL, NULL,
          NULL, NULL, NULL,
          NULL, NULL
        )`,
      );
      sql.run(
        `INSERT INTO chapters (id, parent_id, node_type, name, content, sort_order, is_expanded)
         VALUES ('ch-1', NULL, 'file', '【範例】第一章', '【範例】初始段落', 0, 1)`,
      );

      const parsed = readFileProject(sql);
      let state = createState(new Date('2026-11-11T12:00:00Z'));
      state = reduce(state, {
        type: 'attach-file',
        project: {
          id: 'null-info-book',
          dbKey: 'null-info-book',
          title: parsed.info.title,
          updatedLabel: '剛剛',
          bookGoal: parsed.info.targetWordCount,
          nodes: parsed.tree,
          origin: 'file',
        },
        schedule: state.schedule,
        extras: { info: parsed.info, cards: parsed.cards, logs: parsed.logs },
      });

      // 觸發 remember-place 與 commit-text（這兩個 reducer 分支都會展開 { ...extra.info }）
      state = reduce(state, {
        type: 'remember-place',
        projectId: 'null-info-book',
        nodeId: 'ch-1',
        cursor: 5,
      });
      state = reduce(state, {
        type: 'commit-text',
        projectId: 'null-info-book',
        nodeId: 'ch-1',
        text: '【範例】修改後的段落文字',
      });

      // 透過 buildFileProjectInfo（snapshotManuscript 與自動存檔共用）寫回 .db
      const project = state.projects.find((p) => p.id === 'null-info-book')!;
      const extra = state.fileExtras['null-info-book']!;
      const infoForSave = buildFileProjectInfo(state, project);
      writeFileProject(sql, infoForSave, project.nodes, extra.cards, extra.logs);

      const row = sql.select(
        `SELECT
           title,
           logline,
           global_font_size,
           typeof(global_font_size) AS global_font_size_type,
           editor_font_size,
           typeof(editor_font_size) AS editor_font_size_type,
           target_word_count,
           typeof(target_word_count) AS target_word_count_type,
           daily_target_word_count,
           typeof(daily_target_word_count) AS daily_target_word_count_type,
           last_opened_node_id,
           last_cursor_position
         FROM project_info
         WHERE id = 1`,
      )[0]!;

      expect(row.global_font_size).toBeNull();
      expect(row.global_font_size_type).toBe('null');
      expect(row.editor_font_size).toBeNull();
      expect(row.editor_font_size_type).toBe('null');
      expect(row.target_word_count).toBeNull();
      expect(row.target_word_count_type).toBe('null');
      expect(row.daily_target_word_count).toBeNull();
      expect(row.daily_target_word_count_type).toBe('null');
      expect(row.title).toBeNull();
      expect(row.logline).toBeNull();
      expect(row.last_opened_node_id).toBe('ch-1');
      expect(row.last_cursor_position).toBe(5);
    } finally {
      db.close();
    }
  });
});
