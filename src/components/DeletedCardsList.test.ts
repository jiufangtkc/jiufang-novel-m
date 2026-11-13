import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DELETED_CARDS_EMPTY,
  DELETED_CARDS_TITLE,
  deleteSubcardsImpact,
  PUT_BACK_ORIGINAL_BUTTON,
} from '../copy/cardEditCopy';
import type { FileCard } from '../db/projectFile';
import {
  archiveCardDeletion,
  DELETED_CARD_LIMIT,
  deletedFromCard,
  restoreDeletedCardToOrigin,
  type DeletedCardRecord,
} from '../domain/cardArchive';
import { deleteCard } from '../domain/cardOps';
import { emptyArchive } from '../domain/chapterVersions';
import { DeletedCardsList } from './DeletedCardsList';

describe('WO-61 最近刪除元件（DeletedCardsList）', () => {
  const sampleCategories = [
    { id: 'character', name: '角色' },
    { id: 'world', name: '世界觀' },
  ];

  const sampleDeletedCards: DeletedCardRecord[] = [
    {
      id: 'del-001',
      rootCardId: 'c-1',
      title: '【範例】主角設定',
      category: 'character',
      parentId: null,
      index: 0,
      beforeIds: [],
      afterIds: [],
      cards: [
        {
          id: 'c-1',
          category: 'character',
          title: '【範例】主角設定',
          content: '正義感強烈的青年',
          color: '#3C3F41',
          is_collapsed: 0,
          sort_order: 0,
          parent_id: null,
        },
        {
          id: 'c-1-1',
          category: 'character',
          title: '【範例】專屬配件',
          content: '青銅懷錶',
          color: '#3C3F41',
          is_collapsed: 0,
          sort_order: 0,
          parent_id: 'c-1',
        },
        {
          id: 'c-1-2',
          category: 'character',
          title: '【範例】座騎',
          content: '白色駿馬',
          color: '#3C3F41',
          is_collapsed: 0,
          sort_order: 1,
          parent_id: 'c-1',
        },
      ],
      deletedAt: Date.now() - 1000 * 60 * 5, // 5 分鐘前
    },
    {
      id: 'del-002',
      rootCardId: 'c-2',
      title: '',
      category: 'world',
      parentId: null,
      index: 1,
      beforeIds: [],
      afterIds: [],
      cards: [
        {
          id: 'c-2',
          category: 'world',
          title: '',
          content: '',
          color: '#3C3F41',
          is_collapsed: 0,
          sort_order: 1,
          parent_id: null,
        },
      ],
      deletedAt: Date.now() - 1000 * 60 * 60, // 1 小時前
    },
  ];

  it('WO-61 最近刪除元件：頂部說明句隨裝置稱呼換（這支手機／這台電腦／這台平板），且提及從分類清單最下方的「最近刪除」放回來', () => {
    // 預設／手機
    const htmlPhone = renderToStaticMarkup(
      React.createElement(DeletedCardsList, {
        deletedCards: sampleDeletedCards,
        categories: sampleCategories,
        onRestore: vi.fn(),
        onBack: vi.fn(),
        device: '這支手機',
      }),
    );
    expect(htmlPhone).toContain('最近刪除的 10 項會留在這支手機，可從分類清單最下方的「最近刪除」放回來');

    // 電腦
    const htmlDesktop = renderToStaticMarkup(
      React.createElement(DeletedCardsList, {
        deletedCards: sampleDeletedCards,
        categories: sampleCategories,
        onRestore: vi.fn(),
        onBack: vi.fn(),
        device: '這台電腦',
      }),
    );
    expect(htmlDesktop).toContain('最近刪除的 10 項會留在這台電腦，可從分類清單最下方的「最近刪除」放回來');

    // 平板
    const htmlTablet = renderToStaticMarkup(
      React.createElement(DeletedCardsList, {
        deletedCards: sampleDeletedCards,
        categories: sampleCategories,
        onRestore: vi.fn(),
        onBack: vi.fn(),
        device: '這台平板',
      }),
    );
    expect(htmlTablet).toContain('最近刪除的 10 項會留在這台平板，可從分類清單最下方的「最近刪除」放回來');
  });

  it('WO-61 最近刪除元件：清單項目顯示卡片標題、所屬分類、子卡片數量與「放回原位置」按鈕', () => {
    const handleRestore = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(DeletedCardsList, {
        deletedCards: sampleDeletedCards,
        categories: sampleCategories,
        onRestore: handleRestore,
        onBack: vi.fn(),
      }),
    );

    // 項目 1：【範例】主角設定，分類角色，含 2 張子卡片
    expect(html).toContain('【範例】主角設定');
    expect(html).toContain('角色');
    expect(html).toContain('含 2 張子卡片');
    expect(html).toContain('data-testid="restore-card-btn-del-001"');

    // 項目 2：標題空白時顯示「未命名卡片」
    expect(html).toContain('未命名卡片');
    expect(html).toContain('世界觀');
    expect(html).toContain('data-testid="restore-card-btn-del-002"');

    // 放回原位置按鈕文案
    expect(html).toContain(PUT_BACK_ORIGINAL_BUTTON);
  });

  it('WO-61 最近刪除元件：無刪除紀錄時顯示「沒有最近刪除的卡片。」', () => {
    const html = renderToStaticMarkup(
      React.createElement(DeletedCardsList, {
        deletedCards: [],
        categories: sampleCategories,
        onRestore: vi.fn(),
        onBack: vi.fn(),
      }),
    );

    expect(html).toContain(DELETED_CARDS_EMPTY);
    expect(html).toContain('data-testid="deleted-cards-empty"');
  });

  it('WO-61 最近刪除元件：四種版面靜態結構渲染（phone-portrait, phone-landscape, medium, wide）', () => {
    const modes = ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const;

    for (const mode of modes) {
      const html = renderToStaticMarkup(
        React.createElement(DeletedCardsList, {
          deletedCards: sampleDeletedCards,
          categories: sampleCategories,
          onRestore: vi.fn(),
          onBack: vi.fn(),
          layoutMode: mode,
        }),
      );

      expect(html).toContain(`data-layout="${mode}"`);
      expect(html).toContain('data-testid="deleted-cards-pane"');
      expect(html).toContain(DELETED_CARDS_TITLE);
      expect(html).toContain('data-testid="deleted-cards-back-btn"');
    }
  });

  it('WO-61 刪除：有子卡片時確認句含「連同底下 N 張子卡片一起刪除。」；無子卡片時不加警語', () => {
    function makeCard(id: string, category: string, title: string, parentId: string | null = null, sortOrder = 0): FileCard {
      return {
        id,
        category,
        parent_id: parentId,
        title,
        content: `【範例】${title}`,
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: sortOrder,
      };
    }

    const cardsWithSubs: FileCard[] = [
      makeCard('root-1', 'character', '主角'),
      makeCard('sub-1', 'character', '配件一', 'root-1', 0),
      makeCard('sub-2', 'character', '配件二', 'root-1', 1),
    ];

    const record = deletedFromCard(cardsWithSubs, 'root-1', 1000, 'del-root');
    expect(record).not.toBeNull();
    const subcardCount = Math.max(0, (record!.cards?.length ?? 1) - 1);
    expect(subcardCount).toBe(2);
    expect(deleteSubcardsImpact(subcardCount)).toBe('連同底下 2 張子卡片一起刪除。');

    // 無子卡片
    const singleCards: FileCard[] = [makeCard('single-1', 'world', '地標')];
    const singleRecord = deletedFromCard(singleCards, 'single-1', 1000, 'del-single');
    const singleSubCount = Math.max(0, (singleRecord!.cards?.length ?? 1) - 1);
    expect(singleSubCount).toBe(0);
  });

  it('WO-61 刪除：刪除後進最近刪除，最多保留 10 項（DELETED_CARD_LIMIT）', () => {
    function makeCard(id: string, category: string, title: string): FileCard {
      return {
        id,
        category,
        parent_id: null,
        title,
        content: '',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 0,
      };
    }

    let archive = emptyArchive();
    expect(DELETED_CARD_LIMIT).toBe(10);

    for (let i = 1; i <= 12; i++) {
      const card = makeCard(`card-${i}`, 'summary', `綱要 ${i}`);
      const record = deletedFromCard([card], `card-${i}`, 1000 + i, `del-${i}`)!;
      archive = archiveCardDeletion(archive, record);
    }

    expect(archive.deletedCards).toHaveLength(10);
    expect(archive.deletedCards![0]?.id).toBe('del-12');
    expect(archive.deletedCards![9]?.id).toBe('del-3');
    expect(archive.deletedCards!.some((item) => item.id === 'del-1')).toBe(false);
    expect(archive.deletedCards!.some((item) => item.id === 'del-2')).toBe(false);
  });

  it('WO-61 刪除：放回原位置連子卡片一起回到原母卡與原順序', () => {
    function makeCard(id: string, category: string, title: string, parentId: string | null = null, sortOrder = 0): FileCard {
      return {
        id,
        category,
        parent_id: parentId,
        title,
        content: '',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: sortOrder,
      };
    }

    const initial: FileCard[] = [
      makeCard('c-1', 'character', '卡片一', null, 0),
      makeCard('c-2', 'character', '卡片二', null, 1),
      makeCard('c-2-1', 'character', '卡片二子一', 'c-2', 0),
      makeCard('c-2-2', 'character', '卡片二子二', 'c-2', 1),
      makeCard('c-3', 'character', '卡片三', null, 2),
    ];

    const record = deletedFromCard(initial, 'c-2', 1000, 'del-c2')!;
    const remaining = deleteCard(initial, 'c-2');
    expect(remaining.map((c) => c.id)).toEqual(['c-1', 'c-3']);

    const restored = restoreDeletedCardToOrigin(remaining, record);
    const restoredIds = restored.map((c) => c.id);
    expect(restoredIds).toContain('c-2');
    expect(restoredIds).toContain('c-2-1');
    expect(restoredIds).toContain('c-2-2');

    // 依 sort_order 排序驗證同層順序
    const sameLevel = restored.filter((c) => c.parent_id === null).sort((a, b) => a.sort_order - b.sort_order);
    expect(sameLevel.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);

    // 驗證子卡片之 parent_id
    expect(restored.find((c) => c.id === 'c-2-1')?.parent_id).toBe('c-2');
    expect(restored.find((c) => c.id === 'c-2-2')?.parent_id).toBe('c-2');
  });
});
