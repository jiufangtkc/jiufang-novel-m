import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runReminderSave,
  StaleSaveReminder,
  subscribeStaleSaveTick,
} from '../components/StaleSaveReminder';
import { staleSaveReminder, staleSaveReminderAria } from '../copy/userFacing';
import {
  STALE_SAVE_DAY_MS,
  staleSaveBaseMs,
  hasBodyText,
  staleSaveDays,
  startedMsFromProjectId,
} from '../domain/staleSaveReminder';
import { createMemoryTargetStore, type DiskFile } from '../db/fileTarget';
import {
  saveProjectFromClick,
  type SaveEnvironment,
  type SaveOutcome,
} from '../db/saveProject';
import {
  DEVICE_SAVE_RECORD_KEY,
  loadDeviceSaveRecord,
  saveDeviceSaveRecord,
} from './deviceSaveRecord';
import { applySaveOutcome, createState, reduce, runSaveProjectAs, type SampleState } from './sampleStore';


const H = 60 * 60 * 1000;
/** 臺北 2026-11-13 15:35。 */
const SAVED_AT = Date.parse('2026-11-13T07:35:00Z');
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function days(over: Partial<Parameters<typeof staleSaveDays>[0]> & { nowMs: number }) {
  return staleSaveDays({ lastProjectSaveMs: null, lastExportMs: null, startedMs: null, ...over });
}

/** 程式產生的稿子：有一章有字；建立時間可指定。 */
function stateWithBook(startedMs: number, text = '有字的稿子'): { state: SampleState; id: string } {
  const id = `p-${startedMs}`;
  let state = createState(new Date(startedMs));
  state = reduce(state, { type: 'add-project', id, title: '測試稿', shape: 'novel', startedMs });
  const chapterId = state.projects.find((p) => p.id === id)!.nodes[0].id;
  if (text) state = reduce(state, { type: 'commit-text', projectId: id, nodeId: chapterId, text });
  return { state, id };
}

function daysOf(state: SampleState, id: string, nowMs: number) {
  const meta = state.saveMeta[id];
  return staleSaveDays({
    lastProjectSaveMs: meta?.lastProjectSaveMs ?? null,
    lastExportMs: meta?.lastExportMs ?? null,
    startedMs: state.startedById[id],
    nowMs,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WO-98 天數門檻', () => {
  it('72 小時前一刻不顯示，滿 72 小時 3 天，滿 120 小時 5 天', () => {
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: SAVED_AT + 72 * H - 1 })).toBeNull();
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: SAVED_AT + 72 * H })).toBe(3);
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: SAVED_AT + 120 * H - 1 })).toBe(4);
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: SAVED_AT + 120 * H })).toBe(5);
  });

  it('臺北 11/13 15:35 存檔：11/16 15:34 不顯示、15:35 顯示 3 天、11/18 15:35 顯示 5 天', () => {
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: Date.parse('2026-11-16T07:34:00Z') })).toBeNull();
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: Date.parse('2026-11-16T07:35:00Z') })).toBe(3);
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: Date.parse('2026-11-18T07:35:00Z') })).toBe(5);
  });

  it('儲存專案與另存兩個欄位取最新；沒有暫存欄位可以延後提醒', () => {
    const now = SAVED_AT + 10 * STALE_SAVE_DAY_MS;
    expect(staleSaveBaseMs({ lastProjectSaveMs: now - 5 * STALE_SAVE_DAY_MS, lastExportMs: now - 2 * STALE_SAVE_DAY_MS, startedMs: null, nowMs: now })).toBe(now - 2 * STALE_SAVE_DAY_MS);
    expect(days({ lastProjectSaveMs: now - 2 * STALE_SAVE_DAY_MS, lastExportMs: now - 8 * STALE_SAVE_DAY_MS, nowMs: now })).toBeNull();
    expect(days({ lastProjectSaveMs: now - 4 * STALE_SAVE_DAY_MS, lastExportMs: now - 8 * STALE_SAVE_DAY_MS, nowMs: now })).toBe(4);
  });

  it('自動暫存與立刻暫存不影響提醒', () => {
    const { state, id } = stateWithBook(SAVED_AT);
    const now = SAVED_AT + 4 * STALE_SAVE_DAY_MS;
    let next = reduce(state, { type: 'record-auto-save', projectId: id, atMs: now - 1000 });
    next = reduce(next, { type: 'record-manual-save', projectId: id, atMs: now - 1000 });
    expect(daysOf(next, id, now)).toBe(4);
  });

  it('無效或未來時間不產生負數、NaN 或立即誤報', () => {
    const now = SAVED_AT;
    expect(days({ lastProjectSaveMs: now + 5 * STALE_SAVE_DAY_MS, nowMs: now })).toBeNull();
    expect(days({ lastProjectSaveMs: Number.NaN, startedMs: Number.NaN, nowMs: now })).toBeNull();
    expect(days({ lastProjectSaveMs: -5, startedMs: 0, nowMs: now })).toBeNull();
    expect(days({ startedMs: now + STALE_SAVE_DAY_MS, nowMs: now })).toBeNull();
    expect(days({ nowMs: now })).toBeNull();
  });
});

