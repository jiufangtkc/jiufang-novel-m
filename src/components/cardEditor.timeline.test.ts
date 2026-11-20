import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  EVENT_CHAPTER_LABEL,
  EVENT_CHAPTER_NONE_NOTE,
  EVENT_STORY_TIME_EMPTY,
  EVENT_STORY_TIME_HELP,
  EVENT_STORY_TIME_LABEL,
  EVENT_STORY_TIME_PLACEHOLDER,
  TIMELINE_UNASSIGNED_LABEL,
  TIMELINE_VIEW_TIMELINE,
  timelineJumpToChapter,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import { CATEGORY_CHARACTER, CATEGORY_TIMELINE } from '../domain/cardCategories';
import { updateCard } from '../domain/cardOps';
import { extractTimelineChapters } from '../domain/timeline';
import { CardsScreen, type CardsScreenProps } from '../screens/CardsScreen';
import { SampleProvider, type SampleState } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import {
  buildCardEditorPayload,
  CardEditor,
  type CardEditorCard,
} from './CardEditor';
import {
  BookOutlineIcon,
  EyeOffIcon,
  GripDotsIcon,
  UndoArrowIcon,
} from './Icons';
import { WritingCardsDrawer } from './WritingCardsDrawer';

function hasNestedButton(html: string): boolean {
  const tokens = html.match(/<\/?button\b/gi) ?? [];
  let depth = 0;
  for (const token of tokens) {
    if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1);
    } else {
      depth += 1;
      if (depth > 1) return true;
    }
  }
  return false;
}

const SAMPLE_NODES: ChapterNode[] = [
  {
    id: 'vol-1',
    type: 'folder',
    title: '第一卷　霧港',
    expanded: true,
    children: [
      { id: 'ch-1', type: 'file', title: '第一章　清晨的書房', content: '', progress: 'Draft' },
      { id: 'ch-3', type: 'file', title: '第三章　十年前的火', content: '', progress: 'Draft' },
    ],
  },
  { id: 'ch-4', type: 'file', title: '第四章　每個人都在別處', content: '', progress: 'Draft' },
];

const SAMPLE_CHAPTERS = extractTimelineChapters(SAMPLE_NODES);

const TIMELINE_TOP_CARD: CardEditorCard = {
  id: 'tl-top-1',
  parent_id: null,
  category: CATEGORY_TIMELINE,
  title: '舊館大火，沈家小女兒失蹤',
  content: '舊館在除夕夜起火，沈伯謙抱出了大女兒。',
  color: '#e06c75',
  storyTime: '十年前・冬',
  timelineOrder: 0,
  chapterId: 'ch-3',
};

const TIMELINE_UNLINKED_CARD: CardEditorCard = {
  ...TIMELINE_TOP_CARD,
  id: 'tl-top-2',
  title: '沈伯謙偷偷改了遺囑',
  storyTime: '',
  chapterId: null,
};

const TIMELINE_SUBCARD: CardEditorCard = {
  id: 'tl-sub-1',
  parent_id: 'tl-top-1',
  category: CATEGORY_TIMELINE,
  title: '廚房門鎖異常',
  content: '子卡片只記細節，不出現在時間線。',
  color: '#3C3F41',
};

const CHARACTER_CARD: CardEditorCard = {
  id: 'char-1',
  parent_id: null,
  category: CATEGORY_CHARACTER,
  title: '沈雨晴',
  content: '女主角，二十四歲。',
  color: '#61afef',
};

