import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPLACE_OLD_REMOVE_FAILED } from '../copy/duplicateOpenCopy';
import {
  createDirectoryAppSpace,
  createMemoryDirectory,
  createMirroredSpace,
  type AppSpace,
} from '../db/appSpace';
import type { TargetStore } from '../db/fileTarget';
import { getBook, listBooks, writeBookBytes } from '../db/library';
import type { FileProjectInfo } from '../db/projectFile';
import { resetRemovedBooksForTest } from '../db/removedBooks';
import type { DuplicateChoice, DuplicateOpenInfo } from '../domain/duplicateOpen';
import { LIVE_DRAFT_KEY, loadLiveDraft, writeLiveDraft } from '../editor/liveDraft';
import {
  IMPORT_EVENTS_KEY,
  importCountOf,
  readExportEvents,
  readImportEvents,
  withImportEvent,
} from './importEvents';
import { createDeviceOnlyProbe } from './deviceOnlyContent';
import { resetNavMemoryCache, saveCardDraft } from './navMemory';
import { removeProjectFromDevice } from './removeFromDevice';
import {
  createState,
  linkImportEventsToBytes,
  openDatabaseManuscript,
  projectExportEventsOf,
  projectImportEventsOf,
  recordFullTextExport,
  reduce,
  type Action,
  type SampleState,
} from './sampleStore';

// App 空間換成程式產生的記憶體替身（同 WO-116 測試）。
const spaces = vi.hoisted(() => ({ current: null as AppSpace | null }));
vi.mock('../db/browserSpace', () => ({ appSpace: async () => spaces.current! }));

const UUID_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UUID_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const BASE_MS = Date.parse('2026-11-27T04:00:00Z');

function memoryStore() {
  const data = new Map<string, string>();
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
    lastOpenedNodeId: 'c1',
    lastCursorPosition: 0,
  };
}

/** 程式產生的範例 .db；有給 uuid 就寫入身分證，沒給就是還沒有身分證的舊式檔。 */
async function sampleDb(
  title: string,
  text: string,
  uuid?: string,
  /** 檔內附加表帶的匯入／匯出事件（事件代號 → 事件）。 */
  fileEvents?: {
    imports?: Record<string, { dayKey: string; atMs: number }>;
    exports?: Record<string, { dayKey: string; atMs: number }>;
  },
): Promise<Uint8Array> {
  return writeBookBytes(
    null,
    fakeInfo(title),
    [{ id: 'c1', type: 'file', title: '第一章　', progress: 'Draft', content: text }],
    [],
    [],
    fileEvents?.imports,
    fileEvents?.exports,
    uuid ? { bookUuid: uuid, createdAtMs: BASE_MS, originBookUuid: null } : undefined,
  );
}

let store: ReturnType<typeof memoryStore>;
let space: AppSpace;
let state: SampleState;
let dispatched: Action[];
let saveCalls: string[];
let tick: number;

const targets: TargetStore = {
  async save(key) {
    saveCalls.push(key);
  },
  async load() {
    return null;
  },
  async remove() {},
};

beforeEach(() => {
  store = memoryStore();
  vi.stubGlobal('localStorage', store);
  resetNavMemoryCache();
  resetRemovedBooksForTest();
  space = createMirroredSpace(
    createDirectoryAppSpace(createMemoryDirectory()),
    createDirectoryAppSpace(createMemoryDirectory()),
  );
  spaces.current = space;
  state = createState(new Date(BASE_MS));
  dispatched = [];
  saveCalls = [];
  tick = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNavMemoryCache();
  resetRemovedBooksForTest();
  spaces.current = null;
});

const dispatch = (action: Action) => {
  dispatched.push(action);
  state = reduce(state, action);
};

/** 與 provider 的 removeFromDevice 同一條流程（removeProjectFromDevice＋remove-project）。 */
async function removeOld(id: string): Promise<boolean> {
  const project = state.projects.find((item) => item.id === id);
  if (!project) return false;
  const done = await removeProjectFromDevice({
    project,
    store,
    removeCopy: (key) => space.remove(key),
    removeTarget: async () => undefined,
  });
  if (!done) return false;
  dispatch({ type: 'remove-project', id });
  return true;
}

