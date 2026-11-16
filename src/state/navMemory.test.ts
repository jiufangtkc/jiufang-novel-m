import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_DELETED_NOTICE, CARD_DRAFT_KEPT_NOTICE } from '../copy/navMemoryCopy';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import { findNode } from '../data/demo';
import { readFileProject, writeFileProject } from '../db/projectFile';
import { openDesktopSampleMemoryDb, SAMPLE_BUILTIN_ROOT_CARD_ID } from '../db/testing/desktopSampleDb';
import { withoutNode } from '../domain/chapterOps';
import { saveProjects } from '../domain/outline';
import { LayoutProvider } from '../layout';
import type { LayoutMode } from '../layout/layoutMode';
import { CardsScreen } from '../screens/CardsScreen';
import {
  aliveNearId,
  caretToRestore,
  clearCardDraft,
  getCardDraft,
  markWriteChapterOpen,
  navMemoryKey,
  NAV_MEMORY_PREFIX,
  NAV_MEMORY_VERSION,
  nearIdsOf,
  parseNavMemory,
  patchCardsPlace,
  readCardsPlace,
  readNavMemory,
  readWritePlace,
  resetNavMemoryCache,
  resolveRememberedCard,
  saveCardDraft,
  saveWritePlace,
  scrollTopToRestore,
  selectionPatch,
  writeReturnPath,
  type NavMemoryStore,
} from './navMemory';
import {
  createState,
  getProjectCards,
  manuscriptSnapshotParts,
  reduce,
  SampleProvider,
  type Action,
  type SampleState,
} from './sampleStore';
import {
  endCardEdit,
  flushCardEdit,
  getCardEditSnapshot,
  registerCardEditFlush,
  resetCardEditSession,
  startCardEdit,
} from './writingCardEditSession';

/** 測試用的本機儲存替身（可模擬寫入失敗）。 */
function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const store = {
    data,
    failGet: false,
    failSet: false,
    getItem(key: string) {
      if (store.failGet) throw new Error('讀取失敗（測試）');
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key: string, value: string) {
      if (store.failSet) throw new Error('寫入失敗（測試）');
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null;
    },
    get length() {
      return Object.keys(data).length;
    },
  };
  return store;
}

const FOG = 'fog';
const SECOND = 'second';
const SHEN = '20000000-0000-4000-8000-000000000001'; // 【範例】沈雨晴（有子卡片）
const SHEN_CHILD = '20000000-0000-4000-8000-000000000002';
const LU = '20000000-0000-4000-8000-000000000004'; // 【範例】陸明遠

