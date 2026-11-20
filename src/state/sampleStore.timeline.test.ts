import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { readBookBytes } from '../db/library';
import { CURRENT_SCHEMA_VERSION, currentSchemaVersion } from '../db/migrations';
import { readFileProject, writeFileProject, type FileCard } from '../db/projectFile';
import { tableNames, type Sql } from '../db/sql';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import {
  readTimelineData,
  TIMELINE_EVENTS_TABLE,
  TIMELINE_TABLES,
} from '../db/timelineMeta';
import { openMemoryDb } from '../db/wasmDb';
import {
  CATEGORY_AI_CHAT,
  CATEGORY_CHARACTER,
  CATEGORY_TIMELINE,
} from '../domain/cardCategories';
import { addCard, addSubCard, updateCard } from '../domain/cardOps';
import { renameNode, withoutNode } from '../domain/chapterOps';
import { saveProjects } from '../domain/outline';
import {
  buildChapterIndex,
  buildTimelineModel,
  sortTimelineStoryCards,
} from '../domain/timeline';
import {
  clearCardDraft,
  getCardDraft,
  parseNavMemory,
  resetNavMemoryCache,
  saveCardDraft,
} from './navMemory';
import {
  attachActionForBook,
  deleteProjectCardWithArchive,
  getProjectCards,
  manuscriptBytesOn,
  manuscriptSnapshotParts,
  reduce,
  restoreProjectCardFromArchive,
  type Action,
} from './sampleStore';
import { demoFixtureState } from './testing/sampleFixture';

/**
 * WO-128 第 3 段：時間線狀態管理、章改名與刪除連動、草稿記憶與審查 1「之後改」驗證。
 * 涵蓋規劃 9.3 節全部項目與審查 1 相關測試：
 * 1. 新增時間軸事件（時間線新增與卡片清單新增順序一致排最後，未排過序時不主動寫 timelineOrder）
 * 2. 更新 storyTime、chapterId、timelineOrder（本機稿與 .db 檔案稿雙路徑寫回）
 * 3. 拖曳重排（reorder-timeline、move-timeline-event 的 drop／delta 上移下移／targetIndex，及原地拖放零異動）
 * 4. 章改名（含卷改名）：事件只存 chapterId，時間線與事件卡章名自動跟著更新，不動事件資料
 * 5. 刪章：連到該章的事件 chapterId 轉為 null（「還沒寫進任何章」），事件卡本身與其他欄位不刪
 * 6. 刪卷（內含多章）：該卷所有子章連到的事件 chapterId 全數轉為 null，他卷事件與未連章事件不受影響
 * 7. 刪除事件卡後復原（10 秒復原與最近刪除清單復原）：storyTime、timelineOrder、chapterId 三欄一起完整還原
 * 8. ai_chat 卡片與其他分類卡片零異動（原物件參照與內容完全不變）
 * 9. CardDraft（navMemory）保留 storyTime 與 chapterId，並向後相容舊草稿
 * 10. FileExtras 與 attachActionForBook 帶出 timeline（TimelineRead）
 *
 * 全數使用程式產生的範例資料與記憶體 SQLite，不讀寫任何實體 .db 檔。
 */

async function withDb<T>(bytes: Uint8Array, run: (sql: Sql) => T | Promise<T>): Promise<T> {
  const db = await openMemoryDb(bytes);
  try {
    return await run(db.sql);
  } finally {
    db.close();
  }
}

function createVolumeTreeFixture(): ChapterNode[] {
  return [
    {
      id: 'vol-1',
      type: 'folder',
      title: '第一卷　霧港',
      expanded: true,
      children: [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　清晨的書房',
          progress: 'Draft',
          content: '【範例】第一章正文',
        },
        {
          id: 'ch-2',
          type: 'file',
          title: '第二章　偵探上岸',
          progress: 'Draft',
          content: '【範例】第二章正文',
        },
      ],
    },
    {
      id: 'vol-2',
      type: 'folder',
      title: '第二卷　舊館',
      expanded: false,
      children: [
        {
          id: 'ch-3',
          type: 'file',
          title: '第三章　十年前的火',
          progress: 'Draft',
          content: '【範例】第三章正文',
        },
      ],
    },
  ];
}