function openOnce(
  filename: string,
  bytes: Uint8Array,
  hooks?: {
    ask?: (info: DuplicateOpenInfo) => Promise<DuplicateChoice>;
    removeOld?: (id: string) => Promise<boolean>;
  },
) {
  tick += 1;
  return openDatabaseManuscript({
    filename,
    bytes,
    diskFile: null,
    dispatch,
    env: { targets },
    store,
    now: new Date(BASE_MS + tick * 1000),
    ...(hooks?.ask
      ? {
          getState: () => state,
          askDuplicate: hooks.ask,
          removeOld: hooks.removeOld ?? removeOld,
          // 與 provider 相同：探測這個裝置獨有的卡片草稿與即時草稿。
          deviceOnly: createDeviceOnlyProbe(store),
        }
      : {}),
  });
}

describe('WO-143：同一份範例 .db 連開兩次', () => {
  it('第二次一定問；回答之前 App 空間、state、targets 都沒有新增', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文甲', UUID_A);
    const first = await openOnce('道劍.db', bytes, { ask: async () => 'cancel' });
    expect(first).not.toBeNull();
    expect(await listBooks()).toHaveLength(1);
    expect(saveCalls).toHaveLength(1);

    const seen: { books: number; projects: number; saves: number; info: DuplicateOpenInfo | null } = {
      books: -1,
      projects: -1,
      saves: -1,
      info: null,
    };
    const second = await openOnce('道劍.db', bytes, {
      ask: async (info) => {
        seen.books = (await listBooks()).length;
        seen.projects = state.projects.length;
        seen.saves = saveCalls.length;
        seen.info = info;
        return 'cancel';
      },
    });
    expect(second).toBeNull();
    expect(seen.books).toBe(1);
    expect(seen.projects).toBe(1);
    expect(seen.saves).toBe(1);
    expect(seen.info?.kind).toBe('same-book');
    expect(seen.info?.existingId).toBe(first!.id);
    expect(seen.info?.contentDiffers).toBe(false);
  });

  it('沒傳 askDuplicate：維持舊行為，會多一份', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文甲', UUID_A);
    await openOnce('道劍.db', bytes);
    await openOnce('道劍.db', bytes);
    expect(await listBooks()).toHaveLength(2);
    expect(state.projects).toHaveLength(2);
  });

  it('open-existing：仍只有一份，回傳原本那份，不呼叫 targets.save，並讓它成為目前的稿子', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文甲', UUID_A);
    const first = (await openOnce('道劍.db', bytes))!;
    state = { ...state, activeProjectId: null };
    const second = await openOnce('道劍.db', bytes, { ask: async () => 'open-existing' });
    expect(second).toEqual({ id: first.id, chapterId: 'c1' });
    expect(await listBooks()).toHaveLength(1);
    expect(state.projects).toHaveLength(1);
    expect(saveCalls).toHaveLength(1);
    expect(state.activeProjectId).toBe(first.id);
  });

  it('cancel：App 空間、state、targets、本機儲存完全沒變', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文甲', UUID_A);
    await openOnce('道劍.db', bytes);
    const before = {
      store: new Map(store.data),
      projects: state.projects,
      books: (await listBooks()).map((book) => book.key),
      saves: [...saveCalls],
      actions: dispatched.length,
    };
    const result = await openOnce('道劍.db', bytes, { ask: async () => 'cancel' });
    expect(result).toBeNull();
    expect(store.data).toEqual(before.store);
    expect(state.projects).toBe(before.projects);
    expect((await listBooks()).map((book) => book.key)).toEqual(before.books);
    expect(saveCalls).toEqual(before.saves);
    expect(dispatched).toHaveLength(before.actions);
  });
});

