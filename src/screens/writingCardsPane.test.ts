import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  BACK_TO_CARDS_ARIA,
  BACK_TO_CATEGORIES_ARIA,
  CARDS_HEADING,
  CARDS_READONLY_BADGE,
  CLOSE_CARDS_ARIA,
  CARDS_EMPTY_IN_CATEGORY_HINT,
  SAMPLE_CARDS_NOTICE,
  VIEW_CARDS_BUTTON,
  WRITING_CARDS_EMPTY_BOOK_HINT,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import { SampleProvider } from '../state/sampleStore';
import { EditorPane } from './EditorPane';
import {
  WritingCardsDrawer,
  type WritingCardsDrawerProps,
} from '../components/WritingCardsDrawer';

const OWN_CARDS = [
  {
    id: 'own-1',
    parent_id: null,
    category: 'character',
    title: '【範例】測試稿自己的角色',
    content: '這是這份測試稿自己的角色內容',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 1,
  },
  {
    id: 'own-2',
    parent_id: 'own-1',
    category: 'character',
    title: '自己的子卡片',
    content: '子卡片內容',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 2,
  },
];

// 新稿、手機自己的稿、從檔案開啟的稿；看卡片要讀這份稿子自己的卡片
vi.mock('../state/sampleStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/sampleStore')>();
  const base = { updatedLabel: '剛剛', bookGoal: 50000, nodes: [] };
  return {
    ...actual,
    useProject: (projectId: string | undefined) => {
      if (projectId === 'new-book') {
        return { ...base, id: 'new-book', title: '【範例】新稿測試', cards: [] };
      }
      if (projectId === 'own-book') {
        return { ...base, id: 'own-book', title: '【範例】自己的測試稿', cards: OWN_CARDS };
      }
      if (projectId === 'reopened-file') {
        return {
          ...base,
          id: 'reopened-file',
          title: '【範例】另存再開測試稿',
          origin: 'file',
          cards: OWN_CARDS,
        };
      }
      return actual.useProject(projectId);
    },
  };
});

const mockChapter: ChapterNode = {
  id: 'ch-test-1',
  type: 'file',
  title: '第一章　常霧初起',
  content: '【範例】秋分過後，整座海港常年籠罩在白霧之中。',
  progress: 'Draft',
  expanded: true,
};

function renderEditorPane(projectId = 'fog', chapter = mockChapter): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [`/p/${projectId}/write/${chapter.id}`] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/p/:projectId/write/:chapterId',
            element: createElement(EditorPane, { projectId, chapter }),
          }),
        ),
      ),
    ),
  );
}

function renderDrawer(props: WritingCardsDrawerProps): string {
  return renderToStaticMarkup(
    createElement(SampleProvider, null, createElement(WritingCardsDrawer, props)),
  );
}

