import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsBookGoalLine } from '../copy/userFacing';
import { readBookBytes } from '../db/library';
import { currentSchemaVersion } from '../db/migrations';
import { readFileProject, writeFileProject } from '../db/projectFile';
import { openMemoryDb } from '../db/wasmDb';
import { saveProjects, type KeyValueStore } from '../domain/outline';
import { formatInteger } from '../domain/formatNumber';
import { LayoutProvider } from '../layout';
import { SettingsScreen } from '../screens/SettingsScreen';
import { Workspace } from '../screens/Workspace';
import {
  forgetNewBookGoalSession,
  NEW_BOOK_GOAL_DEFAULT,
  NEW_BOOK_GOAL_STORAGE_KEY,
  parseNewBookGoal,
  readNewBookGoal,
  writeNewBookGoal,
} from './newBookGoal';
import {
  addProjectAction,
  attachActionForBook,
  buildImportedProject,
  createState,
  manuscriptBytesOn,
  reduce,
  runTextImport,
  SampleProvider,
  type SampleState,
  type TextImportOutcome,
} from './sampleStore';

/**
 * WO-109（歡迎-2）：新稿子的全書目標預設。
 * 全部用程式產生的假文字、記憶體儲存與記憶體資料庫，不碰真稿子或真 .db。
 */
const NOW = new Date('2026-11-17T04:00:00Z');
const utf8 = (text: string) => new TextEncoder().encode(text);

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(key: string): string | null {
    if (this.failGet) throw new Error('SecurityError（測試模擬）');
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('QuotaExceededError（測試模擬）');
    this.data.set(key, value);
  }
}

let store: MemoryStore;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  store = new MemoryStore();
  vi.stubGlobal('localStorage', store);
  forgetNewBookGoalSession();
});

