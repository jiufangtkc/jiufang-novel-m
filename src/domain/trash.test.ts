import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import {
  appendToChapterEndPlan,
  collectAliveWritableNodeIds,
  computePutBackPlan,
  createTrashItem,
  extractDeletedRange,
  extractTrashAnchor,
  insertTrashItemWithLimit,
  isTrashOriginalNodeAlive,
  listWritableTargetNodes,
  nextTrashSortOrder,
  normalizeTrashItems,
  shouldAutoCaptureDeletion,
  summarizeTrashUsage,
  TRASH_AUTO_MIN_WORDS,
  TRASH_MAX_ITEMS,
  TRASH_MAX_WORDS,
} from './trash';
import { countWords } from './wordCount';

function sampleTree(): ChapterNode[] {
  return [
    {
      id: 'vol-1',
      type: 'folder',
      title: '第一卷　霧港（範例）',
      children: [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　來信',
          content: '【範例】第一章開頭',
        },
        {
          id: 'ch-2',
          type: 'file',
          title: '第二章　燈塔',
          content: '【範例】第二章正文',
          children: [
            {
              id: 'sc-1',
              type: 'scene',
              title: '幕 1　上坡',
              content: '【範例】幕一正文',
            },
          ],
        },
      ],
    },
  ];
}

describe('WO-138 第 1 段：刪稿領域模型與 100 字門檻', () => {
  it('門檻為 100 字，1～99 字不自動收錄，100 字以上自動收錄', () => {
    expect(TRASH_AUTO_MIN_WORDS).toBe(100);
    expect(shouldAutoCaptureDeletion(countWords('港'.repeat(1)))).toBe(false);
    expect(shouldAutoCaptureDeletion(countWords('港'.repeat(50)))).toBe(false);
    expect(shouldAutoCaptureDeletion(countWords('港'.repeat(99)))).toBe(false);
    expect(shouldAutoCaptureDeletion(countWords('港'.repeat(100)))).toBe(true);
    expect(shouldAutoCaptureDeletion(countWords('霧'.repeat(120)))).toBe(true);
  });

  it('選取快照優先精確擷取被刪片段，重複字元不會對齊偏移', () => {
    const before = '她說「好」字，然後又說「好」字，最後轉身離開。';
    // 選取第二個「好」字（index 12..13）後刪除
    const secondIdx = before.lastIndexOf('「好」');
    const delStart = secondIdx + 1;
    const delEnd = delStart + 1;
    const after = before.slice(0, delStart) + before.slice(delEnd);

    const range = extractDeletedRange(before, after, {
      start: delStart,
      end: delEnd,
      beforeLength: before.length,
    });
    expect(range).toEqual({ start: delStart, end: delEnd });

    const anchor = extractTrashAnchor(before, range.start, range.end);
    expect(anchor.deletedText).toBe('好');
    expect(anchor.wordCount).toBe(1);
    expect(anchor.beforeAnchor).toBe(before.slice(0, delStart));
    expect(anchor.afterAnchor).toBe(before.slice(delEnd));
    expect(anchor.charOffset).toBe(delStart);
  });

  it('無選取快照時回退前後綴 diff，並限制前後文錨點各最多 40 字元', () => {
    const prefix = '甲'.repeat(60);
    const deleted = '乙'.repeat(105);
    const suffix = '丙'.repeat(60);
    const before = prefix + deleted + suffix;
    const after = prefix + suffix;

    const range = extractDeletedRange(before, after, null);
    expect(range).toEqual({ start: 60, end: 165 });

    const anchor = extractTrashAnchor(before, range.start, range.end);
    expect(anchor.deletedText).toBe(deleted);
    expect(anchor.wordCount).toBe(105);
    expect(anchor.beforeAnchor).toBe('甲'.repeat(40));
    expect(anchor.afterAnchor).toBe('丙'.repeat(40));
    expect(anchor.charOffset).toBe(60);
  });
});

