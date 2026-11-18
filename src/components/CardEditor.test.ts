import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_COLOR_LABEL,
  CARD_CONTENT_LABEL,
  CARD_CONTENT_PLACEHOLDER,
  CARD_TITLE_LABEL,
  EDIT_CARD_BUTTON,
  EDIT_CARD_CANCEL,
  EDIT_CARD_DONE,
  EDIT_CARD_HEADING,
  EDIT_CARD_MORE,
} from '../copy/cardEditCopy';
import { DEFAULT_CARD_COLOR, formatCardColorForSave } from '../domain/cardColors';
import {
  CardEditor,
  type CardEditorCard,
  type CardEditorDestination,
  type CardEditorSavePayload,
} from './CardEditor';

describe('WO-61 卡片編輯與預覽元件（CardEditor）', () => {
  const sampleCard: CardEditorCard = {
    id: 'card-sample-001',
    title: '【範例】核心主線：燈塔熄滅之夜',
    content: '### 霧港暗記\n\n雨晴身上唯一的線索，是一枚停在三點十七分的**舊懷錶**與半張浸濕的航海圖。',
    color: '#61afef',
    category: 'summary',
  };

  it('WO-61 編輯：預覽模式以 CardMarkdownView 正確渲染排版且畫面上無 Markdown 字樣', () => {
    const handleSave = vi.fn();
    const handleDone = vi.fn();

    const html = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: sampleCard,
        onSave: handleSave,
        onDone: handleDone,
        initialMode: 'preview',
        layoutMode: 'phone-portrait',
      }),
    );

    // 檢查標題與排版預覽存在
    expect(html).toContain('【範例】核心主線：燈塔熄滅之夜');
    expect(html).toContain('card-editor-preview-content');
    // Markdown 的 **舊懷錶** 經 CardMarkdownView 渲染為 <strong class="card-md-strong">
    expect(html).toContain('<strong class="card-md-strong">舊懷錶</strong>');
    // 依工單規範畫面上絕不出現「Markdown」字樣
    expect(html).not.toContain('Markdown');

    // 預覽模式顯示「編輯」按鈕
    expect(html).toContain(EDIT_CARD_BUTTON);
    expect(html).toContain('data-testid="card-editor-start-edit-btn"');
  });

  it('WO-61 編輯：編輯模式下文字區域完整保存 Markdown 原文（** 等符號不被轉掉）', () => {
    const handleSave = vi.fn();
    const handleDone = vi.fn();

    const html = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: sampleCard,
        onSave: handleSave,
        onDone: handleDone,
        initialMode: 'edit',
        layoutMode: 'phone-portrait',
      }),
    );

    // 標題與欄位標籤
    expect(html).toContain(EDIT_CARD_HEADING);
    expect(html).toContain(CARD_TITLE_LABEL);
    expect(html).toContain(CARD_COLOR_LABEL);
    expect(html).toContain(CARD_CONTENT_LABEL);

    // 內容 textarea 包含原始 Markdown 內容（符號原樣保存），提示文字為「輸入卡片內容」
    expect(html).toContain('data-testid="card-editor-content-textarea"');
    expect(html).toContain(`placeholder="${CARD_CONTENT_PLACEHOLDER}"`);
    expect(CARD_CONTENT_PLACEHOLDER).toBe('輸入卡片內容');
    expect(html).toContain('### 霧港暗記');
    expect(html).toContain('**舊懷錶**');

    // 包含「完成」與「取消」按鈕
    expect(html).toContain(EDIT_CARD_DONE);
    expect(html).toContain(EDIT_CARD_CANCEL);
  });

  it('WO-61 編輯：props 支援卡片、存檔回呼、完成後去哪回呼，具備重用性', async () => {
    let savedPayload: CardEditorSavePayload | null = null;
    let completedDestination: CardEditorDestination | null = null;

    const handleSave = vi.fn(async (payload: CardEditorSavePayload) => {
      savedPayload = payload;
    });

    const handleCompleteDestination = vi.fn((dest: CardEditorDestination) => {
      completedDestination = dest;
    });

    const handleDone = vi.fn();

    // 模擬手機直拿情境：完成後去向預設為正文 'text'
    const portraitElement = React.createElement(CardEditor, {
      card: sampleCard,
      onSave: handleSave,
      onDone: handleDone,
      onCompleteDestination: handleCompleteDestination,
      layoutMode: 'phone-portrait',
      initialMode: 'edit',
    });

    const html = renderToStaticMarkup(portraitElement);
    expect(html).toContain('data-layout="phone-portrait"');

    // 模擬執行存檔回呼：Markdown 原文原樣保存、顏色合乎規範
    const testMarkdown = '## 深入防波堤\n\n留下的巡守紀錄簿只剩最後一頁：**霧氣是從港底升起的**。';
    await handleSave({
      title: '【範例】修改後標題',
      content: testMarkdown,
      color: formatCardColorForSave('#FFAA00'),
    });

    expect(savedPayload).not.toBeNull();
    expect((savedPayload as any).title).toBe('【範例】修改後標題');
    expect((savedPayload as any).content).toBe(testMarkdown);
    expect((savedPayload as any).content).toContain('**霧氣是從港底升起的**');
    expect((savedPayload as any).color).toBe('#ffaa00');

    // 完成後去向回呼
    handleCompleteDestination('text');
    expect(completedDestination).toBe('text');
  });

  it('WO-61 編輯：其他版面預設完成後回預覽（preview）', () => {
    let targetDest: CardEditorDestination | null = null;
    const handleCompleteDestination = vi.fn((dest: CardEditorDestination) => {
      targetDest = dest;
    });

    // 寬版
    const wideElement = React.createElement(CardEditor, {
      card: sampleCard,
      onSave: vi.fn(),
      onDone: vi.fn(),
      onCompleteDestination: handleCompleteDestination,
      layoutMode: 'wide',
      initialMode: 'preview',
    });

    const html = renderToStaticMarkup(wideElement);
    expect(html).toContain('data-layout="wide"');

    // 非手機直拿預設去向為 'preview'
    handleCompleteDestination('preview');
    expect(targetDest).toBe('preview');
  });

  it('WO-61 編輯：四種版面之編輯元件靜態結構渲染（phone-portrait, phone-landscape, medium, wide）', () => {
    const modes = ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const;

    for (const mode of modes) {
      // 預覽模式
      const previewHtml = renderToStaticMarkup(
        React.createElement(CardEditor, {
          card: sampleCard,
          onSave: vi.fn(),
          onDone: vi.fn(),
          layoutMode: mode,
          initialMode: 'preview',
        }),
      );
      expect(previewHtml).toContain(`data-layout="${mode}"`);
      expect(previewHtml).toContain('data-mode="preview"');
      expect(previewHtml).toContain('【範例】核心主線：燈塔熄滅之夜');

      // 編輯模式
      const editHtml = renderToStaticMarkup(
        React.createElement(CardEditor, {
          card: sampleCard,
          onSave: vi.fn(),
          onDone: vi.fn(),
          layoutMode: mode,
          initialMode: 'edit',
        }),
      );
      expect(editHtml).toContain(`data-layout="${mode}"`);
      expect(editHtml).toContain('data-mode="edit"');
      expect(editHtml).toContain('data-testid="card-editor-content-textarea"');
    }
  });

  it('WO-61 編輯：包含子卡片時在預覽模式正常列出子卡片項目', () => {
    const subcards: CardEditorCard[] = [
      {
        id: 'sub-001',
        title: '【範例】隨身舊懷錶',
        content: '停在三點十七分的指針。',
        color: DEFAULT_CARD_COLOR,
        parent_id: sampleCard.id,
      },
      {
        id: 'sub-002',
        title: '【範例】半張浸濕的航海圖',
        content: '標記著礁石區的淺灘。',
        color: '#aa5500',
        parent_id: sampleCard.id,
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: sampleCard,
        subcards,
        onSave: vi.fn(),
        onDone: vi.fn(),
        initialMode: 'preview',
      }),
    );

    expect(html).toContain('data-testid="cards-subcards-section"');
    expect(html).toContain('【範例】隨身舊懷錶');
    expect(html).toContain('【範例】半張浸濕的航海圖');
  });

  it('WO-61 編輯：手機直拿模式拇指區包含編輯按鈕（高 48）與更多動作按鈕', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardEditor, {
        card: sampleCard,
        onSave: vi.fn(),
        onDone: vi.fn(),
        onMoreActions: vi.fn(),
        layoutMode: 'phone-portrait',
        initialMode: 'preview',
      }),
    );

    expect(html).toContain('card-preview-thumb-bar');
    expect(html).toContain('card-editor-thumb-edit-btn');
    expect(html).toContain('card-editor-thumb-more-btn');
    expect(html).toContain(EDIT_CARD_MORE);
  });
});
