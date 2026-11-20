import { describe, expect, it } from 'vitest';
import {
  CATEGORY_AI_CHAT,
  CATEGORY_CHARACTER,
  CATEGORY_SUMMARY,
  CATEGORY_TIMELINE,
  CATEGORY_WORLD,
} from './cardCategories';
import {
  buildChapterIndex,
  buildTimelineModel,
  collectAliveChapterIds,
  computeDualAxisLines,
  computeFlashbackIds,
  extractTimelineChapters,
  moveTimelineCardByDelta,
  moveTimelineCardByDrop,
  moveTimelineCardToIndex,
  nextTimelineOrderForNewEvent,
  reorderTimelineByOrderedIds,
  selectTopLevelTimelineCards,
  sortTimelineStoryCards,
  splitChapterTitle,
  type TimelineCardInput,
  type TimelineChapterNodeInput,
} from './timeline';

function makeCard(overrides: Partial<TimelineCardInput> & { id: string }): TimelineCardInput {
  return {
    parent_id: null,
    category: CATEGORY_TIMELINE,
    title: '【範例】事件',
    content: '',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 0,
    ...overrides,
  };
}

/** 樣張《霧港旅館》5 章、7 事件測試資料（對應 .wo128/樣張/data.js）。 */
function fogHarborFixture(): {
  chapters: TimelineChapterNodeInput[];
  cards: TimelineCardInput[];
} {
  const chapters: TimelineChapterNodeInput[] = [
    { id: 'ch-1', type: 'file', title: '第一章　清晨的書房' },
    { id: 'ch-2', type: 'file', title: '第二章　偵探上岸' },
    { id: 'ch-3', type: 'file', title: '第三章　十年前的火' },
    { id: 'ch-4', type: 'file', title: '第四章　每個人都在別處' },
    { id: 'ch-5', type: 'file', title: '第五章　霧散' },
  ];
  const cards: TimelineCardInput[] = [
    makeCard({
      id: 'e1',
      storyTime: '十年前・冬',
      title: '舊館大火，沈家小女兒失蹤',
      chapterId: 'ch-3',
      color: '#E06C75',
      sort_order: 0,
      timelineOrder: 0,
    }),
    makeCard({
      id: 'e2',
      storyTime: '案發前三個月',
      title: '沈伯謙偷偷改了遺囑',
      chapterId: null,
      color: '#C5BEE0',
      sort_order: 1,
      timelineOrder: 1,
    }),
    makeCard({
      id: 'e3',
      storyTime: '案發當晚 20:00',
      title: '周嫂在湯裡下了安眠藥',
      chapterId: 'ch-5',
      color: '#E89A5C',
      sort_order: 2,
      timelineOrder: 2,
    }),
    makeCard({
      id: 'e4',
      storyTime: '案發當晚 23:40',
      title: '沈伯謙在書房遇害',
      chapterId: 'ch-5',
      color: '#E06C75',
      sort_order: 3,
      timelineOrder: 3,
    }),
    makeCard({
      id: 'e5',
      storyTime: '隔天清晨',
      title: '女傭阿蘋發現書房反鎖',
      chapterId: 'ch-1',
      color: '#3C3F41',
      sort_order: 4,
      timelineOrder: 4,
    }),
    makeCard({
      id: 'e6',
      storyTime: '隔天中午',
      title: '偵探林曉霧搭渡輪抵達霧港',
      chapterId: 'ch-2',
      color: '#3C3F41',
      sort_order: 5,
      timelineOrder: 5,
    }),
    makeCard({
      id: 'e7',
      storyTime: '隔天傍晚',
      title: '逐一詢問三人的不在場證明',
      chapterId: 'ch-4',
      color: '#3C3F41',
      sort_order: 6,
      timelineOrder: 6,
    }),
  ];
  return { chapters, cards };
}

