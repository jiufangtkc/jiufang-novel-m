import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createQuickIdeaPlaceGuard,
  isQuickIdeaAvailable,
  persistPlaceOnBodyBlur,
  persistScrollPlace,
  settleQuickIdeaSession,
  startTailWatch,
  TAIL_MAX_MS,
  TAIL_QUIET_MS,
  tryEnterQuickIdea,
  type TailWatchEnv,
} from '../editor/quickIdeaPlaceGuard';
import { addQuickIdeaCard } from '../domain/quickIdea';
import {
  forgetNavMemory,
  readNavMemory,
  readWritePlace,
  saveWritePlace,
  type NavMemoryStore,
} from './navMemory';
import { getProjectCards, getProjectCategorySettings, reduce } from './sampleStore';
import { demoFixtureState } from './testing/sampleFixture';

/** 假的計時器與可視區 resize（不真的等時間）。 */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const listeners = new Set<() => void>();
  const env: TailWatchEnv = {
    onViewportResize: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setTimeout: (cb, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
  };
  return {
    env,
    resize() {
      [...listeners].forEach((cb) => cb());
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].cb();
      }
      now = end;
    },
  };
}

/** 記錄寫入次數的裝置端記憶（取代 localStorage），只放【範例】。 */
function countingStore(): NavMemoryStore & { data: Record<string, string>; writes: number } {
  return {
    data: {},
    writes: 0,
    getItem(key: string) {
      return this.data[key] ?? null;
    },
    setItem(key: string, value: string) {
      this.writes += 1;
      this.data[key] = value;
    },
  };
}

const PROJECT = 'fog';
const CHAPTER = 'ch-wo144-範例';

/**
 * 依 EditorPane 的真實順序操作的小型模型（vitest 為 node 環境，無法渲染元件）：
 * - 焦點一離開正文就觸發正文 blur（走和 EditorPane 同一個 persistPlaceOnBodyBlur）
 * - 「⋯」按下：先 beginMenu（onBeforeOpen），再開選單，FormatLayer 的 effect 才把焦點移到選單第一顆鈕
 * - 橫拿打字狀態與 useWritingKeyboard 一樣：正文沒有焦點就視為鍵盤已收（landscape 變 false）
 * - 選單項與項數用和 EditorPane 同一個 isQuickIdeaAvailable；選項走 tryEnterQuickIdea
 * - 選單與記入畫面都關了才 settleQuickIdeaSession
 */
function createHarness(options: { landscapeTyping: boolean }) {
  forgetNavMemory(PROJECT);
  const store = countingStore();
  let state = demoFixtureState(new Date('2026-11-28T10:00:00Z'));
  state = reduce(state, { type: 'remember-place', projectId: PROJECT, nodeId: CHAPTER, cursor: 5 });
  saveWritePlace(
    PROJECT,
    { chapterId: CHAPTER, chapterOpen: true, selectionStart: 5, selectionEnd: 5, scrollTop: 120, keyboard: true },
    store,
  );
  const guard = createQuickIdeaPlaceGuard();
  const h = {
    store,
    guard,
    focus: 'body' as 'body' | 'menu' | 'sheet' | 'none',
    menuOpen: false,
    sheetOpen: false,
    writerCalls: 0,
    state: () => state,
    /** 與 useWritingKeyboard 相同：正文沒焦點 → 鍵盤視為已收 */
    keyboardLandscape: () => options.landscapeTyping && h.focus === 'body',
    menuItemCount: (hasSelection = false) =>
      4 + (isQuickIdeaAvailable(guard, h.keyboardLandscape()) ? 1 : 0) + (hasSelection ? 1 : 0),
    menuHasQuickIdea: () => isQuickIdeaAvailable(guard, h.keyboardLandscape()),
    moveFocus(to: 'body' | 'menu' | 'sheet' | 'none') {
      const leavingBody = h.focus === 'body' && to !== 'body';
      h.focus = to;
      if (leavingBody) {
        persistPlaceOnBodyBlur(guard, {
          remember: () => {
            h.writerCalls += 1;
            state = reduce(state, { type: 'remember-place', projectId: PROJECT, nodeId: CHAPTER, cursor: 999 });
          },
          save: () => {
            saveWritePlace(
              PROJECT,
              { chapterId: CHAPTER, chapterOpen: true, selectionStart: 999, selectionEnd: 999, scrollTop: 0, keyboard: false },
              store,
            );
          },
        });
      }
    },
    scrollWrites: 0,
    /** 正文 onScroll：走和 EditorPane 同一個 persistScrollPlace（例如鍵盤收起、可視區變高使捲動被收回） */
    scroll(top: number) {
      persistScrollPlace(guard, () => {
        h.scrollWrites += 1;
        saveWritePlace(
          PROJECT,
          { chapterId: CHAPTER, chapterOpen: true, selectionStart: 5, selectionEnd: 5, scrollTop: top, keyboard: false },
          store,
        );
      });
    },
    settle() {
      settleQuickIdeaSession(guard, { menuOpen: h.menuOpen, quickIdeaOpen: h.sheetOpen });
    },
    clickMore() {
      guard.beginMenu(h.keyboardLandscape()); // onBeforeOpen
      h.menuOpen = true;
      h.moveFocus('menu'); // 選單開啟後 effect 把焦點移到第一顆按鈕
      h.settle();
    },
    closeMenuWithoutPicking() {
      h.menuOpen = false;
      h.settle();
    },
    /** 在選單裡點「記靈感」（選單先關，再呼叫共用開啟函式） */
    pickQuickIdea() {
      h.menuOpen = false;
      const entry = tryEnterQuickIdea(guard, { landscapeTypingNow: h.keyboardLandscape(), composing: false });
      if (entry === 'open') {
        h.sheetOpen = true;
        h.moveFocus('sheet');
      }
      h.settle();
      return entry;
    },
    cancel() {
      h.sheetOpen = false;
      h.settle();
      h.startTail();
    },
    /** 與 EditorPane 的 effect 相同：settle 之後若進入收尾保護就開始看可視區 */
    startTail() {
      h.stopTail();
      h.stopTail = startTailWatch(guard, h.clock.env);
    },
    stopTail: () => {},
    userInput() {
      guard.userInput();
    },
    clock: fakeClock(),
  };
  return h;
}

