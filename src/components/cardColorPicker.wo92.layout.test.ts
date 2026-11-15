import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CARD_COLOR } from '../domain/cardColors';
import { CardEditor, type CardEditorCard } from './CardEditor';
import { cardContentPreviewPlainText } from './cardMarkdown';

function loadPickerLayoutCss(): string {
  const editorCss = readFileSync(new URL('./cardEditor.css', import.meta.url), 'utf8');
  const pickerCss = readFileSync(new URL('./cardColorPicker.css', import.meta.url), 'utf8');
  return `${editorCss}\n${pickerCss}`;
}

describe('WO-92 返工：挑色面板視窗內可完成選色', () => {
  const sampleCard: CardEditorCard = {
    id: 'wo92-layout',
    title: '【範例】排版量測',
    content: '內容',
    color: DEFAULT_CARD_COLOR,
  };

  it('CSS：容器不足時寬版並排改置中浮出，動作列不可縮小', () => {
    const css = loadPickerLayoutCss();
    expect(css).toMatch(/@container card-editor-pane \(max-width: 799px\)/);
    expect(css).toMatch(
      /\.card-editor-pane\.is-color-picker-beside \.card-color-picker-aside \.color-picker-actions[\s\S]*flex-shrink: 0/,
    );
    expect(css).toMatch(/\.card-editor-pane\.is-picking-color \.card-editor-footer/);
  });

  it('CSS：手機橫拿 modal 限高並固定取消／完成在面板內', () => {
    const css = loadPickerLayoutCss();
    expect(css).toMatch(
      /html\[data-layout="phone-landscape"\] \.card-color-picker-modal > \.card-color-picker[\s\S]*max-height: calc\(var\(--vv-height/,
    );
    expect(css).toMatch(
      /html\[data-layout="phone-landscape"\] \.card-color-picker-modal \.color-picker-actions[\s\S]*flex-shrink: 0/,
    );
    expect(css).toMatch(/\.card-color-picker-modal > \.card-color-picker[\s\S]*max-height: calc\(100vh - 32px\)/);
  });

  it('CSS：寬版並排時色票網格可縮在欄內、完成列留在面板底部', () => {
    const css = loadPickerLayoutCss();
    expect(css).toMatch(/@container card-editor-pane \(min-width: 800px\)/);
    expect(css).toMatch(
      /\.card-color-picker-aside \.color-picker-grid\.grid-desktop[\s\S]*repeat\(8, minmax\(0, 1fr\)\)/,
    );
    expect(css).toMatch(
      /\.card-color-picker-aside \.color-picker-actions[\s\S]*flex-shrink: 0/,
    );
  });

  it('清單摘要：英文加粗前後單一空白保留', () => {
    expect(cardContentPreviewPlainText('see **bold** here')).toBe('see bold here');
  });

  it('寬版挑色靜態結構含完成按鈕與挑色中狀態', () => {
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
    expect(html).toContain('is-picking-color');
    expect(html).toContain('card-color-picker-aside');
    expect(html).toContain('data-testid="color-action-done"');
  });
});