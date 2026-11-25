import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writingDayKey } from '../domain/dailyGoal';
import { saveProjects, type KeyValueStore } from '../domain/outline';
import { summarizeStats } from '../domain/stats';
import { readBookBytes, writeBookBytes, type ImportedBook } from '../db/library';
import { createMemoryTargetStore } from '../db/fileTarget';
import { ensureBaseTables } from '../db/migrations';
import { readFileProject, type FileLog, type FileProjectInfo } from '../db/projectFile';
import type { SaveEnvironment } from '../db/saveProject';
import { saveProjectAsNew } from '../db/saveProject';
import { tableNames, type Sql } from '../db/sql';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import {
  readTransferData,
  TRANSFER_EVENTS_TABLE,
  TRANSFER_META_TABLE,
  type TransferEvent,
} from '../db/transferMeta';
import { openMemoryDb } from '../db/wasmDb';
import { LayoutProvider } from '../layout';
import { LogsScreen } from '../screens/LogsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { fingerprintBytes } from './deviceSaveRecord';
import {
  IMPORT_EVENTS_KEY,
  conflictingEventIds,
  countImportEvents,
  countImportEventsOn,
  readImportEvents,
  type ImportEventRecord,
} from './importEvents';
import {
  adoptImportEventsByFingerprint,
  attachActionForBook,
  createState,
  displayLogRows,
  linkImportEventsToBytes,
  manuscriptBytesOn,
  manuscriptSnapshotParts,
  projectExportEventsOf,
  projectImportEventsOf,
  reduce,
  runSaveProjectAs,
  runTextImport,
  SampleProvider,
  verifyBytesForSave,
  type Action,
  type SampleState,
  type TextImportOutcome,
} from './sampleStore';

/**
 * WO-100：匯入次數寫進稿子的 .db，跟著稿子走。
 * 全部用程式產生的假文字與記憶體假 .db，不碰真稿子或真 .db。
 *
 * 「清掉瀏覽器本機資料」在測試裡的做法：換一個全新的空白本機儲存（含 IMPORT_EVENTS_KEY、稿子清單、存檔紀錄全部清空），
 * 重新 createState（不帶任何舊狀態、舊 store、指紋快取或模組記憶體裡的稿子），App 本機稿件庫（IndexedDB）也不帶入；
 * 只保留先前輸出的 .db 位元組，再走與 App 開檔相同的讀檔路徑（readBookBytes → attachActionForBook）。
 */

const NOW = new Date('2026-11-16T07:40:00Z'); // 臺北 2026-11-16 15:40
const TODAY = writingDayKey(NOW, 0);
const utf8 = (text: string) => new TextEncoder().encode(text);

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

let store: MemoryStore;

/** 清掉這個網站在瀏覽器的所有本機資料：換全新空白本機儲存。 */
function clearBrowserData(): void {
  store = new MemoryStore();
  vi.stubGlobal('localStorage', store);
}

async function importText(state: SampleState, filename: string, text: string): Promise<{ state: SampleState; id: string }> {
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
    yieldToUi: async () => undefined,
  });
  if (outcome.kind !== 'imported') throw new Error(`匯入沒成功：${outcome.kind}`);
  return { state: current, id: outcome.id };
}

/** 儲存專案：與 App 同一套快照（含事件）寫在底稿位元組上，成功後升格並連本機指紋（WO-99 保留）。 */
async function saveToDb(
  state: SampleState,
  projectId: string,
  base: Uint8Array | null = null,
): Promise<{ state: SampleState; bytes: Uint8Array }> {
  const project = state.projects.find((item) => item.id === projectId)!;
  const parts = manuscriptSnapshotParts(state, project);
  const bytes = await manuscriptBytesOn(state, project, base);
  await verifyBytesForSave(bytes);
  let next = reduce(state, { type: 'promote-stored', projectId, key: parts.key, filename: `${project.title}.db` });
  const linked = await linkImportEventsToBytes(store, projectId, bytes);
  if (linked) next = reduce(next, { type: 'set-import-events', importEvents: linked });
  return { state: next, bytes };
}