describe('WO-143：replace（用剛選的檔取代）', () => {
  it('先開新的、再刪舊的；最後只有一份且內容是剛選的檔，舊的副本、即時草稿、事件對應都清掉', async () => {
    const oldBytes = await sampleDb('【範例】道劍', '舊正文', UUID_A);
    const newBytes = await sampleDb('【範例】道劍', '新正文', UUID_A);
    const first = (await openOnce('道劍.db', oldBytes))!;
    // 舊那份有還沒存回檔案的改動（旗標存在 saveMeta）、即時草稿與事件。
    state = {
      ...state,
      saveMeta: {
        ...state.saveMeta,
        [first.id]: {
          lastAutoSaveMs: 1,
          lastManualSaveMs: null,
          lastExportMs: null,
          lastProjectSaveMs: null,
          dirtySinceFileSave: true,
        },
      },
    };
    writeLiveDraft(store, { projectId: first.id, chapterId: 'c1', text: '舊的即時草稿', at: 1 });
    store.setItem(
      IMPORT_EVENTS_KEY,
      JSON.stringify(withImportEvent(readImportEvents(store), first.id, 'ev-old', { dayKey: '2026-11-27', atMs: 1 })),
    );
    state = { ...state, importEvents: readImportEvents(store) };

    const order: string[] = [];
    let info = null as DuplicateOpenInfo | null;
    const second = (await openOnce('道劍.db', newBytes, {
      ask: async (value) => {
        info = value;
        return 'replace';
      },
      removeOld: async (id) => {
        // 呼叫刪舊的當下，新的必須已經開好。
        order.push(`removeOld:${id}:projects=${state.projects.map((p) => p.id).join(',')}`);
        return removeOld(id);
      },
    }))!;

    expect(info!.hasUnsavedChanges).toBe(true);
    expect(info!.contentDiffers).toBe(true);
    expect(second.id).not.toBe(first.id);
    expect(order).toEqual([`removeOld:${first.id}:projects=${second.id},${first.id}`]);
    expect(state.projects.map((p) => p.id)).toEqual([second.id]);
    expect(state.projects[0]!.nodes[0]!.content).toBe('新正文');
    expect(state.activeProjectId).toBe(second.id);
    expect((await listBooks()).map((book) => book.key)).toEqual([second.id]);
    expect(await getBook(first.id)).toBeNull();
    expect(loadLiveDraft(store)).toBeNull();
    expect(store.getItem(LIVE_DRAFT_KEY)).toBeNull();
    expect(readImportEvents(store).byProject[first.id]).toBeUndefined();
    expect(state.importEvents.byProject[first.id]).toBeUndefined();
    expect(state.saveMeta[first.id]).toBeUndefined();
  });

  it('沒有未存回檔案的改動時 hasUnsavedChanges 為假', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文', UUID_A);
    await openOnce('道劍.db', bytes);
    let info = null as DuplicateOpenInfo | null;
    await openOnce('道劍.db', bytes, {
      ask: async (value) => {
        info = value;
        return 'cancel';
      },
    });
    expect(info!.hasUnsavedChanges).toBe(false);
  });

  it('舊的刪除失敗：新的保留、兩份都在、跳新提示，不重試', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文', UUID_A);
    const first = (await openOnce('道劍.db', bytes))!;
    const removeFails = vi.fn(async () => false);
    const second = (await openOnce('道劍.db', bytes, { ask: async () => 'replace', removeOld: removeFails }))!;
    expect(removeFails).toHaveBeenCalledTimes(1);
    expect(state.projects.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    expect(await listBooks()).toHaveLength(2);
    const toasts = dispatched.filter((a) => a.type === 'toast');
    expect(toasts.at(-1)).toMatchObject({ message: REPLACE_OLD_REMOVE_FAILED });
  });

  it('匯入事件次數：同內容取代後事件由新稿承接，次數不變、不重複算', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文', UUID_A);
    const first = (await openOnce('道劍.db', bytes))!;
    store.setItem(
      IMPORT_EVENTS_KEY,
      JSON.stringify(withImportEvent(readImportEvents(store), first.id, 'ev-1', { dayKey: '2026-11-27', atMs: 1 })),
    );
    await linkImportEventsToBytes(store, first.id, bytes);
    state = { ...state, importEvents: readImportEvents(store) };
    expect(importCountOf(state.importEvents, first.id)).toBe(1);

    const second = (await openOnce('道劍.db', bytes, { ask: async () => 'replace' }))!;
    const record = readImportEvents(store);
    expect(importCountOf(record, second.id)).toBe(1);
    expect(importCountOf(state.importEvents, second.id)).toBe(1);
    expect(record.byProject[first.id]).toBeUndefined();
    expect(Object.keys(record.events)).toEqual(['ev-1']);
  });

  it('不同內容取代：別本的事件不受影響，舊檔指紋仍留著（之後開回舊檔還能接回）', async () => {
    const oldBytes = await sampleDb('【範例】道劍', '舊正文', UUID_A);
    const newBytes = await sampleDb('【範例】道劍', '新正文', UUID_A);
    const otherBytes = await sampleDb('【範例】別本', '別本正文', UUID_B);
    const other = (await openOnce('別本.db', otherBytes))!;
    const first = (await openOnce('道劍.db', oldBytes))!;
    let record = readImportEvents(store);
    record = withImportEvent(record, first.id, 'ev-old', { dayKey: '2026-11-27', atMs: 1 });
    record = withImportEvent(record, other.id, 'ev-other', { dayKey: '2026-11-27', atMs: 2 });
    store.setItem(IMPORT_EVENTS_KEY, JSON.stringify(record));
    await linkImportEventsToBytes(store, first.id, oldBytes);
    state = { ...state, importEvents: readImportEvents(store) };

    const second = (await openOnce('道劍.db', newBytes, { ask: async () => 'replace' }))!;
    const after = readImportEvents(store);
    expect(importCountOf(after, other.id)).toBe(1);
    // 審查必修 4：刪舊稿前已把舊代號的事件合併到新代號，次數不減少。
    expect(importCountOf(after, second.id)).toBe(1);
    expect(importCountOf(state.importEvents, second.id)).toBe(1);
    expect(after.byProject[first.id]).toBeUndefined();
    // 事件仍被舊檔指紋引用，沒有遺失。
    expect(Object.keys(after.events).sort()).toEqual(['ev-old', 'ev-other']);
    expect(Object.values(after.byFile).flat()).toContain('ev-old');
  });
});