describe('WO-98 建立時間', () => {
  it('新稿從建立時間算；編輯與暫存不重設', () => {
    const { state, id } = stateWithBook(SAVED_AT);
    expect(state.startedById[id]).toBe(SAVED_AT);
    expect(daysOf(state, id, SAVED_AT + 3 * STALE_SAVE_DAY_MS)).toBe(3);
    const chapterId = state.projects.find((p) => p.id === id)!.nodes[0].id;
    let next = reduce(state, { type: 'commit-text', projectId: id, nodeId: chapterId, text: '又改了很多字' });
    next = reduce(next, { type: 'record-auto-save', projectId: id, atMs: SAVED_AT + 2 * STALE_SAVE_DAY_MS });
    expect(next.startedById[id]).toBe(SAVED_AT);
    expect(daysOf(next, id, SAVED_AT + 3 * STALE_SAVE_DAY_MS)).toBe(3);
  });

  it('note-started 只補沒有的，不覆寫已記下的時間', () => {
    const { state, id } = stateWithBook(SAVED_AT);
    const next = reduce(state, { type: 'note-started', startedById: { [id]: SAVED_AT + 99, other: 5 } });
    expect(next.startedById[id]).toBe(SAVED_AT);
    expect(next.startedById.other).toBe(5);
    expect(reduce(next, { type: 'note-started', startedById: { other: 9 } })).toBe(next);
  });

  it('舊稿代號嚴格是 p-加13位毫秒才回推；其他不回推', () => {
    const now = Date.parse('2026-11-16T00:00:00Z');
    expect(startedMsFromProjectId('p-1763000000000', now)).toBe(1763000000000);
    expect(startedMsFromProjectId('file-1763000000000', now)).toBeNull();
    expect(startedMsFromProjectId('p-123', now)).toBeNull();
    expect(startedMsFromProjectId('p-17630000000001', now)).toBeNull();
    expect(startedMsFromProjectId('p-1763000000000x', now)).toBeNull();
    expect(startedMsFromProjectId('p-9999999999999', now)).toBeNull();
    expect(startedMsFromProjectId('p-1000000000000', now)).toBeNull();
  });

  it('本機重載後還在，且寫入存檔紀錄時不會被洗掉', () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const { state, id } = stateWithBook(SAVED_AT);
    saveDeviceSaveRecord(store, { saveMeta: state.saveMeta, startedById: state.startedById, logsById: {}, goalById: {}, draftIds: [] });
    // 沒帶 startedById 的寫入（例如另存指紋）沿用先前記的
    saveDeviceSaveRecord(store, { saveMeta: {}, logsById: {}, goalById: {}, draftIds: [] });
    const loaded = loadDeviceSaveRecord(store, new Date(SAVED_AT + 4 * STALE_SAVE_DAY_MS));
    expect(loaded.startedById[id]).toBe(SAVED_AT);
    data.set(DEVICE_SAVE_RECORD_KEY, JSON.stringify({ startedById: { a: 'x', b: -1, c: 7 } }));
    expect(loadDeviceSaveRecord(store, new Date()).startedById).toEqual({ c: 7 });
  });

  it('各稿時間不串用', () => {
    const a = stateWithBook(SAVED_AT);
    const idB = `p-${SAVED_AT + 2 * STALE_SAVE_DAY_MS}`;
    const state = reduce(a.state, { type: 'add-project', id: idB, title: 'B', shape: 'novel', startedMs: SAVED_AT + 2 * STALE_SAVE_DAY_MS });
    const now = SAVED_AT + 3 * STALE_SAVE_DAY_MS;
    expect(daysOf(state, a.id, now)).toBe(3);
    expect(daysOf(state, idB, now)).toBeNull();
  });
});

