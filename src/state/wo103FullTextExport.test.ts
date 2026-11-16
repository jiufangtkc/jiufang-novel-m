import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findNode } from '../data/demo';
import { writingDayKey } from '../domain/dailyGoal';
import { buildTxt, planExport, toggleSelection } from '../domain/fullTextExport';
import type { KeyValueStore } from '../domain/outline';
import { summarizeStats } from '../domain/stats';
import { DOCX_MIME, TXT_MIME, type DeliveryResult } from '../db/fileDelivery';
import { readBookBytes, writeBookBytes } from '../db/library';
import { readFileProject, writeFileProject, type FileProjectInfo } from '../db/projectFile';
import {
  readTransferData,
  TRANSFER_EVENTS_TABLE,
  TRANSFER_META_TABLE,
  TransferDataError,
  type TransferEvent,
} from '../db/transferMeta';
import { openMemoryDb } from '../db/wasmDb';
import { fakeBookNodes, docxParagraphs, unzip, FAKE_CLICK_ORDER } from '../domain/testing/wo103FakeBook';
import { LayoutProvider } from '../layout';
import { LogsScreen } from '../screens/LogsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { fingerprintBytes } from './deviceSaveRecord';
import { EXPORT_EVENTS_KEY, IMPORT_EVENTS_KEY, countImportEvents, countImportEventsOn, readExportEvents } from './importEvents';
import {
  adoptExportEventsByFingerprint,
  attachActionForBook,
  createState,
  displayLogRows,
  linkExportEventsToBytes,
  manuscriptBytesOn,
  projectExportEventsOf,
  projectImportEventsOf,
  reduce,
  runFullTextExport,
  SampleProvider,
  verifyBytesForSave,
  type FullTextExportOutcome,
  type FullTextExportRequest,
  type SampleState,
} from './sampleStore';

/**
 * WO-103：匯出全文（Word／TXT、全文／自選章節）的計次與紀錄。
 * 全部是程式產生的假稿、假狀態與記憶體假 .db；不碰真稿子或真 .db。
 */

const NOW = new Date('2026-11-16T13:30:00Z'); // 臺北 2026-11-16 21:30
const TODAY = writingDayKey(NOW, 0);
const DRAFT_ID = `p-${Date.parse('2026-11-15T01:00:00Z')}`;

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('模擬本機寫不進去');
    this.data.set(key, value);
  }
}

let store: MemoryStore;

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

function draftState(): SampleState {
  let state = createState(NOW);
  state = reduce(state, { type: 'add-project', id: DRAFT_ID, title: '霧港假稿', shape: 'novel', startedMs: NOW.getTime() });
  state = reduce(state, { type: 'set-nodes', projectId: DRAFT_ID, nodes: fakeBookNodes() });
  state = reduce(state, { type: 'focus-project', id: DRAFT_ID });
  // 開新稿子本身的提示先清掉，才看得出匯出有沒有另跳提示
  return reduce(state, { type: 'toast', message: null });
}

interface Delivered {
  file: File;
}

function deliverer(result: DeliveryResult | Error = 'shared') {
  const calls: Delivered[] = [];
  const deliver = async (file: File): Promise<DeliveryResult> => {
    calls.push({ file });
    if (result instanceof Error) throw result;
    return result;
  };
  return { deliver, calls };
}

let eventSeq = 0;
async function exportOnce(
  state: SampleState,
  request: Partial<FullTextExportRequest> = {},
  options: Partial<Parameters<typeof runFullTextExport>[0]> = {},
): Promise<{ state: SampleState; outcome: FullTextExportOutcome; calls: Delivered[] }> {
  let current = state;
  const { deliver, calls } = deliverer();
  const outcome = await runFullTextExport({
    request: { projectId: DRAFT_ID, format: 'docx', scope: 'all', ...request },
    getState: () => current,
    dispatch: (action) => {
      current = reduce(current, action);
    },
    store,
    busy: { current: false },
    deliver,
    now: () => new Date(),
    newEventId: (projectId) => `exp-${projectId}-${(eventSeq += 1)}`,
    liveDraft: null,
    ...options,
  });
  return { state: current, outcome, calls };
}