/** 開檔：與 actions.importFile 相同——先算原始位元組指紋，讀檔（含檔內附加表），接回本機可靠對應，再 attach。 */
async function openDb(state: SampleState, bytes: Uint8Array, key: string): Promise<{ state: SampleState; book: ImportedBook }> {
  const rawFingerprint = await fingerprintBytes(bytes);
  const book = await readBookBytes('假稿.db', bytes, key);
  const adopted = adoptImportEventsByFingerprint(store, rawFingerprint, key);
  let next = state;
  if (adopted) next = reduce(next, { type: 'set-import-events', importEvents: adopted });
  next = reduce(next, attachActionForBook(book, { updatedLabel: '剛剛' }));
  return { state: next, book };
}

function countOf(state: SampleState, id: string): number {
  return countImportEvents(projectImportEventsOf(state, id));
}

function countOn(state: SampleState, id: string, day: string): number {
  return countImportEventsOn(projectImportEventsOf(state, id), day);
}

function statsDisplay(state: SampleState) {
  // WO-103：匯出次數也用真實的匯出事件集合（與 App 的 SampleProvider 相同算法）。
  const id = state.activeProjectId ?? '';
  return summarizeStats(state.schedule, state.logs, 0, countOf(state, id), countImportEvents(projectExportEventsOf(state, id))).importExport;
}

function render(state: SampleState, screen: 'stats' | 'logs', id: string, mode: 'phone-portrait' | 'wide' = 'phone-portrait'): string {
  const element = createElement(screen === 'stats' ? StatsScreen : LogsScreen);
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: state },
      createElement(
        LayoutProvider,
        { initialMode: mode },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${id}/${screen}`] },
          createElement(Routes, null, createElement(Route, { path: `/p/:projectId/${screen}`, element })),
        ),
      ),
    ),
  );
}
function dayCard(html: string, day: string): string {
  const start = html.indexOf(`data-testid="log-card-${day}"`);
  if (start < 0) return '';
  return html.slice(start, html.indexOf('</li>', start));
}

async function bytesEvents(bytes: Uint8Array) {
  const db = await openMemoryDb(bytes);
  try {
    return readTransferData(db.sql);
  } finally {
    db.close();
  }
}

async function mutate(bytes: Uint8Array, run: (sql: Sql) => void): Promise<Uint8Array> {
  const db = await openMemoryDb(bytes);
  try {
    run(db.sql);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

function fakeInfo(title: string): FileProjectInfo {
  return {
    title,
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
  };
}

/** 程式產生的假 .db：一章非空正文，可帶寫作紀錄與檔內事件。 */
async function fakeDb(title: string, logs: FileLog[], events?: Record<string, TransferEvent>): Promise<Uint8Array> {
  return writeBookBytes(
    null,
    fakeInfo(title),
    [{ id: `c-${title}`, type: 'file', title: '第一章　', progress: 'Draft', content: `${title}的假正文` }],
    [],
    logs,
    events,
  );
}

function fakeLog(date: string, extra: Partial<FileLog> = {}): FileLog {
  return {
    date,
    duration: 120,
    word_count: 50,
    ai_continuation_count: 1,
    ai_continuation_chars: 22,
    ai_chat_count: 3,
    ai_details: '{"假":1}',
    paste_large_count: 2,
    delete_large_count: 1,
    ...extra,
  };
}

/** 程式產生的「電腦版」v14 假庫，填入非空假正文（產生器本身正文為空）。沒有本單附加表。 */
async function desktopV14Bytes(): Promise<Uint8Array> {
  return mutate(await generateDesktopSampleBytes(), (sql) => {
    sql.run("UPDATE chapters SET content = '電腦版假正文一' WHERE id = 'ch-sample-doc-1'");
    sql.run("UPDATE chapters SET content = '電腦版假正文二' WHERE id = 'ch-sample-doc-2'");
    sql.run(
      `INSERT INTO writing_logs (date, duration, word_count, ai_continuation_count, ai_continuation_chars,
        ai_chat_count, ai_details, paste_large_count, delete_large_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['2026-11-01', 300, 400, 2, 88, 1, '{"續寫":2}', 3, 4],
    );
  });
}

/** 早期格式（沒有 schema_version、需要遷移）：重新匯出後位元組一定和原始不同。 */
async function legacyBytes(): Promise<Uint8Array> {
  return mutate(new Uint8Array(), (sql) => {
    ensureBaseTables(sql);
    sql.run('INSERT INTO project_info (title, logline, current_theme) VALUES (?, ?, ?)', ['早期假稿', '', '']);
    sql.run("INSERT INTO chapters (id, parent_id, name, node_type, content, mark, sort_order) VALUES ('c1', NULL, '第一章　', 'file', '早期假正文', 'Draft', 0)");
  });
}

