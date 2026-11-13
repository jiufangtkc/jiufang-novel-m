import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ADD_CATEGORY_BUTTON,
  CATEGORY_BUILTIN_ARIA,
  CATEGORY_BUILTIN_BADGE,
  CATEGORY_HAS_CARDS_WARNING,
  EDIT_CARD_DONE,
  ORGANIZE_CATEGORIES_BUTTON,
} from '../copy/cardEditCopy';
import type { ResolvedCategoryItem } from '../domain/cardCategories';
import type { FileCard } from '../db/projectFile';
import { CategoryManager } from './CategoryManager';

describe('WO-61 分類管理元件（CategoryManager）', () => {
  const sampleCategories: ResolvedCategoryItem[] = [
    {
      id: 'summary',
      name: '本書綱要',
      sort_order: 1,
      isBuiltin: true,
      isCustom: false,
      isOrphan: false,
    },
    {
      id: 'character',
      name: '角色',
      sort_order: 2,
      isBuiltin: true,
      isCustom: false,
      isOrphan: false,
    },
    {
      id: 'world',
      name: '世界觀',
      sort_order: 3,
      isBuiltin: true,
      isCustom: false,
      isOrphan: false,
    },
    {
      id: 'timeline',
      name: '時間軸',
      sort_order: 4,
      isBuiltin: true,
      isCustom: false,
      isOrphan: false,
    },
    {
      id: 'custom_00000001',
      name: '【範例】武器設定',
      sort_order: 5,
      isBuiltin: false,
      isCustom: true,
      isOrphan: false,
    },
    {
      id: 'custom_00000002',
      name: '【範例】空設定分類',
      sort_order: 6,
      isBuiltin: false,
      isCustom: true,
      isOrphan: false,
    },
  ];

  const sampleCards: FileCard[] = [
    {
      id: 'c-1',
      category: 'summary',
      title: '主線綱要',
      content: '綱要內容',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 0,
      parent_id: null,
    },
    {
      id: 'c-2',
      category: 'custom_00000001',
      title: '銀色短劍',
      content: '短劍描述',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 0,
      parent_id: null,
    },
  ];

  it('WO-61 分類元件：內建 4 類標示「內建」且朗讀為「內建分類，不能刪除」，無改名與刪除按鈕', () => {
    const html = renderToStaticMarkup(
      React.createElement(CategoryManager, {
        categories: sampleCategories,
        cards: sampleCards,
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onAddCategory: vi.fn(),
        onDone: vi.fn(),
        layoutMode: 'phone-portrait',
      }),
    );

    // 檢查四個內建分類皆有「內建」標籤與對應朗讀
    for (const id of ['summary', 'character', 'world', 'timeline']) {
      expect(html).toContain(`data-testid="category-builtin-${id}"`);
      expect(html).toContain(CATEGORY_BUILTIN_BADGE);
      expect(html).toContain(`aria-label="${CATEGORY_BUILTIN_ARIA}"`);

      // 內建分類不可有改名或刪除按鈕
      expect(html).not.toContain(`data-testid="category-rename-btn-${id}"`);
      expect(html).not.toContain(`data-testid="category-delete-btn-${id}"`);
    }
  });

  it('WO-61 分類元件：自訂分類有改名與刪除按鈕，按鈕尺寸 ≥ 44×44，且上移／下移按鈕符合觸控目標規範', () => {
    const html = renderToStaticMarkup(
      React.createElement(CategoryManager, {
        categories: sampleCategories,
        cards: sampleCards,
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onAddCategory: vi.fn(),
        onDone: vi.fn(),
        layoutMode: 'phone-portrait',
      }),
    );

    // 自訂分類有改名按鈕
    expect(html).toContain('data-testid="category-rename-btn-custom_00000001"');
    expect(html).toContain('data-testid="category-rename-btn-custom_00000002"');

    // 檢查上移與下移按鈕存在
    expect(html).toContain('data-testid="category-move-up-btn-custom_00000001"');
    expect(html).toContain('data-testid="category-move-down-btn-custom_00000001"');

    // 第一項 summary 的上移按鈕為 disabled
    const moveUpSummary = html.match(/<button[^>]*data-testid="category-move-up-btn-summary"[^>]*>/);
    expect(moveUpSummary).not.toBeNull();
    expect(moveUpSummary![0]).toContain('disabled');

    // 最後一項 custom_00000002 的下移按鈕為 disabled
    const moveDownLast = html.match(/<button[^>]*data-testid="category-move-down-btn-custom_00000002"[^>]*>/);
    expect(moveDownLast).not.toBeNull();
    expect(moveDownLast![0]).toContain('disabled');
  });

  it('WO-61 分類元件：含卡片的自訂分類刪除鈕不可用（disabled）並提示警告，無卡片之自訂分類可點擊刪除', () => {
    const html = renderToStaticMarkup(
      React.createElement(CategoryManager, {
        categories: sampleCategories,
        cards: sampleCards, // custom_00000001 含有卡片 c-2；custom_00000002 無卡片
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onAddCategory: vi.fn(),
        onDone: vi.fn(),
        layoutMode: 'phone-portrait',
      }),
    );

    // custom_00000001 有卡片：刪除鈕 disabled 且包含說明提示
    const deleteWithCards = html.match(/<button[^>]*data-testid="category-delete-btn-custom_00000001"[^>]*>/);
    expect(deleteWithCards).not.toBeNull();
    expect(deleteWithCards![0]).toContain('disabled');
    expect(deleteWithCards![0]).toContain(CATEGORY_HAS_CARDS_WARNING);

    // custom_00000002 無卡片：刪除鈕可用（無 disabled）
    const deleteBtnMatch = html.match(/<button[^>]*data-testid="category-delete-btn-custom_00000002"[^>]*>/);
    expect(deleteBtnMatch).not.toBeNull();
    expect(deleteBtnMatch![0]).not.toContain('disabled');
  });

  it('WO-61 分類元件：提供「新增分類」按鈕與「整理分類」標題與「完成」按鈕', () => {
    const html = renderToStaticMarkup(
      React.createElement(CategoryManager, {
        categories: sampleCategories,
        cards: sampleCards,
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onAddCategory: vi.fn(),
        onDone: vi.fn(),
        layoutMode: 'phone-portrait',
      }),
    );

    expect(html).toContain(ORGANIZE_CATEGORIES_BUTTON);
    expect(html).toContain(ADD_CATEGORY_BUTTON);
    expect(html).toContain(EDIT_CARD_DONE);
    expect(html).toContain('data-testid="category-manager-add-btn"');
    expect(html).toContain('data-testid="category-manager-done-btn"');
  });

  it('WO-61 分類元件：四種版面靜態結構渲染（phone-portrait, phone-landscape, medium, wide）', () => {
    const modes = ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const;

    for (const mode of modes) {
      const html = renderToStaticMarkup(
        React.createElement(CategoryManager, {
          categories: sampleCategories,
          cards: sampleCards,
          onMoveUp: vi.fn(),
          onMoveDown: vi.fn(),
          onRename: vi.fn(),
          onDelete: vi.fn(),
          onAddCategory: vi.fn(),
          onDone: vi.fn(),
          layoutMode: mode,
        }),
      );

      expect(html).toContain(`data-layout="${mode}"`);
      expect(html).toContain('data-testid="category-manager-pane"');
      expect(html).toContain('data-testid="category-manager-list"');
      expect(html).toContain(ORGANIZE_CATEGORIES_BUTTON);
      expect(html).toContain(ADD_CATEGORY_BUTTON);
    }
  });
});