const total = (state: SampleState, id = DRAFT_ID) => countImportEvents(projectExportEventsOf(state, id));
const onDay = (state: SampleState, day: string, id = DRAFT_ID) => countImportEventsOn(projectExportEventsOf(state, id), day);

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

describe('WO-103 成功匯出才計次（Word、TXT、全文、自選各一次）', () => {
  it('Word 全文、TXT 全文、Word 自選、TXT 自選各 +1；章數不影響次數；交付的檔名、MIME、內容正確', async () => {
    let state = draftState();
    expect(total(state)).toBe(0);
    const nodes = fakeBookNodes();
    let selected = new Set<string>();
    for (const id of FAKE_CLICK_ORDER) selected = toggleSelection(findNode(nodes, id)!, selected);

    const steps: Array<[FullTextExportRequest['format'], FullTextExportRequest['scope']]> = [
      ['docx', 'all'],
      ['txt', 'all'],
      ['docx', 'selected'],
      ['txt', 'selected'],
    ];
    const files: File[] = [];
    for (const [index, [format, scope]] of steps.entries()) {
      const run = await exportOnce(state, { format, scope, selected });
      expect(run.outcome).toMatchObject({ kind: 'delivered', via: 'shared', local: 'saved', file: 'not-stored' });
      expect(run.calls).toHaveLength(1);
      files.push(run.calls[0]!.file);
      state = run.state;
      expect(total(state)).toBe(index + 1);
    }
    expect(onDay(state, TODAY)).toBe(4);

    const stamp = '20261116-2130';
    const local = new Date(NOW);
    const pad = (n: number) => String(n).padStart(2, '0');
    const localStamp = `${local.getFullYear()}${pad(local.getMonth() + 1)}${pad(local.getDate())}-${pad(local.getHours())}${pad(local.getMinutes())}`;
    expect(files.map((file) => file.name)).toEqual([
      `霧港假稿_全文_${localStamp}.docx`,
      `霧港假稿_全文_${localStamp}.txt`,
      `霧港假稿_自選章節_${localStamp}.docx`,
      `霧港假稿_自選章節_${localStamp}.txt`,
    ]);
    expect(stamp.length).toBe(localStamp.length);
    expect(files.map((file) => file.type)).toEqual([DOCX_MIME, TXT_MIME, DOCX_MIME, TXT_MIME]);
    expect(await files[1]!.text()).toBe(buildTxt(planExport(nodes, 'all')));
    expect(await files[3]!.text()).toBe(buildTxt(planExport(nodes, 'selected', selected)));
    const docxText = docxParagraphs(new TextDecoder().decode(unzip(new Uint8Array(await files[2]!.arrayBuffer())).get('word/document.xml')!))
      .map((p) => p.text);
    expect(docxText[0]).toBe('第一卷　霧港');
    expect(docxText).not.toContain('外篇　未分卷');

    // 本機紀錄就是 4 筆、全部掛在這份稿子、同一個寫作日
    const record = readExportEvents(store);
    expect(record.byProject[DRAFT_ID]).toHaveLength(4);
    expect(Object.values(record.events).map((event) => event.dayKey)).toEqual([TODAY, TODAY, TODAY, TODAY]);
    // 不加字數、不加寫作時間、不動匯入次數
    expect(state.logs.find((log) => log.date === TODAY)?.word_count ?? 0).toBe(0);
    expect(state.logs.reduce((sum, log) => sum + log.duration, 0)).toBe(0);
    expect(countImportEvents(projectImportEventsOf(state, DRAFT_ID))).toBe(0);
    expect(store.getItem(IMPORT_EVENTS_KEY)).toBeNull();
  });

  it('下載交付（無分享能力）同樣算成功一次', async () => {
    const { deliver } = deliverer('downloaded');
    const run = await exportOnce(draftState(), { format: 'txt' }, { deliver });
    expect(run.outcome).toMatchObject({ kind: 'delivered', via: 'downloaded' });
    expect(total(run.state)).toBe(1);
  });
});

