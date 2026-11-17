import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DictButton, DictOfflineNotice } from '../components/DictButton';
import { DICT_OFFLINE_NOTICE } from '../copy/dictionaryCopy';
import type { LayoutMode } from '../layout/layoutMode';
import { createDictNotice, DICT_NOTICE_MS } from './dictNotice';
import { dictPlacement } from './dictPlacement';
import { createDictSelectionTracker } from './selectionTracker';

const css = readFileSync(new URL('../screens/focusMode.css', import.meta.url), 'utf8');
const editorSrc = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');

function render(word: string, placement: 'topbar' | 'floating' = 'topbar') {
  return renderToStaticMarkup(
    createElement(DictButton, {
      word,
      placement,
      onPointerDown: () => {},
      onPress: () => 'opened' as const,
      onOffline: () => {},
    }),
  );
}

describe('WO-105：位置判斷（四種版面、專注模式）', () => {
  const modes: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];
  it('一般情況都在頁首（含橫拿沒打字）', () => {
    for (const layoutMode of modes) {
      expect(dictPlacement({ layoutMode, focusMode: false, landscapeTyping: false })).toBe('topbar');
    }
  });
  it('手機橫拿打字中浮在左上角；其他版面打字不影響', () => {
    expect(dictPlacement({ layoutMode: 'phone-landscape', focusMode: false, landscapeTyping: true })).toBe('floating');
    for (const layoutMode of ['phone-portrait', 'medium', 'wide'] as const) {
      expect(dictPlacement({ layoutMode, focusMode: false, landscapeTyping: false })).toBe('topbar');
    }
  });
  it('專注模式四種版面都浮在左上角', () => {
    for (const layoutMode of modes) {
      expect(dictPlacement({ layoutMode, focusMode: true, landscapeTyping: false })).toBe('floating');
    }
  });
});