describe('WO-98 存檔成功／取消／失敗接到真正的存檔結果處理', () => {
  function runOutcome(state: SampleState, id: string, outcome: SaveOutcome, mode: 'save' | 'save-as') {
    let next = state;
    applySaveOutcome((action) => void (next = reduce(next, action)), id, outcome, mode);
    return next;
  }
  const now = SAVED_AT + 4 * STALE_SAVE_DAY_MS;

  it('儲存專案成功後提醒消失，再過 3 天又回來；切回仍正確', () => {
    vi.setSystemTime(now);
    const { state, id } = stateWithBook(SAVED_AT);
    expect(daysOf(state, id, now)).toBe(4);
    const saved = runOutcome(state, id, { kind: 'saved', filename: 'a.db' }, 'save');
    expect(daysOf(saved, id, Date.now())).toBeNull();
    expect(daysOf(saved, id, now + 3 * STALE_SAVE_DAY_MS)).toBe(3);
  });

  it('另存成功（含分享／下載交付）也算存檔', () => {
    vi.setSystemTime(now);
    const { state, id } = stateWithBook(SAVED_AT);
    for (const outcome of [
      { kind: 'saved-as', filename: 'a.db' },
      { kind: 'handed-off', via: 'share', filename: 'a.db' },
      { kind: 'handed-off', via: 'download', filename: 'a.db' },
      { kind: 'saved-under-new-title', filename: 'a.db' },
    ] as SaveOutcome[]) {
      const next = runOutcome(state, id, outcome, outcome.kind === 'saved-under-new-title' ? 'save' : 'save-as');
      expect(daysOf(next, id, Date.now())).toBeNull();
    }
  });

  it('取消、沒權限、寫入失敗、資料驗證失敗都不冒充成功，提醒仍在、紀錄不變', () => {
    vi.setSystemTime(now);
    const { state, id } = stateWithBook(SAVED_AT);
    for (const outcome of [
      { kind: 'cancelled' },
      { kind: 'permission-denied' },
      { kind: 'write-failed', restored: true },
      { kind: 'write-failed', restored: false },
      { kind: 'invalid-database' },
    ] as SaveOutcome[]) {
      for (const mode of ['save', 'save-as'] as const) {
        const next = runOutcome(state, id, outcome, mode);
        expect(daysOf(next, id, Date.now())).toBe(4);
        expect(next.saveMeta[id]).toEqual(state.saveMeta[id]);
        expect(next.projects).toEqual(state.projects);
      }
    }
  });

  function diskEnv(pick: SaveEnvironment['pickSaveLocation'], share?: SaveEnvironment['share']) {
    const written: Uint8Array[] = [];
    const file: DiskFile = {
      name: 'a.db',
      read: async () => new Uint8Array(),
      write: async (bytes) => void written.push(bytes),
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    };
    const env: SaveEnvironment = {
      canPickFiles: true,
      targets: createMemoryTargetStore(),
      verify: async () => undefined,
      pickSaveLocation: pick,
      share: share ?? (async () => 'shared'),
    };
    return { env, file, written };
  }

  it('選檔取消：不建立資料、不寫入，提醒仍在；選了位置則成功後消失', async () => {
    vi.setSystemTime(now);
    const { state, id } = stateWithBook(SAVED_AT);
    let built = 0;
    const cancelled = diskEnv(async () => null);
    const outcome = await saveProjectFromClick({
      env: cancelled.env, bookKey: id, plan: 'pick-first-save', writeBackName: 'a.db', newTitleName: 'a.db', startIn: null,
      buildBytes: async () => { built += 1; return new Uint8Array([1]); },
    });
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(built).toBe(0);
    expect(cancelled.written).toHaveLength(0);
    expect(daysOf(runOutcome(state, id, outcome, 'save'), id, Date.now())).toBe(4);

    const ok = diskEnv(async () => null);
    ok.env.pickSaveLocation = async () => ok.file;
    const done = await saveProjectFromClick({
      env: ok.env, bookKey: id, plan: 'pick-first-save', writeBackName: 'a.db', newTitleName: 'a.db', startIn: null,
      buildBytes: async () => new Uint8Array([1]),
    });
    expect(done.kind).toBe('saved');
    expect(daysOf(runOutcome(state, id, done, 'save'), id, Date.now())).toBeNull();
  });

  /** 走實際的 runSaveProjectAs（actions.saveProjectAs 的主體）：快照用假的，狀態用真的 reduce。 */
  async function phoneSaveAs(state: SampleState, id: string, via: 'shared' | 'downloaded' | 'cancelled') {
    let next = state;
    const persisted: boolean[] = [];
    const disk = diskEnv(async () => null, async () => via);
    disk.env.canPickFiles = false;
    const project = state.projects.find((p) => p.id === id)!;
    const result = await runSaveProjectAs({
      state,
      project,
      dispatch: (action) => void (next = reduce(next, action)),
      env: disk.env,
      preparedBytes: null,
      snapshot: async (_state, item, persist = true) => {
        persisted.push(persist);
        return { key: item.dbKey ?? item.id, bytes: new Uint8Array([1, 2, 3]) };
      },
    });
    return { next, persisted, outcome: result.outcome };
  }

  it('手機分享取消：稿子（origin、dbKey、檔名、fileExtras）、正文、起算與存檔時間都不變，提醒仍在，沒存本機副本', async () => {
    vi.setSystemTime(now);
    const { state, id } = stateWithBook(SAVED_AT);
    const before = state.projects.find((p) => p.id === id)!;
    expect(before.origin).not.toBe('file');
    const { next, persisted, outcome } = await phoneSaveAs(state, id, 'cancelled');
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(persisted).toEqual([false]);
    expect(next.projects).toEqual(state.projects);
    expect(next.projects.find((p) => p.id === id)).toEqual(before);
    expect(next.fileExtras).toEqual(state.fileExtras);
    expect(next.startedById).toEqual(state.startedById);
    expect(next.saveMeta[id]?.lastExportMs ?? null).toBeNull();
    expect(next.saveMeta[id]?.lastProjectSaveMs ?? null).toBeNull();
    expect(daysOf(next, id, Date.now())).toBe(4);
  });

  it('手機分享或下載成功：照舊升格並存本機副本，提醒消失', async () => {
    vi.setSystemTime(now);
    const { state, id } = stateWithBook(SAVED_AT);
    for (const via of ['shared', 'downloaded'] as const) {
      const { next, persisted, outcome } = await phoneSaveAs(state, id, via);
      expect(outcome.kind).toBe('handed-off');
      expect(persisted).toEqual([false, true]);
      const project = next.projects.find((p) => p.id === id)!;
      expect(project.origin).toBe('file');
      expect(project.dbKey).toBe(id);
      expect(project.filename).toBeTruthy();
      expect(next.fileExtras[id]).toBeDefined();
      expect(next.saveMeta[id]?.lastExportMs).toBe(now);
      expect(daysOf(next, id, Date.now())).toBeNull();
      expect(project.nodes).toEqual(state.projects.find((p) => p.id === id)!.nodes);
    }
  });
});

