import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  CARDS_PREVIEW_EMPTY_HINT,
  cardsSubcardsCountLabel,
  dailyProgressGoalLabel,
  dailyProgressWordsLabel,
} from '../copy/userFacing';
import { DEMO_CARDS, type DemoCard } from '../data/demoCards';
import { type LayoutMode, LayoutProvider } from '../layout';
import { CardsScreen, type CardsScreenProps } from '../screens/CardsScreen';
import * as sampleStore from '../state/sampleStore';
import { DailyProgressBar } from './DailyProgressBar';
import { WritingCardsDrawer } from './WritingCardsDrawer';

function renderCardsScreen(
  initialUrl: string,
  initialState?: CardsScreenProps,
  mode: LayoutMode = 'wide',
): string {
  return renderToStaticMarkup(
    createElement(
      LayoutProvider,
      { initialMode: mode },
      createElement(
        sampleStore.SampleProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: [initialUrl] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/cards',
              element: createElement<CardsScreenProps>(CardsScreen, initialState ?? null),
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-59：資料集與底列用字定案驗證', () => {
  it('WO-59：DailyProgressBar 底列 300／1000 顯示「今天寫了 300 字」「每日目標 1,000 字」', () => {
    const html = renderToStaticMarkup(
      createElement(DailyProgressBar, {
        words: 300,
        goal: 1000,
        met: false,
        compact: false,
      }),
    );

    // 可見文字包含「今天寫了 300 字」與「每日目標 1,000 字」
    expect(html).toContain('今天寫了 300 字');
    expect(html).toContain('每日目標 1,000 字');
    expect(html).toContain(
      '<div class="daily-bar-heading"><span>今天寫了 300 字</span><span>每日目標 1,000 字</span></div>',
    );

    // 可見標題列不包含「今日已寫」、舊式「目標 1000 字」、前後綴
    const headingMatch = html.match(/<div class="daily-bar-heading">([\s\S]*?)<\/div>/);
    expect(headingMatch).toBeTruthy();
    expect(headingMatch![1]).not.toContain('今日已寫');
    expect(headingMatch![1]).not.toContain('目標 1000 字');
    expect(headingMatch![1]).not.toContain('✦');
    expect(headingMatch![1]).not.toContain('已達標');

    // aria-label 維持原本朗讀文字不改
    expect(html).toContain('aria-label="今日已寫 300 字，目標 1000 字"');
  });

  it('WO-59：DailyProgressBar 底列 12345 字顯示四位數千分位「12,345」且達標時顯示前後綴「✦ 今天寫了 12,345 字，已達標」', () => {
    const htmlMet = renderToStaticMarkup(
      createElement(DailyProgressBar, {
        words: 12345,
        goal: 10000,
        met: true,
        compact: false,
      }),
    );

    expect(htmlMet).toContain('✦ 今天寫了 12,345 字，已達標');
    expect(htmlMet).toContain('每日目標 10,000 字');
    expect(htmlMet).toContain('class="daily-bar is-met"');
    // aria-label 維持原本朗讀文字不改
    expect(htmlMet).toContain('aria-label="今日已寫 12345 字，已達到目標 10000 字"');

    // 測試未達標時 12345 字顯示「今天寫了 12,345 字」
    const htmlNotMet = renderToStaticMarkup(
      createElement(DailyProgressBar, {
        words: 12345,
        goal: 20000,
        met: false,
        compact: false,
      }),
    );
    expect(htmlNotMet).toContain('今天寫了 12,345 字');
    expect(htmlNotMet).toContain('每日目標 20,000 字');
    expect(htmlNotMet).not.toContain('✦');
    expect(htmlNotMet).not.toContain('已達標');
  });

  it('WO-59：DailyProgressBar compact 模式與 aria-label 朗讀維持原樣不改', () => {
    // 1. compact 模式在 300 / 1000 時
    const htmlCompact1 = renderToStaticMarkup(
      createElement(DailyProgressBar, {
        words: 300,
        goal: 1000,
        met: false,
        compact: true,
      }),
    );
    expect(htmlCompact1).toContain('class="daily-bar is-compact"');
    expect(htmlCompact1).toContain('<span class="daily-bar-compact">300／1000</span>');
    expect(htmlCompact1).not.toContain('daily-bar-heading');
    expect(htmlCompact1).toContain('aria-label="今日已寫 300 字，目標 1000 字"');

    // 2. compact 模式在 12345 / 10000 時（N／M 不加千分位，維持原樣）
    const htmlCompact2 = renderToStaticMarkup(
      createElement(DailyProgressBar, {
        words: 12345,
        goal: 10000,
        met: true,
        compact: true,
      }),
    );
    expect(htmlCompact2).toContain('<span class="daily-bar-compact">12345／10000</span>');
    expect(htmlCompact2).not.toContain('daily-bar-heading');
    expect(htmlCompact2).toContain('aria-label="今日已寫 12345 字，已達到目標 10000 字"');
  });

  it('WO-59：cardsSubcardsCountLabel(n) 字串函式全形空白驗證', () => {
    expect(cardsSubcardsCountLabel(3)).toBe('子卡片\u30003 張');
    expect(cardsSubcardsCountLabel(1)).toBe('子卡片\u30001 張');
    expect(cardsSubcardsCountLabel(12)).toBe('子卡片\u300012 張');
    expect(cardsSubcardsCountLabel(1000)).toBe('子卡片\u30001,000 張');
  });

  it('WO-59：dailyProgressWordsLabel 與 dailyProgressGoalLabel 輔助函式輸出驗證', () => {
    expect(dailyProgressWordsLabel(300, false)).toBe('今天寫了 300 字');
    expect(dailyProgressWordsLabel(300, true)).toBe('✦ 今天寫了 300 字，已達標');
    expect(dailyProgressWordsLabel(12345, false)).toBe('今天寫了 12,345 字');
    expect(dailyProgressWordsLabel(12345, true)).toBe('✦ 今天寫了 12,345 字，已達標');
    expect(dailyProgressGoalLabel(1000)).toBe('每日目標 1,000 字');
    expect(dailyProgressGoalLabel(10000)).toBe('每日目標 10,000 字');
  });

  it('WO-59：CardsScreen 畫面輸出：子卡片 0 張時不出現標題、有子卡片時顯示「子卡片　N 張」（全形空白）', () => {
    // 1. 子卡片為 0 張時（【範例】陸承安 無子卡片）：整個標題不顯示（不是顯示「子卡片　0 張」）
    const htmlZero = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000003',
    });
    expect(htmlZero).not.toContain('data-testid="cards-subcards-section"');
    expect(htmlZero).not.toContain('cards-subcards-heading');
    expect(htmlZero).not.toContain('子卡片　0 張');
    expect(htmlZero).not.toContain('子卡片 0 張');

    // 卡片內容區塊（card-detail-pane）不含任何子卡片標題
    const detailPane = htmlZero.match(/<section class="cards-col cards-col-detail"[\s\S]*?<\/section>/);
    expect(detailPane).toBeTruthy();
    expect(detailPane![0]).not.toContain('子卡片');

    // 2. 有子卡片時（【範例】沈雨晴 有 1 張子卡片）：顯示「子卡片　1 張」（全形空白）
    const htmlOne = renderCardsScreen('/p/fog/cards', {
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
    });
    expect(htmlOne).toContain('data-testid="cards-subcards-section"');
    expect(htmlOne).toContain('子卡片\u30001 張');

    // 3. 有 3 張子卡片時：顯示「子卡片　3 張」（全形空白）
    const parentId = '20000000-0000-4000-8000-000000000003';
    const tempSubcards: DemoCard[] = [
      {
        id: '20000000-0000-4000-8000-000000000091',
        parent_id: parentId,
        category: 'character',
        title: '【範例】助手甲',
        content: '第一位助手',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 1,
      },
      {
        id: '20000000-0000-4000-8000-000000000092',
        parent_id: parentId,
        category: 'character',
        title: '【範例】助手乙',
        content: '第二位助手',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 2,
      },
      {
        id: '20000000-0000-4000-8000-000000000093',
        parent_id: parentId,
        category: 'character',
        title: '【範例】助手丙',
        content: '第三位助手',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 3,
      },
    ];

    try {
      DEMO_CARDS.push(...tempSubcards);
      const htmlThree = renderCardsScreen('/p/fog/cards', {
        initialCategoryId: 'character',
        initialCardId: parentId,
      });
      expect(htmlThree).toContain('data-testid="cards-subcards-section"');
      expect(htmlThree).toContain('子卡片\u30003 張');
      expect(htmlThree).toContain('【範例】助手甲');
      expect(htmlThree).toContain('【範例】助手乙');
      expect(htmlThree).toContain('【範例】助手丙');
    } finally {
      for (const temp of tempSubcards) {
        const idx = DEMO_CARDS.findIndex((c) => c.id === temp.id);
        if (idx >= 0) DEMO_CARDS.splice(idx, 1);
      }
    }
  });

  it('WO-59：WritingCardsDrawer 畫面輸出：子卡片 0 張時不出現標題、有子卡片時顯示「子卡片　3 張」（全形空白）', () => {
    // 1. 子卡片為 0 張時：整個標題不顯示
    const htmlZero = renderToStaticMarkup(
      createElement(WritingCardsDrawer, {
        projectId: 'fog',
        onClose: () => {},
        initialCategoryId: 'character',
        initialCardId: '20000000-0000-4000-8000-000000000003',
      }),
    );
    expect(htmlZero).not.toContain('data-testid="cards-subcards-section"');
    expect(htmlZero).not.toContain('cards-subcards-heading');
    expect(htmlZero).not.toContain('子卡片');
    expect(htmlZero).not.toContain('子卡片　0 張');

    // 2. 有 3 張子卡片時：顯示「子卡片　3 張」（全形空白）
    const parentId = '20000000-0000-4000-8000-000000000003';
    const tempSubcards: DemoCard[] = [
      {
        id: '20000000-0000-4000-8000-000000000094',
        parent_id: parentId,
        category: 'character',
        title: '【範例】隨身短刀',
        content: '防身短刀',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 1,
      },
      {
        id: '20000000-0000-4000-8000-000000000095',
        parent_id: parentId,
        category: 'character',
        title: '【範例】航海日誌',
        content: '老舊日誌',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 2,
      },
      {
        id: '20000000-0000-4000-8000-000000000096',
        parent_id: parentId,
        category: 'character',
        title: '【範例】黃銅羅盤',
        content: '家族傳承的羅盤',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 3,
      },
    ];

    try {
      DEMO_CARDS.push(...tempSubcards);
      const htmlThree = renderToStaticMarkup(
        createElement(WritingCardsDrawer, {
          projectId: 'fog',
          onClose: () => {},
          initialCategoryId: 'character',
          initialCardId: parentId,
        }),
      );
      expect(htmlThree).toContain('data-testid="cards-subcards-section"');
      expect(htmlThree).toContain('子卡片\u30003 張');
      expect(htmlThree).toContain('【範例】黃銅羅盤');
    } finally {
      for (const temp of tempSubcards) {
        const idx = DEMO_CARDS.findIndex((c) => c.id === temp.id);
        if (idx >= 0) DEMO_CARDS.splice(idx, 1);
      }
    }
  });

  it('WO-59：CARDS_PREVIEW_EMPTY_HINT 定案為「這份稿子還沒有正文。」且手機橫拿預覽空稿時畫面輸出驗證', () => {
    expect(CARDS_PREVIEW_EMPTY_HINT).toBe('這份稿子還沒有正文。');

    const spy = vi.spyOn(sampleStore, 'useProject').mockReturnValue({
      id: 'empty-manuscript',
      title: '【範例】空稿件',
      updatedLabel: '剛剛',
      bookGoal: 50000,
      origin: 'demo',
      nodes: [],
    } as any);

    try {
      // 手機橫拿版面（phone-landscape）
      const htmlLandscape = renderCardsScreen(
        '/p/empty-manuscript/cards',
        { initialCategoryId: 'character' },
        'phone-landscape',
      );
      expect(htmlLandscape).toContain('cards-landscape-view');
      expect(htmlLandscape).toContain('data-testid="cards-preview-empty"');
      expect(htmlLandscape).toContain('這份稿子還沒有正文。');
      expect(htmlLandscape).not.toContain('這本書還沒有正文內容。');
    } finally {
      spy.mockRestore();
    }
  });

  it('WO-59：原始碼（非測試、非 src/db）靜態掃描：不再有「今日已寫」可見文字（aria-label 除外）與「這本書還沒有正文內容」', () => {
    const sourceRelativePaths = [
      '../copy/userFacing.ts',
      './DailyProgressBar.tsx',
      './WritingCardsDrawer.tsx',
      './CardMarkdownView.tsx',
      './StatusBadge.tsx',
      './Toast.tsx',
      './Icons.tsx',
      './AppNav.tsx',
      '../screens/CardsScreen.tsx',
      '../screens/EditorPane.tsx',
      '../screens/WriteScreen.tsx',
      '../screens/FilesScreen.tsx',
      '../screens/SettingsScreen.tsx',
      '../screens/StatsScreen.tsx',
      '../screens/HomeScreen.tsx',
      '../layout/layoutContext.tsx',
      '../layout/sidePanels.ts',
      '../layout/layoutMode.ts',
      '../layout/useLayoutMode.ts',
      '../layout/compositionAction.ts',
      '../layout/index.ts',
      '../App.tsx',
    ];

    expect(sourceRelativePaths.length).toBeGreaterThan(15);

    for (const rel of sourceRelativePaths) {
      const content = readFileSync(new URL(rel, import.meta.url), 'utf8');

      // 1. 絕不可含有「這本書還沒有正文內容」
      expect(
        content.includes('這本書還沒有正文內容'),
        `${rel} 不可包含「這本書還沒有正文內容」`,
      ).toBe(false);

      // 2. 原始碼中「今日已寫」僅允許出現在 DailyProgressBar.tsx 的 aria-label 宣告中，不可作為可見文字
      if (content.includes('今日已寫')) {
        expect(
          rel,
          `${rel} 非 DailyProgressBar.tsx 卻包含「今日已寫」`,
        ).toBe('./DailyProgressBar.tsx');

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('今日已寫')) {
            // 必須是 aria-label 相關的 label 定義
            const isLabelDef =
              line.includes('? `今日已寫') || line.includes(': `今日已寫');
            expect(
              isLabelDef,
              `DailyProgressBar.tsx 第 ${i + 1} 列的可見文字包含「今日已寫」：${line}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