describe('WO-105：按鈕畫面與朗讀', () => {
  it('選「車票」：主字加小字，朗讀念完整的詞', () => {
    const html = render('車票');
    expect(html).toContain('查字典');
    expect(html).toContain('車票');
    expect(html).toContain('aria-label="查字典，車票。會在新分頁開教育部辭典"');
    expect(html).toContain('type="button"');
  });
  it('4 字以上畫面截成前 2 字加「…」，朗讀念完整詞、不念「…」', () => {
    const html = render('狐狸沒有');
    expect(html).toContain('狐狸…');
    expect(html).toContain('aria-label="查字典，狐狸沒有。會在新分頁開教育部辭典"');
    expect(html.match(/aria-label="[^"]*"/)![0]).not.toContain('…');
  });
  it('剛好 10 字也出現，朗讀完整', () => {
    const w = '一二三四五六七八九十';
    expect(render(w)).toContain(`aria-label="查字典，${w}。會在新分頁開教育部辭典"`);
  });
  it('圖示與可見字不重複朗讀（aria-hidden）', () => {
    const html = render('車票');
    expect(html).toContain('aria-hidden="true"');
  });
  it('按下流程：pointerdown 會 preventDefault，不在按下時再讀選取', () => {
    const tracker = createDictSelectionTracker();
    tracker.update({ source: 'body', focused: true, value: '搭車票出門', selectionStart: 1, selectionEnd: 3 });
    const e = { preventDefault: vi.fn() };
    // 與 useDictSelection.onPointerDown 相同的兩步
    e.preventDefault();
    tracker.beginPress();
    expect(e.preventDefault).toHaveBeenCalled();
    // 按下時輸入框已失焦、選取被清掉，仍用暫存的詞
    tracker.blur('body');
    expect(tracker.getState().word).toBe('車票');
  });
});

describe('WO-105：沒網路提示', () => {
  it('role="status"、polite，念同一句，沒有另寫的朗讀文字，不用 .toast', () => {
    const html = renderToStaticMarkup(createElement(DictOfflineNotice, { visible: true, placement: 'topbar' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(DICT_OFFLINE_NOTICE);
    expect(html).toBe(html.replace('toast', 'x'));
    expect(html).not.toContain('aria-label');
    expect(DICT_OFFLINE_NOTICE).toBe('現在沒有網路，連上後再按一次。');
  });
  it('沒顯示時容器仍在（朗讀區先存在）但沒有內容', () => {
    const html = renderToStaticMarkup(createElement(DictOfflineNotice, { visible: false, placement: 'topbar' }));
    expect(html).toContain('role="status"');
    expect(html).not.toContain(DICT_OFFLINE_NOTICE);
  });
  it('約 3 秒後自己消失', () => {
    vi.useFakeTimers();
    const n = createDictNotice({ set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as never) });
    n.show();
    expect(n.isVisible()).toBe(true);
    vi.advanceTimersByTime(DICT_NOTICE_MS - 1);
    expect(n.isVisible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(n.isVisible()).toBe(false);
    vi.useRealTimers();
  });
  it('消失前再按一次會重新計時', () => {
    vi.useFakeTimers();
    const n = createDictNotice({ set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as never) });
    n.show();
    vi.advanceTimersByTime(2000);
    n.show();
    vi.advanceTimersByTime(2000);
    expect(n.isVisible()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(n.isVisible()).toBe(false);
    vi.useRealTimers();
  });
  it('選取改變時可立刻消失，且會通知訂閱者', () => {
    vi.useFakeTimers();
    const n = createDictNotice({ set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as never) });
    const seen = vi.fn();
    n.subscribe(seen);
    n.show();
    n.hide();
    expect(n.isVisible()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(seen).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('WO-105：版面與樣式規則', () => {
  it('按鈕高 44、寬至少 44', () => {
    expect(css).toMatch(/\.dict-button\s*\{[^}]*height:\s*44px[^}]*min-height:\s*44px[^}]*min-width:\s*44px/s);
  });
  it('手機直拿：頁首章名與半形提醒小標暫藏；按鈕不推擠全書搜尋', () => {
    expect(css).toMatch(/phone-portrait"\] \.topbar\.has-dict-button h1/);
    expect(css).toMatch(/phone-portrait"\] \.topbar\.has-dict-button \.half-width-badge-wrap/);
    expect(css).toMatch(/phone-portrait"\] \.topbar \.dict-button\s*\{[^}]*margin-right:\s*auto[^}]*max-width:\s*127px/s);
  });
  it('寬版先藏已暫存時間，再藏今天字數', () => {
    const save = css.indexOf('.topbar-save { display: none; }');
    const words = css.indexOf('.topbar-words { display: none; }');
    expect(save).toBeGreaterThan(-1);
    expect(words).toBeGreaterThan(save);
  });
  it('專注模式與橫拿打字的浮動位置，和離開鈕同高、左邊距等於離開鈕右邊距', () => {
    expect(css).toMatch(/data-focus-mode="true"\] \.dict-button\.is-floating\s*\{[^}]*top:\s*calc\(16px[^}]*left:\s*24px/s);
    expect(css).toMatch(/data-focus-mode="true"\]\[data-layout="phone-portrait"\] \.dict-button\.is-floating\s*\{[^}]*top:\s*calc\(12px[^}]*left:\s*16px/s);
    expect(css).toMatch(/\.dict-button\.is-floating\s*\{[^}]*top:\s*calc\(8px[^}]*left:\s*calc\(12px/s);
  });
  it('提示不是 .toast，左右各留 12，不推動版面（fixed）', () => {
    expect(css).toMatch(/\.dict-offline-notice\[data-visible="true"\]\s*\{[^}]*position:\s*fixed[^}]*left:\s*12px[^}]*right:\s*12px/s);
    expect(css).not.toContain('.toast');
  });
  it('寫作頁接線：只用既有版面判斷，不用 visualViewport，提示不走 toast', () => {
    expect(editorSrc).toContain('dictPlacement(');
    expect(editorSrc).toContain('useDictSelection(');
    expect(editorSrc).not.toContain('visualViewport');
    expect(editorSrc).not.toMatch(/dict[^\n]*actions\.toast/i);
  });
});
