import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  applyHtmlLayoutAttributes,
  applyPanelsHtmlAttributes,
  LayoutProvider,
  useLayout,
  useLayoutMode,
} from './layoutContext';

describe('WO-54：版面 Context 與 Hook（useLayoutMode）', () => {
  it('WO-54：applyHtmlLayoutAttributes 寫入 HTML 屬性並在非寬版時移除 wideColumns', () => {
    const fakeDoc = {
      documentElement: {
        dataset: {} as Record<string, string>,
      },
    };
    vi.stubGlobal('document', fakeDoc);

    try {
      // 寬版情境
      applyHtmlLayoutAttributes('wide', 'one-side', 'touch');
      expect(fakeDoc.documentElement.dataset.layout).toBe('wide');
      expect(fakeDoc.documentElement.dataset.wideColumns).toBe('one-side');
      expect(fakeDoc.documentElement.dataset.pointer).toBe('touch');

      // 寬版 both 情境
      applyHtmlLayoutAttributes('wide', 'both', 'mouse');
      expect(fakeDoc.documentElement.dataset.layout).toBe('wide');
      expect(fakeDoc.documentElement.dataset.wideColumns).toBe('both');
      expect(fakeDoc.documentElement.dataset.pointer).toBe('mouse');

      // 切換為 medium 中等情境（應清除 data-wide-columns）
      applyHtmlLayoutAttributes('medium', null, 'touch');
      expect(fakeDoc.documentElement.dataset.layout).toBe('medium');
      expect(fakeDoc.documentElement.dataset.wideColumns).toBeUndefined();
      expect(fakeDoc.documentElement.dataset.pointer).toBe('touch');

      // 切換為 phone-portrait 手機直拿情境
      applyHtmlLayoutAttributes('phone-portrait', null, 'touch');
      expect(fakeDoc.documentElement.dataset.layout).toBe('phone-portrait');
      expect(fakeDoc.documentElement.dataset.wideColumns).toBeUndefined();
      expect(fakeDoc.documentElement.dataset.pointer).toBe('touch');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('WO-54：LayoutProvider 透過 Context 提供正確狀態給子元件', () => {
    function Consumer() {
      const layout = useLayout();
      return createElement('div', {
        'data-testid': 'consumer',
        'data-mode': layout.mode,
        'data-columns': layout.wideColumns ?? 'none',
        'data-pointer': layout.pointer,
        'data-at-least-medium': String(layout.isAtLeastMedium),
        'data-focus-mode': String(layout.focusMode),
      });
    }

    const htmlWide = renderToStaticMarkup(
      createElement(
        LayoutProvider,
        { initialMode: 'wide', initialWideColumns: 'both', initialPointer: 'mouse' },
        createElement(Consumer),
      ),
    );
    expect(htmlWide).toContain('data-mode="wide"');
    expect(htmlWide).toContain('data-columns="both"');
    expect(htmlWide).toContain('data-pointer="mouse"');
    expect(htmlWide).toContain('data-at-least-medium="true"');

    const htmlPhone = renderToStaticMarkup(
      createElement(
        LayoutProvider,
        { initialMode: 'phone-portrait', initialPointer: 'touch' },
        createElement(Consumer),
      ),
    );
    expect(htmlPhone).toContain('data-mode="phone-portrait"');
    expect(htmlPhone).toContain('data-columns="none"');
    expect(htmlPhone).toContain('data-pointer="touch"');
    expect(htmlPhone).toContain('data-at-least-medium="false"');
  });

  it('WO-54：在 LayoutProvider 外部呼叫 useLayout / useLayoutMode 不會崩潰，提供預設值', () => {
    function ConsumerOutside() {
      const layout = useLayoutMode();
      return createElement('div', { 'data-testid': 'outside', 'data-mode': layout.mode });
    }

    const html = renderToStaticMarkup(createElement(ConsumerOutside));
    expect(html).toContain('data-testid="outside"');
  });

  describe('WO-62：專注模式 HTML 屬性與 LayoutProvider 狀態整合', () => {
    it('WO-62：applyPanelsHtmlAttributes 於專注模式時寫入 data-focus-mode="true"，非專注時刪除', () => {
      const fakeDoc = {
        documentElement: {
          dataset: {} as Record<string, string>,
        },
      };
      vi.stubGlobal('document', fakeDoc);

      try {
        // 進入專注模式
        applyPanelsHtmlAttributes({ left: false, right: false }, true);
        expect(fakeDoc.documentElement.dataset.focusMode).toBe('true');
        expect(fakeDoc.documentElement.dataset.sidePanelLeft).toBe('false');
        expect(fakeDoc.documentElement.dataset.sidePanelRight).toBe('false');

        // 離開專注模式
        applyPanelsHtmlAttributes({ left: true, right: false }, false);
        expect(fakeDoc.documentElement.dataset.focusMode).toBeUndefined();
        expect(fakeDoc.documentElement.dataset.sidePanelLeft).toBe('true');
        expect(fakeDoc.documentElement.dataset.sidePanelRight).toBe('false');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('WO-62：LayoutProvider 支援 initialPanels / initialFocusMode 初始化專注模式', () => {
      function FocusConsumer() {
        const layout = useLayout();
        return createElement('div', {
          'data-testid': 'focus-consumer',
          'data-focus-mode': String(layout.focusMode),
          'data-left': String(layout.sidePanels.left),
          'data-right': String(layout.sidePanels.right),
        });
      }

      // 透過 initialPanels.focusMode 初始化
      const htmlFromPanels = renderToStaticMarkup(
        createElement(
          LayoutProvider,
          { initialMode: 'phone-portrait', initialPanels: { focusMode: true } },
          createElement(FocusConsumer),
        ),
      );
      expect(htmlFromPanels).toContain('data-focus-mode="true"');
      expect(htmlFromPanels).toContain('data-left="false"');
      expect(htmlFromPanels).toContain('data-right="false"');

      // 透過 initialFocusMode 初始化
      const htmlFromDirectProp = renderToStaticMarkup(
        createElement(
          LayoutProvider,
          { initialMode: 'wide', initialFocusMode: true },
          createElement(FocusConsumer),
        ),
      );
      expect(htmlFromDirectProp).toContain('data-focus-mode="true"');
      expect(htmlFromDirectProp).toContain('data-left="false"');
      expect(htmlFromDirectProp).toContain('data-right="false"');
    });
  });
});