describe('WO-103 不計次：取消、失敗、空選取、無章', () => {
  it('分享取消：不計次、不跳錯誤；交付拋錯：回 failed、不計次；產生檔案失敗：不交付、不計次', async () => {
    const state = draftState();
    const cancel = deliverer('cancelled');
    const cancelled = await exportOnce(state, {}, { deliver: cancel.deliver });
    expect(cancelled.outcome).toEqual({ kind: 'cancelled' });
    expect(total(cancelled.state)).toBe(0);
    expect(cancelled.state.toast).toBeNull();

    const broken = deliverer(new Error('模擬裝置無法儲存'));
    const failed = await exportOnce(state, {}, { deliver: broken.deliver });
    expect(failed.outcome).toEqual({ kind: 'failed' });
    expect(total(failed.state)).toBe(0);

    const never = deliverer();
    const buildFailed = await exportOnce(state, { format: 'docx' }, {
      deliver: never.deliver,
      buildDocx: async () => {
        throw new Error('模擬產生失敗');
      },
    });
    expect(buildFailed.outcome).toEqual({ kind: 'failed' });
    expect(never.calls).toHaveLength(0);
    expect(store.getItem(EXPORT_EVENTS_KEY)).toBeNull();
  });

  it('自選卻一章都沒選、稿子沒有任何章（只有空卷）：回 empty，不交付空檔、不計次', async () => {
    const none = deliverer();
    const empty = await exportOnce(draftState(), { scope: 'selected', selected: new Set() }, { deliver: none.deliver });
    expect(empty.outcome).toEqual({ kind: 'empty' });
    let blank = reduce(draftState(), { type: 'set-nodes', projectId: DRAFT_ID, nodes: [{ id: 'v', type: 'folder', title: '空卷', children: [] }] });
    const noChapters = await exportOnce(blank, { scope: 'all' }, { deliver: none.deliver });
    expect(noChapters.outcome).toEqual({ kind: 'empty' });
    blank = noChapters.state;
    expect(none.calls).toHaveLength(0);
    expect(total(blank)).toBe(0);
  });

  it('畫面已關閉（isCancelled）就不交付、不計次', async () => {
    const none = deliverer();
    const run = await exportOnce(draftState(), {}, { deliver: none.deliver, isCancelled: () => true });
    expect(run.outcome).toEqual({ kind: 'cancelled' });
    expect(none.calls).toHaveLength(0);
    expect(total(run.state)).toBe(0);
  });

  it('手勢失效：先不計次並回備妥的檔案；使用者再點「儲存檔案」交付同一份檔案後才 +1', async () => {
    const gesture = deliverer('needs-gesture');
    const first = await exportOnce(draftState(), { format: 'docx' }, { deliver: gesture.deliver });
    expect(first.outcome.kind).toBe('needs-gesture');
    expect(total(first.state)).toBe(0);
    if (first.outcome.kind !== 'needs-gesture') return;
    const prepared = first.outcome.prepared;
    const again = deliverer('shared');
    const second = await exportOnce(first.state, {}, { deliver: again.deliver, prepared, buildDocx: async () => { throw new Error('不該重新產生'); } });
    expect(second.outcome.kind).toBe('delivered');
    expect(again.calls[0]!.file).toBe(prepared.file);
    expect(total(second.state)).toBe(1);
  });
});

describe('WO-103 重複點擊與重試', () => {
  it('產生或交付期間再按一次回 busy，不重複交付、只記一筆；之後重試成功才再 +1', async () => {
    let current = draftState();
    const busy = { current: false };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: File[] = [];
    const deliver = async (file: File): Promise<DeliveryResult> => {
      calls.push(file);
      await gate;
      return 'shared';
    };
    const common = {
      request: { projectId: DRAFT_ID, format: 'txt' as const, scope: 'all' as const },
      getState: () => current,
      dispatch: (action: Parameters<typeof reduce>[1]) => {
        current = reduce(current, action);
      },
      store,
      busy,
      deliver,
      liveDraft: null,
    };
    const first = runFullTextExport(common);
    const second = await runFullTextExport(common);
    expect(second).toEqual({ kind: 'busy' });
    release();
    expect((await first).kind).toBe('delivered');
    expect(calls).toHaveLength(1);
    expect(total(current)).toBe(1);
    const retry = await runFullTextExport(common);
    expect(retry.kind).toBe('delivered');
    expect(total(current)).toBe(2);
  });
});

