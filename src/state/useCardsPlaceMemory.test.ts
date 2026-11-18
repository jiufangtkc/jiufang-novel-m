import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WO-65 返工 1：以 React Hook 替身執行真正的 useCardsPlaceMemory，
 * 模擬「掛載 → 放上捲動區（ref）→ effect」的順序與清單元素重建。
 */
const hookRuntime = vi.hoisted(() => {
  const slots: unknown[] = [];
  const effects: Array<() => void> = [];
  let index = 0;
  return {
    slots,
    effects,
    begin() {
      index = 0;
    },
    next() {
      return index++;
    },
    reset() {
      slots.length = 0;
      effects.length = 0;
      index = 0;
    },
  };
});

vi.mock('react', () => ({
  useState<T>(init: T | (() => T)) {
    const i = hookRuntime.next();
    if (!(i in hookRuntime.slots)) {
      hookRuntime.slots[i] = typeof init === 'function' ? (init as () => T)() : init;
    }
    return [hookRuntime.slots[i] as T, () => {}];
  },
  useRef<T>(init: T) {
    const i = hookRuntime.next();
    if (!(i in hookRuntime.slots)) hookRuntime.slots[i] = { current: init };
    return hookRuntime.slots[i] as { current: T };
  },
  useEffect(effect: () => void, deps: unknown[]) {
    const i = hookRuntime.next();
    const prev = hookRuntime.slots[i] as unknown[] | undefined;
    const changed = !prev || prev.length !== deps.length || prev.some((d, k) => !Object.is(d, deps[k]));
    hookRuntime.slots[i] = deps;
    if (changed) hookRuntime.effects.push(effect);
  },
}));

import { patchCardsPlace, readCardsPlace, resetNavMemoryCache } from './navMemory';
import { scrollToRestoreOnMount, useCardsPlaceMemory, type CardsPaneRole } from './useCardsPlaceMemory';

const BOOK = 'wo65-rework-book';

/** 捲動元素替身：可捲動高度夠，scrollTop 預設 0（新建立的清單元素都從 0 開始）。 */
function fakePane() {
  return {
    scrollTop: 0,
    scrollHeight: 5000,
    clientHeight: 600,
    classList: { contains: () => false },
    querySelector: () => null,
  } as unknown as HTMLElement;
}

type Selection = { categoryId: string | null; cardId: string | null; collapsedIds: ReadonlySet<string> };
const NO_COLLAPSE: ReadonlySet<string> = new Set();

/** 以程式產生的資料：一個分類下 60 張卡片 id。 */
const CARD_IDS = Array.from({ length: 60 }, (_, i) => `card-${String(i + 1).padStart(2, '0')}`);

/**
 * 畫一次：跑 Hook（render）→ 把這次畫面上的捲動區接上 ref（commit）→ 跑 effect。
 * 回傳 bind，讓測試可以送捲動事件。
 */
function renderFrame(selection: Selection, panes: Partial<Record<CardsPaneRole, HTMLElement>>) {
  hookRuntime.begin();
  const memory = useCardsPlaceMemory(BOOK, selection);
  for (const [role, el] of Object.entries(panes) as Array<[CardsPaneRole, HTMLElement]>) {
    memory.bind(role).ref(el);
  }
  const effects = hookRuntime.effects.splice(0);
  for (const effect of effects) effect();
  return memory;
}

function userScrolls(memory: ReturnType<typeof renderFrame>, role: CardsPaneRole, el: HTMLElement, top: number) {
  (el as { scrollTop: number }).scrollTop = top;
  memory.bind(role).onScrollCapture({ target: el, currentTarget: el } as never);
}

beforeEach(() => {
  hookRuntime.reset();
  resetNavMemoryCache();
  vi.stubGlobal('localStorage', undefined);
});

afterEach(() => {
  hookRuntime.reset();
  resetNavMemoryCache();
  vi.unstubAllGlobals();
});