function createSampleCards(): {
  aiCard: FileCard;
  charCard: FileCard;
  e1: FileCard;
  e2: FileCard;
  e3: FileCard;
  subCard: FileCard;
  all: FileCard[];
} {
  const aiCard: FileCard = {
    id: 'ai-chat-keep',
    parent_id: null,
    category: CATEGORY_AI_CHAT,
    title: '【範例】AI 對話紀錄',
    content: '{"messages":[{"role":"user","text":"範例對話"}]}',
    color: '#1e293b',
    is_collapsed: 0,
    sort_order: 0,
  };
  const charCard: FileCard = {
    id: 'char-keep',
    parent_id: null,
    category: CATEGORY_CHARACTER,
    title: '【範例】林曉霧',
    content: '【範例】偵探角色設定',
    color: '#61afef',
    is_collapsed: 0,
    sort_order: 0,
  };
  const e1: FileCard = {
    id: 'ev-1',
    parent_id: null,
    category: CATEGORY_TIMELINE,
    title: '【範例】舊館大火，沈家小女兒失蹤',
    content: '【範例】十年前火災經過',
    color: '#e06c75',
    is_collapsed: 0,
    sort_order: 0,
    storyTime: '十年前・冬',
    timelineOrder: 0,
    chapterId: 'ch-3',
  };
  const e2: FileCard = {
    id: 'ev-2',
    parent_id: null,
    category: CATEGORY_TIMELINE,
    title: '【範例】沈伯謙偷偷改了遺囑',
    content: '【範例】律師密訪紀錄',
    color: '#e5c07b',
    is_collapsed: 0,
    sort_order: 1,
    storyTime: '案發前三個月',
    timelineOrder: 1,
    chapterId: 'ch-1',
  };
  const e3: FileCard = {
    id: 'ev-3',
    parent_id: null,
    category: CATEGORY_TIMELINE,
    title: '【範例】女傭阿蘋發現書房反鎖',
    content: '【範例】清晨第一現場',
    color: '#98c379',
    is_collapsed: 0,
    sort_order: 2,
    storyTime: '隔天清晨',
    timelineOrder: 2,
    chapterId: 'ch-2',
  };
  const subCard: FileCard = {
    id: 'ev-1-sub',
    parent_id: 'ev-1',
    category: CATEGORY_TIMELINE,
    title: '【範例】火場殘留的懷錶（子卡不上線）',
    content: '【範例】子卡補充細節',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 0,
  };
  return {
    aiCard,
    charCard,
    e1,
    e2,
    e3,
    subCard,
    all: [aiCard, charCard, e1, e2, e3, subCard],
  };
}

