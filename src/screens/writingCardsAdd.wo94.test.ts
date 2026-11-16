import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ADD_CARD_BUTTON } from '../copy/cardEditCopy';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import { addCard } from '../domain/cardOps';
import { LayoutProvider } from '../layout/layoutContext';
import { SampleProvider } from '../state/sampleStore';
import type { LayoutMode, WideColumns } from '../layout/layoutMode';

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
];

vi.mock('../state/sampleStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/sampleStore')>();
  return {
    ...actual,
    useProject: (projectId: string | undefined) =>
      projectId === 'empty-book'
        ? { id: 'empty-book', title: '【範例】空稿', updatedLabel: '剛剛', bookGoal: 50000, nodes: [], cards: [] }
        : projectId === 'own-book'
          ? { id: 'own-book', title: '【範例】自己的測試稿', updatedLabel: '剛剛', bookGoal: 50000, nodes: [], cards: OWN_CARDS }
          : actual.useProject(projectId),
  };
});

const LAYOUTS: Array<[string, LayoutMode, WideColumns | null]> = [
  ['手機直拿', 'phone-portrait', null],
  ['手機橫拿', 'phone-landscape', null],
  ['中等', 'medium', null],
  ['寬版', 'wide', 'both'],
];

function render(mode: LayoutMode, columns: WideColumns | null, projectId: string, categoryId: string | null): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode, initialWideColumns: columns },
        createElement(WritingCardsDrawer, {
          projectId,
          initialCategoryId: categoryId,
          initialCardId: null,
          onClose: () => {},
        }),
      ),
    ),
  );
}

describe('WO-94：看卡片面板分類內可新增卡片', () => {
  it('沿用資料集的「新增卡片」用字', () => {
    expect(ADD_CARD_BUTTON).toBe('新增卡片');
  });

  for (const [name, mode, columns] of LAYOUTS) {
    it(`${name}：分類清單層沒有「新增卡片」，進分類後有；範例稿與無卡片稿都可用`, () => {
      for (const projectId of ['fog', 'own-book', 'empty-book']) {
        const list = render(mode, columns, projectId, null);
        expect(list).toContain('data-testid="category-list"');
        expect(list).not.toContain(ADD_CARD_BUTTON);
        const inCategory = render(mode, columns, projectId, 'character');
        expect(inCategory).toContain(ADD_CARD_BUTTON);
        expect(inCategory).toContain('data-testid="writing-add-card-btn"');
      }
    });
  }

  it('無卡片的稿：分類內顯示空分類說明與「新增卡片」', () => {
    const html = render('wide', 'both', 'empty-book', 'character');
    expect(html).toContain('category-cards-empty');
    expect(html).toContain(ADD_CARD_BUTTON);
  });

  it('不在此面板做刪除、整理分類、新增子卡片', () => {
    const html = render('wide', 'both', 'fog', 'character');
    expect(html).not.toContain('刪除');
    expect(html).not.toContain('整理分類');
    expect(html).not.toContain('子卡片」按鈕');
    expect(html).not.toContain('新增子卡片');
  });

  it('新增沿用 addCard：新卡屬目前分類、在最後、既有卡片原樣保留', () => {
    const next = addCard(OWN_CARDS, { category: 'character' });
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(OWN_CARDS[0]);
    const created = next[1];
    expect(created.category).toBe('character');
    expect(created.parent_id).toBeNull();
    expect(addCard([], { category: 'location' })[0].category).toBe('location');
  });
});