function writeLocalRecord(record: ImportEventRecord): void {
  store.setItem(IMPORT_EVENTS_KEY, JSON.stringify(record));
}

const E1: TransferEvent = { dayKey: '2026-11-10', atMs: Date.parse('2026-11-10T02:00:00Z') };
const E2: TransferEvent = { dayKey: '2026-11-12', atMs: Date.parse('2026-11-12T02:00:00Z') };
const E3: TransferEvent = { dayKey: '2026-11-13', atMs: Date.parse('2026-11-13T02:00:00Z') };
const E4: TransferEvent = { dayKey: '2026-11-14', atMs: Date.parse('2026-11-14T02:00:00Z') };
const E5: TransferEvent = { dayKey: '2026-11-15', atMs: Date.parse('2026-11-15T02:00:00Z') };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  clearBrowserData();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WO-100 核心驗收：清掉瀏覽器本機資料後只靠 .db 重開，次數仍在', () => {
  it('WO-100：新匯入稿為 1，存成 .db；清掉本機（含匯入事件紀錄）後只開同一份位元組，全書 1、原寫作日 1，其他稿子不受影響，匯出為 0（WO-103 起開放，不再是「—」）', async () => {
    const first = await importText(createState(NOW), '假稿甲.txt', '第一章　起\n假正文一\n第二章　承\n假正文二');
    const other = await importText(first.state, '假稿乙.txt', '第一章\n另一份假正文');
    let state = reduce(other.state, { type: 'focus-project', id: first.id });
    expect(countOf(state, first.id)).toBe(1);
    expect(countOf(state, other.id)).toBe(1);

    const saved = await saveToDb(state, first.id);
    // 交付的位元組本身就帶事件：一筆 import、原寫作日、export_count NULL
    const inFile = await bytesEvents(saved.bytes);
    expect(inFile.kind).toBe('ok');
    if (inFile.kind !== 'ok') return;
    expect(Object.values(inFile.importEvents)).toEqual([{ dayKey: TODAY, atMs: expect.any(Number) }]);
    expect(inFile.exportCount).toBeNull();
    const eventId = Object.keys(inFile.importEvents)[0]!;
    expect(readImportEvents(store).byProject[first.id]).toEqual([eventId]); // 保留 WO-99 事件代號

    // 清掉瀏覽器所有本機資料，三天後在「新裝置」只開同一份位元組
    clearBrowserData();
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
    let clean = createState(new Date());
    expect(clean.projects).toEqual([]);
    expect(clean.importEvents).toEqual({ events: {}, byProject: {}, byFile: {} });
    clean = (await openDb(clean, saved.bytes, 'file-new-device')).state;

    expect(countOf(clean, 'file-new-device')).toBe(1);
    expect(countOn(clean, 'file-new-device', TODAY)).toBe(1);
    expect(Object.keys(projectImportEventsOf(clean, 'file-new-device'))).toEqual([eventId]);
    // WO-103：匯出已開放；這份檔沒有匯出事件，所以是 0（不是「—」，也不因匯入或存檔而增加）。
    expect(statsDisplay(clean)).toMatchObject({ importCount: 1, importDisplay: '1', exportCount: 0, exportDisplay: '0' });
    // 開檔不在本機捏造紀錄
    expect(store.getItem(IMPORT_EVENTS_KEY)).toBeNull();
    // 另一份稿子不在、也不串入
    expect(countOf(clean, other.id)).toBe(0);
    const project = clean.projects.find((item) => item.id === 'file-new-device')!;
    expect(project.nodes.map((node) => [node.title, node.content])).toEqual([
      ['第一章　起', '假正文一'],
      ['第二章　承', '假正文二'],
    ]);

    // 畫面：統計頁全書 1、匯出 0；寫作過程紀錄卡原寫作日 1（手機與寬版）
    const stats = render(clean, 'stats', 'file-new-device');
    // WO-120：統計頁改為一行匯入日期說明（原寫作日 TODAY），不再顯示次數
    expect(stats).toContain(`這份稿子是 ${TODAY.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1 年 $2 月 $3 日')}從文字檔匯入的。`);
    expect(stats).not.toContain('stats-import-count');
    expect(stats).not.toContain('stats-export-count');
    expect(stats).not.toContain('準備中');
    const logs = render(clean, 'logs', 'file-new-device');
    expect(dayCard(logs, TODAY)).toContain('這天從文字檔匯入');
    expect(dayCard(logs, TODAY)).not.toContain('匯出');
    const wide = render(clean, 'stats', 'file-new-device', 'wide');
    expect(dayCard(wide, TODAY)).toContain('這天從文字檔匯入');

    // 同一個乾淨環境開一份從沒匯入過的假 .db：0
    clean = (await openDb(clean, await fakeDb('一般假稿', [fakeLog('2026-11-02')]), 'file-plain')).state;
    expect(countOf(clean, 'file-plain')).toBe(0);
    expect(countOf(clean, 'file-new-device')).toBe(1);
    state = clean;
    expect(statsDisplay(state).exportDisplay).toBe('0');
  });
});

