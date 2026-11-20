import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { isTabActive } from '../components/AppNav';
import {
  computeDualTipOffsetLeft,
  DUAL_TIP_MAX_WIDTH,
  TimelineDualAxisView,
} from '../components/TimelineDualAxisView';
import { TimelineReadingView } from '../components/TimelineReadingView';
import { TimelineStoryView } from '../components/TimelineStoryView';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import {
  TIMELINE_ADD_EVENT,
  TIMELINE_BACK_ARIA,
  TIMELINE_BACK_TO_TIMELINE_ARIA,
  TIMELINE_BADGE_FLASHBACK,
  TIMELINE_BADGE_UNREVEALED,
  TIMELINE_DUAL_BOTTOM_DESC,
  TIMELINE_DUAL_BOTTOM_TITLE,
  TIMELINE_DUAL_LEGEND_CROSSING,
  TIMELINE_DUAL_LEGEND_FLASHBACK,
  TIMELINE_DUAL_LEGEND_NORMAL,
  TIMELINE_DUAL_LEGEND_UNASSIGNED,
  TIMELINE_DUAL_TIP_INTRO,
  TIMELINE_DUAL_TOP_DESC,
  TIMELINE_DUAL_TOP_TITLE,
  TIMELINE_EMPTY_HINT,
  TIMELINE_HEADING,
  TIMELINE_LEGEND_FLASHBACK,
  TIMELINE_LEGEND_UNREVEALED,
  TIMELINE_OPEN_CARD,
  TIMELINE_READER_NOT_YET,
  TIMELINE_READING_HINT,
  TIMELINE_STORY_HINT,
  TIMELINE_TAB_DUAL,
  TIMELINE_TAB_READING,
  TIMELINE_TAB_STORY,
  TIMELINE_UNASSIGNED_LABEL,
  TIMELINE_VIEW_CARDS,
  TIMELINE_VIEW_TIMELINE,
  TREE_DONE,
  TREE_MOVE_DOWN,
  TREE_MOVE_UP,
  timelineBookCrumb,
  timelineDragHandleAria,
  timelineDualTipDetail,
  timelineMovedLiveAnnouncement,
  timelineReadingOrderWide,
  timelineSelectedDockLabel,
  timelineStoryOrderPhone,
  timelineStoryOrderWide,
  timelineUnassignedSectionCount,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import type { FileCard } from '../db/projectFile';
import { buildTimelineModel } from '../domain/timeline';
import { LayoutProvider, type LayoutMode, type WideColumns } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { CardsScreen, type CardsScreenProps } from './CardsScreen';
import { TimelineScreen, type TimelineScreenProps } from './TimelineScreen';
import { Workspace } from './Workspace';

const HOTEL_CHAPTERS: ChapterNode[] = [
  { id: 'ch-1', type: 'file', title: '第一章　清晨的書房', content: '' },
  { id: 'ch-2', type: 'file', title: '第二章　偵探上岸', content: '' },
  { id: 'ch-3', type: 'file', title: '第三章　十年前的火', content: '' },
  { id: 'ch-4', type: 'file', title: '第四章　每個人都在別處', content: '' },
  { id: 'ch-5', type: 'file', title: '第五章　霧散', content: '' },
];

const HOTEL_EVENTS: FileCard[] = [
  {
    id: 'e1',
    parent_id: null,
    category: 'timeline',
    title: '舊館大火，沈家小女兒失蹤',
    content: '',
    color: '#E06C75',
    is_collapsed: 0,
    sort_order: 1,
    storyTime: '十年前・冬',
    timelineOrder: 0,
    chapterId: 'ch-3',
  },
  {
    id: 'e2',
    parent_id: null,
    category: 'timeline',
    title: '沈伯謙偷偷改了遺囑',
    content: '',
    color: '#C5BEE0',
    is_collapsed: 0,
    sort_order: 2,
    storyTime: '案發前三個月',
    timelineOrder: 1,
    chapterId: null,
  },
  {
    id: 'e3',
    parent_id: null,
    category: 'timeline',
    title: '周嫂在湯裡下了安眠藥',
    content: '',
    color: '#E89A5C',
    is_collapsed: 0,
    sort_order: 3,
    storyTime: '案發當晚 20:00',
    timelineOrder: 2,
    chapterId: 'ch-5',
  },
  {
    id: 'e5',
    parent_id: null,
    category: 'timeline',
    title: '女傭阿蘋發現書房反鎖',
    content: '',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 4,
    storyTime: '',
    timelineOrder: 3,
    chapterId: 'ch-1',
  },
];

const HOTEL_VOLUME_CHAPTERS: ChapterNode[] = [
  {
    id: 'vol-1',
    type: 'folder',
    title: '第一卷　霧港',
    expanded: true,
    children: [
      { id: 'ch-1', type: 'file', title: '第一章　清晨的書房', content: '' },
      { id: 'ch-2', type: 'file', title: '第二章　偵探上岸', content: '' },
      { id: 'ch-3', type: 'file', title: '第三章　十年前的火', content: '' },
    ],
  },
  { id: 'ch-4', type: 'file', title: '第四章　每個人都在別處', content: '' },
  { id: 'ch-5', type: 'file', title: '第五章　霧散', content: '' },
];

const HOTEL_VOLUME_EVENTS: FileCard[] = [
  HOTEL_EVENTS[0]!,
  HOTEL_EVENTS[1]!,
  HOTEL_EVENTS[2]!,
  {
    id: 'e4',
    parent_id: null,
    category: 'timeline',
    title: '沈伯謙在書房遇害',
    content: '',
    color: '#E06C75',
    is_collapsed: 0,
    sort_order: 3.5,
    timelineOrder: 2.5,
    storyTime: '案發當晚 23:40',
    chapterId: 'ch-5',
  },
  HOTEL_EVENTS[3]!,
];

/** 完整《霧港旅館》7 事件（對應 .wo128/樣張/data.js）。 */
const HOTEL_FULL_7_EVENTS: FileCard[] = [
  HOTEL_EVENTS[0]!, // e1 (ch-3)
  HOTEL_EVENTS[1]!, // e2 (null)
  HOTEL_EVENTS[2]!, // e3 (ch-5)
  {
    id: 'e4',
    parent_id: null,
    category: 'timeline',
    title: '沈伯謙在書房遇害',
    content: '',
    color: '#E06C75',
    is_collapsed: 0,
    sort_order: 4,
    timelineOrder: 3,
    storyTime: '案發當晚 23:40',
    chapterId: 'ch-5',
  },
  {
    id: 'e5',
    parent_id: null,
    category: 'timeline',
    title: '女傭阿蘋發現書房反鎖',
    content: '',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 5,
    timelineOrder: 4,
    storyTime: '隔天清晨',
    chapterId: 'ch-1',
  },
  {
    id: 'e6',
    parent_id: null,
    category: 'timeline',
    title: '偵探林曉霧搭渡輪抵達霧港',
    content: '',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 6,
    timelineOrder: 5,
    storyTime: '隔天中午',
    chapterId: 'ch-2',
  },
  {
    id: 'e7',
    parent_id: null,
    category: 'timeline',
    title: '逐一詢問三人的不在場證明',
    content: '',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 7,
    timelineOrder: 6,
    storyTime: '隔天傍晚',
    chapterId: 'ch-4',
  },
];

vi.mock('../state/sampleStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/sampleStore')>();
  return {
    ...actual,
    useProject: (projectId: string | undefined) => {
      if (projectId === 'hotel-fog') {
        return {
          id: 'hotel-fog',
          title: '霧港旅館',
          updatedLabel: '剛剛',
          bookGoal: 50000,
          cards: HOTEL_EVENTS,
          nodes: HOTEL_CHAPTERS,
        };
      }
      if (projectId === 'hotel-fog-7') {
        return {
          id: 'hotel-fog-7',
          title: '霧港旅館',
          updatedLabel: '剛剛',
          bookGoal: 50000,
          cards: HOTEL_FULL_7_EVENTS,
          nodes: HOTEL_CHAPTERS,
        };
      }
      if (projectId === 'hotel-fog-volume') {
        return {
          id: 'hotel-fog-volume',
          title: '霧港旅館（分卷）',
          updatedLabel: '剛剛',
          bookGoal: 50000,
          cards: HOTEL_VOLUME_EVENTS,
          nodes: HOTEL_VOLUME_CHAPTERS,
        };
      }
      if (projectId === 'hotel-all-linked') {
        return {
          id: 'hotel-all-linked',
          title: '全連章測試書',
          updatedLabel: '剛剛',
          bookGoal: 50000,
          cards: HOTEL_EVENTS.filter((e) => e.chapterId !== null),
          nodes: HOTEL_CHAPTERS,
        };
      }
      if (projectId === 'empty-timeline') {
        return {
          id: 'empty-timeline',
          title: '空白測試書',
          updatedLabel: '剛剛',
          bookGoal: 50000,
          cards: [],
          nodes: HOTEL_CHAPTERS,
        };
      }
      return actual.useProject(projectId);
    },
  };
});

