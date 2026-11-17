import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DictButton } from '../components/DictButton';
import { createDictSelectionTracker } from './selectionTracker';
import { bindDictTextarea, DICT_BUTTON_ATTR, useDictSelection } from './useDictSelection';

/**
 * 以程式產生的假 DOM 模擬瀏覽器的 Tab 順序、focus()、blur 的 relatedTarget 與按鈕原生 Enter／空白啟用。
 * 按鈕的 onClick／onBlur／onPointerDown 取自真正的 DictButton 元件輸出；不呼叫 onPress 代替操作。
 */
class FakeEl extends EventTarget {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  dictSource: string | null = null;
  onClickProp: (() => void) | null = null;
  onBlurProp: ((e: { relatedTarget: unknown }) => void) | null = null;
  constructor(public name: string, private page: FakePage) {
    super();
  }
  closest(sel: string) {
    return this.dictSource && sel === `[${DICT_BUTTON_ATTR}]` ? this : null;
  }
  focus() {
    const prev = this.page.active;
    if (prev === this) return;
    this.page.active = this;
    const blur = new Event('blur');
    Object.defineProperty(blur, 'relatedTarget', { value: this });
    prev?.dispatchEvent(blur);
    prev?.onBlurProp?.({ relatedTarget: this });
    this.dispatchEvent(new Event('focus'));
  }
}

class FakePage extends EventTarget {
  active: FakeEl | null = null;
  /** DOM 順序（Tab 順序）：只含目前存在的元素 */
  order: FakeEl[] = [];
  buttons: FakeEl[] = [];
  get activeElement() {
    return this.active;
  }
  querySelector(sel: string) {
    return this.buttons.find((b) => this.order.includes(b) && sel === `[${DICT_BUTTON_ATTR}="${b.dictSource}"]`) ?? null;
  }
  key(key: string, shift = false) {
    const target = this.active!;
    const ev = new Event('keydown', { cancelable: true });
    Object.assign(ev, { key, shiftKey: shift });
    target.dispatchEvent(ev);
    if (ev.defaultPrevented) return;
    if (key === 'Tab') {
      const i = this.order.indexOf(target);
      const next = this.order[(i + (shift ? -1 : 1) + this.order.length) % this.order.length];
      next.focus();
    } else if ((key === 'Enter' || key === ' ') && target.onClickProp) {
      target.onClickProp(); // 原生 button：Enter／空白觸發 click
    }
  }
}

/** layout：'card' = 查字典、標題、顏色、內容、取消、完成；'body' = 查字典、搜尋、專注、看卡片、正文 */
function build(source: 'card' | 'body') {
  const tracker = createDictSelectionTracker();
  const page = new FakePage();
  const names = source === 'card' ? ['title', 'color', 'content', 'cancel', 'done'] : ['search', 'focus', 'cards', 'content'];
  const els = Object.fromEntries(names.map((n) => [n, new FakeEl(n, page)]));
  const textarea = els.content;
  textarea.value = '我買了車票回家';
  const btn = new FakeEl('dict', page);
  btn.dictSource = source;
  page.buttons = [btn];
  const baseOrder = names.map((n) => els[n]);
  const setVisible = (v: boolean) => {
    page.order = v ? [btn, ...baseOrder] : baseOrder;
  };
  setVisible(false);

  const unbind = bindDictTextarea(
    textarea as unknown as HTMLTextAreaElement,
    page as unknown as Document,
    source,
    tracker,
  );
  let handlers: ReturnType<typeof useDictSelection> | null = null;
  const ref = { current: textarea as unknown as HTMLTextAreaElement };
  const sync = () => {
    // 模擬 React 以 hook 的 visible 決定按鈕是否存在，並把真元件的 props 接到假按鈕
    handlers = useDictSelectionForTest(source, ref, tracker);
    setVisible(handlers.visible);
    if (handlers.visible) {
      const h = handlers;
      const el = DictButton({
        word: handlers.word,
        placement: source === 'card' ? 'card' : 'topbar',
        onPointerDown: h.onPointerDown,
        onPress: h.onPress,
        onBlur: h.onButtonBlur,
        onOffline: () => {},
      }) as ReactElement<{ onClick: () => void; onBlur: (e: { relatedTarget: unknown }) => void; [k: string]: unknown }>;
      expect(el.props[DICT_BUTTON_ATTR]).toBe(source);
      btn.onClickProp = () => {
        el.props.onClick();
        sync();
      };
      btn.onBlurProp = (e) => {
        el.props.onBlur(e);
        sync();
      };
    }
    return handlers;
  };
  tracker.subscribe(() => sync());
  const selectChePiao = () => {
    textarea.focus();
    textarea.selectionStart = 3;
    textarea.selectionEnd = 5;
    textarea.dispatchEvent(new Event('keyup'));
    sync();
  };
  return { tracker, page, els, textarea, btn, selectChePiao, sync, unbind };
}