describe('WO-144 返工 A：打字時「⋯」→記靈感→取消必須零寫入（範例稿，依選單搶焦點的真實順序）', () => {
  it('選單一開正文就失焦，仍沒有任何寫入；取消後稿件資料與位置記憶都沒變', () => {
    const h = createHarness({ landscapeTyping: false });
    const stateBefore = h.state();
    const cardsBefore = structuredClone(getProjectCards(stateBefore, PROJECT));
    const settingsBefore = structuredClone(getProjectCategorySettings(stateBefore, PROJECT));
    const placeBefore = structuredClone(readWritePlace(PROJECT, h.store));
    const memoryBefore = structuredClone(readNavMemory(PROJECT, h.store));
    const writesBefore = h.store.writes;
    const rawBefore = { ...h.store.data };

    h.clickMore();
    expect(h.focus).toBe('menu'); // 正文確實已失焦
    expect(h.menuHasQuickIdea()).toBe(true);
    expect(h.menuItemCount()).toBe(5);
    expect(h.pickQuickIdea()).toBe('open');
    h.cancel();

    expect(h.writerCalls).toBe(0);
    expect(h.state()).toBe(stateBefore);
    expect(getProjectCards(h.state(), PROJECT)).toEqual(cardsBefore);
    expect(getProjectCategorySettings(h.state(), PROJECT)).toEqual(settingsBefore);
    expect(readWritePlace(PROJECT, h.store)).toEqual(placeBefore);
    expect(readNavMemory(PROJECT, h.store)).toEqual(memoryBefore);
    expect(h.store.writes).toBe(writesBefore);
    expect(h.store.data).toEqual(rawBefore);
    expect(h.guard.isTail()).toBe(true); // 面板關了，保護延續到鍵盤穩定
    h.clock.advance(TAIL_QUIET_MS);
    expect(h.guard.isActive()).toBe(false);
  });

  it('燈泡入口同樣零寫入（頁首燈泡不經過選單）', () => {
    const h = createHarness({ landscapeTyping: false });
    const writesBefore = h.store.writes;
    const stateBefore = h.state();
    expect(tryEnterQuickIdea(h.guard, { landscapeTypingNow: false, composing: false })).toBe('open');
    h.sheetOpen = true;
    h.moveFocus('sheet');
    h.cancel();
    expect(h.writerCalls).toBe(0);
    expect(h.store.writes).toBe(writesBefore);
    expect(h.state()).toBe(stateBefore);
  });

  it('只開「⋯」選單再關掉（沒進記靈感）：失焦的位置寫入只是暫緩，選單收起時照原樣補寫一次（既有排版／版本流程不受影響）', () => {
    const h = createHarness({ landscapeTyping: false });
    h.clickMore();
    expect(h.writerCalls).toBe(0); // 選單開著期間先不寫
    h.closeMenuWithoutPicking();
    expect(h.writerCalls).toBe(1); // 沒進記靈感 → 補寫，與沒有這個功能時一樣
    expect(readWritePlace(PROJECT, h.store)?.selectionStart).toBe(999);
  });

  it('沒有任何保護階段時，失焦照舊立即寫入', () => {
    const h = createHarness({ landscapeTyping: false });
    h.moveFocus('none');
    expect(h.writerCalls).toBe(1);
  });

  it('只有按「存起來」才寫稿子資料：存好才多一張靈感卡，且純函式本身不改狀態', () => {
    const h = createHarness({ landscapeTyping: false });
    const before = h.state();
    const cards = getProjectCards(before, PROJECT);
    const settings = getProjectCategorySettings(before, PROJECT);
    const result = addQuickIdeaCard(
      { cards, categoryOrder: settings.categoryOrder, categoriesMeta: settings.categoriesMeta },
      { title: '範例靈感', content: '' },
    );
    expect(h.state()).toBe(before);
    expect(result.kind).toBe('added');
    if (result.kind !== 'added') return;
    const after = reduce(before, {
      type: 'set-card-categories',
      projectId: PROJECT,
      cards: result.cards,
      ...(result.createdCategory
        ? { categoryOrder: result.categoryOrder, categoriesMeta: result.categoriesMeta }
        : {}),
    });
    expect(getProjectCards(after, PROJECT)).toHaveLength(cards.length + 1);
  });
});

