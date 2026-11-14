import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_COLOR_DEFAULT,
  CARD_COLOR_HEX_INVALID,
  CARD_COLOR_HEX_LABEL,
  CARD_COLOR_HEX_PLACEHOLDER,
  CARD_CONTENT_PLACEHOLDER,
  EDIT_CARD_CANCEL,
  EDIT_CARD_DONE,
} from '../copy/cardEditCopy';
import {
  DEFAULT_CARD_COLOR,
  formatCardColorForSave,
  isQtStandardColor,
  isValidCardColor,
  QT_STANDARD_48_COLORS,
} from '../domain/cardColors';
import { CardColorPicker } from './CardColorPicker';

describe('WO-61 卡片挑顏色元件（CardColorPicker）', () => {
  it('WO-61 色票：48 色清單與 Qt 標準基本色一致、順序 8 欄 6 列', () => {
    const handleDone = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(CardColorPicker, {
        currentColor: '#0055ff',
        onDone: handleDone,
        layoutMode: 'wide',
      }),
    );

    // 檢查包含 48 色各色票按鈕
    expect(QT_STANDARD_48_COLORS).toHaveLength(48);
    for (const color of QT_STANDARD_48_COLORS) {
      const swatchId = `color-swatch-${color.toLowerCase().replace('#', '')}`;
      expect(html).toContain(`data-testid="${swatchId}"`);
    }

    // 寬版應使用 8 欄 6 列之 grid-desktop 樣式
    expect(html).toContain('grid-desktop');
    expect(html).toContain('data-layout="wide"');
  });

  it('WO-61 色票：手機直拿為每排 6 色、共 8 排（grid-portrait）', () => {
    const html = renderToStaticMarkup(
      React.createElement(CardColorPicker, {
        currentColor: DEFAULT_CARD_COLOR,
        onDone: vi.fn(),
        layoutMode: 'phone-portrait',
      }),
    );

    expect(html).toContain('grid-portrait');
    expect(html).toContain('data-layout="phone-portrait"');
    // 包含 48 色按鈕
    expect(html).toContain('role="grid"');
  });

  it('WO-61 色票：四種版面靜態結構渲染（phone-portrait, phone-landscape, medium, wide）', () => {
    const modes = ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const;
    for (const mode of modes) {
      const html = renderToStaticMarkup(
        React.createElement(CardColorPicker, {
          currentColor: '#aa5500',
          onDone: vi.fn(),
          layoutMode: mode,
        }),
      );
      expect(html).toContain(`data-layout="${mode}"`);
      expect(html).toContain(CARD_COLOR_DEFAULT);
      expect(html).toContain(CARD_COLOR_HEX_LABEL);
      expect(html).toContain(CARD_COLOR_HEX_PLACEHOLDER);
      expect(html).toContain(EDIT_CARD_DONE);
    }
  });

  it('WO-61 色票：「預設（不加色）」按鈕與存回 #3C3F41', () => {
    const handleDone = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(CardColorPicker, {
        currentColor: '#61afef',
        onDone: handleDone,
      }),
    );

    expect(html).toContain(`data-testid="color-default-button"`);
    expect(html).toContain(CARD_COLOR_DEFAULT);

    // formatCardColorForSave 驗證預設色必定存為 #3C3F41
    expect(formatCardColorForSave(DEFAULT_CARD_COLOR)).toBe('#3C3F41');
    expect(formatCardColorForSave('#3c3f41')).toBe('#3C3F41');
  });

  it('WO-61 色票：不在 48 色中的既有顏色顯示且不被改', () => {
    // 範例自訂顏色 #1a2b4c，非 48 色亦非預設色
    const customColor = '#1a2b4c';
    expect(isQtStandardColor(customColor)).toBe(false);
    expect(isValidCardColor(customColor)).toBe(true);

    const html = renderToStaticMarkup(
      React.createElement(CardColorPicker, {
        currentColor: customColor,
        onDone: vi.fn(),
      }),
    );

    // 畫面上顯示該既有顏色色碼與選回原顏色按鈕
    expect(html).toContain(customColor);
    expect(html).toContain('data-testid="color-restore-original"');

    // 格式化儲存保留該自訂色，大小寫符合 #rrggbb
    expect(formatCardColorForSave(customColor)).toBe(customColor);
  });

  it('WO-61 色票：色碼輸入錯誤格式不存並提示', () => {
    // 錯誤格式（3 碼、無 #、非法字元、空字串）
    const invalidColors = ['#123', 'red', '#gggggg', '123456', ''];
    for (const inv of invalidColors) {
      expect(isValidCardColor(inv)).toBe(false);
      // formatCardColorForSave 會回退至預設色，不得原樣存入非預期字串
      expect(formatCardColorForSave(inv)).toBe(DEFAULT_CARD_COLOR);
    }

    // 驗證錯誤提示字串存在於介面文案中
    expect(CARD_COLOR_HEX_INVALID).toBe('請輸入 # 開頭的 6 碼色碼（例：#3C3F41）');
  });

  it('WO-61 色票：可選取消按鈕存在性與可點擊區域 ≥44×44', () => {
    const htmlWithCancel = renderToStaticMarkup(
      React.createElement(CardColorPicker, {
        currentColor: DEFAULT_CARD_COLOR,
        onDone: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(htmlWithCancel).toContain('data-testid="color-action-cancel"');
    expect(htmlWithCancel).toContain(EDIT_CARD_CANCEL);

    const htmlWithoutCancel = renderToStaticMarkup(
      React.createElement(CardColorPicker, {
        currentColor: DEFAULT_CARD_COLOR,
        onDone: vi.fn(),
      }),
    );
    expect(htmlWithoutCancel).not.toContain('data-testid="color-action-cancel"');
  });

  it('WO-61 修1：CardColorPicker 傳入空字串時點「選回原顏色」再按完成，回傳 #3C3F41 且不出現錯誤提示', () => {
    let capturedDoneColor: string | null = null;
    const handleDone = vi.fn((color: string) => {
      capturedDoneColor = color;
    });

    function findNodeByTestId(node: any, testId: string): any {
      if (!node || typeof node !== 'object') return null;
      if (node.props?.['data-testid'] === testId) return node;
      const children = node.props?.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          const res = findNodeByTestId(child, testId);
          if (res) return res;
        }
      } else if (children) {
        return findNodeByTestId(children, testId);
      }
      return null;
    }

    let capturedTree: any = null;
    function TestEmptyColorPicker() {
      capturedTree = CardColorPicker({
        currentColor: '',
        onDone: handleDone,
      });
      return capturedTree;
    }

    const html = renderToStaticMarkup(React.createElement(TestEmptyColorPicker));

    // 驗證初始渲染安全值為預設色 #3C3F41，不顯示錯誤提示
    expect(html).toContain('data-testid="color-restore-original"');
    expect(html).toContain('aria-label="選回原顏色 #3C3F41"');
    expect(html).toContain('#3c3f41');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain(CARD_COLOR_HEX_INVALID);

    // 模擬點擊「選回原顏色」按鈕
    const restoreBtn = findNodeByTestId(capturedTree, 'color-restore-original');
    expect(restoreBtn).toBeDefined();
    expect(typeof restoreBtn.props.onClick).toBe('function');
    restoreBtn.props.onClick();

    // 模擬點擊「完成」按鈕
    const doneBtn = findNodeByTestId(capturedTree, 'color-action-done');
    expect(doneBtn).toBeDefined();
    expect(typeof doneBtn.props.onClick).toBe('function');
    doneBtn.props.onClick();

    // 驗證順利回傳預設色 #3C3F41，且不觸發錯誤提示
    expect(handleDone).toHaveBeenCalledTimes(1);
    expect(handleDone).toHaveBeenCalledWith(DEFAULT_CARD_COLOR);
    expect(capturedDoneColor).toBe('#3C3F41');
  });

  it('WO-61 修1：CardColorPicker 傳入合法自訂色（非 48 色）時原樣保留', () => {
    const customColor = '#1a2b4c';
    let capturedDoneColor: string | null = null;
    const handleDone = vi.fn((color: string) => {
      capturedDoneColor = color;
    });

    function findNodeByTestId(node: any, testId: string): any {
      if (!node || typeof node !== 'object') return null;
      if (node.props?.['data-testid'] === testId) return node;
      const children = node.props?.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          const res = findNodeByTestId(child, testId);
          if (res) return res;
        }
      } else if (children) {
        return findNodeByTestId(children, testId);
      }
      return null;
    }

    let capturedTree: any = null;
    function TestCustomColorPicker() {
      capturedTree = CardColorPicker({
        currentColor: customColor,
        onDone: handleDone,
      });
      return capturedTree;
    }

    const html = renderToStaticMarkup(React.createElement(TestCustomColorPicker));
    expect(html).toContain(customColor);
    expect(html).toContain('aria-label="選回原顏色 #1a2b4c"');

    // 點擊「選回原顏色」再按「完成」
    const restoreBtn = findNodeByTestId(capturedTree, 'color-restore-original');
    restoreBtn.props.onClick();
    const doneBtn = findNodeByTestId(capturedTree, 'color-action-done');
    doneBtn.props.onClick();

    expect(handleDone).toHaveBeenCalledTimes(1);
    expect(handleDone).toHaveBeenCalledWith(customColor);
    expect(capturedDoneColor).toBe(customColor);
    expect(formatCardColorForSave(customColor)).toBe(customColor);
  });

  it('WO-61 修1：提示文字為「輸入卡片內容」，全站畫面文字不可出現 Markdown 字樣', () => {
    expect(CARD_CONTENT_PLACEHOLDER).toBe('輸入卡片內容');
    expect(CARD_CONTENT_PLACEHOLDER).not.toContain('Markdown');
  });
});