/** hook 不在 React 內執行時，取其純函式部分（useCallback／useState／useEffect 以 stub 方式略過） */
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return {
    ...actual,
    useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
  };
});
function useDictSelectionForTest(...args: Parameters<typeof useDictSelection>) {
  return useDictSelection(...args);
}

afterEach(() => vi.unstubAllGlobals());

for (const source of ['card', 'body'] as const) {
  describe(`WO-104 返工2：${source === 'card' ? '卡片內容' : '正文'}的實際 Tab 順序`, () => {
    it('選車票 → Tab：焦點直接落到查字典（跳過取消／完成等）、暫存仍在 → Enter 恰開窗一次', () => {
      const open = vi.fn();
      vi.stubGlobal('window', { open });
      vi.stubGlobal('navigator', { onLine: true });
      const t = build(source);
      t.selectChePiao();
      expect(t.page.order[0]).toBe(t.btn);
      t.page.key('Tab');
      expect(t.page.active).toBe(t.btn);
      expect(t.tracker.getState()).toMatchObject({ word: '車票', canLookup: true, source });
      t.page.key('Enter');
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toContain(encodeURIComponent('車票'));
      expect(open.mock.calls[0][1]).toBe('_blank');
      t.unbind();
    });

    it('選車票 → Shift+Tab：焦點落到查字典 → 空白鍵恰開窗一次', () => {
      const open = vi.fn();
      vi.stubGlobal('window', { open });
      vi.stubGlobal('navigator', { onLine: true });
      const t = build(source);
      t.selectChePiao();
      t.page.key('Tab', true);
      expect(t.page.active).toBe(t.btn);
      expect(t.tracker.getState().word).toBe('車票');
      t.page.key(' ');
      expect(open).toHaveBeenCalledTimes(1);
      t.unbind();
    });

    it('從按鈕再 Tab 到其他欄位：清除，按鈕消失', () => {
      const t = build(source);
      t.selectChePiao();
      t.page.key('Tab');
      expect(t.page.active).toBe(t.btn);
      t.page.key('Tab'); // 按鈕之後的下一個控制項
      expect(t.page.active).not.toBe(t.textarea);
      expect(t.tracker.getState()).toMatchObject({ word: '', canLookup: false, source: null });
      expect(t.page.order).not.toContain(t.btn);
      t.unbind();
    });

    it('沒有選取時 Tab 照常走原順序，不被攔截', () => {
      const t = build(source);
      t.textarea.focus();
      t.textarea.dispatchEvent(new Event('keyup'));
      const ev = new Event('keydown', { cancelable: true });
      Object.assign(ev, { key: 'Tab', shiftKey: false });
      t.textarea.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
      t.unbind();
    });

    it('按鈕上 Shift+Tab 回輸入框：保留暫存', () => {
      const t = build(source);
      t.selectChePiao();
      t.page.key('Tab');
      t.btn.dispatchEvent(new Event('keydown'));
      t.textarea.focus();
      expect(t.tracker.getState()).toMatchObject({ word: '車票', canLookup: true });
      t.unbind();
    });
  });
}

describe('WO-104 返工2：來源互斥與滑鼠', () => {
  it('卡片選字時，正文輸入框的 Tab 不被攔截', () => {
    const tracker = createDictSelectionTracker();
    const page = new FakePage();
    const body = new FakeEl('body', page);
    const card = new FakeEl('card', page);
    card.value = '車票';
    const b1 = bindDictTextarea(body as unknown as HTMLTextAreaElement, page as unknown as Document, 'body', tracker);
    const b2 = bindDictTextarea(card as unknown as HTMLTextAreaElement, page as unknown as Document, 'card', tracker);
    card.focus();
    card.selectionStart = 0;
    card.selectionEnd = 2;
    card.dispatchEvent(new Event('keyup'));
    body.focus(); // 卡片失焦清除
    const ev = new Event('keydown', { cancelable: true });
    Object.assign(ev, { key: 'Tab' });
    body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    b1();
    b2();
  });

  it('pointerdown 仍 preventDefault', () => {
    const t = build('body');
    const preventDefault = vi.fn();
    t.sync().onPointerDown({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    t.unbind();
  });
});