describe('WO-98 提醒顯示規則', () => {
  it('空稿子（全書沒有正文）不提醒；有正文才提醒', () => {
    const empty = stateWithBook(SAVED_AT, '');
    const filled = stateWithBook(SAVED_AT);
    expect(hasBodyText(empty.state.projects.find((p) => p.id === empty.id)!.nodes)).toBe(false);
    expect(hasBodyText(filled.state.projects.find((p) => p.id === filled.id)!.nodes)).toBe(true);
    expect(read('../screens/EditorPane.tsx')).toContain('hasBodyText(project.nodes)');
  });

  it('文案與朗讀標籤：N 是實際天數', () => {
    expect(staleSaveReminder(3)).toBe('已經 3 天沒存檔了');
    expect(staleSaveReminder(5)).toBe('已經 5 天沒存檔了');
    expect(staleSaveReminderAria(5)).toBe('已經 5 天沒存檔了');
    const html = renderToStaticMarkup(createElement(StaleSaveReminder, { days: 5, onSave: () => undefined }));
    expect(html).toContain('>已經 5 天沒存檔了</button>');
    expect(html).toContain('aria-label="已經 5 天沒存檔了"');
    expect(html).toContain('type="button"');
  });

  it('點提醒：支援寫回走儲存專案；不支援（手機）走另存專案', async () => {
    const calls: string[] = [];
    const actions = {
      saveProject: async () => void calls.push('save'),
      saveProjectAs: async () => void calls.push('save-as'),
    };
    await runReminderSave(true, actions);
    await runReminderSave(false, actions);
    expect(calls).toEqual(['save', 'save-as']);
  });

  it('提醒放在正文頁首 .topbar 內獨立次列，不放進只有寬版才顯示的 topbar-stats', () => {
    const source = read('../screens/EditorPane.tsx');
    const header = source.slice(source.indexOf('<header className={staleDays'), source.indexOf('</header>'));
    expect(header).toContain('<StaleSaveReminder');
    const stats = header.slice(header.indexOf('topbar-stats'), header.indexOf('search-open'));
    expect(stats).not.toContain('StaleSaveReminder');
    expect(header.indexOf('<StaleSaveReminder')).toBeGreaterThan(header.indexOf('toggle-cards-topbar'));
  });

  it('樣式限寫作頁、折成兩列、不截斷；專注模式與手機橫拿收起整個頁首', () => {
    const css = read('../styles/global.css');
    expect(css).toContain('.editor .topbar.has-save-reminder');
    const rule = css.slice(css.indexOf('.editor .topbar .stale-save-reminder'));
    expect(rule).toContain('flex: 1 0 100%');
    expect(rule).toContain('white-space: normal');
    expect(rule).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(rule).not.toContain('text-overflow');
    expect(css).toMatch(/html\.landscape-writing \.editor \.topbar[\s\S]*?display: none/);
    expect(read('../screens/focusMode.css')).toMatch(/html\[data-focus-mode="true"\] \.editor \.topbar[\s\S]*?display: none !important/);
    expect(css).not.toMatch(/stale-save-reminder[^{]*\{[^}]*display:\s*none/);
  });
});

describe('WO-98 跨門檻與回到頁面更新', () => {
  it('定時更新、回到頁面更新、清理後不再更新', () => {
    vi.setSystemTime(SAVED_AT + 72 * H - 30_000);
    let bumps = 0;
    const handlers = new Map<string, () => void>();
    const fake = (): Pick<Window, 'addEventListener' | 'removeEventListener'> =>
      ({
        addEventListener: (type: string, fn: () => void) => void handlers.set(type, fn),
        removeEventListener: (type: string) => void handlers.delete(type),
      }) as never;
    const stop = subscribeStaleSaveTick(() => void (bumps += 1), 60_000, fake(), fake());
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: Date.now() })).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(bumps).toBe(1);
    expect(days({ lastProjectSaveMs: SAVED_AT, nowMs: Date.now() })).toBe(3);
    handlers.get('visibilitychange')?.();
    handlers.get('focus')?.();
    handlers.get('pageshow')?.();
    expect(bumps).toBe(4);
    stop();
    vi.advanceTimersByTime(180_000);
    expect(bumps).toBe(4);
    expect(handlers.size).toBe(0);
  });
});
