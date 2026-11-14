import { describe, expect, it } from 'vitest';
import {
  addCustomCategory,
  appendCategoryToOrder,
  BUILTIN_CATEGORY_CODES,
  BUILTIN_CATEGORY_NAMES,
  CATEGORY_AI_CHAT,
  CATEGORY_CHARACTER,
  CATEGORY_SUMMARY,
  CATEGORY_TIMELINE,
  CATEGORY_WORLD,
  canDeleteCategory,
  CUSTOM_CATEGORY_REGEX,
  deleteCustomCategory,
  generateCustomCategoryCode,
  getCategoryDisplayName,
  isBuiltinCategory,
  isCustomCategory,
  isHiddenCategory,
  isStandardCustomCategoryCode,
  moveCategoryInOrder,
  parseCategoriesMeta,
  parseCategoryOrder,
  parseExpandedCategories,
  rebuildCategoryOrder,
  removeCategoryFromOrder,
  removeCustomCategoryName,
  renameCustomCategory,
  resolveVisibleCategories,
  serializeCategoriesMeta,
  serializeCategoryOrder,
  serializeExpandedCategories,
  setCategoryExpanded,
  setCustomCategoryName,
} from './cardCategories';

describe('分類代碼常數與判斷（cardCategories）', () => {
  it('定義五個電腦版內建分類代碼與對應繁體中文名稱，並將 ai_chat 判定為隱藏分類', () => {
    expect(BUILTIN_CATEGORY_CODES).toEqual([
      'summary',
      'character',
      'world',
      'timeline',
      'ai_chat',
    ]);
    expect(BUILTIN_CATEGORY_NAMES[CATEGORY_SUMMARY]).toBe('本書綱要');
    expect(BUILTIN_CATEGORY_NAMES[CATEGORY_CHARACTER]).toBe('角色');
    expect(BUILTIN_CATEGORY_NAMES[CATEGORY_WORLD]).toBe('世界觀');
    expect(BUILTIN_CATEGORY_NAMES[CATEGORY_TIMELINE]).toBe('時間軸');
    expect(BUILTIN_CATEGORY_NAMES[CATEGORY_AI_CHAT]).toBe('AI 對話紀錄');

    expect(isBuiltinCategory('summary')).toBe(true);
    expect(isBuiltinCategory('custom_c15c6bd8')).toBe(false);
    expect(isCustomCategory('custom_c15c6bd8')).toBe(true);
    expect(isStandardCustomCategoryCode('custom_c15c6bd8')).toBe(true);
    expect(isStandardCustomCategoryCode('custom_C15C6BD8')).toBe(false);

    expect(isHiddenCategory('ai_chat')).toBe(true);
    expect(isHiddenCategory('  AI_CHAT  ')).toBe(true);
    expect(isHiddenCategory('summary')).toBe(false);
    expect(isHiddenCategory('custom_c15c6bd8')).toBe(false);
    expect(isHiddenCategory(null)).toBe(false);
    expect(isHiddenCategory('')).toBe(false);
  });

  it('自訂分類代碼產生器產出 custom_ 加 8 碼小寫十六進位且不與現有重複', () => {
    const existing = new Set<string>(['custom_00000001', 'custom_a1b2c3d4']);
    let callCount = 0;
    const seq = ['00000001', 'a1b2c3d4', 'c15c6bd8'];
    const generated = generateCustomCategoryCode(existing, () => seq[callCount++] ?? 'ffffffff');
    expect(generated).toBe('custom_c15c6bd8');
    expect(CUSTOM_CATEGORY_REGEX.test(generated)).toBe(true);

    // 預設亂數產生器也能符合格式且不重複
    for (let i = 0; i < 20; i++) {
      const code = generateCustomCategoryCode(existing);
      expect(CUSTOM_CATEGORY_REGEX.test(code)).toBe(true);
      expect(existing.has(code)).toBe(false);
      existing.add(code);
    }
  });
});

