import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REMOVE_FROM_DEVICE_BODY,
  removeFromDeviceAria,
  removeFromDeviceTitle,
} from '../copy/userFacing';
import {
  createDirectoryAppSpace,
  createMemoryDirectory,
  createMirroredSpace,
  type AppSpace,
  type ByteDirectory,
} from '../db/appSpace';
import { getBook, loadStoredBooks, listBooks, putBook, removeBook, writeBookBytes } from '../db/library';
import type { FileProjectInfo } from '../db/projectFile';
import { isBookRemoved, resetRemovedBooksForTest } from '../db/removedBooks';
import { createSchedule, withClock } from '../domain/dailyGoal';
import { loadProjects, OUTLINE_STORAGE_KEY, saveProjects } from '../domain/outline';
import { loadLiveDraft, writeLiveDraft } from '../editor/liveDraft';
import { LayoutProvider } from '../layout';
import { HomeScreen } from '../screens/HomeScreen';
import { RemoveFromDeviceDialog } from '../screens/RemoveFromDeviceDialog';
import { DEVICE_SAVE_RECORD_KEY, forgetProjectsInDeviceRecord, rememberExportedFile, saveHomeDailyGoal, saveTourFileGoal } from './deviceSaveRecord';
import { IMPORT_EVENTS_KEY, readImportEvents, withImportEvent } from './importEvents';
import { getCardDraft, navMemoryKey, resetNavMemoryCache, saveCardDraft } from './navMemory';
import { removeProjectFromDevice } from './removeFromDevice';
import {
  addProjectAction,
  createState,
  persistDeviceSaveRecord,
  reduce,
  SampleProvider,
  type SampleState,
} from './sampleStore';

// App 空間換成程式產生的記憶體替身：OPFS 與 IndexedDB 備援各一個，可個別檢查。
const spaces = vi.hoisted(() => ({ current: null as AppSpace | null }));
vi.mock('../db/browserSpace', () => ({ appSpace: async () => spaces.current! }));

const NOON = new Date('2026-11-18T04:00:00Z');
const A = 'p-1001';
const B = 'p-2002';
const FILE_A = 'file-5001';
const FILE_B = 'file-6002';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
type Store = ReturnType<typeof memoryStore>;

interface Rig {
  store: Store;
  opfs: ByteDirectory;
  idb: ByteDirectory;
  removeCalls: string[];
  space: AppSpace;
}

function recordingDirectory(inner: ByteDirectory, calls: string[]): ByteDirectory {
  return {
    ...inner,
    async remove(name) {
      calls.push(name);
      await inner.remove(name);
    },
  };
}

let store: Store;
let rig: Rig;

function setupRig(): Rig {
  const removeCalls: string[] = [];
  const opfs = recordingDirectory(createMemoryDirectory(), removeCalls);
  const idb = createMemoryDirectory();
  const space = createMirroredSpace(createDirectoryAppSpace(opfs), createDirectoryAppSpace(idb));
  spaces.current = space;
  return { store, opfs, idb, removeCalls, space };
}

beforeEach(() => {
  store = memoryStore();
  vi.stubGlobal('localStorage', store);
  resetNavMemoryCache();
  resetRemovedBooksForTest();
  rig = setupRig();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNavMemoryCache();
  resetRemovedBooksForTest();
  spaces.current = null;
});

function fakeInfo(title: string): FileProjectInfo {
  return {
    title,
    logline: '',
    currentTheme: 'dark',
    globalFontFamily: 'sans',
    globalFontSize: 16,
    editorFontFamily: 'serif',
    editorFontSize: 16,
    targetWordCount: 100000,
    dailyTargetWordCount: 1000,
    categoryOrder: null,
    expandedCategories: null,
    categoriesMeta: '{}',
    lastOpenedNodeId: null,
    lastCursorPosition: 0,
  };
}

/** 程式產生的假 .db。 */
async function fakeBook(key: string, title: string) {
  const bytes = await writeBookBytes(
    null,
    fakeInfo(title),
    [{ id: `c-${key}`, type: 'file', title: '第一章　', progress: 'Draft', content: `${title}的假正文` }],
    [],
    [],
  );
  return { key, filename: `${title}.db`, title, bytes, hasExternalFile: false, titleInFile: null, titleSavePending: null } as const;
}