function renderCards(projectId: string, mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: mode },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/cards`] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/p/:projectId/cards', element: createElement(CardsScreen) }),
          ),
        ),
      ),
    ),
  );
}

function renderDrawer(projectId: string, resumeEditing = true): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(
        LayoutProvider,
        { initialMode: 'wide' },
        createElement(WritingCardsDrawer, { projectId, onClose: () => {}, resumeEditing }),
      ),
    ),
  );
}

let storage = memoryStorage();

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  resetNavMemoryCache();
  resetCardEditSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNavMemoryCache();
  resetCardEditSession();
});

/** 模擬關掉 App 再開：清掉這次開著時的記憶體與 store，只留本機儲存。 */
function reopenApp(): SampleState {
  resetNavMemoryCache();
  resetCardEditSession();
  return createState(new Date('2026-11-15T12:00:00Z'));
}

describe('WO-65：記憶的鍵名、版本與每本書分開', () => {
  it('WO-65：鍵名以書 id 結尾、內容帶版本號，寫入後從儲存替身讀得回來', () => {
    patchCardsPlace(FOG, { categoryId: 'character', cardId: SHEN }, storage);
    expect(navMemoryKey(FOG)).toBe(`${NAV_MEMORY_PREFIX}${FOG}`);
    expect(navMemoryKey(FOG)).toBe('jiufang-novel-m.nav-memory.v1:fog');
    const raw = JSON.parse(storage.data[navMemoryKey(FOG)]!);
    expect(raw.version).toBe(NAV_MEMORY_VERSION);
    resetNavMemoryCache();
    expect(readCardsPlace(FOG, storage)?.cardId).toBe(SHEN);
  });
});

describe('WO-65：資料集 → 寫作 → 資料集', () => {
  it('WO-65：同張卡片、分類、預覽與清單捲動、子卡片展開、編輯模式與未完成的字，重開 App 仍在', () => {
    // 在資料集看「沈雨晴」：捲動清單與預覽、收合子卡片、按編輯並打字（未按完成）
    patchCardsPlace(FOG, selectionPatch(null, 'character', SHEN));
    patchCardsPlace(FOG, { listScroll: 180, previewScroll: 420, categoryScroll: 30, collapsedIds: [SHEN_CHILD] });
    saveCardDraft(FOG, SHEN, { title: '【範例】沈雨晴（改到一半）', content: '暫存的內容：還沒按完成', color: '#61afef' });

    // 切到寫作再回來：重建 store、清掉記憶體，只從本機儲存讀回
    const state = reopenApp();
    const place = readCardsPlace(FOG);
    expect(place).toEqual({
      categoryId: 'character',
      cardId: SHEN,
      collapsedIds: [SHEN_CHILD],
      categoryScroll: 30,
      listScroll: 180,
      previewScroll: 420,
    });
    expect(getCardDraft(FOG, SHEN)?.content).toBe('暫存的內容：還沒按完成');

    // 資料集畫面：同一張卡片、仍在編輯畫面，未完成的字還在；正式卡片沒有這幾個字
    const html = renderCards(FOG, 'wide');
    expect(html).toContain('data-mode="edit"');
    expect(html).toContain('暫存的內容：還沒按完成');
    expect(html).toContain('【範例】沈雨晴（改到一半）');
    expect(html).toContain(`data-testid="card-row-${SHEN}"`);
    // 子卡片「隨身舊懷錶」記成收合：孫卡片不出現在清單
    expect(html).not.toContain('data-testid="card-row-20000000-0000-4000-8000-000000000003"');
    const official = getProjectCards(state, FOG).find((c) => c.id === SHEN)!;
    expect(official.title).toBe('【範例】沈雨晴');
    expect(official.content).not.toContain('暫存的內容');
  });

  it('WO-65：寬版右欄「看卡片」與資料集讀同一份記憶（選取與編輯中）', () => {
    patchCardsPlace(FOG, selectionPatch(null, 'character', LU));
    saveCardDraft(FOG, LU, { title: '【範例】陸明遠', content: '資料集打的暫存字', color: '#3C3F41' });
    resetNavMemoryCache();
    // 自己打開右欄：直接回到編輯中（暫存字在）
    startCardEdit();
    const opened = renderDrawer(FOG, true);
    expect(opened).toContain('資料集打的暫存字');
    expect(opened).toContain('data-card-editing="true"');
    resetCardEditSession();
    // 從資料集回寫作頁、右欄原本就開著：先回正文，卡片只顯示「還沒按完成」提示
    const entered = renderDrawer(FOG, false);
    expect(entered).toContain(CARD_DRAFT_KEPT_NOTICE);
    expect(entered).toContain('data-mode="preview"');
    expect(entered).not.toContain('資料集打的暫存字');
  });

  it('WO-65：換分類從清單頂端開始、換卡片從內容頂端開始，同一張不動', () => {
    const before = { categoryId: 'character', cardId: SHEN, collapsedIds: [], categoryScroll: 0, listScroll: 200, previewScroll: 300 };
    expect(selectionPatch(before, 'character', SHEN)).toEqual({ categoryId: 'character', cardId: SHEN });
    expect(selectionPatch(before, 'character', LU)).toEqual({ categoryId: 'character', cardId: LU, previewScroll: 0 });
    expect(selectionPatch(before, 'world', null)).toEqual({ categoryId: 'world', cardId: null, listScroll: 0, previewScroll: 0 });
  });
});

describe('WO-65：寫作 → 資料集 → 寫作', () => {
  it('WO-65：同一篇、同一個字與選取、同一捲動，離開前鍵盤狀態也記得；重開 App 仍在', () => {
    let state = createState(new Date('2026-11-15T12:00:00Z'));
    saveWritePlace(FOG, {
      chapterId: 'ch-2',
      chapterOpen: true,
      selectionStart: 37,
      selectionEnd: 42,
      scrollTop: 640,
      keyboard: true,
      nearIds: nearIdsOf(state.projects.find((p) => p.id === FOG)!.nodes, 'ch-2'),
    });
    state = reopenApp();
    const nodes = state.projects.find((p) => p.id === FOG)!.nodes;
    expect(writeReturnPath(FOG, nodes)).toBe('/p/fog/write/ch-2');
    const text = findNode(nodes, 'ch-2')!.content ?? '';
    expect(caretToRestore(readWritePlace(FOG), 'ch-2', text.length)).toEqual({
      selectionStart: 37,
      selectionEnd: 42,
      scrollTop: 640,
      scrollWidth: 0,
      scrollMax: 0,
      keyboard: true,
    });
    // 別章不套用；游標超過正文長度時放在最後
    expect(caretToRestore(readWritePlace(FOG), 'ch-1', 10)).toBeNull();
    expect(caretToRestore(readWritePlace(FOG), 'ch-2', 20)?.selectionStart).toBe(20);
  });

  it('WO-65：正文框寬度相同就放回同一捲動；寬度不同（目錄抽屜讓位、轉向）依比例停在差不多同一段', () => {
    saveWritePlace(FOG, { chapterId: 'ch-1', chapterOpen: true, selectionStart: 3, selectionEnd: 3, scrollTop: 4800, scrollWidth: 555, scrollMax: 5000, keyboard: false });
    reopenApp();
    const place = readWritePlace(FOG)!;
    expect(scrollTopToRestore(place, 555, 5000)).toBe(4800);
    expect(scrollTopToRestore(place, 452, 10000)).toBe(9600);
    expect(scrollTopToRestore({ scrollTop: 300, scrollWidth: 0, scrollMax: 0 }, 400, 900)).toBe(300);
  });

  it('WO-65：離開時鍵盤收著就記成收著；離開時停在目錄就回目錄', () => {
    saveWritePlace(FOG, { chapterId: 'ch-1', chapterOpen: true, selectionStart: 3, selectionEnd: 3, scrollTop: 0, keyboard: false });
    expect(readWritePlace(FOG)?.keyboard).toBe(false);
    const nodes = createState(new Date()).projects.find((p) => p.id === FOG)!.nodes;
    markWriteChapterOpen(FOG, false);
    expect(writeReturnPath(FOG, nodes)).toBe('/p/fog/write');
  });

  it('WO-65：寫作位置在切頁失焦前就以「按下當下」記下鍵盤狀態（正文元件）', () => {
    const source = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    expect(source).toContain("document.addEventListener('pointerdown', onPointerDown, true)");
    expect(source).toContain('document.activeElement === el || typingAtPointerRef.current');
  });
});

describe('WO-65：兩本書各記各的', () => {
  it('WO-65：位置、編輯中與相同卡片 id 的草稿都不串書，切回第一本仍可接續', () => {
    patchCardsPlace(FOG, selectionPatch(null, 'character', SHEN));
    saveCardDraft(FOG, SHEN, { title: '霧港的暫存', content: '只屬於霧港紀事', color: '#61afef' });
    saveWritePlace(FOG, { chapterId: 'ch-3', chapterOpen: true, selectionStart: 5, selectionEnd: 5, scrollTop: 90, keyboard: true });
    // 第二本範例書也有同一個卡片 id
    patchCardsPlace(SECOND, selectionPatch(null, 'world', null));
    saveCardDraft(SECOND, SHEN, { title: '第二本的暫存', content: '只屬於第二本', color: '#3C3F41' });

    reopenApp();
    expect(getCardDraft(FOG, SHEN)?.content).toBe('只屬於霧港紀事');
    expect(getCardDraft(SECOND, SHEN)?.content).toBe('只屬於第二本');
    expect(readCardsPlace(SECOND)?.cardId).toBeNull();
    expect(readWritePlace(SECOND)).toBeNull();

    // 換到第二本：資料集讀它自己的記憶，不顯示霧港的卡片或暫存字
    const second = renderCards(SECOND, 'wide');
    expect(second).not.toContain('只屬於霧港紀事');
    expect(second).not.toContain('data-mode="edit"');
    expect(second).toContain('data-testid="category-row-world"');
    // 切回第一本仍可接續
    const fog = renderCards(FOG, 'wide');
    expect(fog).toContain('只屬於霧港紀事');
    expect(fog).toContain('data-mode="edit"');
    expect(readWritePlace(FOG)?.chapterId).toBe('ch-3');

    clearCardDraft(SECOND, SHEN);
    expect(getCardDraft(FOG, SHEN)).not.toBeNull();
  });
});

describe('WO-65：壞資料與儲存失敗', () => {
  it('WO-65：沒有資料、壞 JSON、格式不符、舊版本都當作沒有記憶，不當機', () => {
    expect(parseNavMemory(null)).toEqual({ version: 1, write: null, cards: null, drafts: {} });
    expect(parseNavMemory('{壞掉')).toEqual({ version: 1, write: null, cards: null, drafts: {} });
    expect(parseNavMemory('[]').cards).toBeNull();
    expect(parseNavMemory(JSON.stringify({ version: 0, cards: { categoryId: 'world' } })).cards).toBeNull();
    const mixed = parseNavMemory(
      JSON.stringify({
        version: 1,
        write: { chapterId: 'ch-1', chapterOpen: 'yes', selectionStart: 1, selectionEnd: 1, scrollTop: 0, keyboard: false, nearIds: [] },
        cards: { categoryId: 'world', cardId: null, collapsedIds: [], categoryScroll: 0, listScroll: -5, previewScroll: 0 },
        drafts: { a: { title: 't', content: 'c', color: '#fff' }, b: { title: 1 }, c: 'x' },
      }),
    );
    expect(mixed.write).toBeNull();
    expect(mixed.cards).toBeNull();
    expect(Object.keys(mixed.drafts)).toEqual(['a']);

    // 本機儲存裡是壞資料：畫面照常打開（分類清單），不當機
    storage.data[navMemoryKey(FOG)] = '{"version":1,"cards":';
    resetNavMemoryCache();
    expect(() => renderCards(FOG, 'phone-portrait')).not.toThrow();
    expect(renderCards(FOG, 'phone-portrait')).toContain('data-testid="category-list"');
    storage.data[navMemoryKey(FOG)] = JSON.stringify({ version: 1, cards: 'abc', drafts: [] });
    resetNavMemoryCache();
    expect(renderDrawer(FOG)).toContain('data-testid="writing-cards-drawer"');
  });

  it('WO-65：本機儲存讀寫失敗時，目前打的字仍留在記憶體，不會消失', () => {
    const broken: NavMemoryStore = {
      getItem: () => {
        throw new Error('讀取失敗（測試）');
      },
      setItem: () => {
        throw new Error('寫入失敗（測試）');
      },
    };
    expect(() => saveCardDraft(FOG, SHEN, { title: 't', content: '寫不進去也要留著', color: '#fff' }, broken)).not.toThrow();
    expect(getCardDraft(FOG, SHEN, broken)?.content).toBe('寫不進去也要留著');
    storage.failSet = true;
    saveCardDraft(FOG, LU, { title: 't', content: '第二段字', color: '#fff' });
    expect(getCardDraft(FOG, LU)?.content).toBe('第二段字');
    expect(readNavMemory(FOG).drafts[SHEN]?.content).toBe('寫不進去也要留著');
  });
});

describe('WO-65：三種例外', () => {
  it('WO-65：記住的卡片被刪了：回原分類清單並提示可到最近刪除找回，不套到別張卡片', () => {
    // 程式產生的【範例】測試稿與兩張測試卡片
    const book = 'p-wo65-deleted';
    const card = (id: string, title: string, sort: number) => ({
      id,
      parent_id: null,
      category: 'character',
      title,
      content: `${title}的內容`,
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: sort,
    });
    let state = createState(new Date());
    state = reduce(state, { type: 'add-project', id: book, title: '【範例】刪卡測試稿', shape: 'novel' });
    state = reduce(state, {
      type: 'set-cards',
      projectId: book,
      cards: [card('wo65-keep', '【範例】留下的卡', 1), card('wo65-gone', '【範例】會被刪的卡', 2)],
    });
    patchCardsPlace(book, { ...selectionPatch(null, 'character', 'wo65-gone'), listScroll: 120 });
    saveCardDraft(book, 'wo65-gone', { title: '被刪卡片的暫存', content: '不可以跑到別張卡片', color: '#fff' });
    state = reduce(state, { type: 'delete-card', projectId: book, cardId: 'wo65-gone' });
    saveProjects(storage, state.projects.filter((p) => p.origin !== 'file'));
    const reopened = reopenApp();

    const ids = new Set(getProjectCards(reopened, book).map((c) => c.id));
    expect(ids.has('wo65-gone')).toBe(false);
    expect(resolveRememberedCard(readCardsPlace(book), ids)).toEqual({ categoryId: 'character', cardId: null, cardDeleted: true });
    expect(readCardsPlace(book)?.listScroll).toBe(120);
    const html = renderCards(book, 'phone-portrait');
    expect(html).toContain(CARD_DELETED_NOTICE);
    expect(html).toContain('data-testid="category-card-list"');
    expect(html).toContain('【範例】留下的卡');
    expect(html).not.toContain('不可以跑到別張卡片');
    expect(html).not.toContain('data-mode="edit"');
    // 看卡片面板也一樣
    const drawer = renderDrawer(book);
    expect(drawer).toContain(CARD_DELETED_NOTICE);
    expect(drawer).not.toContain('不可以跑到別張卡片');
    // 留下的那張卡片沒有被套上暫存
    expect(getProjectCards(reopened, book).find((c) => c.id === 'wo65-keep')!.title).toBe('【範例】留下的卡');
  });

  it('WO-65：記住的那一章被刪了：回目錄並停在仍存在的附近項目', () => {
    const state = createState(new Date());
    const nodes = state.projects.find((p) => p.id === FOG)!.nodes;
    saveWritePlace(FOG, {
      chapterId: 'ch-3',
      chapterOpen: true,
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      keyboard: true,
      nearIds: nearIdsOf(nodes, 'ch-3'),
    });
    expect(readWritePlace(FOG)?.nearIds).toEqual(['ch-2', 'ch-4', 'vol-1']);
    const after = withoutNode(nodes, 'ch-3')!;
    reopenApp();
    expect(writeReturnPath(FOG, after)).toBe('/p/fog/write');
    expect(aliveNearId(after, readWritePlace(FOG))).toBe('ch-2');
    const alsoPrevGone = withoutNode(after, 'ch-2')!;
    expect(aliveNearId(alsoPrevGone, readWritePlace(FOG))).toBe('ch-4');
  });

  it('WO-65：換書讀那本書自己的記憶，不沿用前一本', () => {
    patchCardsPlace(FOG, selectionPatch(null, 'world', '30000000-0000-4000-8000-000000000001'));
    saveWritePlace(FOG, { chapterId: 'ch-5', chapterOpen: true, selectionStart: 1, selectionEnd: 1, scrollTop: 0, keyboard: false });
    const secondNodes = createState(new Date()).projects.find((p) => p.id === SECOND)!.nodes;
    expect(writeReturnPath(SECOND, secondNodes)).toBe('/p/second/write');
    const html = renderCards(SECOND, 'phone-portrait');
    expect(html).toContain('data-testid="category-list"');
    expect(html).not.toContain('霧港地理與海潮氣候');
    // 資料集依書 id 重新掛載，不會先顯示上一本書再改掉
    const source = readFileSync(new URL('../screens/CardsScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<CardsScreenBody key={projectId} {...props} />');
  });
});

describe('WO-65：編輯中切走只暫存，按完成才寫回', () => {
  it('WO-65：切分頁、收起面板後再回來仍在編輯且字還在；未按完成前正式卡片與存檔寫回都不含暫存字', async () => {
    const db = await openDesktopSampleMemoryDb();
    try {
      const parsed = readFileProject(db.sql);
      let state = createState(new Date('2026-11-15T10:00:00Z'));
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };
      const bookId = 'wo65-sample-book';
      dispatch({
        type: 'attach-file',
        project: { id: bookId, dbKey: bookId, title: parsed.info.title, updatedLabel: '剛剛', bookGoal: 100000, nodes: parsed.tree, origin: 'file' },
        schedule: state.schedule,
        extras: { info: parsed.info, cards: parsed.cards, logs: parsed.logs },
      });
      const before = getProjectCards(state, bookId);
      const original = before.find((c) => c.id === SAMPLE_BUILTIN_ROOT_CARD_ID)!;

      // 面板的暫離出口：只暫存並結束編輯（照 WritingCardsDrawer 的登記方式）
      const typed = { title: original.title, content: `${original.content}【範例】暫存字WO65`, color: original.color };
      registerCardEditFlush((kind) => {
        saveCardDraft(bookId, original.id, typed);
        endCardEdit(kind);
      });
      startCardEdit();
      flushCardEdit('leave'); // 切分頁
      expect(getCardEditSnapshot().endKind).toBe('leave');
      startCardEdit();
      flushCardEdit('close'); // 收起面板
      expect(getCardEditSnapshot().editing).toBe(false);

      // 重新建立狀態：暫存仍在；正式卡片與其他卡片都沒變
      resetNavMemoryCache();
      expect(getCardDraft(bookId, original.id)?.content).toContain('暫存字WO65');
      expect(getProjectCards(state, bookId)).toEqual(before);

      // 存檔寫回的內容不含暫存字
      const project = state.projects.find((p) => p.id === bookId)!;
      const parts = manuscriptSnapshotParts(state, project);
      writeFileProject(db.sql, parts.info, project.nodes, parts.cards, parts.logs);
      const reread = readFileProject(db.sql);
      expect(JSON.stringify(reread.cards)).not.toContain('暫存字WO65');
      expect(JSON.stringify(state.projects)).not.toContain('暫存字WO65');
      expect(JSON.stringify(state.fileExtras)).not.toContain('暫存字WO65');

      // 按「完成」：只更新原卡片並清掉它的暫存
      dispatch({ type: 'update-card', projectId: bookId, cardId: original.id, patch: getCardDraft(bookId, original.id)! });
      clearCardDraft(bookId, original.id);
      const after = getProjectCards(state, bookId);
      expect(after.find((c) => c.id === original.id)!.content).toContain('暫存字WO65');
      expect(after.filter((c) => c.id !== original.id)).toEqual(before.filter((c) => c.id !== original.id));
      expect(getCardDraft(bookId, original.id)).toBeNull();
      const done = manuscriptSnapshotParts(state, state.projects.find((p) => p.id === bookId)!);
      writeFileProject(db.sql, done.info, project.nodes, done.cards, done.logs);
      expect(JSON.stringify(readFileProject(db.sql).cards)).toContain('暫存字WO65');
    } finally {
      db.close();
    }
  });

  it('WO-65：看卡片的暫離出口不呼叫正式更新；只有「完成」經 actions.updateCard 寫回', () => {
    const source = readFileSync(new URL('../components/WritingCardsDrawer.tsx', import.meta.url), 'utf8');
    const flushBlock = source.slice(source.indexOf('registerCardEditFlush((kind)'), source.indexOf('registerCardEditFlush(null)'));
    expect(flushBlock).toContain('saveCardDraft');
    expect(flushBlock).not.toContain('commit');
    expect(flushBlock).not.toContain('updateCard');
    expect(source).toContain("flushCardEdit('leave')");
  });
});

describe('WO-65：資料集按「返回」不掉字', () => {
  it('WO-65：編輯中按返回再打開同張卡片，標題、內容、顏色與編輯中都還在；先看另一張再回來也不誤套', () => {
    // 編輯中打字（每打一字就暫存），按「返回」回清單：只離開編輯畫面
    patchCardsPlace(FOG, selectionPatch(null, 'character', SHEN));
    saveCardDraft(FOG, SHEN, { title: '【範例】返回前的標題', content: '返回前打的內容', color: '#98c379' });
    patchCardsPlace(FOG, selectionPatch(readCardsPlace(FOG), 'character', null));
    // 先看另一張「陸明遠」
    patchCardsPlace(FOG, selectionPatch(readCardsPlace(FOG), 'character', LU));
    const other = renderCards(FOG, 'phone-portrait');
    expect(other).toContain('data-mode="preview"');
    expect(other).not.toContain('返回前打的內容');
    // 再打開原本那張
    patchCardsPlace(FOG, selectionPatch(readCardsPlace(FOG), 'character', SHEN));
    resetNavMemoryCache();
    const back = renderCards(FOG, 'phone-portrait');
    expect(back).toContain('data-mode="edit"');
    expect(back).toContain('返回前打的內容');
    expect(back).toContain('value="【範例】返回前的標題"');
    expect(back).toContain('#98c379');
    expect(getCardDraft(FOG, LU)).toBeNull();

    // 「返回」不走會重設欄位的取消路徑；「取消」才是明確放棄
    const source = readFileSync(new URL('../screens/CardsScreen.tsx', import.meta.url), 'utf8');
    const backBlock = source.slice(source.indexOf('const handleBackToCards'), source.indexOf('const handleBackToCategories'));
    expect(backBlock).not.toContain('clearCardDraft');
  });
});