describe('WO-143 審查必修 2：另存分枝不是同一本', () => {
  it('不同的已寫入身分證、相同檔名、相同書名：問的是 same-title（不提供取代）', async () => {
    const a = await sampleDb('【範例】道劍', '原稿', UUID_A);
    const branch = await sampleDb('【範例】道劍', '分枝', UUID_B);
    await openOnce('道劍.db', a);
    let info = null as DuplicateOpenInfo | null;
    const result = await openOnce('道劍.db', branch, {
      ask: async (value) => {
        info = value;
        return 'replace';
      },
    });
    expect(info!.kind).toBe('same-title');
    // same-title 回「取代」＝取消，原本那份沒被動。
    expect(result).toBeNull();
    expect(state.projects).toHaveLength(1);
    expect(await listBooks()).toHaveLength(1);
  });
});

describe('WO-143 審查必修 3：只存在這個裝置的草稿也算還沒存回檔案', () => {
  async function openedWithDraft(setup: (id: string) => void) {
    const bytes = await sampleDb('【範例】道劍', '正文', UUID_A);
    const first = (await openOnce('道劍.db', bytes))!;
    setup(first.id);
    let info = null as DuplicateOpenInfo | null;
    await openOnce('道劍.db', bytes, {
      ask: async (value) => {
        info = value;
        return 'cancel';
      },
    });
    return info!;
  }

  it('沒有任何草稿：hasUnsavedChanges 為假', async () => {
    expect((await openedWithDraft(() => undefined)).hasUnsavedChanges).toBe(false);
  });

  it('只有卡片草稿（沒有 dirtySinceFileSave）：hasUnsavedChanges 為真，取代前會有二次確認資訊', async () => {
    const info = await openedWithDraft((id) => {
      expect(state.saveMeta[id]?.dirtySinceFileSave).toBeUndefined();
      saveCardDraft(id, 'card-1', { title: '卡片', content: '還沒按完成的字', color: '#111' }, store);
    });
    expect(info.kind).toBe('same-book');
    expect(info.hasUnsavedChanges).toBe(true);
  });

  it('尚未併入正文的即時草稿（屬於這份稿子）：hasUnsavedChanges 為真；屬於別份則不影響', async () => {
    const mine = await openedWithDraft((id) => writeLiveDraft(store, { projectId: id, chapterId: 'c1', text: '打到一半', at: 1 }));
    expect(mine.hasUnsavedChanges).toBe(true);
    store.data.clear();
    const others = await openedWithDraft(() => writeLiveDraft(store, { projectId: 'other-book', chapterId: 'c1', text: '別本', at: 1 }));
    expect(others.hasUnsavedChanges).toBe(false);
  });

  it('即時草稿內容壞掉讀不出來：無法確認，當作有', async () => {
    const info = await openedWithDraft(() => store.setItem(LIVE_DRAFT_KEY, '{壞掉'));
    expect(info.hasUnsavedChanges).toBe(true);
  });
});