afterEach(() => {
  forgetNewBookGoalSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const INVALID_VALUES = [
  '',
  ' ',
  '0',
  '-1',
  '-200000',
  '1.5',
  '200000.0',
  '200,000',
  ' 200000',
  '200000 ',
  '200000abc',
  'abc',
  '1e5',
  '0x10',
  '０２００',
  '00200000',
  '+200000',
  '{"goal":200000}',
  '"200000"',
  'null',
  'NaN',
  'Infinity',
  '99999999999999999999',
];

async function importText(state: SampleState, filename: string, text: string) {
  let current = state;
  const outcome: TextImportOutcome = await runTextImport({
    filename,
    readBytes: async () => utf8(text),
    getState: () => current,
    dispatch: (action) => {
      current = reduce(current, action);
    },
    store,
    busy: { current: false },
    now: () => new Date(),
    yieldToUi: async () => undefined,
  });
  if (outcome.kind !== 'imported') throw new Error(`匯入沒成功：${outcome.kind}`);
  return { state: current, id: outcome.id };
}

function renderSettings(state: SampleState, projectId: string): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: state },
      createElement(
        LayoutProvider,
        { initialMode: 'phone-portrait' },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/settings`] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId',
              element: createElement(Workspace),
              children: [createElement(Route, { key: 's', path: 'settings', element: createElement(SettingsScreen) })],
            }),
          ),
        ),
      ),
    ),
  );
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** 用程式產生一份假的電腦版 .db（全書目標 50,000）。 */
async function fakeDesktopDb(targetWordCount: number): Promise<Uint8Array> {
  const db = await openMemoryDb(new Uint8Array());
  try {
    writeFileProject(
      db.sql,
      {
        title: '假電腦版稿',
        logline: '',
        currentTheme: '',
        globalFontFamily: '',
        globalFontSize: 12,
        editorFontFamily: '',
        editorFontSize: 16,
        targetWordCount,
        dailyTargetWordCount: 1000,
        categoryOrder: null,
        expandedCategories: null,
        categoriesMeta: '{}',
        lastOpenedNodeId: 'd-1',
        lastCursorPosition: 0,
      },
      [{ id: 'd-1', type: 'file', title: '第一章　', progress: 'Draft', content: '假正文' }],
      [],
      [],
    );
    return db.exportBytes();
  } finally {
    db.close();
  }
}

async function openDb(state: SampleState, bytes: Uint8Array, key: string): Promise<SampleState> {
  const book = await readBookBytes('假稿.db', bytes, key);
  return reduce(state, attachActionForBook(book, { updatedLabel: '剛剛' }));
}

async function dbShape(bytes: Uint8Array) {
  const db = await openMemoryDb(bytes);
  try {
    const tables = db.sql
      .select("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((row) => String(row.name));
    const columns = Object.fromEntries(
      tables.map((table) => [table, db.sql.select(`PRAGMA table_info("${table}")`).map((row) => String(row.name))]),
    );
    return { tables, columns, version: currentSchemaVersion(db.sql), info: readFileProject(db.sql).info };
  } finally {
    db.close();
  }
}

describe('WO-109 本機設定 new-book-goal 的讀寫', () => {
  it('鍵名固定；沒設過回 100,000，讀的時候不寫入任何值', () => {
    expect(NEW_BOOK_GOAL_STORAGE_KEY).toBe('jiufang-novel-m.new-book-goal.v1');
    expect(NEW_BOOK_GOAL_DEFAULT).toBe(100000);
    expect(readNewBookGoal(store)).toBe(100000);
    expect(readNewBookGoal()).toBe(100000);
    expect(store.data.size).toBe(0);
  });

  it('設成 200,000：存成整數字串 "200000"（不含千分位、不是 JSON 物件），讀回 200,000', () => {
    expect(writeNewBookGoal(200000, store)).toBe(true);
    expect(store.data.get(NEW_BOOK_GOAL_STORAGE_KEY)).toBe('200000');
    expect([...store.data.keys()]).toEqual([NEW_BOOK_GOAL_STORAGE_KEY]);
    forgetNewBookGoalSession(); // 模擬重新打開 App，只從本機讀
    expect(readNewBookGoal(store)).toBe(200000);
    expect(parseNewBookGoal('1')).toBe(1);
  });

  it.each(INVALID_VALUES)('本機值不合法（%j）時當作沒設，回 100,000、不當機', (raw) => {
    store.data.set(NEW_BOOK_GOAL_STORAGE_KEY, raw);
    expect(parseNewBookGoal(raw)).toBeNull();
    expect(() => readNewBookGoal(store)).not.toThrow();
    expect(readNewBookGoal(store)).toBe(100000);
    // 只讀不寫：不合法的值原樣留著，不替使用者改
    expect(store.data.get(NEW_BOOK_GOAL_STORAGE_KEY)).toBe(raw);
  });

  it('寫入不合法的值（0、負數、小數、NaN、超過安全整數）不寫、回 false', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(writeNewBookGoal(value, store)).toBe(false);
    }
    expect(store.data.size).toBe(0);
    expect(readNewBookGoal(store)).toBe(100000);
  });

  it('getItem 丟錯、沒有儲存（null）時回 100,000、不當機', () => {
    store.data.set(NEW_BOOK_GOAL_STORAGE_KEY, '200000');
    store.failGet = true;
    expect(readNewBookGoal(store)).toBe(100000);
    expect(readNewBookGoal(null)).toBe(100000);
  });

  it('取得 localStorage 本身就丟錯時，讀寫都不當機；讀回 100,000', () => {
    vi.unstubAllGlobals();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError（測試模擬）');
      },
    });
    try {
      expect(readNewBookGoal()).toBe(100000);
      expect(writeNewBookGoal(200000)).toBe(false);
      // 寫不進本機，這次開著時仍用剛剛的值
      expect(readNewBookGoal()).toBe(200000);
      forgetNewBookGoalSession();
      expect(readNewBookGoal()).toBe(100000);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('setItem 丟錯時回 false，但這次開著時仍保留 200,000；重新打開回 100,000', () => {
    store.failSet = true;
    expect(writeNewBookGoal(200000, store)).toBe(false);
    expect(store.data.has(NEW_BOOK_GOAL_STORAGE_KEY)).toBe(false);
    expect(readNewBookGoal(store)).toBe(200000);
    expect(addProjectAction('p-1763352000000', '寫不進本機也帶入', 'novel', undefined, store).bookGoal).toBe(200000);
    forgetNewBookGoalSession();
    expect(readNewBookGoal(store)).toBe(100000);
  });

  it('寫不進去時記憶體值仍優先於本機舊值', () => {
    store.data.set(NEW_BOOK_GOAL_STORAGE_KEY, '150000');
    store.failSet = true;
    expect(writeNewBookGoal(300000, store)).toBe(false);
    expect(store.data.get(NEW_BOOK_GOAL_STORAGE_KEY)).toBe('150000');
    expect(readNewBookGoal(store)).toBe(300000);
  });
});

describe('WO-109 一般開新稿子帶入全書目標預設', () => {
  it.each(['novel', 'single'] as const)('沒設過：開新稿子（%s）全書目標是 100,000（和以前一樣）', (shape) => {
    const action = addProjectAction('p-1763352000001', '新稿', shape, NOW.getTime());
    expect(action.bookGoal).toBe(100000);
    const state = reduce(createState(NOW), action);
    const project = state.projects.find((item) => item.id === 'p-1763352000001')!;
    expect(project.bookGoal).toBe(100000);
    expect(project.shape).toBe(shape);
  });

  it.each(['novel', 'single'] as const)('設成 200,000 後開新稿子（%s）：全書目標 200,000，設定頁卡片顯示 200,000', (shape) => {
    writeNewBookGoal(200000);
    forgetNewBookGoalSession(); // 確認是從本機設定讀的
    const id = 'p-1763352000002';
    let state = reduce(createState(NOW), addProjectAction(id, '二十萬字的稿', shape, NOW.getTime()));
    const project = state.projects.find((item) => item.id === id)!;
    expect(project.bookGoal).toBe(200000);
    // 和首頁開新稿子後進寫作頁一樣聚焦這份稿子，再看設定頁
    state = reduce(state, { type: 'focus-project', id });
    const text = textOf(renderSettings(state, id));
    expect(text).toContain(settingsBookGoalLine(formatInteger(200000)));
    expect(text).not.toContain(settingsBookGoalLine(formatInteger(100000)));
  });

  it.each(INVALID_VALUES.slice(0, 8))('本機值不合法（%j）時開新稿子用 100,000', (raw) => {
    store.data.set(NEW_BOOK_GOAL_STORAGE_KEY, raw);
    const state = reduce(createState(NOW), addProjectAction('p-1763352000003', '新稿', 'novel'));
    expect(state.projects.find((item) => item.id === 'p-1763352000003')!.bookGoal).toBe(100000);
  });

  it('建立事件沒帶或帶了不合法的全書目標，reducer 用 100,000（舊呼叫照舊）', () => {
    let state = createState(NOW);
    state = reduce(state, { type: 'add-project', id: 'p-a', title: 'A', shape: 'novel' });
    state = reduce(state, { type: 'add-project', id: 'p-b', title: 'B', shape: 'single', bookGoal: 0 });
    state = reduce(state, { type: 'add-project', id: 'p-c', title: 'C', shape: 'novel', bookGoal: 1.5 });
    state = reduce(state, { type: 'add-project', id: 'p-d', title: 'D', shape: 'novel', bookGoal: 250000 });
    expect(Object.fromEntries(state.projects.map((p) => [p.id, p.bookGoal]))).toEqual({
      'p-a': 100000,
      'p-b': 100000,
      'p-c': 100000,
      'p-d': 250000,
    });
  });

  it('既有稿子、目前開著的稿子、回復的暫存稿都不套用新預設', () => {
    const existing = buildImportedProject('p-1763000000000', '舊稿', [{ title: '第一章', content: '舊正文' }], 30000);
    saveProjects(store, [existing]);
    writeNewBookGoal(200000);
    // 重新打開（回復本機暫存的稿子）：舊稿維持 30,000
    let state = createState(NOW);
    expect(state.projects.map((p) => [p.id, p.bookGoal])).toEqual([['p-1763000000000', 30000]]);
    state = reduce(state, { type: 'focus-project', id: 'p-1763000000000' });
    state = reduce(state, addProjectAction('p-1763352000004', '新稿', 'novel'));
    expect(state.projects.find((p) => p.id === 'p-1763000000000')!.bookGoal).toBe(30000);
    expect(state.projects.find((p) => p.id === 'p-1763352000004')!.bookGoal).toBe(200000);
    // 之後再改預設，已開的新稿也不跟著變
    writeNewBookGoal(80000);
    expect(state.projects.find((p) => p.id === 'p-1763352000004')!.bookGoal).toBe(200000);
  });
});

describe('WO-109 匯入文字檔開成新稿子帶入全書目標預設', () => {
  it('沒設過：匯入的新稿子全書目標 100,000', async () => {
    const { state, id } = await importText(createState(NOW), '假稿.txt', '第一章\n假正文');
    expect(state.projects.find((p) => p.id === id)!.bookGoal).toBe(100000);
  });

  it('設成 200,000：匯入的新稿子全書目標 200,000，設定頁卡片顯示 200,000；分章照舊', async () => {
    store.setItem(NEW_BOOK_GOAL_STORAGE_KEY, '200000');
    const { state, id } = await importText(createState(NOW), '霧港.txt', '第一章　夜雨\n雨。\n第二章　天晴\n晴。');
    const project = state.projects.find((p) => p.id === id)!;
    expect(project.bookGoal).toBe(200000);
    expect(project.title).toBe('霧港');
    expect(project.nodes.map((node) => node.title)).toEqual(['第一章　夜雨', '第二章　天晴']);
    expect(textOf(renderSettings(state, id))).toContain(settingsBookGoalLine(formatInteger(200000)));
  });

  it('本機值不合法、讀本機丟錯時匯入照樣成功，用 100,000', async () => {
    store.data.set(NEW_BOOK_GOAL_STORAGE_KEY, '-5');
    const first = await importText(createState(NOW), '甲.txt', '假正文甲');
    expect(first.state.projects.find((p) => p.id === first.id)!.bookGoal).toBe(100000);
    store.data.set(NEW_BOOK_GOAL_STORAGE_KEY, '200000');
    const failingRead = new MemoryStore();
    failingRead.failGet = true;
    const project = buildImportedProject('p-x', '乙', [{ title: '第一章', content: '' }], readNewBookGoal(failingRead));
    expect(project.bookGoal).toBe(100000);
    expect(buildImportedProject('p-y', '丙', [{ title: '第一章', content: '' }], 0).bookGoal).toBe(100000);
    expect(buildImportedProject('p-z', '丁', [{ title: '第一章', content: '' }]).bookGoal).toBe(100000);
  });

  it('匯入時既有稿子的全書目標不變', async () => {
    const existing = buildImportedProject('p-1763000000001', '舊稿', [{ title: '第一章', content: '舊' }], 45000);
    saveProjects(store, [existing]);
    writeNewBookGoal(200000);
    const { state, id } = await importText(createState(NOW), '新.txt', '新正文');
    expect(state.projects.find((p) => p.id === 'p-1763000000001')!.bookGoal).toBe(45000);
    expect(state.projects.find((p) => p.id === id)!.bookGoal).toBe(200000);
  });
});

describe('WO-109 .db 不套用、不改結構', () => {
  it('開啟假 .db：全書目標用檔案原值 50,000，不套用 200,000；本機設定不寫進檔案', async () => {
    writeNewBookGoal(200000);
    const bytes = await fakeDesktopDb(50000);
    const state = await openDb(createState(NOW), bytes, 'file-fake');
    expect(state.projects.find((p) => p.id === 'file-fake')!.bookGoal).toBe(50000);
    expect(textOf(renderSettings(state, 'file-fake'))).toContain(settingsBookGoalLine(formatInteger(50000)));
    // 再存回去仍是 50,000
    const project = state.projects.find((p) => p.id === 'file-fake')!;
    const saved = await dbShape(await manuscriptBytesOn(state, project, null));
    expect(saved.info.targetWordCount).toBe(50000);
  });

  it('新稿子另存成 .db：讀回是稿子自己的 200,000；表與欄位和沒設預設時完全一樣、版本不變、不含裝置鍵', async () => {
    const plainState = reduce(createState(NOW), addProjectAction('p-1763352000010', '對照稿', 'novel'));
    const plainBytes = await manuscriptBytesOn(plainState, plainState.projects.find((p) => p.id === 'p-1763352000010')!, null);

    writeNewBookGoal(200000);
    const state = reduce(createState(NOW), addProjectAction('p-1763352000011', '二十萬', 'novel'));
    const project = state.projects.find((p) => p.id === 'p-1763352000011')!;
    const bytes = await manuscriptBytesOn(state, project, null);

    const plain = await dbShape(plainBytes);
    const withGoal = await dbShape(bytes);
    expect(plain.info.targetWordCount).toBe(100000);
    expect(withGoal.info.targetWordCount).toBe(200000);
    expect(withGoal.tables).toEqual(plain.tables);
    expect(withGoal.columns).toEqual(plain.columns);
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('new-book-goal');
    expect(withGoal.version).toBe(plain.version);
    expect(withGoal.version).toBeGreaterThan(0);

    // 再開回來：全書目標是檔案自己的 200,000，即使本機預設已改掉
    writeNewBookGoal(70000);
    const reopened = await openDb(createState(NOW), bytes, 'file-reopen');
    expect(reopened.projects.find((p) => p.id === 'file-reopen')!.bookGoal).toBe(200000);
  });
});