describe('WO-103 紀錄寫入失敗：交付結果與持久化狀態分開', () => {
  it('本機寫不進去：檔案照樣交付、不跳提示、回 local: not-saved，不假稱已保存；下次成功寫入時一起補寫', async () => {
    store.failWrites = true;
    const first = await exportOnce(draftState());
    expect(first.outcome).toMatchObject({ kind: 'delivered', local: 'not-saved' });
    expect(first.state.toast).toBeNull();
    expect(store.getItem(EXPORT_EVENTS_KEY)).toBeNull();
    expect(total(first.state)).toBe(1); // 這次開著的畫面看得到（記憶體），但沒有宣稱已存
    store.failWrites = false;
    const second = await exportOnce(first.state);
    expect(second.outcome).toMatchObject({ kind: 'delivered', local: 'saved' });
    expect(readExportEvents(store).byProject[DRAFT_ID]).toHaveLength(2);
    expect(total(second.state)).toBe(2);
  });

  it('已存成 .db 的稿子：事件寫進 .db 成功回 file: saved；附加表寫不進去（TransferDataError）回 record-failed，不跳提示、不假增檔內計數', async () => {
    const book = await readBookBytes('假稿.db', await fakeDb('檔案假稿'), 'file-a');
    let state = reduce(createState(NOW), attachActionForBook(book, { updatedLabel: '剛剛' }));
    state = reduce(state, { type: 'focus-project', id: 'file-a' });
    const snapshots: SampleState[] = [];
    const ok = await exportOnce(state, { projectId: 'file-a' }, {
      snapshot: async (snap) => {
        snapshots.push(snap);
        return { key: 'file-a', bytes: new Uint8Array() };
      },
    });
    expect(ok.outcome).toMatchObject({ kind: 'delivered', local: 'saved', file: 'saved' });
    // 寫進 .db 的快照已含這次事件
    expect(countImportEvents(projectExportEventsOf(snapshots[0]!, 'file-a'))).toBe(1);

    const recordFailed = await exportOnce(ok.state, { projectId: 'file-a' }, {
      snapshot: async () => {
        throw new TransferDataError('模擬附加表寫不進去');
      },
    });
    expect(recordFailed.outcome).toMatchObject({ kind: 'delivered', via: 'shared', file: 'record-failed', local: 'saved' });
    expect(recordFailed.state.toast).toBeNull();
    // 檔內紀錄（開檔時讀到的）仍是原樣，沒有被假裝加上
    const transfer = recordFailed.state.fileExtras['file-a']!.transfer;
    expect(transfer?.kind === 'ok' ? Object.keys(transfer.exportEvents) : 'absent').toBe('absent');
    expect(total(recordFailed.state, 'file-a')).toBe(2); // 本機可靠紀錄 2 筆

    const saveFailed = await exportOnce(recordFailed.state, { projectId: 'file-a' }, {
      snapshot: async () => {
        throw new Error('模擬空間不足');
      },
    });
    expect(saveFailed.outcome).toMatchObject({ kind: 'delivered', file: 'save-failed' });
    expect(saveFailed.state.toast).toBeNull();
  });
});

