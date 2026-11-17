import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DictButton } from '../components/DictButton';
import { createDictSelectionTracker } from './selectionTracker';
import { bindDictTextarea, DICT_BUTTON_ATTR, useDictSelection } from './useDictSelection';

/** 用程式產生的假元素模擬瀏覽器的焦點與事件（不用真稿） */
class FakeEl extends EventTarget {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  isButton = false;
  closest(sel: string) {
    return this.isButton && sel === `[${DICT_BUTTON_ATTR}]` ? this : null;
  }
}

function setup(source: 'body' | 'card' = 'body') {
  const tracker = createDictSelectionTracker();
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown }) as unknown as Document;
  const textarea = new FakeEl();
  textarea.value = '我買了車票回家';
  const button = new FakeEl();
  button.isButton = true;
  const other = new FakeEl();
  const unbind = bindDictTextarea(textarea as unknown as HTMLTextAreaElement, doc, source, tracker);

  // 用真的 hook 取得按鈕處理函式
  let handlers: ReturnType<typeof useDictSelection> | null = null;
  const ref = { current: textarea as unknown as HTMLTextAreaElement };
  function Probe() {
    handlers = useDictSelection(source, ref, tracker);
    return null;
  }
  const rerender = () => renderToStaticMarkup(createElement(Probe));
  rerender();

  const focusTo = (from: FakeEl, to: FakeEl) => {
    const blur = new Event('blur');
    Object.defineProperty(blur, 'relatedTarget', { value: to });
    (doc as unknown as { activeElement: unknown }).activeElement = to;
    from.dispatchEvent(blur);
    to.dispatchEvent(new Event('focus'));
  };
  const blurButtonTo = (to: FakeEl) => {
    const e = { relatedTarget: to };
    (doc as unknown as { activeElement: unknown }).activeElement = to;
    handlers!.onButtonBlur(e);
    to.dispatchEvent(new Event('focus'));
  };
  const selectChePiao = () => {
    (doc as unknown as { activeElement: unknown }).activeElement = textarea;
    textarea.selectionStart = 3;
    textarea.selectionEnd = 5;
    textarea.dispatchEvent(new Event('keyup'));
  };
  return { tracker, textarea, button, other, focusTo, blurButtonTo, selectChePiao, get h() { rerender(); return handlers!; }, unbind };
}

afterEach(() => vi.unstubAllGlobals());

describe('WO-104 返工1：鍵盤移焦到查字典', () => {
  it('查字典按鈕輸出辨識屬性', () => {
    const html = renderToStaticMarkup(
      createElement(DictButton, {
        word: '車票',
        placement: 'topbar',
        onPointerDown: () => {},
        onPress: () => 'opened' as const,
        onOffline: () => {},
      }),
    );
    expect(html).toContain(DICT_BUTTON_ATTR);
  });

  it('Shift+方向鍵選車票 → Tab 到按鈕 → Enter：保留暫存並開窗一次', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', { onLine: true });
    const t = setup();
    t.selectChePiao();
    expect(t.tracker.getState()).toMatchObject({ word: '車票', canLookup: true, source: 'body' });
    t.focusTo(t.textarea, t.button);
    expect(t.h.visible).toBe(true);
    expect(t.tracker.getState()).toMatchObject({ word: '車票', canLookup: true });
    // 瀏覽器：按鈕上按 Enter／空白會觸發 click
    expect(t.h.onPress()).toBe('opened');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toContain(encodeURIComponent('車票'));
    expect(open.mock.calls[0][1]).toBe('_blank');
    expect(t.tracker.getState().word).toBe('車票');
    t.unbind();
  });

  it('按鈕上 Shift+Tab 回輸入框：保留；再 Tab 到其他欄位：清除', () => {
    const t = setup();
    t.selectChePiao();
    t.focusTo(t.textarea, t.button);
    t.blurButtonTo(t.textarea);
    expect(t.tracker.getState().canLookup).toBe(true);
    t.focusTo(t.textarea, t.button);
    t.blurButtonTo(t.other);
    expect(t.tracker.getState()).toMatchObject({ word: '', canLookup: false, source: null });
    t.unbind();
  });

  it('從輸入框直接移到其他元素：清除、按鈕不出現', () => {
    const t = setup();
    t.selectChePiao();
    t.focusTo(t.textarea, t.other);
    expect(t.tracker.getState().canLookup).toBe(false);
    expect(t.h.visible).toBe(false);
    t.unbind();
  });

  it('沒有 relatedTarget（點空白處）：清除', () => {
    const t = setup();
    t.selectChePiao();
    t.textarea.dispatchEvent(new Event('blur'));
    expect(t.tracker.getState().canLookup).toBe(false);
    t.unbind();
  });

  it('卡片與正文互斥：卡片選字後 Tab 到按鈕，正文不會顯示', () => {
    const tracker = createDictSelectionTracker();
    const mk = (source: 'body' | 'card') => {
      const doc = Object.assign(new EventTarget(), { activeElement: null as unknown }) as unknown as Document;
      const el = new FakeEl();
      el.value = '車票';
      const unbind = bindDictTextarea(el as unknown as HTMLTextAreaElement, doc, source, tracker);
      return { doc, el, unbind };
    };
    const body = mk('body');
    const card = mk('card');
    const btn = new FakeEl();
    btn.isButton = true;
    (card.doc as unknown as { activeElement: unknown }).activeElement = card.el;
    card.el.selectionStart = 0;
    card.el.selectionEnd = 2;
    card.el.dispatchEvent(new Event('keyup'));
    const blur = new Event('blur');
    Object.defineProperty(blur, 'relatedTarget', { value: btn });
    card.el.dispatchEvent(blur);
    expect(tracker.getState().source).toBe('card');
    // 正文失焦不會清掉卡片的暫存
    body.el.dispatchEvent(new Event('blur'));
    expect(tracker.getState()).toMatchObject({ word: '車票', source: 'card' });
    body.unbind();
    card.unbind();
  });

  it('滑鼠／觸控 pointerdown 仍 preventDefault 並保住暫存', () => {
    const t = setup();
    t.selectChePiao();
    const preventDefault = vi.fn();
    t.h.onPointerDown({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    t.textarea.dispatchEvent(new Event('blur'));
    expect(t.tracker.getState().canLookup).toBe(true);
    t.unbind();
  });
});