function renderCardsRoute(
  mode: LayoutMode,
  props: CardsScreenProps,
  wideColumns: WideColumns | null = null,
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wideColumns },
        createElement(
          MemoryRouter,
          { initialEntries: ['/p/fog/cards'] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/cards',
              element: createElement<CardsScreenProps>(CardsScreen, props),
            }),
          ),
        ),
      ),
    ),
  );
}

function renderTimelineRoute(
  projectId: string,
  mode: LayoutMode,
  props?: TimelineScreenProps,
  wideColumns: WideColumns | null = null,
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: wideColumns },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/cards/timeline`] },
          createElement(
            Routes,
            null,
            createElement(
              Route,
              { path: '/p/:projectId', element: createElement(Workspace) },
              createElement(Route, {
                path: 'cards/timeline',
                element: createElement<TimelineScreenProps>(TimelineScreen, props ?? null),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

describe('WO-128 第 5 段：時間線入口、路由與故事順序畫面', () => {
  it('路由註冊與底部導覽：App.tsx 註冊 /p/:projectId/cards/timeline，資料集分頁亮起且維持五格', () => {
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(appSource).toContain('path="cards/timeline"');
    expect(appSource).toContain('TimelineScreen');

    expect(isTabActive('cards', '/p/hotel-fog/cards/timeline')).toBe(true);
    expect(isTabActive('write', '/p/hotel-fog/cards/timeline')).toBe(false);

    const html = renderTimelineRoute('hotel-fog', 'phone-portrait');
    expect(html).toContain('data-testid="bottom-nav"');
    const bottomNavHtml = html.slice(html.indexOf('data-testid="bottom-nav"'));
    expect(bottomNavHtml).toContain('data-testid="nav-cards"');
    expect(bottomNavHtml).toMatch(/data-nav-active="true"[^>]*data-testid="nav-cards"/);
    expect(bottomNavHtml.match(/data-testid="nav-(?:write|cards|files|stats|settings)"/g)?.length).toBe(5);
  });

  it('入口切換：四種版面下，只有「時間軸」分類頂端出現「卡片清單／時間線」，其他分類不出現', () => {
    const layouts: Array<{ mode: LayoutMode; wideColumns: WideColumns | null }> = [
      { mode: 'phone-portrait', wideColumns: null },
      { mode: 'phone-landscape', wideColumns: null },
      { mode: 'medium', wideColumns: null },
      { mode: 'wide', wideColumns: 'both' },
    ];

    for (const { mode, wideColumns } of layouts) {
      const timelineHtml = renderCardsRoute(mode, { initialCategoryId: 'timeline' }, wideColumns);
      expect(timelineHtml, mode).toContain('data-testid="timeline-entry-switch"');
      expect(timelineHtml, mode).toContain(TIMELINE_VIEW_CARDS);
      expect(timelineHtml, mode).toContain(TIMELINE_VIEW_TIMELINE);

      for (const otherCat of ['character', 'summary', 'world', 'custom_5ce4e001']) {
        const otherHtml = renderCardsRoute(mode, { initialCategoryId: otherCat }, wideColumns);
        expect(otherHtml, `${mode}-${otherCat}`).not.toContain('data-testid="timeline-entry-switch"');
      }
    }
  });

  it('時間線頂列與模式切換：顯示「時間線・書名」、返回、新增事件，雙軸對照僅於 wide 出現', () => {
    const phoneHtml = renderTimelineRoute('hotel-fog', 'phone-portrait');
    expect(phoneHtml).toContain(TIMELINE_HEADING);
    expect(phoneHtml).toContain(timelineBookCrumb('霧港旅館'));
    expect(phoneHtml).toContain(TIMELINE_BACK_ARIA);
    expect(phoneHtml).toContain(TIMELINE_ADD_EVENT);
    expect(phoneHtml).toContain(TIMELINE_TAB_STORY);
    expect(phoneHtml).toContain(TIMELINE_TAB_READING);
    expect(phoneHtml).not.toContain(TIMELINE_TAB_DUAL);

    for (const narrowMode of ['phone-landscape', 'medium'] as const) {
      const narrowHtml = renderTimelineRoute('hotel-fog', narrowMode);
      expect(narrowHtml, narrowMode).not.toContain(TIMELINE_TAB_DUAL);
    }

    const wideHtml = renderTimelineRoute('hotel-fog', 'wide', undefined, 'both');
    expect(wideHtml).toContain(TIMELINE_TAB_STORY);
    expect(wideHtml).toContain(TIMELINE_TAB_READING);
    expect(wideHtml).toContain(TIMELINE_TAB_DUAL);
  });

  it('故事順序卡片內容：故事時間沒填不顯示該行、沒連章顯示空心圓與「還沒寫進任何章」、倒敘標記與色條', () => {
    const html = renderTimelineRoute('hotel-fog', 'phone-portrait');

    expect(html).toContain(TIMELINE_STORY_HINT);
    // e1：故事時間、章節、倒敘、色條
    expect(html).toContain('data-testid="timeline-when-e1"');
    expect(html).toContain('十年前・冬');
    expect(html).toContain('舊館大火，沈家小女兒失蹤');
    expect(html).toContain('第三章');
    expect(html).toContain('data-testid="timeline-flashback-chip-e1"');
    expect(html).toContain(TIMELINE_BADGE_FLASHBACK);
    expect(html).toContain('timeline-card-colorbar');

    // e2：未連章 -> 虛線空心圓 + 「還沒寫進任何章」 + 非倒敘
    expect(html).toContain('timeline-dot is-hollow');
    expect(html).toContain('data-testid="timeline-unassigned-chip-e2"');
    expect(html).toContain(TIMELINE_UNASSIGNED_LABEL);
    expect(html).not.toContain('data-testid="timeline-flashback-chip-e2"');

    // e5：故事時間空白 -> 不輸出故事時間那行，預設色 #3C3F41 不畫色條
    expect(html).not.toContain('data-testid="timeline-when-e5"');
    expect(html).toContain('女傭阿蘋發現書房反鎖');

    // 無事件空狀態
    const emptyHtml = renderTimelineRoute('empty-timeline', 'phone-portrait');
    expect(emptyHtml).toContain('data-testid="timeline-empty-hint"');
    expect(emptyHtml).toContain(TIMELINE_EMPTY_HINT);

    // 樣張金色「新」字絕不輸出
    expect(html).not.toContain('>新<');
  });

  it('無障礙結構守衛：無按鈕包按鈕、把手防選字 CSS 完整、排序列與 aria-live 存在', () => {
    const html = renderTimelineRoute('hotel-fog', 'phone-portrait', {
      initialSelectedMoveId: 'e1',
    });

    // 1. 禁止按鈕包按鈕
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/i);

    // 2. 卡片本體與拖曳把手為平級兄弟
    expect(html).toContain('data-testid="timeline-card-btn-e1"');
    expect(html).toContain('data-testid="timeline-handle-e1"');
    expect(html).toContain(timelineDragHandleAria('舊館大火，沈家小女兒失蹤'));

    // 3. 排序列開啟並顯示「已選「…」」＋上移／下移／完成；第一張卡上移應 disabled
    expect(html).toContain('data-testid="timeline-organize-dock"');
    expect(html).toContain(timelineSelectedDockLabel('舊館大火，沈家小女兒失蹤'));
    expect(html).toContain(TREE_MOVE_UP);
    expect(html).toContain(TREE_MOVE_DOWN);
    expect(html).toContain(TREE_DONE);
    const moveUpBtn = html.match(/<button[^>]*data-testid="timeline-move-up-btn"[^>]*>/)?.[0] ?? '';
    expect(moveUpBtn).toContain('disabled');

    // 4. aria-live="polite" 區域與播報文案
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="timeline-live-region"');
    expect(timelineMovedLiveAnnouncement('舊館大火，沈家小女兒失蹤', 2, 4)).toBe(
      '已將「舊館大火，沈家小女兒失蹤」移到故事裡第 2 件，共 4 件',
    );

    // 5. CSS 把手防誤觸／防選字規則
    const css = readFileSync(new URL('./timelineScreen.css', import.meta.url), 'utf8');
    const handleBlock = css.match(/\.timeline-drag-handle \{[^}]+\}/)?.[0] ?? '';
    expect(handleBlock).toContain('touch-action: none');
    expect(handleBlock).toContain('user-select: none');
    expect(handleBlock).toContain('-webkit-user-select: none');
    expect(handleBlock).toContain('-webkit-touch-callout: none');
  });

  it('原始碼守衛：沿用 reduceDrag 與模型 isFlashback、支援 Alt+↑/↓、用字來自 userFacing.ts、寫作頁不加時間線入口', () => {
    const storySource = readFileSync(
      new URL('../components/TimelineStoryView.tsx', import.meta.url),
      'utf8',
    );
    const screenSource = readFileSync(new URL('./TimelineScreen.tsx', import.meta.url), 'utf8');
    const drawerSource = readFileSync(
      new URL('../components/WritingCardsDrawer.tsx', import.meta.url),
      'utf8',
    );
    const writeSource = readFileSync(new URL('./WriteScreen.tsx', import.meta.url), 'utf8');

    expect(storySource).toContain('reduceDrag');
    expect(storySource).not.toContain('computeFlashbackIds');
    expect(storySource).toContain('item.isFlashback');
    expect(storySource).toContain('ArrowUp');
    expect(storySource).toContain('ArrowDown');
    expect(storySource).toContain('altKey');
    expect(screenSource).toContain('buildTimelineModel');
    expect(screenSource).toContain('addTimelineEvent');
    expect(screenSource).toContain('moveTimelineEvent');
    expect(screenSource).toContain('CardEditor');

    // 寫作頁不加時間線入口
    expect(drawerSource).not.toContain('/cards/timeline');
    expect(drawerSource).not.toContain('timeline-entry-switch');
    expect(writeSource).not.toContain('/cards/timeline');

    // 嚴禁簡體常見字詞誤入本段檔案
    for (const src of [storySource, screenSource]) {
      expect(src).not.toMatch(/[时间线顺节对画拖拽无障碍标]/);
    }

    // 直接渲染 TimelineStoryView 驗證倒敘依 buildTimelineModel 的 isFlashback 呈現
    const model = buildTimelineModel(HOTEL_EVENTS, HOTEL_CHAPTERS);
    const directHtml = renderToStaticMarkup(
      createElement(TimelineStoryView, {
        events: model.storyEvents,
        selectedMoveId: null,
        onSelectMoveId: () => {},
        onSelectEvent: () => {},
        onMoveByDrop: () => false,
        onMoveByDelta: () => false,
      }),
    );
    expect(directHtml).toContain('data-testid="timeline-flashback-chip-e1"');
  });
});

describe('WO-128 第 6 段：章節順序畫面與審查 2 之後改', () => {
  it('章節順序分段、有卷名稱、章內故事順序、倒敘標記、空章不出現、無拖曳把手、無按鈕包按鈕', () => {
    const readingHtml = renderTimelineRoute('hotel-fog-volume', 'phone-portrait', {
      initialViewMode: 'reading',
    });

    // 說明與圖例
    expect(readingHtml).toContain('data-testid="timeline-reading-view"');
    expect(readingHtml).toContain(TIMELINE_READING_HINT);
    expect(readingHtml).toContain(TIMELINE_LEGEND_FLASHBACK);
    expect(readingHtml).toContain(TIMELINE_LEGEND_UNREVEALED);
    expect(readingHtml).toContain(TIMELINE_BADGE_FLASHBACK);
    expect(readingHtml).toContain(TIMELINE_BADGE_UNREVEALED);

    // 有卷名稱：「第一卷・第一章」「第一卷・第三章」與副標
    expect(readingHtml).toContain('第一卷・第一章');
    expect(readingHtml).toContain('清晨的書房');
    expect(readingHtml).toContain('第一卷・第三章');
    expect(readingHtml).toContain('十年前的火');
    expect(readingHtml).toContain('第五章');
    expect(readingHtml).toContain('霧散');

    // 空章（第二章、第四章）不出現、不留白塊
    expect(readingHtml).not.toContain('timeline-reading-section-ch-2');
    expect(readingHtml).not.toContain('第二章');
    expect(readingHtml).not.toContain('timeline-reading-section-ch-4');
    expect(readingHtml).not.toContain('第四章');

    // 依目錄順序分段：ch-1 → ch-3 → ch-5 → 未連章
    const ch1Idx = readingHtml.indexOf('data-testid="timeline-reading-section-ch-1"');
    const ch3Idx = readingHtml.indexOf('data-testid="timeline-reading-section-ch-3"');
    const ch5Idx = readingHtml.indexOf('data-testid="timeline-reading-section-ch-5"');
    const unIdx = readingHtml.indexOf('data-testid="timeline-reading-unassigned-section"');
    expect(ch1Idx).toBeGreaterThanOrEqual(0);
    expect(ch3Idx).toBeGreaterThanOrEqual(0);
    expect(ch5Idx).toBeGreaterThanOrEqual(0);
    expect(unIdx).toBeGreaterThanOrEqual(0);
    expect(ch1Idx).toBeLessThan(ch3Idx);
    expect(ch3Idx).toBeLessThan(ch5Idx);
    expect(ch5Idx).toBeLessThan(unIdx);

    // 章內照故事順序：第五章內 e3（故事裡第 3 件）在 e4（故事裡第 4 件）之前
    const e3Idx = readingHtml.indexOf('data-testid="timeline-reading-event-e3"');
    const e4Idx = readingHtml.indexOf('data-testid="timeline-reading-event-e4"');
    expect(e3Idx).toBeGreaterThanOrEqual(0);
    expect(e4Idx).toBeGreaterThanOrEqual(0);
    expect(e3Idx).toBeLessThan(e4Idx);

    // 顯示「故事裡第 N 件」
    expect(readingHtml).toContain(timelineStoryOrderPhone(1));
    expect(readingHtml).toContain(timelineStoryOrderPhone(3));
    expect(readingHtml).toContain(timelineStoryOrderPhone(4));
    expect(readingHtml).toContain(timelineStoryOrderPhone(5));

    // 倒敘橘框與膠囊（e1、e3、e4 為倒敘；e5 與未連章 e2 不標倒敘）
    expect(readingHtml).toContain('data-testid="timeline-reading-flashback-chip-e1"');
    expect(readingHtml).toContain('data-testid="timeline-reading-flashback-chip-e3"');
    expect(readingHtml).toContain('data-testid="timeline-reading-flashback-chip-e4"');
    expect(readingHtml).not.toContain('data-testid="timeline-reading-flashback-chip-e5"');
    expect(readingHtml).not.toContain('data-testid="timeline-reading-flashback-chip-e2"');
    expect(readingHtml).toContain('timeline-reading-card is-flashback');

    // 未連章段「還沒寫進任何章（1）」、虛線框與「尚未揭露」
    expect(readingHtml).toContain(TIMELINE_UNASSIGNED_LABEL);
    expect(readingHtml).toContain(timelineUnassignedSectionCount(1));
    expect(readingHtml).toContain('timeline-reading-card is-unassigned');
    expect(readingHtml).toContain('data-testid="timeline-reading-unrevealed-chip-e2"');
    expect(readingHtml).toContain(timelineStoryOrderPhone(2));

    // 無拖曳把手、無按鈕包按鈕、無樣張金色「新」字
    expect(readingHtml).not.toContain('timeline-drag-handle');
    expect(readingHtml).not.toContain('timeline-organize-dock');
    expect(readingHtml).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/i);
    expect(readingHtml).not.toContain('>新<');
  });

  it('章節順序邊界：全連章時不顯示空的未連章段；無任何事件時顯示空狀態；直接渲染沿用 buildTimelineModel', () => {
    const allLinkedHtml = renderTimelineRoute('hotel-all-linked', 'phone-portrait', {
      initialViewMode: 'reading',
    });
    expect(allLinkedHtml).toContain('data-testid="timeline-reading-section-ch-1"');
    expect(allLinkedHtml).not.toContain('data-testid="timeline-reading-unassigned-section"');
    expect(allLinkedHtml).not.toContain('data-testid="timeline-reading-unassigned-header"');

    const emptyHtml = renderTimelineRoute('empty-timeline', 'phone-portrait', {
      initialViewMode: 'reading',
    });
    expect(emptyHtml).toContain('data-testid="timeline-empty-hint"');
    expect(emptyHtml).toContain(TIMELINE_EMPTY_HINT);
    expect(emptyHtml).not.toContain('data-testid="timeline-reading-unassigned-section"');

    const model = buildTimelineModel(HOTEL_EVENTS, HOTEL_CHAPTERS);
    const directReadingHtml = renderToStaticMarkup(
      createElement(TimelineReadingView, {
        chapterSections: model.chapterSections,
        unassignedEvents: model.unassignedEvents,
        onSelectEvent: () => {},
      }),
    );
    expect(directReadingHtml).toContain('data-testid="timeline-reading-flashback-chip-e1"');
    expect(directReadingHtml).toContain('data-testid="timeline-reading-unrevealed-chip-e2"');

    const readingSource = readFileSync(
      new URL('../components/TimelineReadingView.tsx', import.meta.url),
      'utf8',
    );
    const cssSource = readFileSync(new URL('./timelineScreen.css', import.meta.url), 'utf8');
    expect(readingSource).not.toContain('computeFlashbackIds');
    expect(readingSource).not.toContain('reduceDrag');
    expect(readingSource).not.toMatch(/[时间线顺节对画无障碍标]/);
    expect(cssSource).toContain('var(--flashback)');
    expect(cssSource).not.toContain('var(--warning)');
  });

  it('審查 2 (1)(2)(3)(4)(6) 守衛：短按交原生 onClick、拖後抑 click、鍵盤移動還原焦點、觸控跳章熱區、返回朗讀與新增草稿', () => {
    const storySource = readFileSync(
      new URL('../components/TimelineStoryView.tsx', import.meta.url),
      'utf8',
    );
    const screenSource = readFileSync(new URL('./TimelineScreen.tsx', import.meta.url), 'utf8');
    const editorCss = readFileSync(new URL('../components/cardEditor.css', import.meta.url), 'utf8');

    // (1) & (6)：!wasMoved 交由原生 onClick、僅在 wasMoved && type === 'pointerup' 抑制緊接的一次 click、window 監聽不再依賴 selectedMoveId 重綁
    expect(storySource).toContain('if (!wasMoved) {\n        // 未移動的短按直接交由原生 onClick 處理');
    expect(storySource).toContain("if (type === 'pointerup') {\n        suppressNextClickRef.current = true;\n      }");
    expect(storySource).not.toContain('window.setTimeout');
    expect(storySource).toContain('suppressNextClickRef.current = false;');
    expect(storySource).toContain('}, []);');

    // (2)：鍵盤 Alt+↑/↓ 與把手 ↑/↓ 移動後，在 useLayoutEffect 還原焦點至對應按鈕
    expect(storySource).toContain("triggerDeltaMove(item, -1, 'card')");
    expect(storySource).toContain("triggerDeltaMove(item, 1, 'card')");
    expect(storySource).toContain("triggerDeltaMove(item, -1, 'handle')");
    expect(storySource).toContain("triggerDeltaMove(item, 1, 'handle')");
    expect(storySource).toContain('focus({ preventScroll: true })');

    // (3)：cardEditor.css 觸控模式 .card-editor-jump-link 熱區至少 44px
    expect(editorCss).toMatch(
      /html\[data-pointer="touch"\]\s+\.card-editor-jump-link[\s\S]*?min-height:\s*var\(--hit-size,\s*44px\)/,
    );

    // (4)：從事件卡返回時間線的鈕 aria-label 使用 TIMELINE_BACK_TO_TIMELINE_ARIA；handleAddEvent 先寫入初始草稿
    expect(TIMELINE_BACK_TO_TIMELINE_ARIA).toBe('返回時間線');
    expect(screenSource).not.toContain('BACK_TO_CARDS_ARIA');
    expect(screenSource).toContain('saveCardDraft(projectId, created.id');

    const phoneDetailHtml = renderTimelineRoute('hotel-fog', 'phone-portrait', {
      initialCardId: 'e1',
    });
    expect(phoneDetailHtml).toContain(`aria-label="${TIMELINE_BACK_TO_TIMELINE_ARIA}"`);

    const wideDetailHtml = renderTimelineRoute(
      'hotel-fog',
      'wide',
      { initialCardId: 'e1' },
      'both',
    );
    expect(wideDetailHtml).toContain(`aria-label="${TIMELINE_BACK_TO_TIMELINE_ARIA}"`);
  });
});

describe('WO-128 第 7 段：雙軸對照畫面（TimelineDualAxisView）', () => {
  it('只有 wide（含 one-side 與 both）有雙軸對照切換；非 wide 即使指定 dual 也自動退回故事順序', () => {
    for (const wideColumns of ['one-side', 'both'] as const) {
      const wideHtml = renderTimelineRoute(
        'hotel-fog-7',
        'wide',
        { initialViewMode: 'dual' },
        wideColumns,
      );
      expect(wideHtml, wideColumns).toContain('data-testid="timeline-tab-dual"');
      expect(wideHtml, wideColumns).toContain(TIMELINE_TAB_DUAL);
      expect(wideHtml, wideColumns).toContain('data-testid="timeline-dual-view"');
      expect(wideHtml, wideColumns).not.toContain('data-testid="timeline-story-view"');
    }

    for (const narrowMode of ['phone-portrait', 'phone-landscape', 'medium'] as const) {
      const narrowHtml = renderTimelineRoute('hotel-fog-7', narrowMode, {
        initialViewMode: 'dual',
      });
      expect(narrowHtml, narrowMode).not.toContain('data-testid="timeline-tab-dual"');
      expect(narrowHtml, narrowMode).not.toContain('data-testid="timeline-dual-view"');
      expect(narrowHtml, narrowMode).toContain('data-testid="timeline-story-view"');
    }
  });

  it('《霧港旅館》7 事件雙軸結構：上排故事真實順序（含把手）、下排讀者讀到的順序（跨欄章標頭＋未連章）、圖例與用字常數', () => {
    const html = renderTimelineRoute('hotel-fog-7', 'wide', { initialViewMode: 'dual' }, 'both');

    // 上下排標題與說明用字
    expect(html).toContain(TIMELINE_DUAL_TOP_TITLE);
    expect(html).toContain(TIMELINE_DUAL_TOP_DESC);
    expect(html).toContain(TIMELINE_DUAL_BOTTOM_TITLE);
    expect(html).toContain(TIMELINE_DUAL_BOTTOM_DESC);

    // 頁尾圖例用字
    expect(html).toContain(TIMELINE_DUAL_LEGEND_NORMAL);
    expect(html).toContain(TIMELINE_DUAL_LEGEND_FLASHBACK);
    expect(html).toContain(TIMELINE_DUAL_LEGEND_UNASSIGNED);
    expect(html).toContain(TIMELINE_DUAL_LEGEND_CROSSING);

    // 上排 7 張卡依故事順序 e1..e7 排列，每張皆有「故事第 N 件」與右上 ⠿ 拖曳把手
    const topPositions = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'].map((id, i) => {
      expect(html).toContain(`data-testid="timeline-dual-top-card-${id}"`);
      expect(html).toContain(`data-testid="timeline-dual-handle-${id}"`);
      expect(html).toContain(timelineStoryOrderWide(i + 1));
      const idx = html.indexOf(`data-testid="timeline-dual-top-card-${id}"`);
      expect(idx).toBeGreaterThanOrEqual(0);
      return idx;
    });
    for (let i = 1; i < topPositions.length; i += 1) {
      expect(topPositions[i - 1]!).toBeLessThan(topPositions[i]!);
    }

    // 下排跨欄章標頭：第一章～第五章（第五章 span 2）＋最後「還沒寫進任何章」
    expect(html).toContain('data-testid="timeline-dual-chapter-group-ch-1"');
    expect(html).toContain('data-testid="timeline-dual-chapter-group-ch-5"');
    const ch5Group =
      html.match(/<div[^>]*data-testid="timeline-dual-chapter-group-ch-5"[^>]*>/)?.[0] ?? '';
    expect(ch5Group).toContain('grid-column:span 2');
    const unassignedGroup =
      html.match(/<div[^>]*data-testid="timeline-dual-chapter-group-unassigned"[^>]*>/)?.[0] ?? '';
    expect(unassignedGroup).toContain('is-unassigned');
    expect(unassignedGroup).toContain('grid-column:span 1');

    // 下排 7 張卡依讀者順序 e5, e6, e1, e7, e3, e4，最後是未連章 e2
    const bottomOrderIds = ['e5', 'e6', 'e1', 'e7', 'e3', 'e4', 'e2'];
    const bottomPositions = bottomOrderIds.map((id) => {
      const idx = html.indexOf(`data-testid="timeline-dual-bottom-card-${id}"`);
      expect(idx).toBeGreaterThanOrEqual(0);
      return idx;
    });
    for (let i = 1; i < bottomPositions.length; i += 1) {
      expect(bottomPositions[i - 1]!).toBeLessThan(bottomPositions[i]!);
    }

    for (let k = 1; k <= 6; k += 1) {
      expect(html).toContain(timelineReadingOrderWide(k));
    }
    expect(html).toContain(TIMELINE_READER_NOT_YET);
    expect(html).toContain('data-testid="timeline-dual-bottom-unrevealed-chip-e2"');
    expect(html).toContain(TIMELINE_BADGE_UNREVEALED);

    // 樣張金色「新」字絕不輸出
    expect(html).not.toContain('>新<');
  });

  it('分卷章標頭與全連章／空白邊界：有卷顯示「第一卷・第三章」，全連章無未連章標頭，無事件顯示空狀態', () => {
    const volHtml = renderTimelineRoute(
      'hotel-fog-volume',
      'wide',
      { initialViewMode: 'dual', initialDualSelectedId: 'e1' },
      'both',
    );
    expect(volHtml).toContain('第一卷・第一章');
    expect(volHtml).toContain('第一卷・第三章');
    expect(volHtml).toContain(
      timelineDualTipDetail('舊館大火，沈家小女兒失蹤', 1, '第一卷・第三章'),
    );

    const allLinkedHtml = renderTimelineRoute(
      'hotel-all-linked',
      'wide',
      { initialViewMode: 'dual' },
      'both',
    );
    expect(allLinkedHtml).not.toContain('data-testid="timeline-dual-chapter-group-unassigned"');

    const emptyHtml = renderTimelineRoute(
      'empty-timeline',
      'wide',
      { initialViewMode: 'dual' },
      'both',
    );
    expect(emptyHtml).toContain('data-testid="timeline-empty-hint"');
    expect(emptyHtml).toContain(TIMELINE_EMPTY_HINT);
    expect(emptyHtml).toContain('data-testid="timeline-dual-footer"');
  });

  it('SVG path 數等於事件數、線色線型分類（順敘／倒敘 --flashback／未連章虛線 6 6）、終點圓點、選取加粗 3.5 置頂與其他線 0.4 不透明', () => {
    // 預設選取 e1（7 事件）
    const htmlSelE1 = renderTimelineRoute(
      'hotel-fog-7',
      'wide',
      { initialViewMode: 'dual', initialDualSelectedId: 'e1' },
      'both',
    );

    const pathMatches = [
      ...htmlSelE1.matchAll(/<path\b[^>]*data-testid="timeline-dual-path-(e\d)"[^>]*>/g),
    ];
    const dotMatches = [
      ...htmlSelE1.matchAll(/<circle\b[^>]*data-testid="timeline-dual-dot-(e\d)"[^>]*>/g),
    ];
    expect(pathMatches).toHaveLength(HOTEL_FULL_7_EVENTS.length);
    expect(dotMatches).toHaveLength(HOTEL_FULL_7_EVENTS.length);

    const pathById = new Map(pathMatches.map((m) => [m[1]!, m[0]!]));

    // 1. 倒敘線（e1, e3, e4）：var(--flashback)、實線
    for (const fbId of ['e1', 'e3', 'e4']) {
      const p = pathById.get(fbId)!;
      expect(p).toContain('data-line-kind="flashback"');
      expect(p).toContain('stroke="var(--flashback)"');
      expect(p).not.toContain('stroke-dasharray');
    }

    // 2. 未連章線（e2）：var(--muted)、虛線 6 6
    const pUnassigned = pathById.get('e2')!;
    expect(pUnassigned).toContain('data-line-kind="unassigned"');
    expect(pUnassigned).toContain('stroke="var(--muted)"');
    expect(pUnassigned).toContain('stroke-dasharray="6 6"');

    // 3. 順敘線（e5, e6, e7）：color-mix(in srgb, var(--accent) 60%, transparent)、實線
    for (const normalId of ['e5', 'e6', 'e7']) {
      const p = pathById.get(normalId)!;
      expect(p).toContain('data-line-kind="normal"');
      expect(p).toContain('stroke="color-mix(in srgb, var(--accent) 60%, transparent)"');
      expect(p).not.toContain('stroke-dasharray');
    }

    // 4. 選取 e1 時：e1 stroke-width="3.5"、opacity="1" 且排在最後一條 path（SVG 置頂）；其餘 6 條為 2.2 與 opacity="0.4"
    expect(pathMatches[pathMatches.length - 1]?.[1]).toBe('e1');
    expect(pathById.get('e1')).toContain('stroke-width="3.5"');
    expect(pathById.get('e1')).toContain('opacity="1"');
    expect(pathById.get('e1')).toContain('data-selected="true"');
    for (const otherId of ['e2', 'e3', 'e4', 'e5', 'e6', 'e7']) {
      expect(pathById.get(otherId)).toContain('stroke-width="2.2"');
      expect(pathById.get(otherId)).toContain('opacity="0.4"');
      expect(pathById.get(otherId)).toContain('data-selected="false"');
    }

    // 5. 改選 e2（未連章）時：e2 排在最後置頂且加粗 3.5，上下排 e2 同步加上 .is-selected，提示泡泡顯示未連章摘要與「開啟卡片」按鈕
    const htmlSelE2 = renderTimelineRoute(
      'hotel-fog-7',
      'wide',
      { initialViewMode: 'dual', initialDualSelectedId: 'e2' },
      'both',
    );
    const e2Paths = [
      ...htmlSelE2.matchAll(/<path\b[^>]*data-testid="timeline-dual-path-(e\d)"[^>]*>/g),
    ];
    expect(e2Paths[e2Paths.length - 1]?.[1]).toBe('e2');
    expect(e2Paths[e2Paths.length - 1]?.[0]).toContain('stroke-width="3.5"');
    expect(htmlSelE2).toMatch(
      /class="[^"]*timeline-dual-top-card[^"]*is-selected[^"]*"[^>]*data-testid="timeline-dual-top-card-e2"/,
    );
    expect(htmlSelE2).toMatch(
      /class="[^"]*timeline-dual-bottom-card[^"]*is-selected[^"]*"[^>]*data-testid="timeline-dual-bottom-card-e2"/,
    );
    expect(htmlSelE2).toContain(TIMELINE_DUAL_TIP_INTRO);
    expect(htmlSelE2).toContain(timelineDualTipDetail('沈伯謙偷偷改了遺囑', 2, null));
    expect(htmlSelE2).toContain('data-testid="timeline-dual-open-card-btn"');
    expect(htmlSelE2).toContain(TIMELINE_OPEN_CARD);

    // 6. 未選取任何卡片（initialDualSelectedId: null）時：所有線條皆為 2.2 且 opacity="1"
    const htmlNoSel = renderTimelineRoute(
      'hotel-fog-7',
      'wide',
      { initialViewMode: 'dual', initialDualSelectedId: null },
      'both',
    );
    const noSelPaths = [
      ...htmlNoSel.matchAll(/<path\b[^>]*data-testid="timeline-dual-path-(e\d)"[^>]*>/g),
    ];
    expect(noSelPaths).toHaveLength(7);
    for (const m of noSelPaths) {
      expect(m[0]).toContain('stroke-width="2.2"');
      expect(m[0]).toContain('opacity="1"');
    }
  });

  it('無障礙、開啟卡片側欄並存與原始碼守衛：無按鈕包按鈕、≥44px 開啟卡片鈕、ResizeObserver+rAF、水平拖曳與 Alt+←/→', () => {
    // 在雙軸對照開啟事件卡與底部排序列時，雙軸舞台與右側 CardEditor 並存且無按鈕包按鈕
    const htmlWithOpenAndDock = renderTimelineRoute(
      'hotel-fog-7',
      'wide',
      {
        initialViewMode: 'dual',
        initialCardId: 'e3',
        initialSelectedMoveId: 'e1',
      },
      'both',
    );
    expect(htmlWithOpenAndDock).toContain('data-testid="timeline-dual-view"');
    expect(htmlWithOpenAndDock).toContain('data-testid="timeline-detail-aside"');
    expect(htmlWithOpenAndDock).toContain('data-testid="timeline-organize-dock"');
    expect(htmlWithOpenAndDock).toContain('aria-live="polite"');
    expect(htmlWithOpenAndDock).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/i);

    // 直接渲染 TimelineDualAxisView 檢查無按鈕包按鈕
    const model = buildTimelineModel(HOTEL_FULL_7_EVENTS, HOTEL_CHAPTERS);
    const directDualHtml = renderToStaticMarkup(
      createElement(TimelineDualAxisView, {
        storyEvents: model.storyEvents,
        dualBottomEvents: model.dualBottomEvents,
        dualBottomGroups: model.dualBottomGroups,
        selectedMoveId: null,
        onSelectMoveId: () => {},
        onOpenCard: () => {},
        onMoveByDrop: () => false,
        onMoveByDelta: () => false,
      }),
    );
    expect(directDualHtml).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/i);

    const dualSource = readFileSync(
      new URL('../components/TimelineDualAxisView.tsx', import.meta.url),
      'utf8',
    );
    const cssSource = readFileSync(new URL('./timelineScreen.css', import.meta.url), 'utf8');

    // 原始碼守衛：沿用 computeDualAxisLines 與 reduceDrag、ResizeObserver + window resize + requestAnimationFrame + fonts.ready、水平鍵盤快捷鍵與焦點還原
    expect(dualSource).toContain('computeDualAxisLines');
    expect(dualSource).toContain('reduceDrag');
    expect(dualSource).toContain('ResizeObserver');
    expect(dualSource).toContain("window.addEventListener('resize'");
    expect(dualSource).toContain('requestAnimationFrame');
    expect(dualSource).toContain('document.fonts?.ready');
    expect(dualSource).toContain('ArrowLeft');
    expect(dualSource).toContain('ArrowRight');
    expect(dualSource).toContain('focus({ preventScroll: true })');
    expect(dualSource).toContain('onDoubleClick');
    expect(dualSource).toContain('pane.scrollLeft');
    expect(dualSource).not.toContain('var(--warning)');
    expect(dualSource).not.toMatch(/[时间线顺节对画拽无障碍标]/);

    // CSS 守衛：「開啟卡片」按鈕高度 ≥ 44px，且不使用 --warning 或 --editor
    const openBtnBlock = cssSource.match(/\.timeline-dual-open-btn \{[^}]+\}/)?.[0] ?? '';
    expect(openBtnBlock).toContain('min-height: 44px');
    expect(cssSource).not.toContain('var(--warning)');
    expect(cssSource).not.toContain('var(--editor)');
  });
});

describe('WO-128 第 8 段：畫面與無障礙測試補齊（規劃 9.4 節）', () => {
  const stripSourceComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const extractModeSwitchTabLabels = (html: string): string[] => {
    const start = html.indexOf('data-testid="timeline-mode-switch"');
    if (start < 0) return [];
    const end = html.indexOf('</div>', start);
    const segment = end >= 0 ? html.slice(start, end) : html.slice(start);
    return [...segment.matchAll(/<button\b[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, '').trim(),
    );
  };

  it('四種 LayoutMode 切換按鈕數量與標籤：僅 wide 有 3 顆（含雙軸對照），其餘三種僅 2 顆', () => {
    const narrowModes: Array<{ mode: LayoutMode; wideColumns: WideColumns | null }> = [
      { mode: 'phone-portrait', wideColumns: null },
      { mode: 'phone-landscape', wideColumns: null },
      { mode: 'medium', wideColumns: null },
    ];

    for (const { mode, wideColumns } of narrowModes) {
      const html = renderTimelineRoute('hotel-fog-7', mode, undefined, wideColumns);
      expect(extractModeSwitchTabLabels(html), mode).toEqual([
        TIMELINE_TAB_STORY,
        TIMELINE_TAB_READING,
      ]);
    }

    for (const wideColumns of ['one-side', 'both'] as const) {
      const html = renderTimelineRoute('hotel-fog-7', 'wide', undefined, wideColumns);
      expect(extractModeSwitchTabLabels(html), `wide-${wideColumns}`).toEqual([
        TIMELINE_TAB_STORY,
        TIMELINE_TAB_READING,
        TIMELINE_TAB_DUAL,
      ]);
    }
  });

  it('三種畫面靜態結構與用字全部來自 userFacing.ts（註解外零硬寫中文），且導覽維持五格', () => {
    const timelineFiles = [
      '../screens/TimelineScreen.tsx',
      '../components/TimelineStoryView.tsx',
      '../components/TimelineReadingView.tsx',
      '../components/TimelineDualAxisView.tsx',
    ];
    for (const rel of timelineFiles) {
      const raw = readFileSync(new URL(rel, import.meta.url), 'utf8');
      const stripped = stripSourceComments(raw);
      expect(stripped, `${rel} 不得在註解外硬寫中文`).not.toMatch(/[\u4e00-\u9fff]/);
    }

    const cardsScreenRaw = readFileSync(new URL('./CardsScreen.tsx', import.meta.url), 'utf8');
    const switchStart = cardsScreenRaw.indexOf('const renderTimelineViewSwitch');
    expect(switchStart).toBeGreaterThanOrEqual(0);
    const switchBlock = stripSourceComments(cardsScreenRaw.slice(switchStart, switchStart + 1200));
    expect(switchBlock).not.toMatch(/[\u4e00-\u9fff]/);
    expect(switchBlock).toContain('TIMELINE_VIEW_CARDS');
    expect(switchBlock).toContain('TIMELINE_VIEW_TIMELINE');

    // 四種版面的導覽維持五格且「資料集」保持亮起
    const navLayouts: Array<{ mode: LayoutMode; wideColumns: WideColumns | null; navId: string }> = [
      { mode: 'phone-portrait', wideColumns: null, navId: 'bottom-nav' },
      { mode: 'phone-landscape', wideColumns: null, navId: 'nav-rail' },
      { mode: 'medium', wideColumns: null, navId: 'nav-rail' },
      { mode: 'wide', wideColumns: 'both', navId: 'nav-rail' },
    ];
    for (const { mode, wideColumns, navId } of navLayouts) {
      const html = renderTimelineRoute('hotel-fog-7', mode, undefined, wideColumns);
      expect(html, mode).toContain(`data-testid="${navId}"`);
      const navStart = html.indexOf(`data-testid="${navId}"`);
      const navEnd = html.indexOf('</nav>', navStart);
      const navHtml = html.slice(navStart, navEnd);
      expect(navHtml.match(/data-testid="nav-(?:write|cards|files|stats|settings)"/g)?.length).toBe(5);
      expect(navHtml).toMatch(/data-nav-active="true"[^>]*data-testid="nav-cards"/);
    }
  });

  it('寫作頁抽屜（WritingCardsDrawer）顯示時間軸分類時沒有時間線入口', () => {
    const baseState = demoFixtureState();
    const project = baseState.projects[0]!;
    const drawerHtml = renderToStaticMarkup(
      createElement(
        SampleProvider,
        {
          initialState: {
            ...baseState,
            projects: [
              {
                ...project,
                id: 'fog-drawer',
                nodes: HOTEL_CHAPTERS,
                cards: HOTEL_FULL_7_EVENTS,
              },
            ],
          },
        },
        createElement(WritingCardsDrawer, {
          projectId: 'fog-drawer',
          initialCategoryId: 'timeline',
          initialCardId: null,
          onClose: () => {},
        }),
      ),
    );
    expect(drawerHtml).not.toContain('data-testid="timeline-entry-switch"');
    expect(drawerHtml).not.toContain('data-testid="timeline-entry-timeline-btn"');
    expect(drawerHtml).not.toContain('/cards/timeline');
    expect(drawerHtml).not.toContain(`>${TIMELINE_VIEW_TIMELINE}<`);
  });

  it('全版面與全檢視無障礙守衛：無按鈕包按鈕、把手防選字與熱區 CSS、aria-live、上移／下移禁用邊界', () => {
    // 1. 故事順序與章節順序於四種版面皆無按鈕包按鈕
    for (const mode of ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const) {
      const wideColumns: WideColumns | null = mode === 'wide' ? 'both' : null;
      for (const viewMode of ['story', 'reading'] as const) {
        const html = renderTimelineRoute(
          'hotel-fog-7',
          mode,
          { initialViewMode: viewMode, initialSelectedMoveId: viewMode === 'story' ? 'e4' : null },
          wideColumns,
        );
        expect(html, `${mode}-${viewMode}`).not.toMatch(
          /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/i,
        );
      }
    }

    // 2. 開啟卡片詳情（預覽與編輯＋章清單）、更多選單、刪除確認與 10 秒復原條皆無按鈕包按鈕
    for (const extraProps of [
      { initialCardId: 'e1', initialEditorMode: 'preview' as const },
      { initialCardId: 'e1', initialEditorMode: 'edit' as const },
      { initialCardId: 'e1', initialShowCardMenu: true },
      { initialCardId: 'e1', initialConfirmDeleteCardId: 'e1' },
    ]) {
      const html = renderTimelineRoute('hotel-fog-7', 'phone-portrait', extraProps);
      expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<button\b/i);
    }

    // 3. 故事順序與雙軸對照排序列：第一位上移禁用、最後一位下移禁用、中間位兩者皆可用，且含 aria-live="polite"
    const dualFirstHtml = renderTimelineRoute(
      'hotel-fog-7',
      'wide',
      { initialViewMode: 'dual', initialSelectedMoveId: 'e1' },
      'both',
    );
    expect(dualFirstHtml).toContain('aria-live="polite"');
    expect(dualFirstHtml).toContain(timelineSelectedDockLabel('舊館大火，沈家小女兒失蹤'));
    expect(dualFirstHtml.match(/<button[^>]*data-testid="timeline-move-up-btn"[^>]*>/)?.[0]).toContain(
      'disabled',
    );
    expect(
      dualFirstHtml.match(/<button[^>]*data-testid="timeline-move-down-btn"[^>]*>/)?.[0],
    ).not.toContain('disabled');

    const storyLastHtml = renderTimelineRoute('hotel-fog-7', 'phone-portrait', {
      initialViewMode: 'story',
      initialSelectedMoveId: 'e7',
    });
    expect(
      storyLastHtml.match(/<button[^>]*data-testid="timeline-move-up-btn"[^>]*>/)?.[0],
    ).not.toContain('disabled');
    expect(storyLastHtml.match(/<button[^>]*data-testid="timeline-move-down-btn"[^>]*>/)?.[0]).toContain(
      'disabled',
    );

    const storyMidHtml = renderTimelineRoute('hotel-fog-7', 'phone-portrait', {
      initialViewMode: 'story',
      initialSelectedMoveId: 'e3',
    });
    expect(
      storyMidHtml.match(/<button[^>]*data-testid="timeline-move-up-btn"[^>]*>/)?.[0],
    ).not.toContain('disabled');
    expect(
      storyMidHtml.match(/<button[^>]*data-testid="timeline-move-down-btn"[^>]*>/)?.[0],
    ).not.toContain('disabled');

    // 4. CSS 守衛：拖曳把手至少 44×44 熱區與防選字、時間線 CSS 無寫死色碼與 --warning
    const timelineCss = readFileSync(new URL('./timelineScreen.css', import.meta.url), 'utf8');
    const handleBlock = timelineCss.match(/\.timeline-drag-handle \{[^}]+\}/)?.[0] ?? '';
    expect(handleBlock).toContain('min-width: var(--hit-size, 44px)');
    expect(handleBlock).toContain('min-height: var(--hit-size, 44px)');
    expect(handleBlock).toContain('touch-action: none');
    expect(handleBlock).toContain('user-select: none');
    expect(handleBlock).toContain('-webkit-user-select: none');
    expect(handleBlock).toContain('-webkit-touch-callout: none');
    expect(timelineCss).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(timelineCss).not.toContain('var(--warning)');

    const cardsCss = readFileSync(new URL('./cardsScreen.css', import.meta.url), 'utf8');
    const wo128CardsCss = cardsCss.slice(cardsCss.indexOf('WO-128'));
    expect(wo128CardsCss).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(wo128CardsCss).not.toContain('var(--warning)');
  });
});

describe('WO-128 審查 3 小修：雙軸提示泡泡夾限與上排標題列避讓把手', () => {
  it('computeDualTipOffsetLeft：1180×820 水平捲動舞台時夾限在目前可視範圍內，1440×900 對齊卡片且不超出右緣', () => {
    // 1. 1180×820（左側窄欄 72px，可視寬度 1108px，舞台寬度 1328px，未捲動 scrollLeft=0）
    //    點第 5 張卡 e3（cardLeft=836, stageLeft=72, rawLeft=736）時應夾限在 1108 - 56 - 420 = 632
    expect(
      computeDualTipOffsetLeft({
        cardLeft: 836,
        stageLeft: 72,
        stageWidth: 1328,
        scrollLeft: 0,
        viewportWidth: 1108,
      }),
    ).toBe(632);

    // 2. 1180×820 向右捲動到底（scrollLeft=220, stageLeft=-148）：
    //    點最後一張卡 e2（舞台 x=1132 → cardLeft=984, rawLeft=1104）夾限在 852
    expect(
      computeDualTipOffsetLeft({
        cardLeft: 984,
        stageLeft: -148,
        stageWidth: 1328,
        scrollLeft: 220,
        viewportWidth: 1108,
      }),
    ).toBe(852);

    //    點靠左側部分被捲出視窗的卡片（舞台 x=212 → cardLeft=64, rawLeft=184）應推至至少 scrollLeft - 28 = 192
    expect(
      computeDualTipOffsetLeft({
        cardLeft: 64,
        stageLeft: -148,
        stageWidth: 1328,
        scrollLeft: 220,
        viewportWidth: 1108,
      }),
    ).toBe(192);

    // 3. 1440×900（可視寬度 1368px，舞台寬度 1368px）：點中間卡片維持對齊、點最末張卡片夾限在 892
    expect(
      computeDualTipOffsetLeft({
        cardLeft: 832,
        stageLeft: 72,
        stageWidth: 1368,
        scrollLeft: 0,
        viewportWidth: 1368,
      }),
    ).toBe(732);
    expect(
      computeDualTipOffsetLeft({
        cardLeft: 1212,
        stageLeft: 72,
        stageWidth: 1368,
        scrollLeft: 0,
        viewportWidth: 1368,
      }),
    ).toBe(892);
  });

  it('原始碼與 CSS 守衛：泡泡扣減常數對齊 420px、點卡後 scrollIntoView、上排標題列用 var(--hit-size) 避開把手', () => {
    const dualSource = readFileSync(
      new URL('../components/TimelineDualAxisView.tsx', import.meta.url),
      'utf8',
    );
    const timelineCss = readFileSync(new URL('./timelineScreen.css', import.meta.url), 'utf8');

    // 泡泡 max-width 與扣減常數對齊 420，且不再使用舊的 340
    expect(DUAL_TIP_MAX_WIDTH).toBe(420);
    expect(timelineCss).toMatch(/\.timeline-dual-tip\s*\{[^}]*max-width:\s*420px/);
    expect(dualSource).toContain('DUAL_TIP_MAX_WIDTH = 420');
    expect(dualSource).not.toContain('- 340');

    // 點卡後呼叫 scrollIntoView({ inline: 'nearest', block: 'nearest' }) 並監聽捲動容器
    expect(dualSource).toContain("scrollIntoView({ inline: 'nearest', block: 'nearest' })");
    expect(dualSource).toContain("addEventListener('scroll'");

    // 上排卡片標題列右側留白改用 var(--hit-size, 44px) 避開觸控把手，不寫死 32px
    expect(timelineCss).toMatch(
      /\.timeline-dual-card-btn\.is-top\s+\.timeline-dual-card-top[\s\S]*?padding-right:\s*var\(--hit-size,\s*44px\)/,
    );
    expect(timelineCss).not.toMatch(/\.timeline-dual-card-top\s*\{[^}]*padding-right:\s*32px/);
  });
});