describe('WO-138 第 1 段：50 則與 5 萬字上限清理規則', () => {
  it('達 50 則上限時，優先清掉最舊且無註記原因的項目並保護有註記項目', () => {
    const baseMs = 1_700_000_000_000;
    const items = Array.from({ length: TRASH_MAX_ITEMS }, (_, index) =>
      createTrashItem({
        itemId: `item-${String(index).padStart(2, '0')}`,
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章　來信',
        content: '霧'.repeat(10),
        deletedAtMs: baseMs + index * 1000,
        // 最舊那則（index 0）有寫原因，第 2 舊（index 1）沒有寫原因
        reason: index === 0 ? '節奏太拖' : '',
      }),
    );

    const incoming = createTrashItem({
      itemId: 'item-new',
      chapterId: 'ch-1',
      chapterTitleSnapshot: '第一章　來信',
      content: '港'.repeat(120),
      deletedAtMs: baseMs + 100_000,
    });

    const result = insertTrashItemWithLimit(items, incoming);
    expect(result.kind).toBe('added');
    if (result.kind !== 'added') return;

    expect(result.evictedCount).toBe(1);
    expect(result.evictedIds).toEqual(['item-01']);
    expect(result.items).toHaveLength(TRASH_MAX_ITEMS);
    expect(result.items.some((item) => item.itemId === 'item-00')).toBe(true);
    expect(result.items.some((item) => item.itemId === 'item-01')).toBe(false);
    expect(result.items[0]?.itemId).toBe('item-new');
  });

  it('達 50,000 字上限時，依序清掉最舊無註記項目直到放得下', () => {
    const baseMs = 1_700_000_000_000;
    const existing = [
      createTrashItem({
        itemId: 'annotated-old',
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章',
        content: '甲'.repeat(20_000),
        deletedAtMs: baseMs + 1000,
        reason: '要留著對照',
      }),
      createTrashItem({
        itemId: 'plain-1',
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章',
        content: '乙'.repeat(15_000),
        deletedAtMs: baseMs + 2000,
      }),
      createTrashItem({
        itemId: 'plain-2',
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章',
        content: '丙'.repeat(15_000),
        deletedAtMs: baseMs + 3000,
      }),
    ];

    const incoming = createTrashItem({
      itemId: 'incoming',
      chapterId: 'ch-1',
      chapterTitleSnapshot: '第一章',
      content: '丁'.repeat(20_000),
      deletedAtMs: baseMs + 4000,
    });

    const result = insertTrashItemWithLimit(existing, incoming);
    expect(result.kind).toBe('added');
    if (result.kind !== 'added') return;

    expect(result.evictedIds).toEqual(['plain-1', 'plain-2']);
    expect(result.evictedCount).toBe(2);
    expect(result.items.map((item) => item.itemId)).toEqual(['incoming', 'annotated-old']);
  });

  it('全部都有註記又滿、或單筆超大時，不動既有項目並回傳 blocked-full', () => {
    const baseMs = 1_700_000_000_000;
    const fullAnnotated = Array.from({ length: TRASH_MAX_ITEMS }, (_, index) =>
      createTrashItem({
        itemId: `ann-${index}`,
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章',
        content: '霧'.repeat(20),
        deletedAtMs: baseMs + index * 1000,
        reason: '有寫原因',
      }),
    );

    const blockedAll = insertTrashItemWithLimit(
      fullAnnotated,
      createTrashItem({
        itemId: 'extra',
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章',
        content: '港'.repeat(120),
        deletedAtMs: baseMs + 99_000,
      }),
    );
    expect(blockedAll.kind).toBe('blocked-full');
    if (blockedAll.kind === 'blocked-full') {
      expect(blockedAll.reason).toBe('all-annotated');
      expect(blockedAll.items).toHaveLength(TRASH_MAX_ITEMS);
      expect(blockedAll.items.some((item) => item.itemId === 'extra')).toBe(false);
    }

    const tooBig = insertTrashItemWithLimit(
      [
        createTrashItem({
          itemId: 'plain',
          chapterId: 'ch-1',
          chapterTitleSnapshot: '第一章',
          content: '甲'.repeat(100),
          deletedAtMs: baseMs,
        }),
      ],
      createTrashItem({
        itemId: 'giant',
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章',
        content: '乙'.repeat(TRASH_MAX_WORDS + 1),
        deletedAtMs: baseMs + 1000,
      }),
    );
    expect(tooBig.kind).toBe('blocked-full');
    if (tooBig.kind === 'blocked-full') {
      expect(tooBig.reason).toBe('exceeds-max-words');
      expect(tooBig.items.map((item) => item.itemId)).toEqual(['plain']);
    }
  });

  it('統計接近上限、達上限與同毫秒排序', () => {
    const items = [
      createTrashItem({
        itemId: 'a',
        chapterId: 'ch-1',
        chapterTitleSnapshot: '第一章',
        content: '霧'.repeat(40_000),
        deletedAtMs: 1000,
        sortOrder: 0,
      }),
    ];
    const near = summarizeTrashUsage(items);
    expect(near.nearLimit).toBe(true);
    expect(near.atLimit).toBe(false);
    expect(near.hasEvictable).toBe(true);

    expect(nextTrashSortOrder(items, 1000)).toBe(1);
    expect(nextTrashSortOrder(items, 2000)).toBe(0);

    const normalized = normalizeTrashItems([
      { itemId: 'a', content: '甲', deletedAtMs: 1000, sortOrder: 0 },
      { itemId: 'b', content: '乙', deletedAtMs: 1000, sortOrder: 1 },
      { itemId: '', content: '無效' },
    ]);
    expect(normalized.map((item) => item.itemId)).toEqual(['b', 'a']);
  });
});

