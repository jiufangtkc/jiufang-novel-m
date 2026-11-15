import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EDIT_CARD_BUTTON } from '../copy/cardEditCopy';
import { cardContentPreviewPlainText } from './cardMarkdown';
import { CardEditor, type CardEditorCard } from './CardEditor';

describe('WO-92 卡片編輯與預覽排版', () => {
  const sampleCard: CardEditorCard = {
    id: 'wo92-sample',
    title: '【範例】霧港線索',
    content: '雨晴帶著**舊懷錶**與半張航海圖。',
    color: '#61afef',
  };

  it('預覽模式：標題與「編輯」按鈕各只出現一次（寬版）', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: sampleCard,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'preview',
        layoutMode: 'wide',
      }),
    );

    expect(html).toContain('card-detail-heading');
    expect(html).not.toContain('card-editor-title');
    expect(html).not.toContain('data-testid="card-editor-start-edit-btn-footer"');

    const editMatches = html.match(new RegExp(EDIT_CARD_BUTTON, 'g'));
    expect(editMatches?.length ?? 0).toBe(1);
  });

  it('手機直拿編輯：頁尾不出現第二顆「卡片顏色」', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: sampleCard,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'edit',
        layoutMode: 'phone-portrait',
      }),
    );

    expect(html).toContain('data-testid="card-editor-color-btn"');
    expect(html).not.toContain('data-testid="card-editor-thumb-color-btn"');

    const colorButtonCount = (html.match(/data-testid="card-editor-color-btn"/g) ?? []).length;
    expect(colorButtonCount).toBe(1);
  });

  it('寬版挑色：面板在編輯欄旁邊（aside），非全螢幕 modal', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: sampleCard,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'edit',
        layoutMode: 'wide',
        initialPickingColor: true,
      }),
    );

    expect(html).toContain('card-color-picker-aside');
    expect(html).toContain('is-color-picker-beside');
    expect(html).not.toMatch(/card-color-picker-modal/);
  });

  it('清單摘要去除 Markdown 符號', () => {
    expect(cardContentPreviewPlainText('帶著**舊懷錶**出發。')).toBe('帶著舊懷錶出發。');
    expect(cardContentPreviewPlainText('### 小標\n\n內文。')).toBe('小標 內文。');
  });
});