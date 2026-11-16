import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_TEXT_FILE_BUTTON, IMPORT_TEXT_FILE_HINT } from '../copy/userFacing';
import { writingDayKey } from '../domain/dailyGoal';
import { OUTLINE_STORAGE_KEY, saveProjects, type KeyValueStore } from '../domain/outline';
import { summarizeStats } from '../domain/stats';
import { decodeTextBytes, normalizeNewlines, splitChaptersInBatches } from '../domain/textImport';
import { readBookBytes } from '../db/library';
import { currentSchemaVersion } from '../db/migrations';
import { readFileProject, writeFileProject, type FileLog } from '../db/projectFile';
import { TRANSFER_TABLES } from '../db/transferMeta';
import { openMemoryDb } from '../db/wasmDb';
import { LayoutProvider } from '../layout';
import { FilesScreen } from '../screens/FilesScreen';
import { LogsScreen } from '../screens/LogsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { DEVICE_SAVE_RECORD_KEY, fingerprintBytes, rememberExportedFile } from './deviceSaveRecord';
import { IMPORT_EVENTS_KEY, countImportEvents, importCountOf, importCountOn, readImportEvents } from './importEvents';
import {
  adoptImportEventsByFingerprint,
  attachActionForBook,
  createState,
  linkImportEventsToBytes,
  manuscriptBytesOn,
  manuscriptSnapshotParts,
  projectExportEventsOf,
  projectImportEventsOf,
  persistDeviceSaveRecord,
  reduce,
  runTextImport,
  SampleProvider,
  useSample,
  type Action,
  type SampleState,
  type TextImportOutcome,
} from './sampleStore';
import { demoFixtureState } from './testing/sampleFixture';

/** 臺北 2026-11-16 下午。全部用程式產生的假文字與記憶體資料庫，不碰真稿子或真 .db。 */
const NOW = new Date('2026-11-16T07:40:00Z');
const TODAY = writingDayKey(NOW, 0);
const utf8 = (text: string) => new TextEncoder().encode(text);

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failKeys = new Set<string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failKeys.has(key)) throw new Error('QuotaExceededError（測試模擬）');
    this.data.set(key, value);
  }
}

let store: MemoryStore;

/** 像 App 一樣跑一次匯入：dispatch 直接套 reducer。 */
async function importText(
  state: SampleState,
  filename: string,
  bytes: Uint8Array,
  options: { busy?: { current: boolean }; yieldToUi?: () => Promise<void> } = {},
): Promise<{ state: SampleState; outcome: TextImportOutcome; dispatched: Action[] }> {
  let current = state;
  const dispatched: Action[] = [];
  const outcome = await runTextImport({
    filename,
    readBytes: async () => bytes,
    getState: () => current,
    dispatch: (action) => {
      dispatched.push(action);
      current = reduce(current, action);
    },
    store,
    busy: options.busy ?? { current: false },
    now: () => new Date(),
    yieldToUi: options.yieldToUi ?? (async () => undefined),
  });
  return { state: current, outcome, dispatched };
}

function importedId(outcome: TextImportOutcome): string {
  if (outcome.kind !== 'imported') throw new Error(`匯入沒成功：${outcome.kind}`);
  return outcome.id;
}

/** 和 App 自動暫存一樣：本機稿子清單與這台裝置的紀錄寫進本機。 */
function autoSave(state: SampleState): void {
  saveProjects(store, state.projects.filter((project) => project.origin !== 'file'));
  persistDeviceSaveRecord(store, state);
}

/** 重新整理：從本機重建狀態再打開那份稿子。 */
function reload(projectId: string): SampleState {
  return reduce(createState(new Date()), { type: 'focus-project', id: projectId });
}

/**
 * 儲存專案的實際轉換（WO-100 改走檔內資料路徑）：用與 App 存檔同一套快照（含這份稿子的匯入事件）寫成 .db 位元組，
 * 升格並把匯入事件對到這份檔。
 */
async function saveToDb(state: SampleState, projectId: string): Promise<{ state: SampleState; bytes: Uint8Array }> {
  const project = state.projects.find((item) => item.id === projectId)!;
  const parts = manuscriptSnapshotParts(state, project);
  const bytes = await manuscriptBytesOn(state, project, null);
  let next = reduce(state, { type: 'promote-stored', projectId, key: parts.key, filename: `${project.title}.db` });
  const linked = await linkImportEventsToBytes(store, projectId, bytes);
  if (linked) next = reduce(next, { type: 'set-import-events', importEvents: linked });
  return { state: next, bytes };
}