describe('WO-144 第 3 輪：選單與記入畫面期間的捲動也不寫閱讀位置', () => {
  function snapshot(h: ReturnType<typeof createHarness>) {
    return {
      state: h.state(),
      place: structuredClone(readWritePlace(PROJECT, h.store)),
      memory: structuredClone(readNavMemory(PROJECT, h.store)),
      raw: { ...h.store.data },
      writes: h.store.writes,
    };
  }

  it('「⋯」→記靈感→（鍵盤收起使正文捲動）→取消：寫入次數為零，位置記憶不變', () => {
    const h = createHarness({ landscapeTyping: false });
    const before = snapshot(h);
    h.clickMore(); // 正文失焦（鍵盤收起）
    h.scroll(40); // 選單開著時可視區變高、捲動被收回
    expect(h.pickQuickIdea()).toBe('open');
    h.scroll(10); // 記入畫面開著時再次捲動
    h.scroll(0);
    h.cancel();
    const after = snapshot(h);
    expect(h.scrollWrites).toBe(0);
    expect(h.writerCalls).toBe(0);
    expect(after.state).toBe(before.state);
    expect(after.place).toEqual(before.place);
    expect(after.memory).toEqual(before.memory);
    expect(after.raw).toEqual(before.raw);
    expect(after.writes).toBe(before.writes);
  });

  it('燈泡入口同樣：記入畫面期間捲動後取消，寫入次數為零', () => {
    const h = createHarness({ landscapeTyping: false });
    const before = snapshot(h);
    expect(tryEnterQuickIdea(h.guard, { landscapeTypingNow: false, composing: false })).toBe('open');
    h.sheetOpen = true;
    h.moveFocus('sheet');
    h.scroll(25);
    h.cancel();
    const after = snapshot(h);
    expect(h.scrollWrites).toBe(0);
    expect(after.writes).toBe(before.writes);
    expect(after.raw).toEqual(before.raw);
    expect(after.place).toEqual(before.place);
  });

  it('對照：不在保護階段時，正文 onScroll 照常寫入閱讀位置（一般閱讀沒被關掉）', () => {
    const h = createHarness({ landscapeTyping: false });
    h.scroll(333);
    expect(h.scrollWrites).toBe(1);
    expect(readWritePlace(PROJECT, h.store)?.scrollTop).toBe(333);
  });

  it('取消結束保護階段後，使用者真正的捲動又會正常記錄', () => {
    const h = createHarness({ landscapeTyping: false });
    h.clickMore();
    h.pickQuickIdea();
    h.scroll(5);
    h.cancel();
    expect(h.scrollWrites).toBe(0);
    h.userInput(); // 使用者自己動手捲動：立即恢復
    h.scroll(210);
    expect(h.scrollWrites).toBe(1);
    expect(readWritePlace(PROJECT, h.store)?.scrollTop).toBe(210);
  });

  it('只開「⋯」再關掉：選單期間的捲動直接略過（不把異常捲動當閱讀位置），關閉後照常', () => {
    const h = createHarness({ landscapeTyping: false });
    h.clickMore();
    h.scroll(7);
    expect(h.scrollWrites).toBe(0);
    h.closeMenuWithoutPicking();
    h.scroll(90);
    expect(h.scrollWrites).toBe(1);
  });

  it('EditorPane 的 onScroll 走 persistScrollPlace', () => {
    const src = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    expect(src).toContain('persistScrollPlace(quickIdeaGuardRef.current');
    expect(src).not.toContain('onScroll={() => saveWritePlaceNow()}');
  });
});