describe('WO-103 寫作日、稿子對應與紀錄卡', () => {
  it('事件依那份稿子的一天結束時刻歸日（不是一律午夜）', async () => {
    let state = draftState();
    state = reduce(state, { type: 'set-hour', hour: 4 });
    const at = new Date(2026, 10, 17, 2, 30); // 裝置本地 11/17 02:30
    expect(writingDayKey(at, 4)).not.toBe(writingDayKey(at, 0));
    const run = await exportOnce(state, {}, { now: () => at });
    const events = Object.values(projectExportEventsOf(run.state, DRAFT_ID));
    expect(events).toEqual([{ dayKey: writingDayKey(at, 4), atMs: at.getTime() }]);
  });

  it('匯出途中切換稿子：事件仍掛在按下匯出的那份，不會掛到另一份', async () => {
    let state = draftState();
    state = reduce(state, { type: 'add-project', id: 'p-other', title: '另一份', shape: 'novel', startedMs: NOW.getTime() });
    let current = state;
    const run = await runFullTextExport({
      request: { projectId: DRAFT_ID, format: 'txt', scope: 'all' },
      getState: () => current,
      dispatch: (action) => {
        current = reduce(current, action);
      },
      store,
      busy: { current: false },
      liveDraft: null,
      deliver: async () => {
        current = reduce(current, { type: 'focus-project', id: 'p-other' });
        return 'shared';
      },
    });
    expect(run.kind).toBe('delivered');
    expect(total(current, DRAFT_ID)).toBe(1);
    expect(total(current, 'p-other')).toBe(0);
  });

  it('用按下匯出那一刻的記憶體快照（含編輯器還沒交出的字），不讀舊磁碟稿', async () => {
    const run = await exportOnce(draftState(), { format: 'txt' }, { liveDraft: { projectId: DRAFT_ID, chapterId: 'c5', text: '剛打的新字' } });
    expect(await (run.calls[0]!.file).text()).toContain('第五章\n剛打的新字');
  });

  it('只有匯出的日子也有紀錄卡（不加字數、不加時間）；統計頁、紀錄頁、統計頁內卡片都顯示實數、沒有準備中', async () => {
    let state = draftState();
    const yesterday = new Date(NOW.getTime() - 24 * 3600 * 1000);
    const yKey = writingDayKey(yesterday, state.schedule.dayEndHour);
    state = (await exportOnce(state, {}, { now: () => yesterday })).state;
    state = (await exportOnce(state)).state;
    state = (await exportOnce(state, { format: 'txt' })).state;
    const rows = displayLogRows(state, DRAFT_ID);
    const yRow = rows.find((row) => row.date === yKey)!;
    expect(yRow).toBeTruthy();
    expect(yRow.word_count).toBe(0);
    expect(yRow.duration).toBe(0);
    expect(state.logs.some((log) => log.date === yKey)).toBe(false); // 只供顯示，不寫回紀錄

    const logs = render(state, 'logs', DRAFT_ID);
    expect(dayCard(logs, yKey)).toContain('匯出　1 次');
    expect(dayCard(logs, yKey)).toContain('匯入　0 次');
    expect(dayCard(logs, TODAY)).toContain('匯出　2 次');
    expect(logs).not.toContain('準備中');
    const stats = render(state, 'stats', DRAFT_ID);
    expect(stats).toMatch(/data-testid="stats-export-count">3</);
    expect(stats).not.toContain('準備中');
    const wide = render(state, 'stats', DRAFT_ID, 'wide');
    expect(dayCard(wide, TODAY)).toContain('匯出　2 次');
    expect(dayCard(wide, yKey)).toContain('匯出　1 次');
    // 統計頁全書＝各日加總（同一份事件集合）
    const summary = summarizeStats(state.schedule, state.logs, 0, 0, total(state));
    expect(summary.importExport).toMatchObject({ exportCount: 3, exportDisplay: '3' });
  });
});

/* ---------------- .db 往返（假 .db） ---------------- */

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

async function fakeDb(
  title: string,
  importEvents?: Record<string, TransferEvent>,
  exportEvents?: Record<string, TransferEvent>,
): Promise<Uint8Array> {
  return writeBookBytes(
    null,
    fakeInfo(title),
    [{ id: `c-${title}`, type: 'file', title: '第一章　', progress: 'Draft', content: `${title}的假正文` }],
    [],
    [],
    importEvents,
    exportEvents,
  );
}

async function inDb<T>(bytes: Uint8Array, run: (sql: Parameters<typeof readTransferData>[0]) => T): Promise<T> {
  const db = await openMemoryDb(bytes);
  try {
    return run(db.sql);
  } finally {
    db.close();
  }
}

async function mutate(bytes: Uint8Array, run: (sql: Parameters<typeof readTransferData>[0]) => void): Promise<Uint8Array> {
  const db = await openMemoryDb(bytes);
  try {
    run(db.sql);
    return db.exportBytes();
  } finally {
    db.close();
  }
}

async function openDb(state: SampleState, bytes: Uint8Array, key: string): Promise<SampleState> {
  const raw = await fingerprintBytes(bytes);
  const book = await readBookBytes('假稿.db', bytes, key);
  let next = state;
  const adopted = adoptExportEventsByFingerprint(store, raw, key);
  if (adopted) next = reduce(next, { type: 'set-export-events', exportEvents: adopted });
  next = reduce(next, attachActionForBook(book, { updatedLabel: '剛剛' }));
  return reduce(next, { type: 'focus-project', id: key });
}