/**
 * 開啟別的稿子（.db）：和 actions.importFile 同一套轉換（WO-100：先算原始位元組指紋、讀檔內附加表），
 * 新代號 file-…，指紋對得上就接回本機匯入事件。
 */
async function openDb(state: SampleState, bytes: Uint8Array, key: string): Promise<SampleState> {
  const rawFingerprint = await fingerprintBytes(bytes);
  const book = await readBookBytes('x.db', bytes, key);
  const adopted = adoptImportEventsByFingerprint(store, rawFingerprint, key);
  let next = state;
  if (adopted) next = reduce(next, { type: 'set-import-events', importEvents: adopted });
  return reduce(next, attachActionForBook(book, { updatedLabel: '剛剛' }));
}

function totalImportDisplay(state: SampleState) {
  // WO-103：匯出次數也用真實的匯出事件集合（與 App 相同算法）；匯入不會產生匯出事件。
  return summarizeStats(
    state.schedule,
    state.logs,
    0,
    countImportEvents(projectImportEventsOf(state, state.activeProjectId)),
    countImportEvents(projectExportEventsOf(state, state.activeProjectId)),
  ).importExport;
}

describe('WO-99 匯入文字檔開成新稿子', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store = new MemoryStore();
    vi.stubGlobal('localStorage', store);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('WO-99：成功匯入建立完整新稿子，書名用檔名，直接進第一章（有前言就是前言）', async () => {
    const { state, outcome, dispatched } = await importText(
      createState(NOW),
      '霧港.txt',
      utf8('\ufeff寫在前面\n第一章　夜雨\n雨下了一整夜。\n第二章　天晴\n太陽出來了。\n'),
    );
    const id = importedId(outcome);
    // 只 dispatch 一次，一次加入完整稿子
    expect(dispatched).toHaveLength(1);
    const project = state.projects.find((item) => item.id === id)!;
    expect(project.title).toBe('霧港');
    expect(project.shape).toBe('novel');
    expect(project.nodes.map((node) => [node.title, node.content])).toEqual([
      ['前言', '寫在前面'],
      ['第一章　夜雨', '雨下了一整夜。'],
      ['第二章　天晴', '太陽出來了。\n'],
    ]);
    expect(new Set(project.nodes.map((node) => node.id)).size).toBe(3);
    expect(outcome.kind === 'imported' && outcome.chapterId).toBe(project.nodes[0]!.id);
    expect(state.recentIds[0]).toBe(id);
    expect(state.toast).toBe('已開新稿子');
  });

  it('WO-99：既有稿子、卡片、紀錄、目標、存檔紀錄完全不變；同名也另建一份', async () => {
    let base = demoFixtureState(NOW, { withDemoStats: true });
    base = reduce(base, { type: 'focus-project', id: 'fog' });
    base = reduce(base, { type: 'record-project-save', projectId: 'fog', atMs: 123 });
    autoSave(base);
    const before = structuredClone(base);
    const outlineBefore = store.getItem(OUTLINE_STORAGE_KEY);
    const fogTitle = base.projects.find((item) => item.id === 'fog')!.title;

    const first = await importText(base, `${fogTitle}.txt`, utf8('第一章\n甲'));
    const second = await importText(first.state, `${fogTitle}.txt`, utf8('第一章\n乙'));
    const after = second.state;
    const idA = importedId(first.outcome);
    const idB = importedId(second.outcome);
    expect(idA).not.toBe(idB);

    expect(after.projects.slice(2)).toEqual(before.projects);
    expect(after.projects[0]!.title).toBe(after.projects[1]!.title);
    expect(after.fileExtras).toEqual(before.fileExtras);
    expect(after.saveMeta).toEqual(before.saveMeta);
    expect(after.activeProjectId).toBe('fog');
    expect(after.schedule).toEqual(before.schedule);
    expect(after.logs).toEqual(before.logs);
    expect(after.demoLogs).toEqual(before.demoLogs);
    for (const [key, value] of Object.entries(before.goalById)) expect(after.goalById[key]).toEqual(value);
    for (const [key, value] of Object.entries(before.logsById)) expect(after.logsById[key]).toEqual(value);
    expect(after.recentIds).toEqual([idB, idA, ...before.recentIds]);
    // 本機清單裡原有的稿子也一字不差
    const savedNow = JSON.parse(store.getItem(OUTLINE_STORAGE_KEY)!) as { id: string }[];
    expect(savedNow.slice(2)).toEqual(JSON.parse(outlineBefore!));
    // 原稿匯入次數維持 0
    expect(importCountOf(after.importEvents, 'fog')).toBe(0);
  });

  it('WO-99：讀不出來（無效位元組、二進位、UTF-16 BOM、讀檔失敗）不建稿、不加最近清單、不記事件', async () => {
    const base = createState(NOW);
    for (const bytes of [
      new Uint8Array([0x80, 0x80, 0xff]),
      utf8('A\u0000B'),
      new Uint8Array([0xff, 0xfe, 0x41, 0x00]),
    ]) {
      const { state, outcome, dispatched } = await importText(base, '壞檔.txt', bytes);
      expect(outcome).toEqual({ kind: 'unreadable' });
      expect(state).toBe(base);
      expect(dispatched).toHaveLength(0);
    }
    let current = base;
    const failedRead = await runTextImport({
      filename: '讀不到.txt',
      readBytes: async () => {
        throw new Error('NotReadableError');
      },
      getState: () => current,
      dispatch: (action) => {
        current = reduce(current, action);
      },
      store,
      busy: { current: false },
      yieldToUi: async () => undefined,
    });
    expect(failedRead).toEqual({ kind: 'unreadable' });
    expect(current).toBe(base);
    expect(store.getItem(IMPORT_EVENTS_KEY)).toBeNull();
    expect(store.getItem(OUTLINE_STORAGE_KEY)).toBeNull();
  });

  it('WO-99：本機存不下時不建稿、不計次，先前的匯入事件原樣保留', async () => {
    const ok = await importText(createState(NOW), '先.txt', utf8('第一章\n先'));
    const eventsBefore = store.getItem(IMPORT_EVENTS_KEY);
    store.failKeys.add(OUTLINE_STORAGE_KEY);
    const failed = await importText(ok.state, '後.txt', utf8('第一章\n後'));
    expect(failed.outcome).toEqual({ kind: 'storage-failed' });
    expect(failed.state).toBe(ok.state);
    expect(store.getItem(IMPORT_EVENTS_KEY)).toBe(eventsBefore);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(1);

    // 事件本身寫不進去也一樣
    store.failKeys = new Set([IMPORT_EVENTS_KEY]);
    const failedAgain = await importText(ok.state, '後.txt', utf8('第一章\n後'));
    expect(failedAgain.outcome).toEqual({ kind: 'storage-failed' });
    expect(failedAgain.state).toBe(ok.state);
  });

  it('WO-99：處理中再按一次不會重複建立', async () => {
    const busy = { current: false };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let current = createState(NOW);
    const dispatch = (action: Action) => {
      current = reduce(current, action);
    };
    const common = {
      filename: '一次.txt',
      readBytes: async () => utf8('第一章\n只要一份'),
      getState: () => current,
      dispatch,
      store,
      busy,
    };
    const first = runTextImport({ ...common, yieldToUi: () => gate });
    const second = await runTextImport({ ...common, yieldToUi: async () => undefined });
    expect(second).toEqual({ kind: 'busy' });
    release();
    expect((await first).kind).toBe('imported');
    expect(current.projects).toHaveLength(1);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(1);
    expect(busy.current).toBe(false);
  });

  it('WO-99：檔案頁取消選檔（沒有選到檔）不呼叫匯入、不顯示錯誤', () => {
    let calls = 0;
    let inputProps: { onChange: (event: unknown) => void } | null = null;
    function Harness() {
      const { actions } = useSample();
      actions.importTextFile = async () => {
        calls += 1;
        return { kind: 'busy' };
      };
      const vdom = FilesScreen();
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const props = (node as { props?: Record<string, unknown> }).props;
        if (props?.['data-testid'] === 'import-text-input') inputProps = props as never;
        const children = props?.children;
        if (Array.isArray(children)) children.forEach(walk);
        else if (children) walk(children);
      };
      walk(vdom);
      return vdom;
    }
    const html = renderToStaticMarkup(
      createElement(
        SampleProvider,
        { initialState: demoFixtureState(NOW) },
        createElement(
          LayoutProvider,
          { initialMode: 'phone-portrait' },
          createElement(
            MemoryRouter,
            { initialEntries: ['/p/fog/files'] },
            createElement(Routes, null, createElement(Route, { path: '/p/:projectId/files', element: createElement(Harness) })),
          ),
        ),
      ),
    );
    expect(html).toContain(IMPORT_TEXT_FILE_BUTTON);
    expect(html).toContain(IMPORT_TEXT_FILE_HINT);
    expect(html).not.toContain('import-text-error');
    expect(inputProps).not.toBeNull();
    const target = { files: [] as File[], value: 'C:\\fakepath\\x.txt' };
    inputProps!.onChange({ target });
    expect(calls).toBe(0);
    expect(target.value).toBe('');
  });

  it('WO-99：重新整理後新稿子與正文都在', async () => {
    const { state, outcome } = await importText(createState(NOW), '留著.txt', utf8('前言文字\n第一章 起\n正文一\n第二章 承\n正文二'));
    const id = importedId(outcome);
    autoSave(state);
    const reloaded = reload(id);
    const project = reloaded.projects.find((item) => item.id === id)!;
    expect(project.nodes).toEqual(state.projects.find((item) => item.id === id)!.nodes);
    expect(project.title).toBe('留著');
  });
});