describe('WO-100 日期與隔離', () => {
  it('WO-100：不同寫作日按原 dayKey 分組；沒有紀錄列的事件日也有卡；不改舊紀錄欄位；改了每日結束時刻也不重算；不同稿子不串', async () => {
    const logsA = [fakeLog('2026-11-10')];
    const fileA = await fakeDb('假稿Ａ', logsA, { 'imp-a1': E1, 'imp-a2': E2 });
    const fileB = await fakeDb('假稿Ｂ', [fakeLog('2026-11-13')], { 'imp-b1': E3 });

    let state = createState(NOW);
    state = (await openDb(state, fileB, 'file-b')).state;
    const opened = await openDb(state, fileA, 'file-a');
    state = opened.state;
    expect(countOf(state, 'file-a')).toBe(2);
    expect(countOf(state, 'file-b')).toBe(1);
    expect(countOn(state, 'file-a', '2026-11-10')).toBe(1);
    expect(countOn(state, 'file-a', '2026-11-12')).toBe(1);
    expect(countOn(state, 'file-a', '2026-11-13')).toBe(0);
    // 2026-11-12 沒有紀錄列，仍顯示一張日卡
    expect(state.logs.map((log) => log.date)).toEqual(['2026-11-10']);
    expect(displayLogRows(state, 'file-a').map((row) => row.date)).toEqual(['2026-11-12', '2026-11-10']);
    const html = render(state, 'logs', 'file-a');
    expect(dayCard(html, '2026-11-12')).toContain('這天從文字檔匯入');
    expect(dayCard(html, '2026-11-10')).toContain('這天從文字檔匯入');
    expect(dayCard(html, '2026-11-13')).toBe('');

    // 改每日結束時刻後重存、清本機、重開：事件 dayKey／atMs 原樣，舊紀錄列逐欄不變，沒多寫一列
    state = reduce(state, { type: 'set-hour', hour: 4 });
    const resaved = await saveToDb(state, 'file-a', opened.book.bytes);
    clearBrowserData();
    const reopened = await openDb(createState(new Date()), resaved.bytes, 'file-a2');
    expect(projectImportEventsOf(reopened.state, 'file-a2')).toEqual({ 'imp-a1': E1, 'imp-a2': E2 });
    expect(reopened.book.logs).toEqual(logsA);
    expect(countOf(reopened.state, 'file-b')).toBe(0);
  });
});

