import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  applyHtmlLayoutAttributes,
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
});