describe('WO-138 第 1 段：放回原章演算法與節點存活檢查', () => {
  it('雙錨點與近端短雙錨點能準確放回原位，並選最接近 charOffset 的位置', () => {
    const content = '【範例】這是被刪掉的一段核心對話。';
    const beforeAnchor = '前面的燈塔亮著，';
    const afterAnchor = '她收起信紙往下走。';
    const body = `重複段：${beforeAnchor}${afterAnchor}中間隔了很多字。重複段：${beforeAnchor}${afterAnchor}`;
    const secondSeam = body.lastIndexOf(afterAnchor);

    const plan = computePutBackPlan(body, {
      content,
      beforeAnchor,
      afterAnchor,
      charOffset: secondSeam,
    });
    expect(plan.placement).toBe('original');
    expect(plan.insertStart).toBe(secondSeam);
    expect(plan.nextBody.slice(plan.insertStart, plan.insertEnd)).toBe(content);

    // 遠端字元稍微改寫，近端 12 字元雙錨點仍可對上
    const nearBefore = '燈塔在霧夜裡依然亮著光，';
    const nearAfter = '她收起信紙沿著石階往下走';
    const modifiedBefore = '遠處改掉了，' + nearBefore;
    const modifiedAfter = nearAfter + '（遠處改寫）';
    const body2 = `開頭。${nearBefore}${nearAfter}結尾。`;
    const planShort = computePutBackPlan(body2, {
      content,
      beforeAnchor: modifiedBefore,
      afterAnchor: modifiedAfter,
      charOffset: 3,
    });
    expect(planShort.placement).toBe('original');
    expect(planShort.nextBody).toBe(`開頭。${nearBefore}${content}${nearAfter}結尾。`);
  });

  it('章首、章尾、空章與單側長錨點唯一命中皆放回原位', () => {
    const startPlan = computePutBackPlan('後續段落開始。', {
      content: '開頭段落。',
      beforeAnchor: '',
      afterAnchor: '後續段落開始。',
      charOffset: 0,
    });
    expect(startPlan.placement).toBe('original');
    expect(startPlan.nextBody).toBe('開頭段落。後續段落開始。');

    const endPlan = computePutBackPlan('前面的最後一句。', {
      content: '結尾補段。',
      beforeAnchor: '前面的最後一句。',
      afterAnchor: '',
      charOffset: 8,
    });
    expect(endPlan.placement).toBe('original');
    expect(endPlan.nextBody).toBe('前面的最後一句。結尾補段。');

    const emptyPlan = computePutBackPlan('', {
      content: '整章重放。',
      beforeAnchor: '',
      afterAnchor: '',
      charOffset: 0,
    });
    expect(emptyPlan.placement).toBe('original');
    expect(emptyPlan.nextBody).toBe('整章重放。');

    const singleSidePlan = computePutBackPlan('這段前面有十個字以上的前文內容後來改掉了後面。', {
      content: '插回中段。',
      beforeAnchor: '十個字以上的前文內容',
      afterAnchor: '已經找不到的後文',
      charOffset: 10,
    });
    expect(singleSidePlan.placement).toBe('original');
    expect(singleSidePlan.nextBody).toBe('這段前面有十個字以上的前文內容插回中段。後來改掉了後面。');
  });

  it('原位置完全對不上時放到本章最末，並妥善補齊段落換行', () => {
    const planNoNewline = computePutBackPlan('整章已經大幅重寫。', {
      content: '原本的段落',
      beforeAnchor: '舊前文找不到了',
      afterAnchor: '舊後文也找不到了',
      charOffset: 5,
    });
    expect(planNoNewline.placement).toBe('end');
    expect(planNoNewline.nextBody).toBe('整章已經大幅重寫。\n\n原本的段落');
    expect(planNoNewline.nextBody.slice(planNoNewline.insertStart, planNoNewline.insertEnd)).toBe('原本的段落');

    expect(appendToChapterEndPlan('已有一個換行\n', '新段').nextBody).toBe('已有一個換行\n\n新段');
    expect(appendToChapterEndPlan('已有兩個換行\n\n', '新段').nextBody).toBe('已有兩個換行\n\n新段');
    expect(appendToChapterEndPlan('', '新段').nextBody).toBe('新段');
  });

  it('幕 scene 不會被誤判為原章已刪，目錄卷 folder 不視為可寫目標', () => {
    const tree = sampleTree();
    const alive = collectAliveWritableNodeIds(tree);
    expect(alive.has('ch-1')).toBe(true);
    expect(alive.has('ch-2')).toBe(true);
    expect(alive.has('sc-1')).toBe(true);
    expect(alive.has('vol-1')).toBe(false);

    expect(isTrashOriginalNodeAlive(tree, 'sc-1')?.title).toBe('幕 1　上坡');
    expect(isTrashOriginalNodeAlive(tree, 'vol-1')).toBeNull();
    expect(isTrashOriginalNodeAlive(tree, 'missing')).toBeNull();

    const targets = listWritableTargetNodes(tree);
    expect(targets.map((t) => `${t.node.id}:${t.parentChapterTitle ?? ''}`)).toEqual([
      'ch-1:',
      'ch-2:',
      'sc-1:第二章　燈塔',
    ]);
  });
});