describe('WO-128 第 4 段：事件卡編輯器與預覽新欄位', () => {
  it('Icons.tsx 補齊 4 個時間線圖示（GripDotsIcon、UndoArrowIcon、EyeOffIcon、BookOutlineIcon）', () => {
    for (const Icon of [GripDotsIcon, UndoArrowIcon, EyeOffIcon, BookOutlineIcon]) {
      const svg = renderToStaticMarkup(React.createElement(Icon, { size: 18 }));
      expect(svg).toContain('<svg');
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('viewBox="0 0 24 24"');
    }
  });

  it('時間軸頂層卡在預覽與編輯模式皆顯示「故事時間」與「出現在哪一章」，且不含樣張金色「新」標註', () => {
    const previewHtml = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: TIMELINE_TOP_CARD,
        chapters: SAMPLE_CHAPTERS,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'preview',
      }),
    );

    expect(previewHtml).toContain('data-testid="card-timeline-preview-fields"');
    expect(previewHtml).toContain(EVENT_STORY_TIME_LABEL);
    expect(previewHtml).toContain('十年前・冬');
    expect(previewHtml).toContain(EVENT_CHAPTER_LABEL);
    expect(previewHtml).toContain('第一卷・第三章　十年前的火');
    expect(previewHtml).toContain(timelineJumpToChapter('第一卷・第三章'));
    expect(previewHtml).not.toContain('class="new"');
    expect(previewHtml).not.toContain('>新<');

    const editHtml = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: TIMELINE_TOP_CARD,
        chapters: SAMPLE_CHAPTERS,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'edit',
        initialChapterPickerOpen: true,
      }),
    );

    expect(editHtml).toContain('data-testid="card-editor-story-time-input"');
    expect(editHtml).toContain(`placeholder="${EVENT_STORY_TIME_PLACEHOLDER}"`);
    expect(editHtml).toContain('value="十年前・冬"');
    expect(editHtml).toContain(EVENT_STORY_TIME_HELP);
    expect(editHtml).toContain(EVENT_CHAPTER_LABEL);
    expect(editHtml).toContain('role="radiogroup"');
    expect(editHtml).toContain('role="radio"');
    expect(editHtml).toContain('aria-expanded="true"');
    // 章清單分卷名稱與未連章最後一項旁註
    expect(editHtml).toContain('第一卷・第一章　清晨的書房');
    expect(editHtml).toContain('第一卷・第三章　十年前的火');
    expect(editHtml).toContain('第四章　每個人都在別處');
    expect(editHtml).toContain(TIMELINE_UNASSIGNED_LABEL);
    expect(editHtml).toContain(EVENT_CHAPTER_NONE_NOTE);
    expect(editHtml).toContain(timelineJumpToChapter('第一卷・第三章'));
    expect(editHtml).not.toContain('class="new"');
    expect(editHtml).not.toContain('>新<');

    // 欄位順序：標題 → 故事時間 → 出現在哪一章 → 內容
    const titleIdx = editHtml.indexOf('card-editor-title-input');
    const storyTimeIdx = editHtml.indexOf('card-editor-story-time-input');
    const chapterIdx = editHtml.indexOf('card-editor-chapter-picker');
    const contentIdx = editHtml.indexOf('card-editor-content-textarea');
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(storyTimeIdx).toBeGreaterThanOrEqual(0);
    expect(chapterIdx).toBeGreaterThanOrEqual(0);
    expect(contentIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeLessThan(storyTimeIdx);
    expect(storyTimeIdx).toBeLessThan(chapterIdx);
    expect(chapterIdx).toBeLessThan(contentIdx);
  });

  it('未連章或失效 chapterId 顯示「還沒寫進任何章」與「先記著，之後再放」，且不顯示跳章連結', () => {
    const unlinkedPreview = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: TIMELINE_UNLINKED_CARD,
        chapters: SAMPLE_CHAPTERS,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'preview',
      }),
    );
    expect(unlinkedPreview).toContain(EVENT_STORY_TIME_EMPTY);
    expect(unlinkedPreview).toContain(TIMELINE_UNASSIGNED_LABEL);
    expect(unlinkedPreview).toContain(EVENT_CHAPTER_NONE_NOTE);
    expect(unlinkedPreview).not.toContain('card-editor-jump-chapter-btn');

    const stalePreview = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: { ...TIMELINE_TOP_CARD, chapterId: 'deleted-chapter-id' },
        chapters: SAMPLE_CHAPTERS,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'preview',
      }),
    );
    expect(stalePreview).toContain(TIMELINE_UNASSIGNED_LABEL);
    expect(stalePreview).not.toContain('card-editor-jump-chapter-btn');
  });

  it('子卡與角色卡在預覽與編輯模式完全不受影響（無故事時間、無出現在哪一章、無跳章連結）', () => {
    for (const card of [TIMELINE_SUBCARD, CHARACTER_CARD]) {
      for (const mode of ['preview', 'edit'] as const) {
        const html = renderToStaticMarkup(
          React.createElement(CardEditor, {
            card,
            chapters: SAMPLE_CHAPTERS,
            onSave: vi.fn(),
            onDone: vi.fn(),
            initialMode: mode,
            initialChapterPickerOpen: true,
          }),
        );
        expect(html).not.toContain(EVENT_STORY_TIME_LABEL);
        expect(html).not.toContain(EVENT_CHAPTER_LABEL);
        expect(html).not.toContain(TIMELINE_UNASSIGNED_LABEL);
        expect(html).not.toContain('card-timeline-preview-fields');
        expect(html).not.toContain('card-editor-story-time-input');
        expect(html).not.toContain('card-editor-chapter-picker');
        expect(html).not.toContain('card-editor-jump-chapter-btn');
      }
    }
  });

  it('無障礙結構：預覽與編輯（含展開章清單、各版面）皆無按鈕包按鈕', () => {
    for (const layoutMode of ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const) {
      const previewHtml = renderToStaticMarkup(
        React.createElement(CardEditor, {
          card: TIMELINE_TOP_CARD,
          chapters: SAMPLE_CHAPTERS,
          onSave: vi.fn(),
          onDone: vi.fn(),
          initialMode: 'preview',
          layoutMode,
        }),
      );
      expect(hasNestedButton(previewHtml), `preview ${layoutMode}`).toBe(false);

      const editHtml = renderToStaticMarkup(
        React.createElement(CardEditor, {
          card: TIMELINE_TOP_CARD,
          chapters: SAMPLE_CHAPTERS,
          onSave: vi.fn(),
          onDone: vi.fn(),
          initialMode: 'edit',
          initialChapterPickerOpen: true,
          layoutMode,
        }),
      );
      expect(hasNestedButton(editHtml), `edit ${layoutMode}`).toBe(false);
    }
  });

  it('選「還沒寫進任何章」存成 null，並可經 updateCard 正確寫回卡片；子卡與他類卡不帶時間線欄位', () => {
    const unassignedPayload = buildCardEditorPayload({
      card: TIMELINE_TOP_CARD,
      title: TIMELINE_TOP_CARD.title,
      content: TIMELINE_TOP_CARD.content,
      color: TIMELINE_TOP_CARD.color ?? '#3C3F41',
      storyTime: '十年前・冬',
      chapterId: null,
      chapters: SAMPLE_CHAPTERS,
    });
    expect(unassignedPayload.chapterId).toBeNull();
    expect(unassignedPayload.storyTime).toBe('十年前・冬');

    const [updated] = updateCard(
      [
        {
          id: TIMELINE_TOP_CARD.id,
          parent_id: null,
          category: CATEGORY_TIMELINE,
          title: TIMELINE_TOP_CARD.title,
          content: TIMELINE_TOP_CARD.content,
          color: '#e06c75',
          is_collapsed: 0,
          sort_order: 0,
          storyTime: '十年前・冬',
          chapterId: 'ch-3',
        },
      ],
      TIMELINE_TOP_CARD.id,
      unassignedPayload,
    );
    expect(updated?.chapterId).toBeNull();

    const subPayload = buildCardEditorPayload({
      card: TIMELINE_SUBCARD,
      title: TIMELINE_SUBCARD.title,
      content: TIMELINE_SUBCARD.content,
      color: '#3C3F41',
      storyTime: '不應帶入',
      chapterId: 'ch-3',
      chapters: SAMPLE_CHAPTERS,
    });
    expect(subPayload).toEqual({
      title: TIMELINE_SUBCARD.title,
      content: TIMELINE_SUBCARD.content,
      color: '#3C3F41',
    });
    expect('storyTime' in subPayload).toBe(false);
    expect('chapterId' in subPayload).toBe(false);

    const charPayload = buildCardEditorPayload({
      card: CHARACTER_CARD,
      title: CHARACTER_CARD.title,
      content: CHARACTER_CARD.content,
      color: '#61afef',
      storyTime: '不應帶入',
      chapterId: 'ch-3',
      chapters: SAMPLE_CHAPTERS,
    });
    expect('storyTime' in charPayload).toBe(false);
    expect('chapterId' in charPayload).toBe(false);
  });

  it('CardsScreen 與 WritingCardsDrawer 打開時間軸頂層卡時皆看得到兩欄與跳章連結，且抽屜無時間線入口', () => {
    const baseState = demoFixtureState();
    const project = baseState.projects[0]!;
    const customState: SampleState = {
      ...baseState,
      projects: [
        {
          ...project,
          id: 'tl-wire-book',
          nodes: SAMPLE_NODES,
          cards: [
            {
              id: TIMELINE_TOP_CARD.id,
              parent_id: null,
              category: CATEGORY_TIMELINE,
              title: TIMELINE_TOP_CARD.title,
              content: TIMELINE_TOP_CARD.content,
              color: '#e06c75',
              is_collapsed: 0,
              sort_order: 0,
              storyTime: '十年前・冬',
              chapterId: 'ch-3',
            },
          ],
        },
      ],
    };

    const cardsHtml = renderToStaticMarkup(
      React.createElement(
        SampleProvider,
        { initialState: customState },
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/p/tl-wire-book/cards'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, {
              path: '/p/:projectId/cards',
              element: React.createElement<CardsScreenProps>(CardsScreen, {
                initialCategoryId: CATEGORY_TIMELINE,
                initialCardId: TIMELINE_TOP_CARD.id,
                initialEditorMode: 'preview',
              }),
            }),
          ),
        ),
      ),
    );
    expect(cardsHtml).toContain(EVENT_STORY_TIME_LABEL);
    expect(cardsHtml).toContain('十年前・冬');
    expect(cardsHtml).toContain(EVENT_CHAPTER_LABEL);
    expect(cardsHtml).toContain(timelineJumpToChapter('第一卷・第三章'));

    const drawerHtml = renderToStaticMarkup(
      React.createElement(
        SampleProvider,
        { initialState: customState },
        React.createElement(WritingCardsDrawer, {
          projectId: 'tl-wire-book',
          initialCategoryId: CATEGORY_TIMELINE,
          initialCardId: TIMELINE_TOP_CARD.id,
          onClose: vi.fn(),
        }),
      ),
    );
    expect(drawerHtml).toContain(EVENT_STORY_TIME_LABEL);
    expect(drawerHtml).toContain('十年前・冬');
    expect(drawerHtml).toContain(EVENT_CHAPTER_LABEL);
    expect(drawerHtml).toContain(timelineJumpToChapter('第一卷・第三章'));

    // 寫作頁抽屜清單層也不加入時間線入口
    const drawerListHtml = renderToStaticMarkup(
      React.createElement(
        SampleProvider,
        { initialState: customState },
        React.createElement(WritingCardsDrawer, {
          projectId: 'tl-wire-book',
          initialCategoryId: CATEGORY_TIMELINE,
          initialCardId: null,
          onClose: vi.fn(),
        }),
      ),
    );
    expect(drawerListHtml).not.toContain(`>${TIMELINE_VIEW_TIMELINE}<`);
  });

  it('原始碼守衛：跳章前保存草稿、選單點選「還沒寫進任何章」傳入 null、抽屜不加時間線入口、CSS 使用既有主題變數', () => {
    const editorSrc = readFileSync(new URL('./CardEditor.tsx', import.meta.url), 'utf8');
    const drawerSrc = readFileSync(new URL('./WritingCardsDrawer.tsx', import.meta.url), 'utf8');
    const cardsScreenSrc = readFileSync(new URL('../screens/CardsScreen.tsx', import.meta.url), 'utf8');
    const editorCss = readFileSync(new URL('./cardEditor.css', import.meta.url), 'utf8');

    // CardEditor 選「還沒寫進任何章」傳入 null；跳章前在編輯模式先同步草稿
    expect(editorSrc).toContain('onClick={() => handleSelectChapter(null)}');
    expect(editorSrc).toContain("if (currentMode === 'edit')");
    expect(editorSrc).toContain('onDraftChangeRef.current?.(currentDraft)');
    expect(editorSrc).toContain('onJumpToChapter?.(targetChapterId, currentDraft)');

    // CardsScreen 與 WritingCardsDrawer 接線：跳章前先保存草稿再跳到寫作頁該章
    expect(cardsScreenSrc).toContain('extractTimelineChapters(project.nodes)');
    expect(cardsScreenSrc).toContain('saveCardDraft(projectId, card.id, draftPayload)');
    expect(cardsScreenSrc).toContain('navigate(`/p/${projectId}/write/${chapterId}`)');

    expect(drawerSrc).toContain('extractTimelineChapters(project.nodes)');
    expect(drawerSrc).toContain('saveCardDraft(projectId, currentCard.id, draftPayload)');
    expect(drawerSrc).toContain('/p/${projectId}/write/${chapterId}');
    expect(drawerSrc).not.toContain('TIMELINE_VIEW_TIMELINE');
    expect(drawerSrc).not.toContain('/cards/timeline');

    // cardEditor.css 新增樣式不使用寫死色碼
    const addedCss = editorCss.slice(editorCss.indexOf('WO-128'));
    expect(addedCss).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(addedCss).not.toMatch(/rgba?\(/i);
    expect(addedCss).toContain('var(--accent)');
    expect(addedCss).toContain('var(--accent-soft)');
    expect(addedCss).toContain('var(--border)');
    expect(addedCss).toContain('var(--panel)');
    expect(addedCss).toContain('var(--muted)');
  });
});