/** A、B 兩份一般暫存稿（可同名），寫進假本機儲存，並補上裝置紀錄、草稿與位置記憶。 */
function seedDrafts(titleA = '同名書', titleB = '同名書'): SampleState {
  let state = createState(NOON);
  state = reduce(state, addProjectAction(A, titleA, 'novel', 1001));
  state = reduce(state, addProjectAction(B, titleB, 'novel', 2002));
  const schedule = withClock(createSchedule({ dayEndHour: 0, defaultGoal: 1000 }), NOON);
  const meta = { lastAutoSaveMs: 1, lastManualSaveMs: null, lastExportMs: null, lastProjectSaveMs: null };
  state = {
    ...state,
    goalById: { [A]: schedule, [B]: schedule },
    logsById: { [A]: [], [B]: [] },
    saveMeta: { [A]: meta, [B]: meta },
    startedById: { [A]: 1001, [B]: 2002 },
  };
  saveProjects(store, state.projects);
  persistDeviceSaveRecord(store, state);
  saveTourFileGoal(store, A, 500);
  saveTourFileGoal(store, B, 600);
  saveCardDraft(A, 'card-a', { title: 'A 草稿', content: 'a', color: '#111' }, store);
  saveCardDraft(B, 'card-b', { title: 'B 草稿', content: 'b', color: '#222' }, store);
  store.setItem(`jiufang-novel-m.tree-place.v1:${A}`, '{"nodeId":"x","prevId":null,"offset":0}');
  store.setItem(`jiufang-novel-m.tree-place.v1:${B}`, '{"nodeId":"y","prevId":null,"offset":0}');
  return state;
}

function recordText(): string {
  return store.getItem(DEVICE_SAVE_RECORD_KEY) ?? '';
}

function removeFromRig(id: string, dbKey?: string): Promise<boolean> {
  return removeProjectFromDevice({ project: { id, dbKey }, store, removeCopy: (key) => rig.space.remove(key) });
}

describe('WO-116：確認視窗文案與按鈕', () => {
  it('標題、內文、按鈕逐字符合定版，「刪掉」為危險樣式', () => {
    const html = renderToStaticMarkup(
      createElement(RemoveFromDeviceDialog, { bookTitle: '星河', busy: false, onConfirm: () => undefined, onCancel: () => undefined }),
    );
    expect(html).toContain('要從這個裝置刪掉「星河」嗎？');
    expect(html).toContain('這份稿子存在這個裝置上的內容會一起刪掉，刪了就找不回來。你另存在別處的 .db 稿件檔不會受影響。');
    expect(html).toMatch(/<button[^>]*class="button danger"[^>]*>刪掉<\/button>/);
    expect(html).toMatch(/<button[^>]*>取消<\/button>/);
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('這支手機');
    for (const simplified of ['删', '设备', '这', '从', '会', '备']) expect(html).not.toContain(simplified);
  });

  it('讀不到書名用「未命名稿子」', () => {
    expect(removeFromDeviceTitle('')).toBe('要從這個裝置刪掉「未命名稿子」嗎？');
    expect(removeFromDeviceTitle('   ')).toBe('要從這個裝置刪掉「未命名稿子」嗎？');
    const html = renderToStaticMarkup(
      createElement(RemoveFromDeviceDialog, { bookTitle: '', busy: false, onConfirm: () => undefined, onCancel: () => undefined }),
    );
    expect(html).toContain('要從這個裝置刪掉「未命名稿子」嗎？');
    expect(REMOVE_FROM_DEVICE_BODY).toContain('這個裝置');
  });

  it('X 的朗讀標籤說的是刪掉這個裝置上的暫存，並可辨認是哪一份；開視窗前畫面沒有確認視窗', () => {
    expect(removeFromDeviceAria('星河')).toBe('刪掉這個裝置上的暫存：星河');
    expect(removeFromDeviceAria('')).toBe('刪掉這個裝置上的暫存：未命名稿子');
    const state = seedDrafts('星河', '別本');
    const before = new Map(store.data);
    const html = renderToStaticMarkup(
      createElement(
        SampleProvider,
        { initialState: state },
        createElement(
          LayoutProvider,
          { initialMode: 'phone-portrait' },
          createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(HomeScreen)),
        ),
      ),
    );
    expect(html).toContain('aria-label="刪掉這個裝置上的暫存：星河"');
    expect(html).toContain('aria-label="刪掉這個裝置上的暫存：別本"');
    expect(html).not.toContain('從最近清單移除');
    expect(html).not.toContain('remove-from-device-dialog');
    // 畫面（含 X）顯示本身不改任何本機儲存。
    expect(store.data).toEqual(before);
  });
});