describe('寫作時看卡片畫面驗收測試（WO-50）', () => {
  it('寫作畫面具備「看卡片」按鈕（頂列與手機橫放備援按鈕，無狀態列重複入口）', () => {
    const html = renderEditorPane('fog');

    // 頂列包含「看卡片」按鈕（至少 44×44）
    expect(html).toContain('toggle-cards-topbar');
    expect(html).toContain(VIEW_CARDS_BUTTON);

    // 橫放打字時之備援觸發按鈕（至少 44×44）
    expect(html).toContain('toggle-cards-landscape');

    // 狀態列已移除重複入口，恢復原本乾淨版面
    expect(html).not.toContain('toggle-cards-status');
  });

  it('面板各層靜態輸出（第 1 層：分類清單、第 2 層：卡片清單、第 3 層：卡片排版內容）', () => {
    // 第 1 層：分類清單（selectedCategoryId = null）
    const layer1 = renderDrawer({
      projectId: 'fog',
      initialCategoryId: null,
      onClose: () => {},
    });
    expect(layer1).toContain(CARDS_HEADING);
    expect(layer1).toContain('category-list');
    expect(layer1).toContain('角色');
    expect(layer1).toContain('本書綱要');
    expect(layer1).toContain(CLOSE_CARDS_ARIA);
    expect(layer1).toContain('角色，5 張');

    // 第 2 層：卡片清單（selectedCategoryId = 'character'）
    const layer2 = renderDrawer({
      projectId: 'fog',
      initialCategoryId: 'character',
      initialCardId: null,
      onClose: () => {},
    });
    expect(layer2).toContain(CARDS_HEADING);
    expect(layer2).toContain('角色');
    expect(layer2).toContain(BACK_TO_CATEGORIES_ARIA);
    expect(layer2).toContain('category-card-list');
    expect(layer2).toContain('【範例】沈雨晴');
    expect(layer2).toContain('【範例】陸明遠');

    // 第 3 層：卡片排版內容預覽（以 CardMarkdownView 渲染）
    const layer3 = renderDrawer({
      projectId: 'fog',
      initialCategoryId: 'character',
      initialCardId: '20000000-0000-4000-8000-000000000001',
      onClose: () => {},
    });
    expect(layer3).toContain(CARDS_HEADING);
    expect(layer3).toContain('角色');
    expect(layer3).toContain(BACK_TO_CARDS_ARIA);
    expect(layer3).toContain('card-detail-heading');
    expect(layer3).toContain('【範例】沈雨晴');
    // CardMarkdownView 渲染出的結構
    expect(layer3).toContain('card-md-view');
    expect(layer3).toContain('鐘錶修復師的養女');
  });

  it('WO-64／WO-94：各層不再有「只能看」；只有卡片內容層有「編輯」；分類清單無新增、分類內（卡片清單層）才有「新增卡片」；仍無刪除、排序或 disabled 變灰按鈕', () => {
    // 檢查各層
    const layers = [
      renderDrawer({ projectId: 'fog', initialCategoryId: null, onClose: () => {} }),
      renderDrawer({ projectId: 'fog', initialCategoryId: 'character', onClose: () => {} }),
      renderDrawer({ projectId: 'fog', initialCategoryId: 'character', initialCardId: '20000000-0000-4000-8000-000000000001', onClose: () => {} }),
    ];

    layers.forEach((html, index) => {
      expect(html).not.toContain(CARDS_READONLY_BADGE);
      // 分類清單與卡片清單沒有編輯入口；卡片內容層（第 3 層）才有「編輯」
      if (index < 2) expect(html).not.toContain('編輯');
      else expect(html).toContain('編輯');
      // WO-94：分類清單層（0）無新增；分類內卡片清單層（1）可新增；卡片內容層（2）沒有新增
      if (index === 1) expect(html).toContain('新增卡片');
      else expect(html).not.toContain('新增');
      expect(html).not.toContain('刪除');
      expect(html).not.toContain('排序');
      expect(html).not.toContain('改色');
      expect(html).not.toContain('disabled');
    });
  });

  it('AI 對話紀錄分類完全不出現', () => {
    const layer1 = renderDrawer({
      projectId: 'fog',
      initialCategoryId: null,
      onClose: () => {},
    });
    expect(layer1).not.toContain('AI對話紀錄');
    expect(layer1).not.toContain('AI 對話紀錄');
    expect(layer1).not.toContain('ai_chat');
  });

  it('WO-75：提示小字只在內建範例書出現；新稿、自己的稿、另存再開的檔都沒有', () => {
    const sample = renderDrawer({ projectId: 'fog', initialCategoryId: null, onClose: () => {} });
    expect(sample).toContain(SAMPLE_CARDS_NOTICE);
    expect(
      renderDrawer({ projectId: 'fog', initialCategoryId: 'character', onClose: () => {} }),
    ).toContain(SAMPLE_CARDS_NOTICE);
    expect(
      renderDrawer({
        projectId: 'fog',
        initialCategoryId: 'character',
        initialCardId: '20000000-0000-4000-8000-000000000003',
        onClose: () => {},
      }),
    ).toContain(SAMPLE_CARDS_NOTICE);

    for (const projectId of ['new-book', 'own-book', 'reopened-file']) {
      for (const initialCategoryId of [null, 'character']) {
        const html = renderDrawer({ projectId, initialCategoryId, onClose: () => {} });
        expect(html, `${projectId}/${initialCategoryId}`).not.toContain(SAMPLE_CARDS_NOTICE);
      }
    }
  });

  it('WO-74：新稿沒有卡片時是空的並有一句說明，不出現範例角色', () => {
    const layer1 = renderDrawer({ projectId: 'new-book', initialCategoryId: null, onClose: () => {} });
    expect(layer1).toContain(WRITING_CARDS_EMPTY_BOOK_HINT);
    expect(layer1).toContain('角色，0 張');
    expect(layer1).not.toContain('沈雨晴');
    expect(layer1).not.toContain('【範例】');

    const layer2 = renderDrawer({ projectId: 'new-book', initialCategoryId: 'character', onClose: () => {} });
    expect(layer2).toContain(CARDS_EMPTY_IN_CATEGORY_HINT);
    expect(layer2).not.toContain('沈雨晴');
  });

  it('WO-74：看卡片讀這份稿子自己的卡片、張數與子卡片，沒有範例卡片', () => {
    for (const projectId of ['own-book', 'reopened-file']) {
      const layer1 = renderDrawer({ projectId, initialCategoryId: null, onClose: () => {} });
      expect(layer1).not.toContain(WRITING_CARDS_EMPTY_BOOK_HINT);
      expect(layer1).toContain('角色，2 張');
      expect(layer1).toContain('本書綱要，0 張');
      expect(layer1).not.toContain('自訂分類001');

      const layer2 = renderDrawer({ projectId, initialCategoryId: 'character', onClose: () => {} });
      expect(layer2).toContain('【範例】測試稿自己的角色');
      expect(layer2).toContain('自己的子卡片');
      expect(layer2).not.toContain('沈雨晴');

      const layer3 = renderDrawer({
        projectId,
        initialCategoryId: 'character',
        initialCardId: 'own-1',
        onClose: () => {},
      });
      expect(layer3).toContain('這是這份測試稿自己的角色內容');
      expect(layer3).toContain('子卡片');
      // WO-64：拿掉「只能看」，改成可按「編輯」
      expect(layer3).not.toContain(CARDS_READONLY_BADGE);
      expect(layer3).toContain('編輯');
    }
  });

  it('WO-74：內建範例書仍顯示原有範例卡片', () => {
    const layer1 = renderDrawer({ projectId: 'fog', initialCategoryId: null, onClose: () => {} });
    expect(layer1).toContain('角色，5 張');
    expect(layer1).not.toContain(WRITING_CARDS_EMPTY_BOOK_HINT);
  });
});