describe('WO-65 返工 1：清單重建後仍放回捲動位置', () => {
  it('WO-65：同一分類連續開卡片、按「返回」三次，每次新建的清單都回到原位置；切到別的分類從頂端開始', () => {
    const list = (categoryId: string): Selection => ({ categoryId, cardId: null, collapsedIds: NO_COLLAPSE });
    const open = (categoryId: string, cardId: string): Selection => ({ categoryId, cardId, collapsedIds: NO_COLLAPSE });

    // 進分類、往下捲清單
    let listEl = fakePane();
    let memory = renderFrame(list('character'), { list: listEl });
    userScrolls(memory, 'list', listEl, 450);
    expect(readCardsPlace(BOOK)?.listScroll).toBe(450);

    const seen: number[] = [];
    for (const cardId of [CARD_IDS[10]!, CARD_IDS[25]!, CARD_IDS[40]!]) {
      // 打開卡片：清單卸載，只剩卡片內容
      const previewEl = fakePane();
      memory = renderFrame(open('character', cardId), { preview: previewEl });
      expect(previewEl.scrollTop).toBe(0); // 換卡片從內容頂端開始
      // 按「返回卡片清單」：建立全新的清單元素
      listEl = fakePane();
      memory = renderFrame(list('character'), { list: listEl });
      seen.push(listEl.scrollTop);
    }
    expect(seen).toEqual([450, 450, 450]);

    // 同一個清單元素重畫（例如展開子卡片）不重放、不蓋掉使用者剛捲的位置
    userScrolls(memory, 'list', listEl, 820);
    renderFrame({ categoryId: 'character', cardId: null, collapsedIds: new Set([CARD_IDS[3]!]) }, { list: listEl });
    expect(listEl.scrollTop).toBe(820);
    expect(readCardsPlace(BOOK)?.listScroll).toBe(820);

    // 切到別的分類：新清單從頂端開始，記憶也歸零
    const worldEl = fakePane();
    renderFrame(list('world'), { list: worldEl });
    expect(worldEl.scrollTop).toBe(0);
    expect(readCardsPlace(BOOK)).toMatchObject({ categoryId: 'world', listScroll: 0 });

    // 再切回原分類：也算換分類，從頂端開始
    const backEl = fakePane();
    renderFrame(list('character'), { list: backEl });
    expect(backEl.scrollTop).toBe(0);
  });

  it('WO-65：同一張卡片的內容重建時放回內容捲動，換卡片不套用；分類清單重建也放回', () => {
    patchCardsPlace(BOOK, {
      categoryId: 'character',
      cardId: CARD_IDS[5]!,
      categoryScroll: 120,
      listScroll: 300,
      previewScroll: 600,
    });
    const sel = { categoryId: 'character', cardId: CARD_IDS[5]!, collapsedIds: NO_COLLAPSE };
    const preview1 = fakePane();
    const category1 = fakePane();
    renderFrame(sel, { preview: preview1, category: category1 });
    expect(preview1.scrollTop).toBe(600);
    expect(category1.scrollTop).toBe(120);

    // 同一張卡片的內容區重新建立（例如回清單再點回同一張）
    const preview2 = fakePane();
    const category2 = fakePane();
    renderFrame(sel, { preview: preview2, category: category2 });
    expect(preview2.scrollTop).toBe(600);
    expect(category2.scrollTop).toBe(120);

    // 純判斷：記憶的卡片／分類不是目前這個就不放回；位置是 0 也不動
    const stored = readCardsPlace(BOOK);
    expect(scrollToRestoreOnMount('preview', stored, { categoryId: 'character', cardId: CARD_IDS[6]! })).toBeNull();
    expect(scrollToRestoreOnMount('list', stored, { categoryId: 'world', cardId: null })).toBeNull();
    expect(scrollToRestoreOnMount('list', stored, { categoryId: 'character', cardId: null })).toBe(300);
    expect(scrollToRestoreOnMount('list', null, { categoryId: 'character', cardId: null })).toBeNull();
    expect(
      scrollToRestoreOnMount('list', { ...stored!, listScroll: 0 }, { categoryId: 'character', cardId: null }),
    ).toBeNull();
  });
});