describe('WO-100 重存／另存／重開不重複', () => {
  async function phoneSaveAs(state: SampleState, id: string, via: 'downloaded' | 'cancelled') {
    let next = state;
    const dispatched: Action[] = [];
    let handed: Uint8Array | null = null;
    const env: SaveEnvironment = {
      canPickFiles: false,
      targets: createMemoryTargetStore(),
      verify: verifyBytesForSave,
      pickSaveLocation: async () => null,
      share: async (_name, bytes) => {
        handed = bytes;
        return via;
      },
    };
    const project = state.projects.find((item) => item.id === id)!;
    const result = await runSaveProjectAs({
      state,
      project,
      dispatch: (action) => {
        dispatched.push(action);
        next = reduce(next, action);
      },
      env,
      preparedBytes: null,
      snapshot: async (snapState, item) => ({
        key: item.dbKey ?? item.id,
        bytes: await manuscriptBytesOn(snapState, item, null),
      }),
    });
    return { next, dispatched, handed: handed as Uint8Array | null, outcome: result.outcome };
  }

  it('WO-100：多次重存、手機另存（下載）、多次開回、改正文再存開，次數都是 1；清本機後仍相同', async () => {
    const imported = await importText(createState(NOW), '往返假稿.txt', '第一章\n假正文');
    let state = reduce(imported.state, { type: 'focus-project', id: imported.id });

    // 手機另存交付的位元組也帶事件
    const phone = await phoneSaveAs(state, imported.id, 'downloaded');
    expect(phone.outcome.kind).toBe('handed-off');
    const handedEvents = await bytesEvents(phone.handed!);
    expect(handedEvents.kind === 'ok' && Object.keys(handedEvents.importEvents)).toHaveLength(1);
    state = phone.next;

    // 預備分享、暫存、儲存、另存都取同一份快照事件
    const project = state.projects.find((item) => item.id === imported.id)!;
    expect(Object.keys(manuscriptSnapshotParts(state, project).importEvents)).toHaveLength(1);

    let saved = await saveToDb(state, imported.id, phone.handed);
    for (let index = 0; index < 3; index += 1) saved = await saveToDb(saved.state, imported.id, saved.bytes);
    const db = await openMemoryDb(saved.bytes);
    try {
      expect(db.sql.select(`SELECT COUNT(*) AS n FROM ${TRANSFER_EVENTS_TABLE}`)[0]!.n).toBe(1);
    } finally {
      db.close();
    }

    // 同一環境（本機也有對應）開回：檔內與本機同代號只算一次
    const sameDevice = await openDb(saved.state, saved.bytes, 'file-same');
    expect(countOf(sameDevice.state, 'file-same')).toBe(1);

    // 清本機，開兩次同一份
    clearBrowserData();
    let clean = (await openDb(createState(new Date()), saved.bytes, 'file-a')).state;
    const opened = await openDb(clean, saved.bytes, 'file-b');
    clean = opened.state;
    expect(countOf(clean, 'file-a')).toBe(1);
    expect(countOf(clean, 'file-b')).toBe(1);

    // 改正文再存（沿用開檔後的本機副本位元組），清本機再開
    clean = reduce(clean, { type: 'focus-project', id: 'file-b' });
    const chapterId = clean.projects.find((item) => item.id === 'file-b')!.nodes[0]!.id;
    clean = reduce(clean, { type: 'commit-text', projectId: 'file-b', nodeId: chapterId, text: '改過的假正文' });
    const edited = await saveToDb(clean, 'file-b', opened.book.bytes);
    clearBrowserData();
    const third = await openDb(createState(new Date()), edited.bytes, 'file-c');
    expect(countOf(third.state, 'file-c')).toBe(1);
    expect(countOn(third.state, 'file-c', TODAY)).toBe(1);
    expect(third.book.tree[0]!.content).toBe('改過的假正文');
  });

  it('WO-100：手機另存取消維持 WO-98 狀態不變（不升格、不連指紋、不改事件）', async () => {
    const imported = await importText(createState(NOW), '取消假稿.txt', '第一章\n假正文');
    const state = reduce(imported.state, { type: 'focus-project', id: imported.id });
    const recordBefore = store.getItem(IMPORT_EVENTS_KEY);
    const cancelled = await phoneSaveAs(state, imported.id, 'cancelled');
    expect(cancelled.outcome).toEqual({ kind: 'cancelled' });
    expect(cancelled.dispatched).toEqual([]);
    expect(cancelled.next).toBe(state);
    expect(store.getItem(IMPORT_EVENTS_KEY)).toBe(recordBefore);
    expect(state.projects.find((item) => item.id === imported.id)!.origin).not.toBe('file');
  });

  it('WO-100：交付失敗（分享丟錯）不升格、不建立指紋對應，不宣稱外部檔已保存', async () => {
    const imported = await importText(createState(NOW), '失敗假稿.txt', '第一章\n假正文');
    const state = reduce(imported.state, { type: 'focus-project', id: imported.id });
    const recordBefore = store.getItem(IMPORT_EVENTS_KEY);
    let next = state;
    await expect(
      runSaveProjectAs({
        state,
        project: state.projects.find((item) => item.id === imported.id)!,
        dispatch: (action) => void (next = reduce(next, action)),
        env: {
          canPickFiles: false,
          targets: createMemoryTargetStore(),
          verify: verifyBytesForSave,
          pickSaveLocation: async () => null,
          share: async () => {
            throw new Error('模擬分享失敗');
          },
        },
        preparedBytes: null,
        snapshot: async (snapState, item) => ({ key: item.id, bytes: await manuscriptBytesOn(snapState, item, null) }),
      }),
    ).rejects.toThrow('模擬分享失敗');
    expect(next).toBe(state);
    expect(store.getItem(IMPORT_EVENTS_KEY)).toBe(recordBefore);
    expect(readImportEvents(store).byFile).toEqual({});
  });
});

