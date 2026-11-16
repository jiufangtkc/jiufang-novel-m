import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_ROOM_ATTR,
  panelCoverFromBottom,
  restorePanelRoom,
  revealCaretAbovePanel,
  scrollDeltaToReveal,
} from './caret';

const rect = (top: number, bottom: number, left = 0, right = 390) => ({ top, bottom, left, right });

describe('WO-88 面板遮擋量', () => {
  it('直拿下方面板：頂端落在正文中間，遮住底部', () => {
    expect(panelCoverFromBottom(rect(100, 800), rect(420, 844))).toBe(380);
  });
  it('側邊抽屜（頂端不低於正文頂端）不套用直拿扣高', () => {
    expect(panelCoverFromBottom(rect(100, 800), rect(0, 844, 100, 390))).toBe(0);
  });
  it('寬版右欄（左右不重疊）不扣高', () => {
    expect(panelCoverFromBottom(rect(100, 800, 0, 600), rect(120, 800, 700, 1000))).toBe(0);
  });
});

describe('WO-88 可見高度縮短後的捲動量', () => {
  const caretTop = 500;
  const caretHeight = 28;
  it('完整高度看得到，面板拉起後要捲', () => {
    expect(scrollDeltaToReveal(caretTop, caretHeight, 0, 700)).toBe(0);
    const delta = scrollDeltaToReveal(caretTop, caretHeight, 0, 700 - 380);
    expect(delta).toBeGreaterThan(0);
    const newTop = delta;
    expect(caretTop + caretHeight).toBeLessThanOrEqual(newTop + 320 - 24);
    expect(caretTop).toBeGreaterThanOrEqual(newTop + 24);
  });
  it('已可見時為零，已有捲動位置時仍正確', () => {
    expect(scrollDeltaToReveal(100, 28, 0, 320)).toBe(0);
    expect(scrollDeltaToReveal(1000, 28, 800, 320)).toBe(0);
    const d = scrollDeltaToReveal(1300, 28, 800, 320);
    expect(1300 + 28).toBeLessThanOrEqual(800 + d + 320 - 24);
  });
});

function fakeTextarea(opts: { scrollTop: number; scrollHeight: number; clientHeight: number; caretTop: number }) {
  const attrs = new Map<string, string>();
  const el = {
    scrollTop: opts.scrollTop,
    scrollHeight: opts.scrollHeight,
    clientHeight: opts.clientHeight,
    selectionStart: 5,
    selectionEnd: 5,
    value: 'x'.repeat(10),
    style: { paddingBottom: '' } as Record<string, string>,
    getBoundingClientRect: () => ({ top: 100, bottom: 100 + opts.clientHeight, left: 0, right: 390 }),
    hasAttribute: (k: string) => attrs.has(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
  vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '28px', paddingBottom: '16px' }));
  vi.stubGlobal('document', {
    createElement: () => {
      return {
        style: {},
        textContent: '',
        offsetTop: opts.caretTop,
        offsetHeight: 28,
        appendChild: () => undefined,
        remove: () => undefined,
      };
    },
    body: { appendChild: () => undefined },
  });
  return el as unknown as HTMLTextAreaElement;
}

const panel = (top: number) =>
  ({ getBoundingClientRect: () => rect(top, 844) }) as unknown as HTMLElement;

describe('WO-88 revealCaretAbovePanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('游標被面板蓋住時只捲必要距離，且不改游標與內容', () => {
    const el = fakeTextarea({ scrollTop: 0, scrollHeight: 3000, clientHeight: 700, caretTop: 500 });
    const delta = revealCaretAbovePanel(el, panel(420));
    expect(delta).toBe(500 + 28 - (700 - 380 - 24));
    expect(el.scrollTop).toBe(delta);
    expect(el.selectionStart).toBe(5);
    expect(el.value).toBe('x'.repeat(10));
  });
  it('游標已在剩餘可見區就不捲', () => {
    const el = fakeTextarea({ scrollTop: 0, scrollHeight: 3000, clientHeight: 700, caretTop: 100 });
    expect(revealCaretAbovePanel(el, panel(420))).toBe(0);
    expect(el.scrollTop).toBe(0);
  });
  it('未被遮擋的版面（面板頂端在正文頂端上方）不捲', () => {
    const el = fakeTextarea({ scrollTop: 0, scrollHeight: 3000, clientHeight: 700, caretTop: 600 });
    expect(revealCaretAbovePanel(el, panel(0))).toBe(0);
  });
  it('動畫中先量到偏低的面板、最終再量：以最終幾何為準，游標行下緣在面板上方至少 24px', () => {
    const el = fakeTextarea({ scrollTop: 0, scrollHeight: 3000, clientHeight: 700, caretTop: 500 });
    // 動畫起點面板幾乎在螢幕外（遮擋極小），第一次量不會捲；最終位置才需要捲
    revealCaretAbovePanel(el, panel(800));
    revealCaretAbovePanel(el, panel(600));
    revealCaretAbovePanel(el, panel(420));
    const caretBottomOnScreen = 100 + 500 + 28 - el.scrollTop;
    expect(caretBottomOnScreen).toBeLessThanOrEqual(420 - 24);
    // 再量一次（保底）不再多捲
    const before = el.scrollTop;
    expect(revealCaretAbovePanel(el, panel(420))).toBe(0);
    expect(el.scrollTop).toBe(before);
  });
  it('接近文末捲不到時暫時加大底部留白，關閉後恢復', () => {
    const el = fakeTextarea({ scrollTop: 2300, scrollHeight: 3000, clientHeight: 700, caretTop: 2900 });
    const delta = revealCaretAbovePanel(el, panel(420));
    expect(delta).toBeGreaterThan(0);
    expect(el.hasAttribute(PANEL_ROOM_ATTR)).toBe(true);
    expect(el.style.paddingBottom).toBe(`${16 + (delta - 0)}px`);
    restorePanelRoom(el);
    expect(el.style.paddingBottom).toBe('');
    expect(el.hasAttribute(PANEL_ROOM_ATTR)).toBe(false);
  });
});

describe('WO-88 接到看卡片開啟與關閉流程', () => {
  const src = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
  it('openCards 開啟後等面板動畫再量測並捲動', () => {
    const open = src.slice(src.indexOf('const openCards'), src.indexOf('// WO-64'));
    expect(open).toContain('revealCaretWhenPanelReady()');
    expect(open).toContain('revealCaretAbovePanel(el, panel)');
    expect(open).toContain('getAnimations');
    expect(open).toContain('animationend');
    expect(open).toContain('setTimeout(again, 300)');
    expect(open).not.toContain('selectionStart =');
    expect(open).not.toContain('.value =');
  });
  it('closeCards 恢復暫加的留白，並仍以現在位置還原（WO-82）', () => {
    const close = src.slice(src.indexOf('const closeCards'), src.indexOf('const toggleCards'));
    expect(close).toContain('restorePanelRoom(ref.current)');
    expect(close).toContain('snapshotForCardsClose');
  });
});