describe('WO-143 審查必修 4：取代不吃掉匯出事件次數', () => {
  it('經實際匯出流程產生匯出事件 → 重開原檔選取代 → 匯出次數不變、不重複', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文', UUID_A);
    const first = (await openOnce('道劍.db', bytes))!;
    const outcome = await recordFullTextExport({
      getState: () => state,
      dispatch,
      store,
      projectId: first.id,
      at: new Date(BASE_MS + 5000),
      eventId: 'ex-1',
      snapshot: (async () => undefined) as unknown as Parameters<typeof recordFullTextExport>[0]['snapshot'],
    });
    expect(outcome.local).toBe('saved');
    expect(importCountOf(state.exportEvents, first.id)).toBe(1);
    // 這筆事件只掛在舊代號、原檔還沒有紀錄（沒有檔案指紋對應）。
    expect(Object.values(readExportEvents(store).byFile).flat()).toEqual([]);

    const second = (await openOnce('道劍.db', bytes, { ask: async () => 'replace' }))!;
    expect(second.id).not.toBe(first.id);
    const record = readExportEvents(store);
    expect(record.byProject[second.id]).toEqual(['ex-1']);
    expect(record.byProject[first.id]).toBeUndefined();
    expect(Object.keys(record.events)).toEqual(['ex-1']);
    expect(importCountOf(state.exportEvents, second.id)).toBe(1);
    expect(Object.keys(projectExportEventsOf(state, second.id))).toEqual(['ex-1']);
  });

  it('匯入事件（只掛在舊代號、沒連到檔案指紋）取代後同樣由新稿承接，且不重複', async () => {
    const bytes = await sampleDb('【範例】道劍', '正文', UUID_A);
    const first = (await openOnce('道劍.db', bytes))!;
    store.setItem(
      IMPORT_EVENTS_KEY,
      JSON.stringify(withImportEvent(readImportEvents(store), first.id, 'im-1', { dayKey: '2026-11-27', atMs: 1 })),
    );
    state = { ...state, importEvents: readImportEvents(store) };
    const second = (await openOnce('道劍.db', bytes, { ask: async () => 'replace' }))!;
    expect(readImportEvents(store).byProject[second.id]).toEqual(['im-1']);
    expect(importCountOf(state.importEvents, second.id)).toBe(1);
    // 再取代一次：仍然是 1，不會越取代越多。
    const third = (await openOnce('道劍.db', bytes, { ask: async () => 'replace' }))!;
    expect(readImportEvents(store).byProject[third.id]).toEqual(['im-1']);
    expect(importCountOf(state.importEvents, third.id)).toBe(1);
  });
});

describe('WO-143 複審必修 1：身分證完全相符的副本優先於舊格式同名別稿', () => {
  it('較近期開啟、書名檔名相同的舊格式別稿，不會搶在 uuid 完全相符的副本前面；沒有相符副本時才落到它', async () => {
    const newer = await sampleDb('【範例】道劍', '新版', UUID_A);
    const legacy = await sampleDb('【範例】道劍', '舊格式別稿'); // 沒有身分證
    const a = (await openOnce('道劍.db', newer))!;
    const b = (await openOnce('道劍.db', legacy))!; // 舊行為（不問），較近期開啟
    expect(state.recentIds[0]).toBe(b.id);

    let info = null as DuplicateOpenInfo | null;
    await openOnce('道劍.db', newer, {
      ask: async (value) => {
        info = value;
        return 'cancel';
      },
    });
    expect(info!.kind).toBe('same-book');
    expect(info!.existingId).toBe(a.id);

    // 拿掉相符的副本後，才退回用書名＋檔名辨認舊格式別稿。
    await removeOld(a.id);
    info = null;
    await openOnce('道劍.db', newer, {
      ask: async (value) => {
        info = value;
        return 'cancel';
      },
    });
    expect(info!.existingId).toBe(b.id);
  });
});