describe('寬鬆解析與序列化保護（P0-2 相關）', () => {
  it('未改動時原文字串寫回（含 NULL、空白格式、鍵順序都不變）', () => {
    const rawOrderWithSpaces = '[ "summary" , "character", "world", "timeline", "ai_chat", "custom_c15c6bd8" ]';
    const order = parseCategoryOrder(rawOrderWithSpaces);
    expect(order.writable).toBe(true);
    expect(order.dirty).toBe(false);
    expect(serializeCategoryOrder(order)).toBe(rawOrderWithSpaces);

    const nullOrder = parseCategoryOrder(null);
    expect(serializeCategoryOrder(nullOrder)).toBeNull();

    const nullExpanded = parseExpandedCategories(null);
    expect(serializeExpandedCategories(nullExpanded)).toBeNull();

    const rawExpanded = '["summary",   "custom_c15c6bd8"]';
    const expanded = parseExpandedCategories(rawExpanded);
    expect(serializeExpandedCategories(expanded)).toBe(rawExpanded);

    const rawMeta = '{\n  "custom_c15c6bd8": "自訂分類001",\n  "extra_key": 42\n}';
    const meta = parseCategoriesMeta(rawMeta);
    expect(serializeCategoriesMeta(meta)).toBe(rawMeta);
  });

  it('NULL、空字串、非法 JSON、型別不對都不拋錯；非法 JSON 標記不可改寫並原文寫回', () => {
    const invalidOrderJson = '["summary", broken_json';
    const parsedBadOrder = parseCategoryOrder(invalidOrderJson);
    expect(parsedBadOrder.writable).toBe(false);
    expect(parsedBadOrder.codes).toEqual([]);
    const afterAttemptOrder = appendCategoryToOrder(parsedBadOrder, 'custom_12345678');
    expect(serializeCategoryOrder(afterAttemptOrder)).toBe(invalidOrderJson);

    const wrongTypeOrder = '{"not":"an array"}';
    const parsedWrongOrder = parseCategoryOrder(wrongTypeOrder);
    expect(parsedWrongOrder.writable).toBe(false);
    expect(serializeCategoryOrder(rebuildCategoryOrder(parsedWrongOrder, ['summary']))).toBe(wrongTypeOrder);

    const invalidMetaJson = '{bad_meta';
    const parsedBadMeta = parseCategoriesMeta(invalidMetaJson);
    expect(parsedBadMeta.writable).toBe(false);
    const afterAttemptMeta = setCustomCategoryName(parsedBadMeta, 'custom_c15c6bd8', '【範例】新名');
    expect(serializeCategoriesMeta(afterAttemptMeta)).toBe(invalidMetaJson);

    const wrongTypeMeta = '["array_not_object"]';
    const parsedWrongMeta = parseCategoriesMeta(wrongTypeMeta);
    expect(parsedWrongMeta.writable).toBe(false);
    expect(serializeCategoriesMeta(setCustomCategoryName(parsedWrongMeta, 'custom_11111111', '名'))).toBe(
      wrongTypeMeta,
    );

    const emptyOrder = parseCategoryOrder('');
    expect(emptyOrder.writable).toBe(true);
    expect(serializeCategoryOrder(emptyOrder)).toBe('');

    const emptyMeta = parseCategoriesMeta('');
    expect(emptyMeta.writable).toBe(true);
    expect(serializeCategoriesMeta(emptyMeta)).toBe('');
  });

  it('淺層修補 categories_meta：改自訂分類名稱時，其他鍵與未知鍵值完整保留', () => {
    const rawMeta = JSON.stringify({
      custom_c15c6bd8: '自訂分類001',
      custom_deadbeef: '【範例】舊分類',
      desktop_unknown_flag: { nested: true, version: 2 },
      desktop_num: 99,
    });
    const meta = parseCategoriesMeta(rawMeta);
    const updated = setCustomCategoryName(meta, 'custom_c15c6bd8', '【範例】自訂分類改名');
    const serialized = serializeCategoriesMeta(updated);
    expect(serialized).not.toBeNull();
    const reparsed = JSON.parse(serialized!);
    expect(reparsed).toEqual({
      custom_c15c6bd8: '【範例】自訂分類改名',
      custom_deadbeef: '【範例】舊分類',
      desktop_unknown_flag: { nested: true, version: 2 },
      desktop_num: 99,
    });

    const removed = removeCustomCategoryName(updated, 'custom_deadbeef');
    expect(JSON.parse(serializeCategoriesMeta(removed)!)).toEqual({
      custom_c15c6bd8: '【範例】自訂分類改名',
      desktop_unknown_flag: { nested: true, version: 2 },
      desktop_num: 99,
    });
  });

  it('重算 category_order 時，隱藏分類（ai_chat）與手機不認得的代碼原位保留', () => {
    const rawOrder = JSON.stringify([
      'summary',
      'character',
      'ai_chat',
      'world',
      'desktop_future_tab',
      'timeline',
      'custom_c15c6bd8',
    ]);
    const order = parseCategoryOrder(rawOrder);
    // 手機端將 timeline 移到 summary 前面，並新增 custom_11223344
    const rebuilt = rebuildCategoryOrder(
      order,
      ['timeline', 'summary', 'character', 'world', 'custom_c15c6bd8', 'custom_11223344'],
      ['custom_c15c6bd8', 'custom_11223344'],
    );
    expect(rebuilt.codes).toEqual([
      'timeline',
      'summary',
      'ai_chat',
      'character',
      'desktop_future_tab',
      'world',
      'custom_c15c6bd8',
      'custom_11223344',
    ]);
    // ai_chat 仍在索引 2，desktop_future_tab 仍在索引 4
    expect(rebuilt.codes[2]).toBe('ai_chat');
    expect(rebuilt.codes[4]).toBe('desktop_future_tab');

    // removeCategoryFromOrder 不可刪掉 ai_chat
    const tryRemoveAi = removeCategoryFromOrder(rebuilt, 'ai_chat');
    expect(tryRemoveAi.codes).toContain('ai_chat');
  });

  it('expanded_categories 切換展開時保留未知項與 ai_chat', () => {
    const raw = '["summary", "ai_chat"]';
    const parsed = parseExpandedCategories(raw);
    const same = setCategoryExpanded(parsed, 'summary', true);
    expect(same.dirty).toBe(false);
    expect(serializeExpandedCategories(same)).toBe(raw);

    const added = setCategoryExpanded(parsed, 'custom_c15c6bd8', true);
    expect(JSON.parse(serializeExpandedCategories(added)!)).toEqual([
      'summary',
      'ai_chat',
      'custom_c15c6bd8',
    ]);
  });

  it('有卡片用到但不在 category_order 的分類代碼，畫面清單附在最後（ai_chat 除外）', () => {
    const categories = resolveVisibleCategories({
      categoryOrder: '["summary", "character", "world", "timeline", "ai_chat", "custom_c15c6bd8"]',
      categoriesMeta: '{"custom_c15c6bd8": "自訂分類001", "custom_orphan01": "【範例】遺落分類"}',
      cards: [
        { category: 'ai_chat' },
        { category: 'character' },
        { category: 'legacy_cat' },
        { category: 'custom_unlisted' },
      ],
    });

    expect(categories.map((c) => c.id)).toEqual([
      'summary',
      'character',
      'world',
      'timeline',
      'custom_c15c6bd8',
      'custom_orphan01',
      'legacy_cat',
      'custom_unlisted',
    ]);
    expect(categories.find((c) => c.id === 'custom_c15c6bd8')?.name).toBe('自訂分類001');
    expect(categories.find((c) => c.id === 'legacy_cat')?.isOrphan).toBe(true);
    expect(categories.find((c) => c.id === 'ai_chat')).toBeUndefined();
    expect(getCategoryDisplayName('summary')).toBe('本書綱要');
  });

  it('WO-52 (c) categories_meta 中非自訂分類代碼的字串鍵不當成分類顯示，但寫回時照原樣保留；已在 category_order 或實際有卡片用到的代碼仍正常顯示（ai_chat 除外）', () => {
    const rawMeta = JSON.stringify({
      custom_c15c6bd8: '自訂分類001',
      custom_a1b2c3d4: '【範例】僅在 meta 的自訂分類',
      desktop_view_mode: 'compact',
      desktop_sort_key: 'updated_at',
      custom_setting_flag: 'enabled',
      custom_123: '太短非8碼',
      custom_123456789: '太長非8碼',
      in_order_special: '【範例】已在排序中的特殊分類',
      card_used_key: '【範例】有卡片用到的分類名',
    });

    const categories = resolveVisibleCategories({
      categoryOrder: JSON.stringify([
        'summary',
        'character',
        'world',
        'timeline',
        'ai_chat',
        'custom_c15c6bd8',
        'in_order_special',
      ]),
      categoriesMeta: rawMeta,
      cards: [
        { category: 'ai_chat' },
        { category: 'card_used_key' },
      ],
    });

    const visibleIds = categories.map((c) => c.id);
    expect(visibleIds).toEqual([
      'summary',
      'character',
      'world',
      'timeline',
      'custom_c15c6bd8',
      'in_order_special',
      'custom_a1b2c3d4',
      'card_used_key',
    ]);

    // 非 custom_＋8碼、且不在 category_order、也無卡片使用的字串設定鍵不可顯示為分類
    expect(visibleIds).not.toContain('desktop_view_mode');
    expect(visibleIds).not.toContain('desktop_sort_key');
    expect(visibleIds).not.toContain('custom_setting_flag');
    expect(visibleIds).not.toContain('custom_123');
    expect(visibleIds).not.toContain('custom_123456789');
    expect(visibleIds).not.toContain('ai_chat');

    // 已在 category_order 或有卡片用到的分類仍能正確取得名稱與孤兒標記
    expect(categories.find((c) => c.id === 'in_order_special')?.name).toBe('【範例】已在排序中的特殊分類');
    expect(categories.find((c) => c.id === 'in_order_special')?.isOrphan).toBe(false);
    expect(categories.find((c) => c.id === 'card_used_key')?.name).toBe('【範例】有卡片用到的分類名');
    expect(categories.find((c) => c.id === 'card_used_key')?.isOrphan).toBe(true);

    // 寫回時（不論未改動或淺層修改其他分類名稱）所有字串設定鍵皆原樣保留
    const parsedMeta = parseCategoriesMeta(rawMeta);
    expect(serializeCategoriesMeta(parsedMeta)).toBe(rawMeta);

    const renamedMeta = setCustomCategoryName(parsedMeta, 'custom_c15c6bd8', '【範例】自訂分類001改');
    const savedObj = JSON.parse(serializeCategoriesMeta(renamedMeta)!);
    expect(savedObj.desktop_view_mode).toBe('compact');
    expect(savedObj.desktop_sort_key).toBe('updated_at');
    expect(savedObj.custom_setting_flag).toBe('enabled');
    expect(savedObj.custom_123).toBe('太短非8碼');
    expect(savedObj.custom_123456789).toBe('太長非8碼');
    expect(savedObj.custom_c15c6bd8).toBe('【範例】自訂分類001改');
  });
});