describe('WO-99 匯入次數（九方 15:39 補充）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store = new MemoryStore();
    vi.stubGlobal('localStorage', store);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('WO-99：成功一次 +1，記在新稿子的當日；統計頁與當日紀錄卡一致，匯出為 0（WO-103 起開放）', async () => {
    const { state, outcome } = await importText(createState(NOW), '一次.txt', utf8('第一章\n內容'));
    const id = importedId(outcome);
    const opened = reduce(state, { type: 'focus-project', id });
    expect(importCountOf(opened.importEvents, id)).toBe(1);
    expect(importCountOn(opened.importEvents, id, TODAY)).toBe(1);
    expect(totalImportDisplay(opened)).toMatchObject({ importCount: 1, importDisplay: '1', exportCount: 0, exportDisplay: '0' });
    // 當日紀錄卡有一列，次數一致
    expect(opened.logs.map((log) => log.date)).toEqual([TODAY]);

    const render = (element: ReturnType<typeof createElement>, path: string, url: string, mode: 'phone-portrait' | 'wide' = 'phone-portrait') =>
      renderToStaticMarkup(
        createElement(
          SampleProvider,
          { initialState: opened },
          createElement(
            LayoutProvider,
            { initialMode: mode },
            createElement(MemoryRouter, { initialEntries: [url] }, createElement(Routes, null, createElement(Route, { path, element }))),
          ),
        ),
      );
    const stats = render(createElement(StatsScreen), '/p/:projectId/stats', `/p/${id}/stats`);
    expect(stats).toMatch(/data-testid="stats-import-count">1</);
    expect(stats).toMatch(/data-testid="stats-export-count">0</);
    const logs = render(createElement(LogsScreen), '/p/:projectId/logs', `/p/${id}/logs`);
    expect(logs).toContain('匯入\u30001 次');
    expect(logs).toContain('匯出\u30000 次');
    expect(logs).not.toContain('匯出\u3000— 次');
    const wide = render(createElement(StatsScreen), '/p/:projectId/stats', `/p/${id}/stats`, 'wide');
    expect(wide).toContain('匯入\u30001 次');
  });

  it('WO-99：連續成功兩次各建一稿、各記 1；裝置上共 2 筆事件；舊稿維持 0', async () => {
    let state = demoFixtureState(NOW);
    const first = await importText(state, '同名.txt', utf8('甲'));
    const second = await importText(first.state, '同名.txt', utf8('乙'));
    state = second.state;
    const a = importedId(first.outcome);
    const b = importedId(second.outcome);
    expect(importCountOf(state.importEvents, a)).toBe(1);
    expect(importCountOf(state.importEvents, b)).toBe(1);
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(2);
    expect(importCountOf(state.importEvents, 'fog')).toBe(0);
    const fog = reduce(state, { type: 'focus-project', id: 'fog' });
    expect(totalImportDisplay(fog)).toMatchObject({ importCount: 0, importDisplay: '0', exportDisplay: '0' });
  });

  it('WO-99：失敗、取消、busy 都不加次數', async () => {
    const base = createState(NOW);
    await importText(base, '壞.txt', new Uint8Array([0xc3, 0x28, 0xa0, 0xa1, 0xff]));
    await importText(base, '壞.txt', new Uint8Array([0xfe, 0xff, 0x00, 0x41]));
    expect(readImportEvents(store)).toEqual({ events: {}, byProject: {}, byFile: {} });
    // 取消就是根本沒有呼叫匯入；busy 直接回來
    const busy = await importText(base, '忙.txt', utf8('甲'), { busy: { current: true } });
    expect(busy.outcome).toEqual({ kind: 'busy' });
    expect(Object.keys(readImportEvents(store).events)).toHaveLength(0);
  });

  it('WO-99：重新整理、重新渲染、多次重新整理都不遺失、不重複', async () => {
    const { state, outcome } = await importText(createState(NOW), '刷新.txt', utf8('第一章\n內容'));
    const id = importedId(outcome);
    autoSave(state);
    let reloaded = reload(id);
    expect(importCountOf(reloaded.importEvents, id)).toBe(1);
    expect(importCountOn(reloaded.importEvents, id, TODAY)).toBe(1);
    expect(reloaded.logs.map((log) => log.date)).toEqual([TODAY]);
    for (let index = 0; index < 3; index += 1) {
      autoSave(reloaded);
      reloaded = reload(id);
    }
    expect(importCountOf(reloaded.importEvents, id)).toBe(1);
    expect(totalImportDisplay(reloaded).importDisplay).toBe('1');
  });

  it('WO-99：存成 .db、另存、多次開回、再存再開，次數都是 1；不受另存指紋 30 筆淘汰與升格清理影響', async () => {
    const imported = await importText(createState(NOW), '往返.txt', utf8('第一章　起\n正文一\n第二章　承\n正文二'));
    const id = importedId(imported.outcome);
    let state = reduce(imported.state, { type: 'focus-project', id });

    // 儲存專案：升格成檔案稿（稿子代號不變），draftIds 不再包含它
    const saved = await saveToDb(state, id);
    state = saved.state;
    expect(state.projects.find((item) => item.id === id)!.origin).toBe('file');
    autoSave(state);
    const record = JSON.parse(store.getItem(DEVICE_SAVE_RECORD_KEY)!) as { logsById: Record<string, unknown> };
    expect(record.logsById[id]).toBeUndefined();
    expect(importCountOf(readImportEvents(store), id)).toBe(1);

    // 另存指紋快取被擠滿（超過 30 筆）也不影響
    for (let index = 0; index < 40; index += 1) rememberExportedFile(store, `fake-${index}`, Date.now() + index + 1);

    // 換一份狀態（重新整理）後開回那份 .db：新代號，接回同一事件
    let reopened = await openDb(createState(new Date()), saved.bytes, 'file-a');
    expect(importCountOf(reopened.importEvents, 'file-a')).toBe(1);
    expect(importCountOn(reopened.importEvents, 'file-a', TODAY)).toBe(1);
    const reopenedProject = reopened.projects.find((item) => item.id === 'file-a')!;
    expect(reopenedProject.nodes.map((node) => [node.title, node.content])).toEqual([
      ['第一章　起', '正文一'],
      ['第二章　承', '正文二'],
    ]);
    expect(reopened.logs.map((log) => log.date)).toContain(TODAY);
    reopened = reduce(reopened, { type: 'focus-project', id: 'file-a' });
    expect(totalImportDisplay(reopened)).toMatchObject({ importDisplay: '1', exportDisplay: '0' });

    // 同一份檔再開一次，也還是 1（不累加）
    const again = await openDb(reopened, saved.bytes, 'file-b');
    expect(importCountOf(again.importEvents, 'file-a')).toBe(1);
    expect(importCountOf(again.importEvents, 'file-b')).toBe(1);

    // 開回的那份改寫後再存、再開
    const edited = reduce(again, {
      type: 'commit-text',
      projectId: 'file-a',
      nodeId: reopenedProject.nodes[0]!.id,
      text: '正文一，改過。',
    });
    const resaved = await saveToDb(edited, 'file-a');
    expect(resaved.bytes).not.toEqual(saved.bytes);
    const third = await openDb(createState(new Date()), resaved.bytes, 'file-c');
    expect(importCountOf(third.importEvents, 'file-c')).toBe(1);
    // 原本那份匯入稿仍是 1，裝置上仍只有 1 筆事件
    expect(importCountOf(third.importEvents, id)).toBe(1);
    expect(Object.keys(third.importEvents.events)).toHaveLength(1);
  });

  it('WO-99：開啟從沒匯入過的 .db 不算匯入，仍是 0', async () => {
    let state = reduce(createState(NOW), { type: 'add-project', id: 'p-1700000000000', title: '一般新稿', shape: 'novel' });
    const saved = await saveToDb(state, 'p-1700000000000');
    state = await openDb(createState(new Date()), saved.bytes, 'file-plain');
    expect(importCountOf(state.importEvents, 'file-plain')).toBe(0);
    expect(readImportEvents(store).byFile).toEqual({});
  });

  it('WO-99（WO-100 調整）：相容性——不動 AI 次數與明細、大量貼上／刪除；.db 只多本單命名空間附加表、既有表不多欄、版本不變', async () => {
    // 程式產生的假「電腦版」紀錄，帶 AI 明細與次數
    const desktopLog: FileLog = {
      date: '2026-11-10',
      duration: 600,
      word_count: 321,
      ai_continuation_count: 3,
      ai_continuation_chars: 456,
      ai_chat_count: 2,
      ai_details: '{"假資料":[1,2,3]}',
      paste_large_count: 4,
      delete_large_count: 5,
    };
    const shellDb = await openMemoryDb(new Uint8Array());
    let desktopBytes: Uint8Array;
    try {
      writeFileProject(
        shellDb.sql,
        {
          title: '假電腦版稿',
          logline: '',
          currentTheme: '',
          globalFontFamily: '',
          globalFontSize: 12,
          editorFontFamily: '',
          editorFontSize: 16,
          targetWordCount: 100000,
          dailyTargetWordCount: 1000,
          categoryOrder: null,
          expandedCategories: null,
          categoriesMeta: '{}',
          lastOpenedNodeId: null,
          lastCursorPosition: 0,
        },
        [{ id: 'd-1', type: 'file', title: '第一章　', progress: 'Draft', content: '電腦版正文' }],
        [],
        [desktopLog],
      );
      desktopBytes = shellDb.exportBytes();
    } finally {
      shellDb.close();
    }
    let state = await openDb(createState(NOW), desktopBytes, 'file-desktop');
    const imported = await importText(state, '新匯入.txt', utf8('第一章\n匯入正文'));
    state = imported.state;
    const importedProjectId = importedId(imported.outcome);
    // 電腦版稿的紀錄不受影響
    expect(state.fileExtras['file-desktop']!.logs).toEqual([desktopLog]);
    const resaved = await saveToDb(state, 'file-desktop');
    const desktopAgain = await openMemoryDb(resaved.bytes);
    try {
      expect(readFileProject(desktopAgain.sql).logs).toEqual([desktopLog]);
    } finally {
      desktopAgain.close();
    }

    // 匯入稿存成 .db：AI 欄位都是 0、明細是 '{}'；除了本單命名空間附加表，資料表、欄位與版本跟一般新稿完全一樣
    const importedSave = await saveToDb(state, importedProjectId);
    const plain = reduce(createState(NOW), { type: 'add-project', id: 'p-1700000000001', title: '對照', shape: 'novel' });
    const plainSave = await saveToDb(plain, 'p-1700000000001');
    const schemaOf = async (bytes: Uint8Array) => {
      const db = await openMemoryDb(bytes);
      try {
        const tables = db.sql.select("SELECT name, sql FROM sqlite_master ORDER BY name");
        const logs = readFileProject(db.sql).logs;
        return { tables, version: currentSchemaVersion(db.sql), logs };
      } finally {
        db.close();
      }
    };
    const a = await schemaOf(importedSave.bytes);
    const b = await schemaOf(plainSave.bytes);
    const namespaced = new Set<string>(TRANSFER_TABLES);
    // 一般新稿（沒有匯入）不建附加表
    expect(b.tables.filter((row) => namespaced.has(String(row.name)))).toEqual([]);
    // 匯入稿只多本單兩張命名空間附加表，其他表的名稱與定義（欄位）完全一樣
    expect(a.tables.filter((row) => namespaced.has(String(row.name))).map((row) => row.name).sort()).toEqual(
      [...TRANSFER_TABLES].sort(),
    );
    expect(a.tables.filter((row) => !namespaced.has(String(row.name)) && !String(row.name).startsWith('sqlite_autoindex_jiufangm_'))).toEqual(b.tables);
    expect(a.version).toBe(b.version);
    expect(a.version).toBe(14);
    expect(a.logs).toEqual([
      {
        date: TODAY,
        duration: 0,
        word_count: 0,
        ai_continuation_count: 0,
        ai_continuation_chars: 0,
        ai_chat_count: 0,
        ai_details: '{}',
        paste_large_count: 0,
        delete_large_count: 0,
      },
    ]);
  });
});