async function saveDb(state: SampleState, id: string, base: Uint8Array | null): Promise<Uint8Array> {
  const project = state.projects.find((item) => item.id === id)!;
  const bytes = await manuscriptBytesOn(state, project, base);
  await verifyBytesForSave(bytes);
  await linkExportEventsToBytes(store, id, bytes);
  return bytes;
}

const EXP_A: TransferEvent = { dayKey: '2026-11-10', atMs: Date.parse('2026-11-10T02:00:00Z') };

describe('WO-103 匯出事件寫進 .db（主 schema 14、附加修訂值 1）', () => {
  it('匯出後存成 .db：export 事件與正文同檔；清掉本機只開那份檔仍是同樣次數；重存、另存、重開都不增加', async () => {
    let state = draftState();
    state = (await exportOnce(state)).state;
    state = (await exportOnce(state, { format: 'txt' })).state;
    const bytes = await saveDb(state, DRAFT_ID, null);
    const inFile = await inDb(bytes, (sql) => readTransferData(sql));
    expect(inFile.kind).toBe('ok');
    if (inFile.kind !== 'ok') return;
    expect(Object.keys(inFile.exportEvents)).toHaveLength(2);
    expect(inFile.importEvents).toEqual({});
    expect(inFile.exportCount).toBeNull(); // 不寫 export_count
    await inDb(bytes, (sql) => {
      expect(sql.select(`SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`)[0]!.version).toBe(14);
      expect(sql.select(`SELECT format_revision FROM ${TRANSFER_META_TABLE}`)).toEqual([{ format_revision: 1 }]);
    });

    // 重存兩次（同一份事件）：檔內仍 2 筆
    const resaved = await saveDb(state, DRAFT_ID, bytes);
    const resaved2 = await saveDb(state, DRAFT_ID, resaved);
    await inDb(resaved2, (sql) => {
      expect(sql.select(`SELECT COUNT(*) AS n FROM ${TRANSFER_EVENTS_TABLE} WHERE kind = 'export'`)[0]!.n).toBe(2);
    });

    // 同一台裝置開回（本機 byFile 對得上＋檔內事件）：聯集去重仍是 2，不是 4
    let reopened = await openDb(createState(NOW), resaved2, 'file-same-device');
    expect(total(reopened, 'file-same-device')).toBe(2);

    // 清掉本機，只開那份檔：仍 2、原寫作日
    store = new MemoryStore();
    vi.stubGlobal('localStorage', store);
    reopened = await openDb(createState(NOW), resaved2, 'file-clean');
    expect(total(reopened, 'file-clean')).toBe(2);
    expect(onDay(reopened, TODAY, 'file-clean')).toBe(2);
    expect(store.getItem(EXPORT_EVENTS_KEY)).toBeNull(); // 開檔不在本機捏造紀錄

    // 開回後再匯出一次：3；存回後檔內 3
    const more = await exportOnce(reopened, { projectId: 'file-clean' }, {
      snapshot: async () => ({ key: 'file-clean', bytes: new Uint8Array() }),
    });
    expect(total(more.state, 'file-clean')).toBe(3);
    const saved3 = await saveDb(more.state, 'file-clean', resaved2);
    const read3 = await inDb(saved3, (sql) => readTransferData(sql));
    expect(read3.kind === 'ok' ? Object.keys(read3.exportEvents).length : -1).toBe(3);
  });

  it('舊 NULL 保持 NULL；既有非 NULL export_count 原樣保留、不清成 0、不加進畫面次數（無法證明是否已含檔內事件）', async () => {
    const withNull = await fakeDb('舊NULL', { 'imp-x': EXP_A });
    const presetCount = await mutate(withNull, (sql) => sql.exec(`UPDATE ${TRANSFER_META_TABLE} SET export_count = 7`));
    for (const [bytes, expected, key] of [[withNull, null, 'file-x1'], [presetCount, 7, 'file-x2']] as const) {
      let state = await openDb(createState(NOW), bytes, key);
      expect(total(state, key)).toBe(0);
      state = (await exportOnce(state, { projectId: key }, { snapshot: async () => ({ key, bytes: new Uint8Array() }) })).state;
      expect(total(state, key)).toBe(1);
      const saved = await saveDb(state, key, bytes);
      await inDb(saved, (sql) => {
        expect(sql.select(`SELECT export_count FROM ${TRANSFER_META_TABLE}`)).toEqual([{ export_count: expected }]);
        const read = readTransferData(sql);
        expect(read.kind === 'ok' && Object.keys(read.exportEvents).length).toBe(1);
        expect(read.kind === 'ok' && read.importEvents).toEqual({ 'imp-x': EXP_A }); // 匯入數字不受影響
      });
      const reopened = await openDb(createState(NOW), saved, `${key}-reopen`);
      expect(total(reopened, `${key}-reopen`)).toBe(1);
      expect(countImportEvents(projectImportEventsOf(reopened, `${key}-reopen`))).toBe(1);
    }
  });

  it('附加資料損壞：不當 0 覆寫、不寫進匯出事件，外部存檔驗證擋下；本機可靠紀錄照算', async () => {
    const good = await fakeDb('壞檔', { 'imp-x': EXP_A });
    const broken = await mutate(good, (sql) => sql.exec(`UPDATE ${TRANSFER_META_TABLE} SET format_revision = 9`));
    let state = await openDb(createState(NOW), broken, 'file-bad');
    state = (await exportOnce(state, { projectId: 'file-bad' }, { snapshot: async () => ({ key: 'file-bad', bytes: new Uint8Array() }) })).state;
    expect(total(state, 'file-bad')).toBe(1);
    const project = state.projects.find((item) => item.id === 'file-bad')!;
    const saved = await manuscriptBytesOn(state, project, broken);
    await expect(verifyBytesForSave(saved)).rejects.toThrow();
    await inDb(saved, (sql) => {
      expect(sql.select(`SELECT format_revision FROM ${TRANSFER_META_TABLE}`)).toEqual([{ format_revision: 9 }]);
      expect(sql.select(`SELECT kind FROM ${TRANSFER_EVENTS_TABLE}`)).toEqual([{ kind: 'import' }]);
    });
  });

  it('同代號衝突（檔內 export 與要寫的內容不同，或同代號跨匯入／匯出）：整筆交易回復，正文不只存一半', async () => {
    const bytes = await fakeDb('衝突', {}, { 'exp-1': EXP_A });
    const book = await readBookBytes('衝突.db', bytes, 'file-c');
    const tree = structuredClone(book.tree);
    tree[0]!.content = '不該被存進去的假正文';
    await inDb(bytes, (sql) => {
      expect(() =>
        writeFileProject(sql, book.info, tree, book.cards, book.logs, {}, { 'exp-1': { ...EXP_A, atMs: EXP_A.atMs + 1 } }),
      ).toThrow(TransferDataError);
      expect(() => writeFileProject(sql, book.info, tree, book.cards, book.logs, { 'exp-1': EXP_A }, {})).toThrow(TransferDataError);
      expect(() => writeFileProject(sql, book.info, tree, book.cards, book.logs, { 'dup': EXP_A }, { 'dup': EXP_A })).toThrow(TransferDataError);
      const after = readFileProject(sql);
      expect(after.tree[0]!.content).toBe('衝突的假正文');
      expect(after.transfer).toEqual({ kind: 'ok', revision: 1, exportCount: null, importEvents: {}, exportEvents: { 'exp-1': EXP_A } });
    });
  });

  it('只寫匯出事件也會建附加表；沒有任何事件時仍不建表（電腦版原檔結構不動）', async () => {
    const plain = await fakeDb('無事件');
    await inDb(plain, (sql) => expect(readTransferData(sql)).toEqual({ kind: 'absent' }));
    const onlyExport = await fakeDb('只有匯出', undefined, { 'exp-1': EXP_A });
    await inDb(onlyExport, (sql) => {
      expect(readTransferData(sql)).toEqual({ kind: 'ok', revision: 1, exportCount: null, importEvents: {}, exportEvents: { 'exp-1': EXP_A } });
      expect(sql.select(`SELECT event_id, kind, day_key, at_ms FROM ${TRANSFER_EVENTS_TABLE}`)).toEqual([
        { event_id: 'exp-1', kind: 'export', day_key: EXP_A.dayKey, at_ms: EXP_A.atMs },
      ]);
    });
  });
});