describe('WO-144 第 4 輪：面板關閉後，保護延續到鍵盤與版面穩定', () => {
  function snap(h: ReturnType<typeof createHarness>) {
    return {
      state: h.state(),
      place: structuredClone(readWritePlace(PROJECT, h.store)),
      memory: structuredClone(readNavMemory(PROJECT, h.store)),
      raw: { ...h.store.data },
      writes: h.store.writes,
    };
  }
  function expectUnchanged(h: ReturnType<typeof createHarness>, before: ReturnType<typeof snap>) {
    const after = snap(h);
    expect(h.scrollWrites).toBe(0);
    expect(h.writerCalls).toBe(0);
    expect(after.state).toBe(before.state);
    expect(after.place).toEqual(before.place);
    expect(after.memory).toEqual(before.memory);
    expect(after.raw).toEqual(before.raw);
    expect(after.writes).toBe(before.writes);
  }
  const openers: Array<[string, (h: ReturnType<typeof createHarness>) => void]> = [
    [
      '「⋯」入口',
      (h) => {
        h.clickMore();
        expect(h.pickQuickIdea()).toBe('open');
      },
    ],
    [
      '燈泡入口',
      (h) => {
        expect(tryEnterQuickIdea(h.guard, { landscapeTypingNow: false, composing: false })).toBe('open');
        h.sheetOpen = true;
        h.moveFocus('sheet');
      },
    ],
  ];

  for (const [name, open] of openers) {
    it(`${name}：先取消（面板已關），再收到鍵盤收合造成的正文 scroll，寫入次數為零`, () => {
      const h = createHarness({ landscapeTyping: false });
      const before = snap(h);
      open(h);
      h.cancel();
      expect(h.sheetOpen).toBe(false); // 面板確實已關
      expect(h.guard.isTail()).toBe(true);
      h.scroll(300); // 鍵盤收合、可視區變高、捲動被收回（非使用者主動）
      h.clock.resize();
      h.clock.advance(100);
      h.scroll(280);
      h.clock.resize();
      h.scroll(260);
      expectUnchanged(h, before);
    });

    it(`${name}：可視區穩定後恢復一般存位置`, () => {
      const h = createHarness({ landscapeTyping: false });
      open(h);
      h.cancel();
      h.clock.resize();
      h.clock.advance(TAIL_QUIET_MS - 1);
      h.scroll(10);
      expect(h.scrollWrites).toBe(0); // 最後一次 resize 後還沒滿安靜時間
      h.clock.advance(1);
      expect(h.guard.isActive()).toBe(false);
      h.scroll(77);
      expect(h.scrollWrites).toBe(1);
      expect(readWritePlace(PROJECT, h.store)?.scrollTop).toBe(77);
    });

    it(`${name}：使用者主動 touch／wheel／鍵盤輸入立即恢復，之後的捲動會存`, () => {
      const h = createHarness({ landscapeTyping: false });
      open(h);
      h.cancel();
      h.scroll(5);
      expect(h.scrollWrites).toBe(0);
      h.userInput(); // EditorPane 的 onTouchStart／onWheel／onKeyDown 都呼叫這個
      expect(h.guard.isActive()).toBe(false);
      h.scroll(150);
      expect(h.scrollWrites).toBe(1);
      expect(readWritePlace(PROJECT, h.store)?.scrollTop).toBe(150);
    });
  }

  it('可視區一直在變也不會永遠保護：到上限就恢復', () => {
    const h = createHarness({ landscapeTyping: false });
    openers[0][1](h);
    h.cancel();
    for (let t = 0; t < TAIL_MAX_MS; t += 100) {
      h.clock.resize();
      h.clock.advance(100);
    }
    expect(h.guard.isActive()).toBe(false);
    h.scroll(9);
    expect(h.scrollWrites).toBe(1);
  });

  it('收尾期間又重新打開記靈感：舊計時失效，不會提早解除', () => {
    const h = createHarness({ landscapeTyping: false });
    openers[1][1](h);
    h.cancel();
    h.clock.advance(TAIL_QUIET_MS - 10);
    openers[1][1](h); // 重新開啟
    h.clock.advance(TAIL_MAX_MS);
    expect(h.guard.isActive()).toBe(true); // 面板還開著
    h.scroll(1);
    expect(h.scrollWrites).toBe(0);
  });

  it('使用者輸入在沒有收尾保護時什麼都不做（不影響開著的面板）', () => {
    const h = createHarness({ landscapeTyping: false });
    openers[1][1](h);
    h.userInput();
    expect(h.guard.isActive()).toBe(true);
  });

  it('EditorPane 接線：onTouchStart／onWheel／onKeyDown 呼叫 userInput，並啟動 startTailWatch', () => {
    const src = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    for (const ev of ['onTouchStart', 'onWheel', 'onKeyDown']) {
      expect(src).toContain(`${ev}={() => quickIdeaGuardRef.current.userInput()}`);
    }
    expect(src).toContain('startTailWatch(guard');
  });
});