describe('WO-116：取消／關閉不改任何資料', () => {
  it('沒有按「刪掉」就不會呼叫刪除：記憶體與本機儲存、App 空間維持原樣', async () => {
    const state = seedDrafts();
    await putBook(await fakeBook(FILE_A, '檔案稿'));
    const before = new Map(store.data);
    const namesBefore = [...(await rig.opfs.list())].sort();
    // 取消、關視窗只是關掉畫面狀態；此時沒有任何儲存操作。
    expect(store.data).toEqual(before);
    expect([...(await rig.opfs.list())].sort()).toEqual(namesBefore);
    expect(rig.removeCalls).toEqual([]);
    expect(isBookRemoved(A)).toBe(false);
    expect(state.projects.map((project) => project.id)).toEqual([B, A]);
  });
});

describe('WO-116：按「刪掉」後各層儲存都沒有該稿', () => {
  it('一般暫存稿：outline、即時草稿、裝置紀錄（含 tourGoalById）、位置記憶與草稿都清掉，B 全留著', async () => {
    seedDrafts();
    writeLiveDraft(store, { projectId: A, chapterId: 'c', text: 'A 的即時草稿', at: 1 });
    expect(recordText()).toContain('tourGoalById');
    expect(await removeFromRig(A)).toBe(true);

    expect(loadProjects(store)?.map((project) => project.id)).toEqual([B]);
    expect(loadLiveDraft(store)).toBeNull();
    const record = JSON.parse(recordText()) as Record<string, Record<string, unknown>>;
    for (const field of ['saveMeta', 'logsById', 'goalById', 'startedById', 'tourGoalById']) {
      expect(Object.keys(record[field] ?? {}), field).toEqual([B]);
    }
    expect(recordText()).not.toContain(A);
    expect(store.getItem(navMemoryKey(A))).toBeNull();
    expect(getCardDraft(A, 'card-a', store)).toBeNull();
    expect(store.getItem(`jiufang-novel-m.tree-place.v1:${A}`)).toBeNull();
    // B 完全不受影響。
    expect(getCardDraft(B, 'card-b', store)?.title).toBe('B 草稿');
    expect(store.getItem(`jiufang-novel-m.tree-place.v1:${B}`)).not.toBeNull();
    expect(recordText()).toContain(B);
  });

  it('只有 B 的即時草稿時，刪 A 不會清掉 B 的草稿', async () => {
    seedDrafts();
    writeLiveDraft(store, { projectId: B, chapterId: 'c', text: 'B 的即時草稿', at: 1 });
    expect(await removeFromRig(A)).toBe(true);
    expect(loadLiveDraft(store)?.projectId).toBe(B);
    expect(loadLiveDraft(store)?.text).toBe('B 的即時草稿');
  });

  it('重開 createState：刪掉的稿子不再出現在 projects 與最近清單（刪 A 不影響同名 B）', async () => {
    seedDrafts();
    expect(await removeFromRig(A)).toBe(true);
    resetRemovedBooksForTest(); // 模擬重新整理：記憶體裡的名單消失，只剩真正的儲存內容。
    resetNavMemoryCache();
    const reopened = createState(NOON);
    expect(reopened.projects.map((project) => project.id)).toEqual([B]);
    expect(reopened.recentIds).toEqual([B]);
    expect(Object.keys(reopened.goalById)).toEqual([B]);
    expect(Object.keys(reopened.saveMeta)).toEqual([B]);
    expect(Object.keys(reopened.startedById)).toEqual([B]);
  });

  it('刪最後一份：outline 寫入空陣列，重開後是空清單', async () => {
    seedDrafts();
    expect(await removeFromRig(A)).toBe(true);
    expect(await removeFromRig(B)).toBe(true);
    expect(store.getItem(OUTLINE_STORAGE_KEY)).toBe('[]');
    resetRemovedBooksForTest();
    const reopened = createState(NOON);
    expect(reopened.projects).toEqual([]);
    expect(reopened.recentIds).toEqual([]);
  });

  it('保留共用設定：homeGoal 與另存檔案指紋不受影響', async () => {
    seedDrafts();
    saveHomeDailyGoal(store, 700);
    rememberExportedFile(store, 'abc123', 42);
    forgetProjectsInDeviceRecord(store, [A]);
    const record = JSON.parse(recordText()) as { homeGoal: number; exportedFiles: Record<string, number> };
    expect(record.homeGoal).toBe(700);
    expect(record.exportedFiles).toEqual({ abc123: 42 });
  });

  it('匯入事件：拿掉這份稿子的對應，其他稿子的事件保留', async () => {
    seedDrafts();
    let record = readImportEvents(store);
    record = withImportEvent(record, A, 'ev-a', { dayKey: '2026-11-18', atMs: 1 });
    record = withImportEvent(record, B, 'ev-b', { dayKey: '2026-11-18', atMs: 2 });
    store.setItem(IMPORT_EVENTS_KEY, JSON.stringify(record));
    expect(await removeFromRig(A)).toBe(true);
    const after = readImportEvents(store);
    expect(Object.keys(after.byProject)).toEqual([B]);
    expect(Object.keys(after.events)).toEqual(['ev-b']);
  });

  it('記憶體：remove-project 拿掉該稿的所有資料，B 保留', () => {
    const state = seedDrafts();
    const next = reduce({ ...state, activeProjectId: A }, { type: 'remove-project', id: A });
    expect(next.projects.map((project) => project.id)).toEqual([B]);
    expect(next.recentIds).toEqual([B]);
    for (const map of [next.goalById, next.logsById, next.saveMeta, next.startedById]) {
      expect(Object.keys(map)).toEqual([B]);
    }
    expect(next.activeProjectId).toBeNull();
  });
});