describe('WO-61 分類管理規則（cardCategories）', () => {
  const builtinCodes = ['summary', 'character', 'world', 'timeline', 'ai_chat'];

  it('WO-61 分類：內建 4 類與 ai_chat 不能改名（reason: 內建分類不能改名）', () => {
    const rawMeta = JSON.stringify({ custom_c15c6bd8: '自訂分類001' });

    for (const code of builtinCodes) {
      const res = renameCustomCategory({
        code,
        newName: '【範例】改名嘗試',
        categoriesMeta: rawMeta,
      });
      expect(res.renamed).toBe(false);
      expect(res.reason).toBe('內建分類不能改名');
    }
  });

  it('WO-61 分類：內建 4 類與 ai_chat 不能刪除（reason: 內建分類，不能刪除）', () => {
    for (const code of builtinCodes) {
      const check = canDeleteCategory(code, []);
      expect(check.canDelete).toBe(false);
      expect(check.reason).toBe('內建分類，不能刪除');

      const delRes = deleteCustomCategory({
        code,
        categoryOrder: '["summary", "character", "world", "timeline", "ai_chat"]',
        categoriesMeta: '{}',
        cards: [],
      });
      expect(delRes.deleted).toBe(false);
      expect(delRes.reason).toBe('內建分類，不能刪除');
    }
  });

  it('WO-61 分類：自訂分類可改名（寫 categories_meta），且保留其餘未知鍵與設定', () => {
    const rawMeta = JSON.stringify({
      custom_c15c6bd8: '舊分類名',
      desktop_view_mode: 'compact',
      ai_chat: '電腦版AI對話名稱',
    });

    const res = renameCustomCategory({
      code: 'custom_c15c6bd8',
      newName: '新自訂分類名',
      categoriesMeta: rawMeta,
    });

    expect(res.renamed).toBe(true);
    const parsed = JSON.parse(res.nextCategoriesMeta);
    expect(parsed.custom_c15c6bd8).toBe('新自訂分類名');
    expect(parsed.desktop_view_mode).toBe('compact');
    expect(parsed.ai_chat).toBe('電腦版AI對話名稱');

    // 空白名稱拒絕改名
    const blankRes = renameCustomCategory({
      code: 'custom_c15c6bd8',
      newName: '   ',
      categoriesMeta: rawMeta,
    });
    expect(blankRes.renamed).toBe(false);
    expect(blankRes.reason).toBe('名稱不能是空白');
  });

  it('WO-61 分類：自訂分類可上移下移（寫 category_order），保留 ai_chat 與未知元素位置', () => {
    const rawOrder = JSON.stringify([
      'summary',
      'character',
      'world',
      'timeline',
      'ai_chat',
      'custom_00000001',
      'custom_00000002',
    ]);
    const rawMeta = JSON.stringify({
      custom_00000001: '分類一',
      custom_00000002: '分類二',
    });

    // custom_00000002 上移
    const moveUpRes = moveCategoryInOrder({
      code: 'custom_00000002',
      direction: 'up',
      categoryOrder: rawOrder,
      categoriesMeta: rawMeta,
    });
    expect(moveUpRes.moved).toBe(true);
    const orderAfterUp = JSON.parse(moveUpRes.nextCategoryOrder!);
    expect(orderAfterUp).toContain('ai_chat');
    // custom_00000002 移到 custom_00000001 前面
    const idx1 = orderAfterUp.indexOf('custom_00000001');
    const idx2 = orderAfterUp.indexOf('custom_00000002');
    expect(idx2).toBeLessThan(idx1);

    // 最前項不能再上移，最後項不能再下移
    const firstMoveUp = moveCategoryInOrder({
      code: 'summary',
      direction: 'up',
      categoryOrder: rawOrder,
      categoriesMeta: rawMeta,
    });
    expect(firstMoveUp.moved).toBe(false);

    const lastMoveDown = moveCategoryInOrder({
      code: 'custom_00000002',
      direction: 'down',
      categoryOrder: rawOrder,
      categoriesMeta: rawMeta,
    });
    expect(lastMoveDown.moved).toBe(false);
  });

  it('WO-61 分類：有卡片的自訂分類不能刪，並說明要先把卡片移走或刪掉', () => {
    const cards = [
      { id: 'card-1', category: 'custom_c15c6bd8' },
      { id: 'card-2', category: 'character' },
    ];

    const check = canDeleteCategory('custom_c15c6bd8', cards);
    expect(check.canDelete).toBe(false);
    expect(check.reason).toBe('分類內還有卡片，要先把卡片移走或刪掉才能刪除');

    const delRes = deleteCustomCategory({
      code: 'custom_c15c6bd8',
      categoryOrder: '["summary", "custom_c15c6bd8"]',
      categoriesMeta: '{"custom_c15c6bd8": "自訂分類"}',
      cards,
    });
    expect(delRes.deleted).toBe(false);
    expect(delRes.reason).toBe('分類內還有卡片，要先把卡片移走或刪掉才能刪除');
  });

  it('WO-61 分類：沒有卡片的自訂分類可刪除，只移除自己的鍵，ai_chat 與未知鍵原樣保留', () => {
    const rawOrder = JSON.stringify([
      'summary',
      'character',
      'world',
      'timeline',
      'ai_chat',
      'custom_c15c6bd8',
      'custom_another1',
    ]);
    const rawMeta = JSON.stringify({
      custom_c15c6bd8: '要刪的自訂分類',
      custom_another1: '保留的自訂分類',
      desktop_view_mode: 'compact',
      ai_chat: 'AI 對話紀錄',
    });
    const cards = [
      { id: 'c-1', category: 'summary' },
      { id: 'c-2', category: 'custom_another1' },
    ];

    const delRes = deleteCustomCategory({
      code: 'custom_c15c6bd8',
      categoryOrder: rawOrder,
      categoriesMeta: rawMeta,
      cards,
      expandedCategories: JSON.stringify(['summary', 'custom_c15c6bd8']),
    });

    expect(delRes.deleted).toBe(true);

    // category_order 移除自己的代碼，但 ai_chat 與其他分類完整保留
    const nextOrder = JSON.parse(delRes.nextCategoryOrder!);
    expect(nextOrder).not.toContain('custom_c15c6bd8');
    expect(nextOrder).toContain('ai_chat');
    expect(nextOrder).toContain('custom_another1');
    expect(nextOrder).toContain('summary');

    // categories_meta 僅移除自己的鍵，其餘未知鍵原樣保留
    const nextMeta = JSON.parse(delRes.nextCategoriesMeta);
    expect(nextMeta.custom_c15c6bd8).toBeUndefined();
    expect(nextMeta.custom_another1).toBe('保留的自訂分類');
    expect(nextMeta.desktop_view_mode).toBe('compact');
    expect(nextMeta.ai_chat).toBe('AI 對話紀錄');

    // expandedCategories 亦一併移除該代碼
    const nextExpanded = JSON.parse(delRes.nextExpandedCategories!);
    expect(nextExpanded).toEqual(['summary']);
  });

  it('WO-61 分類：新增自訂分類產生 custom_＋8 碼，加入 category_order 並寫入 categories_meta', () => {
    const rawOrder = JSON.stringify(['summary', 'character', 'world', 'timeline', 'ai_chat']);
    const rawMeta = JSON.stringify({ desktop_setting: true });

    const addRes = addCustomCategory({
      name: '【範例】武器設定',
      categoryOrder: rawOrder,
      categoriesMeta: rawMeta,
    });

    expect(addRes.added).toBe(true);
    expect(addRes.code).toMatch(CUSTOM_CATEGORY_REGEX);

    const nextOrder = JSON.parse(addRes.nextCategoryOrder!);
    expect(nextOrder).toContain(addRes.code);
    expect(nextOrder).toContain('ai_chat');

    const nextMeta = JSON.parse(addRes.nextCategoriesMeta);
    expect(nextMeta[addRes.code]).toBe('【範例】武器設定');
    expect(nextMeta.desktop_setting).toBe(true);
  });
});