describe('WO-99 50 萬字匯入', () => {
  beforeEach(() => {
    store = new MemoryStore();
  });

  function bigText(withHeadings: boolean): string {
    const paragraph = '霧氣自港口緩緩爬上石階，路燈一盞接一盞亮起。她把信紙摺成四折，塞進大衣口袋。'; // 40 字
    const parts: string[] = [];
    let length = 0;
    let chapter = 0;
    while (length < 500_000) {
      if (withHeadings && length % 5000 < paragraph.length + 1) {
        chapter += 1;
        parts.push(`第${chapter}章　假標題${chapter}`);
      }
      parts.push(paragraph);
      length += paragraph.length + 1;
    }
    return parts.join('\n');
  }

  it.each([
    ['有章名', true],
    ['沒有章名', false],
  ])('WO-99：%s 的 50 萬字內容完整、分批讓出、只 dispatch 一次，耗時合理', async (_label, withHeadings) => {
    const text = bigText(withHeadings);
    expect(text.length).toBeGreaterThanOrEqual(500_000);
    const bytes = utf8(text);
    // 各階段分開量（純函式），整體另外量完整匯入流程。
    const t0 = performance.now();
    const decoded = decodeTextBytes(bytes);
    const t1 = performance.now();
    expect(decoded.ok && decoded.text === text).toBe(true);
    const normalized = normalizeNewlines(text);
    const t2 = performance.now();
    await splitChaptersInBatches(normalized, { prefaceTitle: '前言', defaultTitle: '第一章\u3000' }, async () => undefined);
    const t3 = performance.now();
    let yields = 0;
    const started = performance.now();
    const result = await importText(createState(new Date()), '大檔.txt', bytes, {
      yieldToUi: async () => {
        yields += 1;
      },
    });
    const totalMs = performance.now() - started;
    const id = importedId(result.outcome);
    const project = result.state.projects.find((item) => item.id === id)!;
    if (withHeadings) {
      const rebuilt = project.nodes.map((node) => `${node.title}\n${node.content}`).join('\n');
      expect(rebuilt).toBe(text);
      expect(project.nodes.length).toBeGreaterThan(90);
      // 每 5000 行讓出一次，加上開頭兩次
      expect(yields).toBeGreaterThanOrEqual(3);
    } else {
      expect(project.nodes).toHaveLength(1);
      expect(project.nodes[0]!.content).toBe(text);
      expect(yields).toBeGreaterThanOrEqual(4);
    }
    expect(result.dispatched).toHaveLength(1);
    // 寬鬆門檻：一般電腦遠低於此；交接另記實測數字。
    expect(totalMs).toBeLessThan(5000);
    console.info(
      `[WO-99 50 萬字] ${_label}：${text.length} 字、${bytes.byteLength} 位元組、${project.nodes.length} 章、讓出 ${yields} 次；` +
        `解碼 ${(t1 - t0).toFixed(1)} ms、換行 ${(t2 - t1).toFixed(1)} ms、分章 ${(t3 - t2).toFixed(1)} ms、整體匯入（含本機寫入）${totalMs.toFixed(1)} ms`,
    );
  });
});