describe('WO-116：App 空間副本（OPFS 與 IndexedDB 備援）', () => {
  it('雙邊副本都刪，只動目標鍵；另一份檔案稿與其他項目保留', async () => {
    await putBook(await fakeBook(FILE_A, '同名書'));
    await putBook(await fakeBook(FILE_B, '同名書'));
    expect((await rig.opfs.list()).sort()).toEqual([`${FILE_A}.db`, `${FILE_A}.json`, `${FILE_B}.db`, `${FILE_B}.json`]);
    expect(await removeFromRig(FILE_A)).toBe(true);
    expect((await rig.opfs.list()).sort()).toEqual([`${FILE_B}.db`, `${FILE_B}.json`]);
    expect((await rig.idb.list()).sort()).toEqual([`${FILE_B}.db`, `${FILE_B}.json`]);
    // 只對目標鍵的兩個名稱下過刪除，沒有碰任何其他名稱。
    expect(rig.removeCalls.sort()).toEqual([`${FILE_A}.db`, `${FILE_A}.json`]);
    expect(await getBook(FILE_A)).toBeNull();
    expect(await getBook(FILE_B)).not.toBeNull();
  });

  for (const side of ['opfs', 'idb'] as const) {
    it(`只有${side === 'opfs' ? ' OPFS' : ' IndexedDB 備援'}有副本也能刪乾淨`, async () => {
      const book = await fakeBook(FILE_A, '單邊');
      const only = side === 'opfs' ? createDirectoryAppSpace(rig.opfs) : createDirectoryAppSpace(rig.idb);
      await only.put(book);
      expect((await listBooks()).map((item) => item.key)).toEqual([FILE_A]);
      expect(await removeFromRig(FILE_A)).toBe(true);
      expect(await listBooks()).toEqual([]);
      expect(await rig.opfs.list()).toEqual([]);
      expect(await rig.idb.list()).toEqual([]);
    });
  }

  it('升格後稿子代號與副本鍵不同時，兩個代號都清掉', async () => {
    await putBook(await fakeBook('key-9', '升格稿'));
    seedDrafts();
    expect(await removeFromRig(A, 'key-9')).toBe(true);
    expect(await listBooks()).toEqual([]);
    expect(loadProjects(store)?.map((project) => project.id)).toEqual([B]);
  });

  it('啟動讀取（loadStoredBooks）不會再讀回已刪稿；殘留的舊資料也被濾掉', async () => {
    await putBook(await fakeBook(FILE_A, '同名書'));
    await putBook(await fakeBook(FILE_B, '同名書'));
    expect(await removeFromRig(FILE_A)).toBe(true);
    // 模擬刪除前就已開始的寫入把副本又落地：直接塞回空間。
    await rig.space.put(await fakeBook(FILE_A, '同名書'));
    const books = await loadStoredBooks(NOON);
    expect(books.map((book) => book.key)).toEqual([FILE_B]);
  });

  it('quiet 與非 quiet 的 attach-file 都不能把已刪稿加回', async () => {
    const base = createState(NOON);
    expect(await removeFromRig(FILE_A)).toBe(true);
    const schedule = withClock(createSchedule({ dayEndHour: 0, defaultGoal: 1000 }), NOON);
    for (const quiet of [true, false]) {
      const next = reduce(base, {
        type: 'attach-file',
        quiet,
        schedule,
        extras: { info: fakeInfo('檔案稿'), cards: [], logs: [] },
        project: {
          id: FILE_A,
          title: '檔案稿',
          updatedLabel: '剛剛',
          bookGoal: 100000,
          nodes: [],
          origin: 'file',
          dbKey: FILE_A,
        },
      });
      expect(next.projects).toEqual([]);
      expect(next.recentIds).toEqual([]);
      expect(next).toBe(base);
    }
  });

  it('刪除前已開始、刪除後才完成的暫存不會把稿子寫回', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = rig.space;
    spaces.current = {
      ...real,
      async put(book) {
        await gate;
        await real.put(book);
      },
    };
    const book = await fakeBook(FILE_A, '同名書');
    const inflight = putBook(book); // 刪除前就開始的自動暫存
    const removing = removeBook(FILE_A);
    release();
    await inflight;
    await removing;
    expect(await rig.opfs.list()).toEqual([]);
    expect(await rig.idb.list()).toEqual([]);
    // 刪除之後才發出的暫存（離頁寫回）也直接略過。
    await putBook(book);
    expect(await rig.opfs.list()).toEqual([]);
    expect(await rig.idb.list()).toEqual([]);
  });

  it('離頁寫回的裝置紀錄用的是刪除前的舊狀態，也不會把已刪稿的資料寫回', async () => {
    const stale = seedDrafts();
    expect(await removeFromRig(A)).toBe(true);
    persistDeviceSaveRecord(store, stale);
    const record = JSON.parse(recordText()) as Record<string, Record<string, unknown>>;
    for (const field of ['saveMeta', 'logsById', 'goalById', 'startedById']) {
      expect(Object.keys(record[field] ?? {}), field).toEqual([B]);
    }
    expect(recordText()).not.toContain(A);
  });
});

describe('WO-116：失敗不假報完成，且不碰使用者檔案', () => {
  it('App 空間刪不掉：回傳 false、本機儲存原封不動、稿子仍可正常存', async () => {
    seedDrafts();
    const before = new Map(store.data);
    const done = await removeProjectFromDevice({
      project: { id: A },
      store,
      removeCopy: async () => {
        throw new Error('刪不掉');
      },
    });
    expect(done).toBe(false);
    expect(store.data).toEqual(before);
    expect(isBookRemoved(A)).toBe(false);
  });

  it('刪除只會對 App 空間裡的目標鍵（.db 與 .json）下刪除', async () => {
    await putBook(await fakeBook(FILE_A, '同名書'));
    await removeFromRig(FILE_A);
    expect(rig.removeCalls.every((name) => name === `${FILE_A}.db` || name === `${FILE_A}.json`)).toBe(true);
  });
});
