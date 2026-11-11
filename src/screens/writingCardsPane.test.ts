import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  BACK_TO_CARDS_ARIA,
  BACK_TO_CATEGORIES_ARIA,
  CARDS_HEADING,
  CLOSE_CARDS_ARIA,
  SAMPLE_CARDS_NOTICE,
  VIEW_CARDS_BUTTON,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import { SampleProvider } from '../state/sampleStore';
import { EditorPane } from './EditorPane';
import {
  WritingCardsDrawer,
  type WritingCardsDrawerProps,
} from '../components/WritingCardsDrawer';

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
  return renderToStaticMarkup(createElement(WritingCardsDrawer, props));
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
    // 檢查無障礙朗讀文案規格：角色，5 張卡片
    expect(layer1).toContain('角色，5 張卡片');

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

  it('只能看：面板裡絕無編輯、新增、刪除、排序或 disabled 變灰按鈕', () => {
    // 檢查各層
    const layers = [
      renderDrawer({ projectId: 'fog', initialCategoryId: null, onClose: () => {} }),
      renderDrawer({ projectId: 'fog', initialCategoryId: 'character', onClose: () => {} }),
      renderDrawer({ projectId: 'fog', initialCategoryId: 'character', initialCardId: '20000000-0000-4000-8000-000000000001', onClose: () => {} }),
    ];

    for (const html of layers) {
      expect(html).not.toContain('新增');
      expect(html).not.toContain('編輯');
      expect(html).not.toContain('刪除');
      expect(html).not.toContain('排序');
      expect(html).not.toContain('改色');
      expect(html).not.toContain('disabled');
    }
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

  it('電腦版稿件顯示提示小字，一般稿件不顯示', () => {
    const normalHtml = renderDrawer({
      projectId: 'fog',
      isDesktopFile: false,
      initialCategoryId: null,
      onClose: () => {},
    });
    expect(normalHtml).not.toContain(SAMPLE_CARDS_NOTICE);

    const desktopHtml = renderDrawer({
      projectId: 'desktop-proj',
      isDesktopFile: true,
      initialCategoryId: null,
      onClose: () => {},
    });
    expect(desktopHtml).toContain(SAMPLE_CARDS_NOTICE);
  });
});