describe('WO-100 無附加表的舊檔', () => {
  it('WO-100：電腦版 v14 假庫（沒有附加表）、沒有本機對應 → 0；開存不建附加表、內容不變', async () => {
    const original = await desktopV14Bytes();
    const opened = await openDb(createState(NOW), original, 'file-desktop');
    expect(opened.book.transfer).toEqual({ kind: 'absent' });
    expect(countOf(opened.state, 'file-desktop')).toBe(0);
    const saved = await saveToDb(opened.state, 'file-desktop', opened.book.bytes);
    const db = await openMemoryDb(saved.bytes);
    try {
      expect(tableNames(db.sql).has(TRANSFER_META_TABLE)).toBe(false);
      expect(tableNames(db.sql).has(TRANSFER_EVENTS_TABLE)).toBe(false);
    } finally {
      db.close();
    }
  });

  it('WO-100：有可靠本機對應（原始位元組指紋）就沿用；存回再清本機重開，次數仍在；章名、非空正文、卡片、舊紀錄逐欄不變', async () => {
    const original = await desktopV14Bytes();
    const rawFp = (await fingerprintBytes(original))!;
    writeLocalRecord({
      events: { 'imp-old-1': E1, 'imp-old-2': E2 },
      byProject: { 'p-1762000000000': ['imp-old-1', 'imp-old-2'] },
      byFile: { [rawFp]: ['imp-old-1', 'imp-old-2'] },
    });
    const before = await readBookBytes('原.db', original, 'x');
    const opened = await openDb(createState(NOW), original, 'file-desktop');
    expect(countOf(opened.state, 'file-desktop')).toBe(2);

    const saved = await saveToDb(opened.state, 'file-desktop', opened.book.bytes);
    // 成功遷移不刪舊紀錄
    const kept = readImportEvents(store);
    expect(kept.events).toEqual({ 'imp-old-1': E1, 'imp-old-2': E2 });
    expect(kept.byFile[rawFp]).toEqual(['imp-old-1', 'imp-old-2']);
    expect(kept.byProject['p-1762000000000']).toEqual(['imp-old-1', 'imp-old-2']);

    clearBrowserData();
    const reopened = await openDb(createState(new Date()), saved.bytes, 'file-again');
    expect(projectImportEventsOf(reopened.state, 'file-again')).toEqual({ 'imp-old-1': E1, 'imp-old-2': E2 });
    expect(reopened.book.tree).toEqual(before.tree);
    expect(reopened.book.cards).toEqual(before.cards);
    expect(reopened.book.logs).toEqual(before.logs);
    expect(reopened.book.info.title).toBe(before.info.title);
  });
});