describe('WO-128 9.3 狀態管理、章刪除連動、草稿記憶與審查 1 之後改', () => {
  beforeEach(() => {
    resetNavMemoryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetNavMemoryCache();
  });

  it('1. 新增事件與審查 1 (2)：未排過序時新增不主動設 timelineOrder；一旦排過序，「時間線新增事件」與「卡片清單新增時間軸卡」都排在最後且順序一致', async () => {
    let state = demoFixtureState(new Date('2026-11-20T09:30:00Z'));
    const bookId = 'p-tl-add';
    state = reduce(state, {
      type: 'add-project',
      id: bookId,
      title: '【範例】新增事件順序測試稿',
      shape: 'novel',
    });

    // (a) 尚未手動排過序時：透過 add-timeline-event 與卡片清單 addCard 新增，timelineOrder 皆維持 undefined，且依新增先後排在最後
    state = reduce(state, {
      type: 'add-timeline-event',
      projectId: bookId,
      input: { id: 'first-ev', title: '【範例】事件 A' },
    });
    state = reduce(state, {
      type: 'set-cards',
      projectId: bookId,
      cards: addCard(getProjectCards(state, bookId), {
        id: 'second-ev',
        category: CATEGORY_TIMELINE,
        title: '【範例】事件 B（清單新增）',
      }),
    });
    state = reduce(state, {
      type: 'add-timeline-event',
      projectId: bookId,
      input: { id: 'third-ev', title: '【範例】事件 C（時間線新增）' },
    });

    const unrankedCards = getProjectCards(state, bookId);
    expect(unrankedCards.every((c) => c.timelineOrder === undefined)).toBe(true);
    expect(sortTimelineStoryCards(unrankedCards).map((c) => c.id)).toEqual([
      'first-ev',
      'second-ev',
      'third-ev',
    ]);

    // 未填任何時間線欄位時存成 .db，依然不建立時間線附加表（舊稿零寫入保證）
    const baseBytes = await generateDesktopSampleBytes();
    const project0 = state.projects.find((p) => p.id === bookId)!;
    const savedUnranked = await manuscriptBytesOn(state, project0, baseBytes);
    await withDb(savedUnranked, (sql) => {
      expect(readTimelineData(sql)).toEqual({ kind: 'absent' });
      for (const name of TIMELINE_TABLES) {
        expect(tableNames(sql).has(name)).toBe(false);
      }
    });

    // (b) 使用者在時間線拖曳排過序後（已有數字 timelineOrder）：
    // 先切回「卡片清單」新增一張時間軸卡 D，再回「時間線」點「新增事件」E，再回「卡片清單」新增 F
    // 順序必須嚴格依新增先後排在最後：[third-ev, first-ev, second-ev, list-d, tl-e, list-f]
    state = reduce(state, {
      type: 'reorder-timeline',
      projectId: bookId,
      orderedIds: ['third-ev', 'first-ev', 'second-ev'],
    });
    expect(
      sortTimelineStoryCards(getProjectCards(state, bookId)).map((c) => [c.id, c.timelineOrder]),
    ).toEqual([
      ['third-ev', 0],
      ['first-ev', 1],
      ['second-ev', 2],
    ]);

    // 卡片清單新增 D
    state = reduce(state, {
      type: 'set-cards',
      projectId: bookId,
      cards: addCard(getProjectCards(state, bookId), {
        id: 'list-d',
        category: CATEGORY_TIMELINE,
        title: '【範例】事件 D（清單新增）',
      }),
    });
    // 時間線新增 E
    state = reduce(state, {
      type: 'add-timeline-event',
      projectId: bookId,
      input: {
        id: 'tl-e',
        title: '【範例】事件 E（時間線新增）',
        storyTime: '第三年春',
        chapterId: project0.nodes[0]!.children![0]!.id,
      },
    });
    // 卡片清單再新增 F，並新增一張子卡（子卡不應獲得 timelineOrder 也不上線）
    const afterE = getProjectCards(state, bookId);
    const withFAndSub = addSubCard(
      addCard(afterE, {
        id: 'list-f',
        category: CATEGORY_TIMELINE,
        title: '【範例】事件 F（清單再新增）',
      }),
      'list-f',
      { id: 'list-f-sub', title: '【範例】F 的子卡片' },
    );
    state = reduce(state, {
      type: 'set-cards',
      projectId: bookId,
      cards: withFAndSub,
    });

    const finalCards = getProjectCards(state, bookId);
    expect(sortTimelineStoryCards(finalCards).map((c) => [c.id, c.timelineOrder])).toEqual([
      ['third-ev', 0],
      ['first-ev', 1],
      ['second-ev', 2],
      ['list-d', 3],
      ['tl-e', 4],
      ['list-f', 5],
    ]);
    expect(finalCards.find((c) => c.id === 'list-f-sub')?.timelineOrder).toBeUndefined();
  });

  it('2. 更新 storyTime／chapterId 與拖曳重排、上移／下移（本機稿與 .db 檔案稿兩條路皆正確寫回，ai_chat 零異動）', async () => {
    const sample = createSampleCards();
    const tree = createVolumeTreeFixture();

    // 路徑一：本機稿（localStorage）
    let state = demoFixtureState(new Date('2026-11-20T09:40:00Z'));
    const localBookId = 'p-local-tl';
    state = reduce(state, {
      type: 'add-project',
      id: localBookId,
      title: '【範例】本機時間線稿',
      shape: 'novel',
    });
    state = reduce(state, {
      type: 'set-nodes',
      projectId: localBookId,
      nodes: tree,
    });
    state = reduce(state, {
      type: 'set-cards',
      projectId: localBookId,
      cards: sample.all,
    });

    // 修改 ev-2 的故事時間與連章
    state = reduce(state, {
      type: 'update-card',
      projectId: localBookId,
      cardId: 'ev-2',
      patch: { storyTime: '案發前一個月・雨夜', chapterId: 'ch-3' },
    });
    expect(getProjectCards(state, localBookId).find((c) => c.id === 'ev-2')).toMatchObject({
      storyTime: '案發前一個月・雨夜',
      chapterId: 'ch-3',
      timelineOrder: 1,
    });

    // 上移 ev-3（delta: -1）：原本 [ev-1, ev-2, ev-3] -> [ev-1, ev-3, ev-2]
    state = reduce(state, {
      type: 'move-timeline-event',
      projectId: localBookId,
      cardId: 'ev-3',
      delta: -1,
    });
    expect(
      sortTimelineStoryCards(getProjectCards(state, localBookId)).map((c) => [
        c.id,
        c.timelineOrder,
      ]),
    ).toEqual([
      ['ev-1', 0],
      ['ev-3', 1],
      ['ev-2', 2],
    ]);

    // 拖曳落點（drop）：把 ev-2 拖到 ev-1 之前 -> [ev-2, ev-1, ev-3]
    state = reduce(state, {
      type: 'move-timeline-event',
      projectId: localBookId,
      cardId: 'ev-2',
      drop: { id: 'ev-1', after: false },
    });
    expect(
      sortTimelineStoryCards(getProjectCards(state, localBookId)).map((c) => [
        c.id,
        c.timelineOrder,
      ]),
    ).toEqual([
      ['ev-2', 0],
      ['ev-1', 1],
      ['ev-3', 2],
    ]);

    // 下移 ev-2（delta: 1）：-> [ev-1, ev-2, ev-3]
    state = reduce(state, {
      type: 'move-timeline-event',
      projectId: localBookId,
      cardId: 'ev-2',
      delta: 1,
    });
    expect(
      sortTimelineStoryCards(getProjectCards(state, localBookId)).map((c) => [
        c.id,
        c.timelineOrder,
      ]),
    ).toEqual([
      ['ev-1', 0],
      ['ev-2', 1],
      ['ev-3', 2],
    ]);

    // 驗證 ai_chat 卡片、角色卡與子卡維持原物件參照不動
    const localCardsNow = getProjectCards(state, localBookId);
    expect(localCardsNow.find((c) => c.id === 'ai-chat-keep')).toBe(sample.aiCard);
    expect(localCardsNow.find((c) => c.id === 'char-keep')).toBe(sample.charCard);
    expect(localCardsNow.find((c) => c.id === 'ev-1-sub')).toBe(sample.subCard);

    // 驗證本機稿透過 saveProjects / createState 序列化保留三欄
    const kvData: Record<string, string> = {};
    const kvStore = {
      getItem: (k: string) => kvData[k] ?? null,
      setItem: (k: string, v: string) => {
        kvData[k] = v;
      },
    };
    saveProjects(
      kvStore,
      state.projects.filter((p) => p.origin !== 'file'),
    );
    const savedOutlineJson = kvData['jiufang-novel-m.outline.v1'] ?? '';
    expect(savedOutlineJson).toContain('案發前一個月・雨夜');
    expect(savedOutlineJson).toContain('"chapterId":"ch-3"');

    // 路徑二：.db 檔案稿（審查 1 (5) 一併驗證 attachActionForBook 與 FileExtras.timeline）
    const rawBytes = await generateDesktopSampleBytes();
    const initialBook = await readBookBytes('範例檔案稿', rawBytes, 'file-tl-book');
    expect(initialBook.timeline).toEqual({ kind: 'absent' });

    const attachAct = attachActionForBook(
      {
        ...initialBook,
        tree: structuredClone(tree),
        cards: sample.all.map((c) => ({ ...c })),
      },
      { updatedLabel: '剛剛' },
    );
    state = reduce(state, attachAct);
    expect(state.fileExtras['file-tl-book']?.timeline).toEqual({ kind: 'absent' });

    // 在檔案稿上重排並更新卡片
    state = reduce(state, {
      type: 'reorder-timeline',
      projectId: 'file-tl-book',
      orderedIds: ['ev-3', 'ev-1', 'ev-2'],
    });
    state = reduce(state, {
      type: 'update-card',
      projectId: 'file-tl-book',
      cardId: 'ev-3',
      patch: { storyTime: '破曉 05:15', chapterId: 'ch-1' },
    });

    // projects 與 fileExtras 同步更新
    const fileProject = state.projects.find((p) => p.id === 'file-tl-book')!;
    expect(state.fileExtras['file-tl-book']!.cards).toEqual(fileProject.cards);

    const savedFileBytes = await manuscriptBytesOn(state, fileProject, rawBytes);
    const reopenedBook = await readBookBytes('範例檔案稿', savedFileBytes, 'file-tl-book');
    expect(reopenedBook.timeline).toEqual({
      kind: 'ok',
      revision: 1,
      entries: {
        'ev-3': { storyTime: '破曉 05:15', timelineOrder: 0, chapterId: 'ch-1' },
        'ev-1': { storyTime: '十年前・冬', timelineOrder: 1, chapterId: 'ch-3' },
        'ev-2': { storyTime: '案發前三個月', timelineOrder: 2, chapterId: 'ch-1' },
      },
    });
    const reattachedState = reduce(
      state,
      attachActionForBook(reopenedBook, { updatedLabel: '剛剛' }),
    );
    expect(reattachedState.fileExtras['file-tl-book']?.timeline).toEqual(reopenedBook.timeline);
  });

  it('3. 章改名（與卷改名）：事件只存章 id，不改動事件卡資料，時間線與章索引自動呈現新章名', () => {
    const sample = createSampleCards();
    const tree = createVolumeTreeFixture();

    let state = demoFixtureState(new Date('2026-11-20T09:45:00Z'));
    const bookId = 'p-rename-chapter';
    state = reduce(state, {
      type: 'add-project',
      id: bookId,
      title: '【範例】章改名測試稿',
      shape: 'novel',
    });
    state = reduce(state, { type: 'set-nodes', projectId: bookId, nodes: tree });
    state = reduce(state, { type: 'set-cards', projectId: bookId, cards: sample.all });

    const cardsBeforeRename = getProjectCards(state, bookId);

    // 將 ch-3「第三章　十年前的火」改名為「第三章　舊館灰燼」，並將 vol-2「第二卷　舊館」改名為「第二卷　餘燼」
    const renamedNodes1 = renameNode(tree, 'ch-3', '第三章　舊館灰燼')!;
    const renamedNodes2 = renameNode(renamedNodes1, 'vol-2', '第二卷　餘燼')!;
    state = reduce(state, {
      type: 'set-nodes',
      projectId: bookId,
      nodes: renamedNodes2,
    });

    const cardsAfterRename = getProjectCards(state, bookId);
    // 事件卡片陣列與每一張卡的參照完全不需變動
    expect(cardsAfterRename).toBe(cardsBeforeRename);
    expect(cardsAfterRename.find((c) => c.id === 'ev-1')?.chapterId).toBe('ch-3');

    // 時間線模型與章索引即時反映新卷名與新章名
    const project = state.projects.find((p) => p.id === bookId)!;
    const chapterIndex = buildChapterIndex(project.nodes);
    expect(chapterIndex.get('ch-3')).toMatchObject({
      title: '第三章　舊館灰燼',
      volumeTitle: '第二卷　餘燼',
      headerLead: '第二卷・第三章',
      headerSub: '舊館灰燼',
      chipLabel: '第二卷・第三章',
      pickerLabel: '第二卷・第三章　舊館灰燼',
      jumpLabel: '跳到第二卷・第三章',
    });

    const model = buildTimelineModel(cardsAfterRename, project.nodes);
    const ev1Item = model.storyEvents.find((e) => e.id === 'ev-1')!;
    expect(ev1Item.chapter?.pickerLabel).toBe('第二卷・第三章　舊館灰燼');
  });

  it('4. 刪章與刪卷（內含多章）：連到被刪章節的事件 chapterId 自動轉為 null（事件不刪），他卷事件與 ai_chat 零異動，本機與 .db 均同步', async () => {
    const sample = createSampleCards();
    const tree = createVolumeTreeFixture();

    const rawBytes = await generateDesktopSampleBytes();
    const book = await readBookBytes('範例刪章連動稿', rawBytes, 'file-del-chapter');
    let state = demoFixtureState(new Date('2026-11-20T09:50:00Z'));
    state = reduce(
      state,
      attachActionForBook(
        {
          ...book,
          tree,
          cards: sample.all,
        },
        { updatedLabel: '剛剛' },
      ),
    );

    const beforeCards = getProjectCards(state, 'file-del-chapter');
    const beforeAiRef = beforeCards.find((c) => c.id === 'ai-chat-keep')!;
    const beforeCharRef = beforeCards.find((c) => c.id === 'char-keep')!;
    const beforeEv1Ref = beforeCards.find((c) => c.id === 'ev-1')!; // 連到 vol-2 的 ch-3
    const beforeEv3Ref = beforeCards.find((c) => c.id === 'ev-3')!; // 連到 vol-1 的 ch-2

    // (a) 單獨刪除 ch-1（ev-2 連到 ch-1）
    const nodesAfterDelCh1 = withoutNode(tree, 'ch-1')!;
    state = reduce(state, {
      type: 'set-nodes',
      projectId: 'file-del-chapter',
      nodes: nodesAfterDelCh1,
    });

    const afterDelCh1Cards = getProjectCards(state, 'file-del-chapter');
    // 事件總數不變（事件不刪）
    expect(afterDelCh1Cards).toHaveLength(beforeCards.length);
    const ev2AfterCh1 = afterDelCh1Cards.find((c) => c.id === 'ev-2')!;
    expect(ev2AfterCh1.chapterId).toBeNull();
    expect(ev2AfterCh1.title).toBe('【範例】沈伯謙偷偷改了遺囑');
    expect(ev2AfterCh1.storyTime).toBe('案發前三個月');
    expect(ev2AfterCh1.timelineOrder).toBe(1);

    // 其他未連到 ch-1 的事件卡、角色卡與 ai_chat 卡原物件參照完全不變
    expect(afterDelCh1Cards.find((c) => c.id === 'ev-1')).toBe(beforeEv1Ref);
    expect(afterDelCh1Cards.find((c) => c.id === 'ev-3')).toBe(beforeEv3Ref);
    expect(afterDelCh1Cards.find((c) => c.id === 'ai-chat-keep')).toBe(beforeAiRef);
    expect(afterDelCh1Cards.find((c) => c.id === 'char-keep')).toBe(beforeCharRef);

    // (b) 刪除整卷 vol-1（內含 ch-2，ev-3 連到 ch-2；vol-2 下的 ch-3 與 ev-1 不受影響）
    // 再額外加一張連到 vol-1 另一章 ch-1b 的事件，確認刪卷時底下多章連到的事件全數轉 null
    const treeWithMultiChaptersInVol1: ChapterNode[] = [
      {
        id: 'vol-1',
        type: 'folder',
        title: '第一卷　霧港',
        expanded: false, // 刻意測試收合狀態的卷
        children: [
          { id: 'ch-2', type: 'file', title: '第二章　偵探上岸', progress: 'Draft', content: '' },
          { id: 'ch-2b', type: 'file', title: '第二章之二　渡輪', progress: 'Draft', content: '' },
        ],
      },
      tree[1]!, // vol-2 (ch-3)
    ];
    state = reduce(state, {
      type: 'set-nodes',
      projectId: 'file-del-chapter',
      nodes: treeWithMultiChaptersInVol1,
    });
    state = reduce(state, {
      type: 'add-timeline-event',
      projectId: 'file-del-chapter',
      input: {
        id: 'ev-4',
        title: '【範例】渡輪汽笛響起',
        storyTime: '隔天午後',
        chapterId: 'ch-2b',
      },
    });

    const refEv1BeforeVolDel = getProjectCards(state, 'file-del-chapter').find(
      (c) => c.id === 'ev-1',
    )!;

    // 刪除第一卷 vol-1
    const nodesAfterDelVol1 = withoutNode(treeWithMultiChaptersInVol1, 'vol-1')!;
    state = reduce(state, {
      type: 'set-nodes',
      projectId: 'file-del-chapter',
      nodes: nodesAfterDelVol1,
    });

    const afterDelVol1Cards = getProjectCards(state, 'file-del-chapter');
    expect(afterDelVol1Cards.find((c) => c.id === 'ev-3')?.chapterId).toBeNull();
    expect(afterDelVol1Cards.find((c) => c.id === 'ev-4')?.chapterId).toBeNull();
    // 第二卷的 ev-1 完全不受影響（且原物件參照不變）
    expect(afterDelVol1Cards.find((c) => c.id === 'ev-1')).toBe(refEv1BeforeVolDel);
    expect(afterDelVol1Cards.find((c) => c.id === 'ev-1')?.chapterId).toBe('ch-3');
    expect(afterDelVol1Cards.find((c) => c.id === 'ai-chat-keep')).toBe(beforeAiRef);

    // 寫回 .db 確認 jiufangm_timeline_events 內對應的 chapter_id 已同步存為 NULL
    const projectNow = state.projects.find((p) => p.id === 'file-del-chapter')!;
    const savedBytes = await manuscriptBytesOn(state, projectNow, rawBytes);
    await withDb(savedBytes, (sql) => {
      expect(currentSchemaVersion(sql)).toBe(CURRENT_SCHEMA_VERSION);
      const rows = sql.select(
        `SELECT card_id, story_time, timeline_order, chapter_id FROM ${TIMELINE_EVENTS_TABLE} ORDER BY card_id`,
      );
      expect(rows).toEqual([
        { card_id: 'ev-1', story_time: '十年前・冬', timeline_order: 0, chapter_id: 'ch-3' },
        { card_id: 'ev-2', story_time: '案發前三個月', timeline_order: 1, chapter_id: null },
        { card_id: 'ev-3', story_time: '隔天清晨', timeline_order: 2, chapter_id: null },
        { card_id: 'ev-4', story_time: '隔天午後', timeline_order: 3, chapter_id: null },
      ]);
    });
  });

  it('5. 刪除事件卡後復原（10 秒復原與最近刪除復原）：storyTime、timelineOrder、chapterId 三欄連同子卡一起完整還原，ai_chat 卡片零異動', async () => {
    const sample = createSampleCards();
    const tree = createVolumeTreeFixture();

    let state = demoFixtureState(new Date('2026-11-20T09:55:00Z'));
    const bookId = 'p-del-restore-tl';
    state = reduce(state, {
      type: 'add-project',
      id: bookId,
      title: '【範例】刪卡復原測試稿',
      shape: 'novel',
    });
    state = reduce(state, { type: 'set-nodes', projectId: bookId, nodes: tree });
    state = reduce(state, { type: 'set-cards', projectId: bookId, cards: sample.all });

    const dispatch = (action: Action) => {
      state = reduce(state, action);
    };

    // 刪除 ev-1（帶有 storyTime: '十年前・冬', timelineOrder: 0, chapterId: 'ch-3' 及子卡 ev-1-sub）
    const deletedRecord = await deleteProjectCardWithArchive(state, dispatch, bookId, 'ev-1', {
      deletedAt: 1700000000000,
      recordId: 'del-rec-ev-1',
    });
    expect(deletedRecord).not.toBeNull();
    expect(deletedRecord!.cards.find((c) => c.id === 'ev-1')).toMatchObject({
      storyTime: '十年前・冬',
      timelineOrder: 0,
      chapterId: 'ch-3',
    });

    const cardsAfterDelete = getProjectCards(state, bookId);
    expect(cardsAfterDelete.some((c) => c.id === 'ev-1')).toBe(false);
    expect(cardsAfterDelete.some((c) => c.id === 'ev-1-sub')).toBe(false);
    // ai_chat 卡片與其他事件卡毫髮無傷
    expect(cardsAfterDelete.find((c) => c.id === 'ai-chat-keep')).toBe(sample.aiCard);
    expect(cardsAfterDelete.find((c) => c.id === 'ev-2')).toBe(sample.e2);

    // 復原（對應 10 秒復原與從最近刪除點復原）
    const restoredList = await restoreProjectCardFromArchive(
      state,
      dispatch,
      bookId,
      deletedRecord!,
    );
    expect(restoredList).not.toBeNull();

    const cardsAfterRestore = getProjectCards(state, bookId);
    const restoredEv1 = cardsAfterRestore.find((c) => c.id === 'ev-1')!;
    const restoredSub = cardsAfterRestore.find((c) => c.id === 'ev-1-sub')!;
    expect(restoredEv1).toMatchObject({
      id: 'ev-1',
      category: CATEGORY_TIMELINE,
      title: '【範例】舊館大火，沈家小女兒失蹤',
      storyTime: '十年前・冬',
      timelineOrder: 0,
      chapterId: 'ch-3',
    });
    expect(restoredSub).toMatchObject({
      id: 'ev-1-sub',
      parent_id: 'ev-1',
      category: CATEGORY_TIMELINE,
    });
    expect(cardsAfterRestore.find((c) => c.id === 'ai-chat-keep')).toBe(sample.aiCard);
    expect(sortTimelineStoryCards(cardsAfterRestore).map((c) => c.id)).toEqual([
      'ev-1',
      'ev-2',
      'ev-3',
    ]);
  });

  it('6. CardDraft（navMemory）保留 storyTime 與 chapterId，並相容無此二欄的舊版草稿', () => {
    const bookId = 'p-draft-tl';
    const cardId = 'ev-draft-1';

    saveCardDraft(bookId, cardId, {
      title: '【範例】編輯到一半的事件',
      content: '【範例】暫存內文',
      color: '#e06c75',
      storyTime: '案發當晚 23:40',
      chapterId: 'ch-5',
    });

    // 模擬關閉 App 清掉記憶體快取後從 JSON 重讀
    const rawJson = JSON.stringify({
      version: 1,
      write: null,
      cards: null,
      drafts: {
        [cardId]: getCardDraft(bookId, cardId),
        'legacy-card': {
          title: '【範例】舊版三欄草稿',
          content: '無時間線欄位',
          color: '#3C3F41',
        },
        'unassigned-card': {
          title: '【範例】未連章草稿',
          content: '明確設為還沒寫進任何章',
          color: '#3C3F41',
          storyTime: '',
          chapterId: null,
        },
      },
    });

    const parsed = parseNavMemory(rawJson);
    expect(parsed.drafts[cardId]).toEqual({
      title: '【範例】編輯到一半的事件',
      content: '【範例】暫存內文',
      color: '#e06c75',
      storyTime: '案發當晚 23:40',
      chapterId: 'ch-5',
    });
    expect(parsed.drafts['legacy-card']).toEqual({
      title: '【範例】舊版三欄草稿',
      content: '無時間線欄位',
      color: '#3C3F41',
    });
    expect(parsed.drafts['unassigned-card']).toEqual({
      title: '【範例】未連章草稿',
      content: '明確設為還沒寫進任何章',
      color: '#3C3F41',
      storyTime: '',
      chapterId: null,
    });

    // 按完成時直接將 draft 作為 patch 交給 updateCard，可一併寫入 storyTime 與 chapterId
    const baseCard: FileCard = {
      id: cardId,
      parent_id: null,
      category: CATEGORY_TIMELINE,
      title: '舊標題',
      content: '舊內容',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 0,
    };
    const updated = updateCard([baseCard], cardId, parsed.drafts[cardId]!);
    expect(updated[0]).toMatchObject({
      title: '【範例】編輯到一半的事件',
      content: '【範例】暫存內文',
      color: '#e06c75',
      storyTime: '案發當晚 23:40',
      chapterId: 'ch-5',
    });

    clearCardDraft(bookId, cardId);
    expect(getCardDraft(bookId, cardId)).toBeNull();
  });

  it('7. 審查 1 (3) store 整合：未曾排過序的舊稿在 store 觸發原地拖放（move-timeline-event drop 順序不變）不會改動 state，存回 .db 維持零寫入', async () => {
    const rawBytes = await generateDesktopSampleBytes();
    const db = await openMemoryDb(rawBytes);
    const withTwoTimelineCards = (() => {
      try {
        db.sql.run(
          `INSERT INTO cards (id, parent_id, category, title, content, color, is_collapsed, sort_order)
           VALUES ('old-tl-1', NULL, 'timeline', '【範例】舊事件一', '', '#3C3F41', 0, 0),
                  ('old-tl-2', NULL, 'timeline', '【範例】舊事件二', '', '#3C3F41', 0, 1)`,
        );
        return db.exportBytes();
      } finally {
        db.close();
      }
    })();

    const book = await readBookBytes('舊稿原地拖放', withTwoTimelineCards, 'file-noop-drop');
    let state = demoFixtureState(new Date('2026-11-20T09:58:00Z'));
    state = reduce(state, attachActionForBook(book, { updatedLabel: '剛剛' }));

    const stateBeforeDrop = state;
    // 把第 1 張拖到第 2 張之前（順序仍是 old-tl-1, old-tl-2）
    state = reduce(state, {
      type: 'move-timeline-event',
      projectId: 'file-noop-drop',
      cardId: 'old-tl-1',
      drop: { id: 'old-tl-2', after: false },
    });
    expect(state).toBe(stateBeforeDrop);

    // 寫回資料庫：零 DML、不建立時間線附加表
    const project = state.projects.find((p) => p.id === 'file-noop-drop')!;
    const parts = manuscriptSnapshotParts(state, project);
    await withDb(withTwoTimelineCards, (sql) => {
      const statements: string[] = [];
      const countingSql: Sql = {
        exec: (stmt) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(stmt)) statements.push(stmt);
          sql.exec(stmt);
        },
        run: (stmt, params) => {
          if (/\b(UPDATE|DELETE|INSERT|CREATE|ALTER|DROP)\b/i.test(stmt)) statements.push(stmt);
          sql.run(stmt, params);
        },
        select: (stmt, params) => sql.select(stmt, params),
      };
      readFileProject(sql);
      writeFileProject(countingSql, parts.info, project.nodes, parts.cards, parts.logs);
      expect(statements).toEqual([]);
      expect(readTimelineData(sql)).toEqual({ kind: 'absent' });
    });
  });
});