describe('時間線領域純函式（timeline）', () => {
  describe('頂層時間軸卡篩選', () => {
    it('只保留時間軸頂層卡，排除子卡片與其他分類，並處理孤兒與循環參照', () => {
      const cards: TimelineCardInput[] = [
        makeCard({ id: 't1', sort_order: 1, title: '頂層事件 1' }),
        makeCard({ id: 't1-sub', parent_id: 't1', sort_order: 0, title: '子事件不上線' }),
        makeCard({ id: 't1-grand', parent_id: 't1-sub', sort_order: 0, title: '孫事件不上線' }),
        makeCard({ id: 'orphan', parent_id: 'missing-id', sort_order: 2, title: '孤兒事件升頂層' }),
        makeCard({ id: 'cross', parent_id: 'char-1', sort_order: 3, title: '跨分類父卡升頂層' }),
        makeCard({ id: 'cyc-a', parent_id: 'cyc-b', sort_order: 4, title: '循環 A' }),
        makeCard({ id: 'cyc-b', parent_id: 'cyc-a', sort_order: 5, title: '循環 B' }),
        makeCard({ id: 'cyc-sub', parent_id: 'cyc-a', sort_order: 0, title: '循環下子卡不上線' }),
        makeCard({ id: 'char-1', category: CATEGORY_CHARACTER, sort_order: 0, title: '角色卡' }),
        makeCard({ id: 'world-1', category: CATEGORY_WORLD, sort_order: 0, title: '世界觀卡' }),
        makeCard({ id: 'sum-1', category: CATEGORY_SUMMARY, sort_order: 0, title: '綱要卡' }),
        makeCard({ id: 'custom-1', category: 'custom_1234abcd', sort_order: 0, title: '自訂分類卡' }),
        makeCard({ id: 'ai-1', category: CATEGORY_AI_CHAT, sort_order: 0, title: 'AI 對話卡' }),
      ];

      const topIds = selectTopLevelTimelineCards(cards).map((c) => c.id);
      expect(topIds).toEqual(['t1', 'orphan', 'cross', 'cyc-a', 'cyc-b']);
    });
  });

  describe('故事順序排序與重排', () => {
    it('首次未排依 sort_order；不依故事時間文字排；已排後依 timelineOrder 且新卡 null 放最後', () => {
      const firstOpen: TimelineCardInput[] = [
        makeCard({ id: 'b', sort_order: 2, storyTime: '第一年' }),
        makeCard({ id: 'a', sort_order: 0, storyTime: '第十年' }),
        makeCard({ id: 'c', sort_order: 1, storyTime: '第五年' }),
      ];
      expect(sortTimelineStoryCards(firstOpen).map((c) => c.id)).toEqual(['a', 'c', 'b']);

      const mixed: TimelineCardInput[] = [
        makeCard({ id: 'new-1', sort_order: 0, timelineOrder: null, storyTime: '一萬年前' }),
        makeCard({ id: 'ord-2', sort_order: 1, timelineOrder: 1, storyTime: '明年' }),
        makeCard({ id: 'ord-1', sort_order: 5, timelineOrder: 0, storyTime: '後年' }),
        makeCard({ id: 'new-2', sort_order: 2, timelineOrder: undefined, storyTime: '昨天' }),
      ];
      expect(sortTimelineStoryCards(mixed).map((c) => c.id)).toEqual([
        'ord-1',
        'ord-2',
        'new-1',
        'new-2',
      ]);
    });

    it('計算新增事件的預設 timelineOrder（全 null 回傳 null，有排序時回傳 max + 1）', () => {
      const unranked = [
        makeCard({ id: 'e1', sort_order: 0, timelineOrder: null }),
        makeCard({ id: 'e2', sort_order: 1 }),
      ];
      expect(nextTimelineOrderForNewEvent(unranked)).toBeNull();

      const ranked = [
        makeCard({ id: 'e1', sort_order: 0, timelineOrder: 0 }),
        makeCard({ id: 'e2', sort_order: 1, timelineOrder: 4 }),
        makeCard({ id: 'e3', sort_order: 2, timelineOrder: null }),
      ];
      expect(nextTimelineOrderForNewEvent(ranked)).toBe(5);
    });

    it('支援上移、下移、指定索引與拖曳落點重排並重算 0..M-1，不改動他類卡片參照', () => {
      const nonTimeline = makeCard({ id: 'char-1', category: CATEGORY_CHARACTER, sort_order: 0 });
      const subCard = makeCard({ id: 'sub-1', parent_id: 'e1', sort_order: 0 });
      const cards: TimelineCardInput[] = [
        nonTimeline,
        makeCard({ id: 'e1', sort_order: 0 }),
        makeCard({ id: 'e2', sort_order: 1 }),
        makeCard({ id: 'e3', sort_order: 2 }),
        subCard,
      ];

      // 下移第一位 e1 -> [e2, e1, e3]，寫入 0, 1, 2
      const afterDown = moveTimelineCardByDelta(cards, 'e1', 1);
      expect(sortTimelineStoryCards(afterDown).map((c) => [c.id, c.timelineOrder])).toEqual([
        ['e2', 0],
        ['e1', 1],
        ['e3', 2],
      ]);
      // 其他分類與子卡片維持原物件參照
      expect(afterDown.find((c) => c.id === 'char-1')).toBe(nonTimeline);
      expect(afterDown.find((c) => c.id === 'sub-1')).toBe(subCard);

      // 邊界：第一位不可上移、最後一位不可下移
      expect(
        sortTimelineStoryCards(moveTimelineCardByDelta(afterDown, 'e2', -1)).map((c) => c.id),
      ).toEqual(['e2', 'e1', 'e3']);
      expect(
        sortTimelineStoryCards(moveTimelineCardByDelta(afterDown, 'e3', 1)).map((c) => c.id),
      ).toEqual(['e2', 'e1', 'e3']);

      // 上移最後一位 e3 -> [e2, e3, e1]
      const afterUp = moveTimelineCardByDelta(afterDown, 'e3', -1);
      expect(sortTimelineStoryCards(afterUp).map((c) => [c.id, c.timelineOrder])).toEqual([
        ['e2', 0],
        ['e3', 1],
        ['e1', 2],
      ]);

      // 指定任意目標索引：把 e1 移到索引 0 -> [e1, e2, e3]
      const afterToIndex = moveTimelineCardToIndex(afterUp, 'e1', 0);
      expect(sortTimelineStoryCards(afterToIndex).map((c) => [c.id, c.timelineOrder])).toEqual([
        ['e1', 0],
        ['e2', 1],
        ['e3', 2],
      ]);

      // 任意拖曳落點：把 e1 拖到 e3 之後 -> [e2, e3, e1]；把 e1 拖到 e2 之前 -> [e1, e2, e3]
      const afterDropAfter = moveTimelineCardByDrop(afterToIndex, 'e1', { id: 'e3', after: true });
      expect(sortTimelineStoryCards(afterDropAfter).map((c) => [c.id, c.timelineOrder])).toEqual([
        ['e2', 0],
        ['e3', 1],
        ['e1', 2],
      ]);
      const afterDropBefore = moveTimelineCardByDrop(afterDropAfter, 'e1', {
        id: 'e2',
        after: false,
      });
      expect(sortTimelineStoryCards(afterDropBefore).map((c) => [c.id, c.timelineOrder])).toEqual([
        ['e1', 0],
        ['e2', 1],
        ['e3', 2],
      ]);

      // 直接指定有序清單重算 0..M-1
      const afterOrdered = reorderTimelineByOrderedIds(afterDropBefore, ['e3', 'e1', 'e2']);
      expect(sortTimelineStoryCards(afterOrdered).map((c) => [c.id, c.timelineOrder])).toEqual([
        ['e3', 0],
        ['e1', 1],
        ['e2', 2],
      ]);
    });

    it('審查 1 (3)：從沒排過序的舊稿原地拖放（搬移後順序與原順序相同）直接回傳原卡片、不寫入 timelineOrder', () => {
      const c1 = makeCard({ id: 'e1', sort_order: 0 });
      const c2 = makeCard({ id: 'e2', sort_order: 1 });
      const c3 = makeCard({ id: 'e3', sort_order: 2 });
      const unranked: TimelineCardInput[] = [c1, c2, c3];

      // 把第 1 張 e1 拖到第 2 張 e2 之前（落點順序仍是 e1, e2, e3）
      const dropBeforeNext = moveTimelineCardByDrop(unranked, 'e1', { id: 'e2', after: false });
      expect(dropBeforeNext).toEqual(unranked);
      expect(dropBeforeNext[0]).toBe(c1);
      expect(dropBeforeNext[1]).toBe(c2);
      expect(dropBeforeNext[2]).toBe(c3);
      expect(dropBeforeNext.every((c) => c.timelineOrder === undefined)).toBe(true);

      // 把第 2 張 e2 拖到第 1 張 e1 之後（落點順序仍是 e1, e2, e3）
      const dropAfterPrev = moveTimelineCardByDrop(unranked, 'e2', { id: 'e1', after: true });
      expect(dropAfterPrev).toEqual(unranked);
      expect(dropAfterPrev.every((c) => c.timelineOrder === undefined)).toBe(true);
    });
  });

  describe('目錄章清單與分卷名稱格式化', () => {
    it('支援根層章、分卷章（含收合卷）、跳過幕、相容 volume/chapter 節點型別', () => {
      expect(splitChapterTitle('第三章　十年前的火')).toEqual({
        lead: '第三章',
        sub: '十年前的火',
      });
      expect(splitChapterTitle('序章')).toEqual({ lead: '序章', sub: '' });
      expect(splitChapterTitle('第一章　')).toEqual({ lead: '第一章', sub: '' });

      const nodes: TimelineChapterNodeInput[] = [
        {
          id: 'ch-0',
          type: 'file',
          title: '楔子　風雨欲來',
          children: [{ id: 'sc-0', type: 'scene', title: '第一幕' }],
        },
        {
          id: 'vol-1',
          type: 'folder',
          title: '第一卷　霧港',
          expanded: false,
          children: [
            { id: 'ch-1', type: 'file', title: '第一章　清晨的書房' },
            {
              id: 'ch-3',
              type: 'file',
              title: '第三章　十年前的火',
              children: [{ id: 'sc-3-1', type: 'scene', title: '火場' }],
            },
          ],
        },
        {
          id: 'vol-2',
          type: 'volume',
          title: '第二卷　真相',
          expanded: true,
          children: [{ id: 'ch-4', type: 'chapter', title: '第四章 歸途' }],
        },
      ];

      const chapters = extractTimelineChapters(nodes);
      expect(chapters.map((c) => c.id)).toEqual(['ch-0', 'ch-1', 'ch-3', 'ch-4']);
      expect(Array.from(collectAliveChapterIds(nodes))).toEqual(['ch-0', 'ch-1', 'ch-3', 'ch-4']);

      const index = buildChapterIndex(nodes);
      expect(index.get('ch-0')).toMatchObject({
        headerLead: '楔子',
        headerSub: '風雨欲來',
        chipLabel: '楔子',
        pickerLabel: '楔子　風雨欲來',
        jumpLabel: '跳到楔子',
      });
      expect(index.get('ch-3')).toMatchObject({
        volumeTitle: '第一卷　霧港',
        volumeLead: '第一卷',
        headerLead: '第一卷・第三章',
        headerSub: '十年前的火',
        chipLabel: '第一卷・第三章',
        pickerLabel: '第一卷・第三章　十年前的火',
        jumpLabel: '跳到第一卷・第三章',
      });
      expect(index.get('ch-4')).toMatchObject({
        headerLead: '第二卷・第四章',
        headerSub: '歸途',
        chipLabel: '第二卷・第四章',
        pickerLabel: '第二卷・第四章 歸途',
        jumpLabel: '跳到第二卷・第四章',
      });
    });
  });

  describe('《霧港旅館》7 事件 5 章完整驗算與章節順序分段', () => {
    it('精準命中倒敘 {e1, e3, e4}、未揭露 {e2}，並正確分段與省略空章', () => {
      const { chapters, cards } = fogHarborFixture();
      const model = buildTimelineModel(cards, chapters);

      expect(model.storyEvents.map((e) => [e.id, e.storyPosition])).toEqual([
        ['e1', 1],
        ['e2', 2],
        ['e3', 3],
        ['e4', 4],
        ['e5', 5],
        ['e6', 6],
        ['e7', 7],
      ]);

      expect(model.readingEvents.map((e) => [e.id, e.readingPosition])).toEqual([
        ['e5', 1],
        ['e6', 2],
        ['e1', 3],
        ['e7', 4],
        ['e3', 5],
        ['e4', 6],
      ]);

      expect(Array.from(model.flashbackIds).sort()).toEqual(['e1', 'e3', 'e4']);
      expect(model.unassignedEvents.map((e) => [e.id, e.storyPosition, e.readingPosition])).toEqual([
        ['e2', 2, null],
      ]);

      expect(model.chapterSections.map((s) => [s.chapter.id, s.events.map((e) => e.id)])).toEqual([
        ['ch-1', ['e5']],
        ['ch-2', ['e6']],
        ['ch-3', ['e1']],
        ['ch-4', ['e7']],
        ['ch-5', ['e3', 'e4']],
      ]);

      expect(model.dualBottomEvents.map((e) => e.id)).toEqual([
        'e5',
        'e6',
        'e1',
        'e7',
        'e3',
        'e4',
        'e2',
      ]);
      expect(model.dualBottomGroups.map((g) => [g.kind, g.chapter?.id ?? null, g.span])).toEqual([
        ['chapter', 'ch-1', 1],
        ['chapter', 'ch-2', 1],
        ['chapter', 'ch-3', 1],
        ['chapter', 'ch-4', 1],
        ['chapter', 'ch-5', 2],
        ['unassigned', null, 1],
      ]);
    });

    it('省略空章、章內依故事順序排、全連章時不產生未連章群組', () => {
      const chapters: TimelineChapterNodeInput[] = [
        { id: 'ch-1', type: 'file', title: '第一章　空章' },
        { id: 'ch-2', type: 'file', title: '第二章　有事件' },
      ];
      const cards: TimelineCardInput[] = [
        makeCard({ id: 'b', sort_order: 1, timelineOrder: 1, chapterId: 'ch-2' }),
        makeCard({ id: 'a', sort_order: 0, timelineOrder: 0, chapterId: 'ch-2' }),
      ];

      const model = buildTimelineModel(cards, chapters);
      expect(model.chapterSections.map((s) => s.chapter.id)).toEqual(['ch-2']);
      expect(model.chapterSections[0]?.events.map((e) => e.id)).toEqual(['a', 'b']);
      expect(model.unassignedEvents).toHaveLength(0);
      expect(model.dualBottomGroups.map((g) => g.kind)).toEqual(['chapter']);
    });
  });

  describe('倒敘演算法邊界案例', () => {
    it('全順敘回傳空集合；全倒敘除第一件外全中；同章多倒敘皆標；第一件永非倒敘', () => {
      const chapters: TimelineChapterNodeInput[] = [
        { id: 'c1', type: 'file', title: '第一章' },
        { id: 'c2', type: 'file', title: '第二章' },
        { id: 'c3', type: 'file', title: '第三章' },
      ];

      // 全順敘：故事 1->2->3 對應 章 1->2->3
      const linearCards = [
        makeCard({ id: 's1', timelineOrder: 0, chapterId: 'c1' }),
        makeCard({ id: 's2', timelineOrder: 1, chapterId: 'c2' }),
        makeCard({ id: 's3', timelineOrder: 2, chapterId: 'c3' }),
      ];
      expect(Array.from(buildTimelineModel(linearCards, chapters).flashbackIds)).toEqual([]);

      // 全倒敘：章 1 讀 s3，章 2 讀 s2，章 3 讀 s1 -> 第一件 s3 不算，{s2, s1} 為倒敘
      const reverseCards = [
        makeCard({ id: 's1', timelineOrder: 0, chapterId: 'c3' }),
        makeCard({ id: 's2', timelineOrder: 1, chapterId: 'c2' }),
        makeCard({ id: 's3', timelineOrder: 2, chapterId: 'c1' }),
      ];
      expect(Array.from(buildTimelineModel(reverseCards, chapters).flashbackIds).sort()).toEqual([
        's1',
        's2',
      ]);

      // 同章多倒敘：c1 放故事最後一件 s4，c2 放故事較早的 s1, s2, s3 -> 三件皆倒敘
      const sameChapterFlashbacks = [
        makeCard({ id: 's1', timelineOrder: 0, chapterId: 'c2' }),
        makeCard({ id: 's2', timelineOrder: 1, chapterId: 'c2' }),
        makeCard({ id: 's3', timelineOrder: 2, chapterId: 'c2' }),
        makeCard({ id: 's4', timelineOrder: 3, chapterId: 'c1' }),
      ];
      expect(
        Array.from(buildTimelineModel(sameChapterFlashbacks, chapters).flashbackIds).sort(),
      ).toEqual(['s1', 's2', 's3']);
    });

    it('未連章事件與連到已刪章的事件不標倒敘，也不干擾 maxStorySoFar', () => {
      const chapters: TimelineChapterNodeInput[] = [
        { id: 'c1', type: 'file', title: '第一章' },
        { id: 'c2', type: 'file', title: '第二章' },
      ];
      // e3 故事最晚但連到已不存在的章 'deleted-ch'；若誤參與掃描會讓 e2 被標成倒敘
      const cards = [
        makeCard({ id: 'e1', timelineOrder: 0, chapterId: 'c1' }),
        makeCard({ id: 'e2', timelineOrder: 1, chapterId: 'c2' }),
        makeCard({ id: 'e3', timelineOrder: 2, chapterId: 'deleted-ch' }),
        makeCard({ id: 'e4', timelineOrder: 3, chapterId: null }),
      ];

      const model = buildTimelineModel(cards, chapters);
      expect(Array.from(model.flashbackIds)).toEqual([]);
      expect(model.unassignedEvents.map((e) => e.id)).toEqual(['e3', 'e4']);
      expect(model.unassignedEvents.every((e) => !e.isFlashback && e.isUnassigned)).toBe(true);
      expect(
        computeFlashbackIds([
          { id: 'first', storyPosition: 10 },
          { id: 'second', storyPosition: 20 },
        ]).size,
      ).toBe(0);
    });
  });

  describe('雙軸對照 SVG 連線計算', () => {
    it('正確計算三次貝茲曲線起終點、線色、虛線與選取置頂狀態', () => {
      const stageBox = { left: 100, top: 50 };
      const bottomLabelTop = 458; // y2 = 458 - 50 - 8 = 400
      const pairs = [
        {
          id: 'e1',
          topBox: { left: 120, top: 100, width: 160, bottom: 200 }, // x1 = 100, y1 = 150
          bottomBox: { left: 320, top: 500, width: 160, bottom: 600 }, // x2 = 300
          isFlashback: true,
          isUnassigned: false,
        },
        {
          id: 'e2',
          topBox: { left: 300, top: 100, width: 160, bottom: 200 }, // x1 = 280, y1 = 150
          bottomBox: { left: 500, top: 500, width: 160, bottom: 600 }, // x2 = 480
          isFlashback: false,
          isUnassigned: true,
        },
        {
          id: 'e3',
          topBox: { left: 480, top: 100, width: 160, bottom: 200 }, // x1 = 460, y1 = 150
          bottomBox: { left: 140, top: 500, width: 160, bottom: 600 }, // x2 = 120
          isFlashback: false,
          isUnassigned: false,
        },
      ];

      // 未選取任何卡片
      const unselected = computeDualAxisLines(stageBox, bottomLabelTop, pairs, null);
      expect(unselected).toHaveLength(3);
      expect(unselected[0]).toEqual({
        id: 'e1',
        kind: 'flashback',
        x1: 100,
        y1: 150,
        x2: 300,
        y2: 400,
        pathD: 'M 100 150 C 100 275, 300 275, 300 400',
        stroke: 'var(--flashback)',
        strokeWidth: 2.2,
        strokeDasharray: undefined,
        opacity: 1,
        isSelected: false,
      });
      expect(unselected[1]).toMatchObject({
        id: 'e2',
        kind: 'unassigned',
        stroke: 'var(--muted)',
        strokeDasharray: '6 6',
        strokeWidth: 2.2,
        opacity: 1,
      });
      expect(unselected[2]).toMatchObject({
        id: 'e3',
        kind: 'normal',
        stroke: 'color-mix(in srgb, var(--accent) 60%, transparent)',
        strokeDasharray: undefined,
        strokeWidth: 2.2,
        opacity: 1,
      });

      // 選取 e1 時：e1 移至最後（SVG 置頂），寬度 3.5、opacity 1；其餘兩條 opacity 0.4
      const selected = computeDualAxisLines(stageBox, bottomLabelTop, pairs, 'e1');
      expect(selected.map((line) => [line.id, line.isSelected, line.strokeWidth, line.opacity])).toEqual([
        ['e2', false, 2.2, 0.4],
        ['e3', false, 2.2, 0.4],
        ['e1', true, 3.5, 1],
      ]);
    });
  });
});