describe('WO-100 舊本機紀錄遷移', () => {
  it('WO-100：尚未存成檔案的本機稿用原有 byProject；存檔後清本機重開仍在', async () => {
    const draftId = 'p-1762500000000';
    const first = reduce(createState(NOW), { type: 'add-project', id: draftId, title: '本機假稿', shape: 'novel', startedMs: 1762500000000 });
    saveProjects(store, first.projects);
    writeLocalRecord({ events: { 'imp-d1': E1, 'imp-d2': E2 }, byProject: { [draftId]: ['imp-d1', 'imp-d2'] }, byFile: {} });

    let state = reduce(createState(NOW), { type: 'focus-project', id: draftId });
    expect(countOf(state, draftId)).toBe(2);
    expect(displayLogRows(state, draftId).map((row) => row.date)).toEqual(['2026-11-12', '2026-11-10']);
    const saved = await saveToDb(state, draftId);
    state = saved.state;
    expect(countOf(state, draftId)).toBe(2);
    clearBrowserData();
    const reopened = await openDb(createState(new Date()), saved.bytes, 'file-draft');
    expect(projectImportEventsOf(reopened.state, 'file-draft')).toEqual({ 'imp-d1': E1, 'imp-d2': E2 });
  });

  it('WO-100：原始位元組與重新匯出位元組不同時，用原始位元組的指紋才對得上；重新匯出的指紋對不上', async () => {
    const raw = await legacyBytes();
    const rawFp = (await fingerprintBytes(raw))!;
    writeLocalRecord({ events: { 'imp-l1': E1 }, byProject: { 'p-1761000000000': ['imp-l1'] }, byFile: { [rawFp]: ['imp-l1'] } });
    const book = await readBookBytes('早期.db', raw, 'probe');
    const exportedFp = (await fingerprintBytes(book.bytes))!;
    expect(exportedFp).not.toBe(rawFp);
    expect(adoptImportEventsByFingerprint(store, exportedFp, 'probe')).toBeNull();

    const opened = await openDb(createState(NOW), raw, 'file-legacy');
    expect(countOf(opened.state, 'file-legacy')).toBe(1);
    const saved = await saveToDb(opened.state, 'file-legacy', opened.book.bytes);
    clearBrowserData();
    const reopened = await openDb(createState(new Date()), saved.bytes, 'file-legacy2');
    expect(projectImportEventsOf(reopened.state, 'file-legacy2')).toEqual({ 'imp-l1': E1 });
    expect(reopened.book.tree[0]!.content).toBe('早期假正文');
  });

  it('WO-100：檔內與本機重複及不同事件以事件代號取聯集——不相加、不取較大值', async () => {
    const file = await fakeDb('聯集假稿', [fakeLog('2026-11-13')], { 'imp-3': E3, 'imp-4': E4 });
    const fp = (await fingerprintBytes(file))!;
    writeLocalRecord({ events: { 'imp-3': E3, 'imp-5': E5 }, byProject: {}, byFile: { [fp]: ['imp-3', 'imp-5'] } });
    const opened = await openDb(createState(NOW), file, 'file-union');
    // 檔內 2、本機 2：聯集 3（不是 4，也不是 2）
    expect(Object.keys(projectImportEventsOf(opened.state, 'file-union')).sort()).toEqual(['imp-3', 'imp-4', 'imp-5']);
    const saved = await saveToDb(opened.state, 'file-union', opened.book.bytes);
    clearBrowserData();
    const reopened = await openDb(createState(new Date()), saved.bytes, 'file-union2');
    expect(projectImportEventsOf(reopened.state, 'file-union2')).toEqual({ 'imp-3': E3, 'imp-4': E4, 'imp-5': E5 });
  });

  it('WO-100：同代號本機與檔內內容不同時以檔內為準、不重複算，存回也不覆寫檔內那筆', async () => {
    const file = await fakeDb('衝突假稿', [], { 'imp-3': E3 });
    const fp = (await fingerprintBytes(file))!;
    writeLocalRecord({ events: { 'imp-3': E5 }, byProject: {}, byFile: { [fp]: ['imp-3'] } });
    const opened = await openDb(createState(NOW), file, 'file-conflict');
    expect(projectImportEventsOf(opened.state, 'file-conflict')).toEqual({ 'imp-3': E3 });
    const transfer = opened.book.transfer;
    expect(transfer.kind).toBe('ok');
    if (transfer.kind !== 'ok') return;
    expect(conflictingEventIds(opened.state.importEvents, 'file-conflict', transfer.importEvents)).toEqual(['imp-3']);
    const saved = await saveToDb(opened.state, 'file-conflict', opened.book.bytes);
    const read = await bytesEvents(saved.bytes);
    expect(read.kind === 'ok' && read.importEvents).toEqual({ 'imp-3': E3 });
  });

  it('WO-100：指紋不符（同檔名但內容被改過）不靠檔名接回，讀為 0', async () => {
    const original = await desktopV14Bytes();
    const fp = (await fingerprintBytes(original))!;
    writeLocalRecord({ events: { 'imp-x': E1 }, byProject: {}, byFile: { [fp]: ['imp-x'] } });
    const changed = await mutate(original, (sql) => sql.run("UPDATE chapters SET content = '別的程式改過' WHERE id = 'ch-sample-doc-1'"));
    const opened = await openDb(createState(NOW), changed, 'file-changed');
    expect(countOf(opened.state, 'file-changed')).toBe(0);
    expect(readImportEvents(store).byProject['file-changed']).toBeUndefined();
  });
});