describe('WO-144 返工 B：橫拿打字時打開浮動「⋯」，選單從頭到尾不列「記靈感」', () => {
  it('選單搶走焦點使鍵盤視為已收後，已開的選單仍不含記靈感、項數一致、開啟函式不開畫面', () => {
    const h = createHarness({ landscapeTyping: true });
    expect(h.keyboardLandscape()).toBe(true);
    expect(h.menuItemCount()).toBe(4); // 打開前（橫拿打字）：不含記靈感

    h.clickMore();
    // 選單搶焦點 → 即時判斷變成「鍵盤已收」
    expect(h.focus).toBe('menu');
    expect(h.keyboardLandscape()).toBe(false);
    // 但選單開著期間仍用開啟當下鎖定的橫拿狀態
    expect(h.menuHasQuickIdea()).toBe(false);
    expect(h.menuItemCount()).toBe(4);
    expect(h.menuItemCount(true)).toBe(5); // 有選取時 +1，仍不含記靈感
    expect(h.pickQuickIdea()).toBe('blocked');
    expect(h.sheetOpen).toBe(false);

    // 選單關閉後鎖定解除，回到即時判斷
    expect(h.guard.lockedLandscape()).toBeNull();
    expect(isQuickIdeaAvailable(h.guard, h.keyboardLandscape())).toBe(true);
  });

  it('頁首看得見時（非橫拿打字）選單列記靈感且項數為 5', () => {
    const h = createHarness({ landscapeTyping: false });
    h.clickMore();
    expect(h.menuHasQuickIdea()).toBe(true);
    expect(h.menuItemCount()).toBe(5);
    expect(h.menuItemCount(true)).toBe(6);
  });

  it('EditorPane 接線：兩顆「⋯」都在開選單前 beginMenu；選單項與項數用鎖定後的判斷', () => {
    const src = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    expect(src.match(/onBeforeOpen=\{beginQuickIdeaMenuSession\}/g)).toHaveLength(2);
    expect(src).toContain('quickIdeaGuardRef.current.beginMenu(keyboard.landscape)');
    expect(src).toContain('persistPlaceOnBodyBlur(quickIdeaGuardRef.current');
    expect(src).toContain('const guard = quickIdeaGuardRef.current;');
    expect(src).toMatch(/settleQuickIdeaSession\(guard, \{\s*menuOpen: formatTools\.isOpen,\s*quickIdeaOpen,/);
    const tools = readFileSync(new URL('../components/FormatTools.tsx', import.meta.url), 'utf8');
    expect(tools.indexOf('props.onBeforeOpen?.();')).toBeGreaterThan(-1);
    expect(tools.indexOf('props.onBeforeOpen?.();')).toBeLessThan(tools.indexOf('props.tools.open(event.currentTarget)'));
  });
});