describe('WO-143 複審必修 2：舊稿檔內帶來的事件換回舊版時不掉出統計', () => {
  const ev = (atMs: number) => ({ dayKey: '2026-11-27', atMs });

  it('新版檔（檔內有 1 筆獨有事件）被同一本較舊的 .db 取代後，匯入／匯出次數不下降、不重複；連續取代仍不重複', async () => {
    const newer = await sampleDb('【範例】道劍', '新版', UUID_A, {
      imports: { 'im-file': ev(1) },
      exports: { 'ex-file': ev(2) },
    });
    const older = await sampleDb('【範例】道劍', '舊版備份', UUID_A); // 同一本（同身分證），檔內沒有那兩筆事件
    const first = (await openOnce('道劍.db', newer))!;
    expect(Object.keys(projectImportEventsOf(state, first.id))).toEqual(['im-file']);
    expect(Object.keys(projectExportEventsOf(state, first.id))).toEqual(['ex-file']);

    const second = (await openOnce('道劍.db', older, { ask: async () => 'replace' }))!;
    expect(Object.keys(projectImportEventsOf(state, second.id))).toEqual(['im-file']);
    expect(Object.keys(projectExportEventsOf(state, second.id))).toEqual(['ex-file']);
    expect(readImportEvents(store).byProject[second.id]).toEqual(['im-file']);
    expect(readExportEvents(store).byProject[second.id]).toEqual(['ex-file']);
    expect(readImportEvents(store).byProject[first.id]).toBeUndefined();

    // 再取代一次（仍用較舊的檔）：次數維持 1。
    const third = (await openOnce('道劍.db', older, { ask: async () => 'replace' }))!;
    expect(Object.keys(projectImportEventsOf(state, third.id))).toEqual(['im-file']);
    expect(Object.keys(projectExportEventsOf(state, third.id))).toEqual(['ex-file']);
    expect(readImportEvents(store).byProject[third.id]).toEqual(['im-file']);

    // 換回帶有同一筆事件的新版檔：檔內與本機同代號去重，仍是 1。
    const fourth = (await openOnce('道劍.db', newer, { ask: async () => 'replace' }))!;
    expect(Object.keys(projectImportEventsOf(state, fourth.id))).toEqual(['im-file']);
    expect(Object.keys(projectExportEventsOf(state, fourth.id))).toEqual(['ex-file']);
    expect(state.projects.map((p) => p.id)).toEqual([fourth.id]);
  });
});

describe('WO-143：只是書名相同、舊式檔', () => {
  it('兩本不同的範例書同名：kind 為 same-title，keep-separate 後有兩份；只提供 keep-separate 不提供取代', async () => {
    const a = await sampleDb('【範例】同名書', '甲', UUID_A);
    const b = await sampleDb('【範例】同名書', '乙', UUID_B);
    await openOnce('甲.db', a);
    let info = null as DuplicateOpenInfo | null;
    const second = await openOnce('乙.db', b, {
      ask: async (value) => {
        info = value;
        return 'keep-separate';
      },
    });
    expect(info!.kind).toBe('same-title');
    expect(second).not.toBeNull();
    expect(state.projects).toHaveLength(2);
    expect(await listBooks()).toHaveLength(2);
  });

  it('same-title 時回「replace」不會取代任何東西（當作取消）', async () => {
    const a = await sampleDb('【範例】同名書', '甲', UUID_A);
    const b = await sampleDb('【範例】同名書', '乙', UUID_B);
    await openOnce('甲.db', a);
    const result = await openOnce('乙.db', b, { ask: async () => 'replace' });
    expect(result).toBeNull();
    expect(state.projects).toHaveLength(1);
    expect(await listBooks()).toHaveLength(1);
  });

  it('same-title 的 open-existing：不新增，回傳已有的那本', async () => {
    const a = await sampleDb('【範例】同名書', '甲', UUID_A);
    const b = await sampleDb('【範例】同名書', '乙', UUID_B);
    const first = (await openOnce('甲.db', a))!;
    const result = await openOnce('乙.db', b, { ask: async () => 'open-existing' });
    expect(result?.id).toBe(first.id);
    expect(await listBooks()).toHaveLength(1);
  });

  it('沒有身分證的舊式檔：書名＋檔名相同 → same-book；檔名不同 → same-title', async () => {
    const legacy = await sampleDb('【範例】舊式稿', '舊式正文');
    await openOnce('舊式.db', legacy);
    const kinds: string[] = [];
    const record = async (value: DuplicateOpenInfo) => {
      kinds.push(value.kind);
      return 'cancel' as const;
    };
    await openOnce('舊式.db', legacy, { ask: record });
    await openOnce('改了名.db', legacy, { ask: record });
    expect(kinds).toEqual(['same-book', 'same-title']);
  });

  it('完全不同書名：不問，直接開', async () => {
    const a = await sampleDb('【範例】甲書', '甲', UUID_A);
    const b = await sampleDb('【範例】乙書', '乙', UUID_B);
    await openOnce('甲.db', a);
    const ask = vi.fn(async () => 'cancel' as const);
    const second = await openOnce('乙.db', b, { ask });
    expect(ask).not.toHaveBeenCalled();
    expect(second).not.toBeNull();
    expect(state.projects).toHaveLength(2);
  });
});