describe('WO-100 格式錯誤與匯出預留（稿子狀態層）', () => {
  it('WO-100／WO-137：附加資料損壞（corrupt）的檔：不讀成 0 覆寫；本機副本不動附加表；外部存檔前檢查擋下（較新修訂值則放行）', async () => {
    const good = await fakeDb('修訂值假稿', [], { 'imp-1': E1 });
    const newer = await mutate(good, (sql) => sql.exec(`UPDATE ${TRANSFER_META_TABLE} SET format_revision = 99`));
    const openedNewer = await openDb(createState(NOW), newer, 'file-newer');
    expect(openedNewer.book.transfer).toEqual({ kind: 'newer-revision', revision: 99 });
    const newerProject = openedNewer.state.projects.find((item) => item.id === 'file-newer')!;
    const newerLocalCopy = await manuscriptBytesOn(openedNewer.state, newerProject, openedNewer.book.bytes);
    await expect(verifyBytesForSave(newerLocalCopy)).resolves.toBeUndefined();

    const bad = await mutate(good, (sql) => sql.exec(`UPDATE ${TRANSFER_META_TABLE} SET format_revision = 'v99'`));
    const opened = await openDb(createState(NOW), bad, 'file-bad');
    expect(opened.book.transfer.kind).toBe('corrupt');
    // 本機副本（底稿即開檔後的副本）照常寫正文，但附加表原樣
    const project = opened.state.projects.find((item) => item.id === 'file-bad')!;
    const localCopy = await manuscriptBytesOn(opened.state, project, opened.book.bytes);
    const db = await openMemoryDb(localCopy);
    try {
      expect(db.sql.select(`SELECT format_revision FROM ${TRANSFER_META_TABLE}`)[0]!.format_revision).toBe('v99');
      expect(readFileProject(db.sql).transfer.kind).toBe('corrupt');
    } finally {
      db.close();
    }
    await expect(verifyBytesForSave(localCopy)).rejects.toThrow();
    // 另存路徑：驗證失敗就不交出去，回「存檔失敗」
    let shareCalled = false;
    const outcome = await saveProjectAsNew(
      {
        canPickFiles: false,
        targets: createMemoryTargetStore(),
        verify: verifyBytesForSave,
        pickSaveLocation: async () => null,
        share: async () => {
          shareCalled = true;
          return 'downloaded';
        },
      },
      'file-bad',
      localCopy,
      '修訂值假稿.db',
    );
    expect(outcome).toEqual({ kind: 'invalid-database' });
    expect(shareCalled).toBe(false);
  });

  it('WO-100／WO-103：export_count 預設 NULL、重存保留；儲存／另存不計全文匯出、不產生匯出事件；統計與卡片為 0（不是「—」）', async () => {
    const imported = await importText(createState(NOW), '匯出預留.txt', '第一章\n假正文');
    let state = reduce(imported.state, { type: 'focus-project', id: imported.id });
    const first = await saveToDb(state, imported.id);
    const second = await saveToDb(first.state, imported.id, first.bytes);
    state = second.state;
    const db = await openMemoryDb(second.bytes);
    try {
      expect(db.sql.select(`SELECT export_count FROM ${TRANSFER_META_TABLE}`)).toEqual([{ export_count: null }]);
      expect(db.sql.select(`SELECT kind, COUNT(*) AS n FROM ${TRANSFER_EVENTS_TABLE} GROUP BY kind`)).toEqual([{ kind: 'import', n: 1 }]);
    } finally {
      db.close();
    }
    expect(statsDisplay(state)).toMatchObject({ exportCount: 0, exportDisplay: '0' });
    expect(countImportEvents(projectExportEventsOf(state, imported.id))).toBe(0);
    const html = render(state, 'logs', imported.id);
    expect(dayCard(html, TODAY)).not.toContain('匯出');
  });
});
