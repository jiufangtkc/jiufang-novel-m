import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countAchievements, writingDayKey } from '../domain/dailyGoal';
import { saveProjects, type KeyValueStore } from '../domain/outline';
import { formatClockTime, formatLastExportLabel, latestSaveTimestamp } from '../domain/saveClock';
import { summarizeStats } from '../domain/stats';
import { editorSaveStatus } from '../screens/editorSaveStatus';
import { appSpaceStatusLine } from '../screens/filesStatus';
import { DEVICE_SAVE_RECORD_KEY } from './deviceSaveRecord';
import {
  createState,
  exportTimeOfBytes,
  noteExportedBytes,
  persistDeviceSaveRecord,
  reduce,
  type SampleState,
} from './sampleStore';

/** 臺北 2026-11-14 中午。 */
const NOON = new Date('2026-11-14T04:00:00Z');
const TODAY = writingDayKey(NOON, 0);

class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

let store: MemoryStore;

function statsOf(state: SampleState) {
  return summarizeStats(state.schedule, state.logs, countAchievements(state.schedule.settled));
}

function chapterOf(state: SampleState, projectId: string): string {
  return state.projects.find((item) => item.id === projectId)!.nodes[0]!.id;
}

function write(state: SampleState, projectId: string, text: string): SampleState {
  return reduce(state, { type: 'commit-text', projectId, nodeId: chapterOf(state, projectId), text });
}

/** 和 App 自動暫存做的事一樣：正文寫進本機、記下暫存時間，再把存檔紀錄留在這台裝置。 */
function autoSave(state: SampleState, atMs: number): SampleState {
  saveProjects(store, state.projects.filter((project) => project.origin !== 'file'));
  const next = state.activeProjectId
    ? reduce(state, { type: 'record-auto-save', projectId: state.activeProjectId, atMs })
    : state;
  persistDeviceSaveRecord(store, next);
  return next;
}

/** 重新整理：從這台裝置的儲存重新建立狀態，再像使用者一樣打開那份稿子。 */
function reload(now: Date, projectId: string): SampleState {
  return reduce(createState(now), { type: 'focus-project', id: projectId });
}

describe('WO-77 自動暫存留住今天字數、另存時間重新整理後還在', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
    store = new MemoryStore();
    vi.stubGlobal('localStorage', store);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('WO-77：新稿只等自動暫存、不另存，重新整理後正文與今天字數都在，再寫繼續累加', () => {
    let state = reduce(createState(NOON), { type: 'add-project', id: 'p-77', title: '【範例】暫存稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-77' });
    expect(statsOf(state).todayWords).toBe(0);
    const first = '霧從港口慢慢退去。';
    state = write(state, 'p-77', first);
    const before = statsOf(state).todayWords;
    expect(before).toBeGreaterThan(0);
    state = autoSave(state, NOON.getTime() + 60_000);

    const reloaded = reload(NOON, 'p-77');
    const project = reloaded.projects.find((item) => item.id === 'p-77')!;
    expect(project.nodes[0]!.content).toBe(first);
    expect(statsOf(reloaded).todayWords).toBe(before);
    expect(reloaded.logs.map((log) => log.date)).toEqual([TODAY]);
    // 不借範例書的 300 字與範例日期
    expect(statsOf(reloaded).activeDays).toBe(1);
    expect(statsOf(reloaded).achievementCount).toBe(0);

    // 再寫一段：只加新的字，不重算舊段
    const second = `${first}\n燈塔亮了。`;
    const grown = write(reloaded, 'p-77', second);
    const added = statsOf(grown).todayWords - before;
    const fresh = write(
      reduce(reduce(createState(NOON), { type: 'add-project', id: 'p-cmp', title: '【範例】對照', shape: 'novel' }), {
        type: 'focus-project',
        id: 'p-cmp',
      }),
      'p-cmp',
      second,
    );
    expect(statsOf(grown).todayWords).toBe(statsOf(fresh).todayWords);
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(statsOf(fresh).todayWords);
  });

  it('WO-77：重新整理後範例書紀錄不變，兩份新稿各自還原', () => {
    let state = createState(NOON);
    const sampleBefore = statsOf(state);
    state = reduce(state, { type: 'add-project', id: 'p-a', title: '【範例】甲', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-a' });
    state = write(state, 'p-a', '甲稿十個字寫在這裡。');
    const aWords = statsOf(state).todayWords;
    state = autoSave(state, NOON.getTime());
    state = reduce(state, { type: 'add-project', id: 'p-b', title: '【範例】乙', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-b' });
    state = write(state, 'p-b', '乙稿。');
    const bWords = statsOf(state).todayWords;
    autoSave(state, NOON.getTime());

    expect(statsOf(reload(NOON, 'p-a')).todayWords).toBe(aWords);
    expect(statsOf(reload(NOON, 'p-b')).todayWords).toBe(bWords);
    const sample = createState(NOON);
    expect(statsOf(sample)).toEqual(sampleBefore);
    // 範例書不寫進這台裝置的寫作紀錄
    const saved = JSON.parse(store.getItem(DEVICE_SAVE_RECORD_KEY)!);
    expect(Object.keys(saved.logsById).sort()).toEqual(['p-a', 'p-b']);
  });

  it('WO-77：隔天重新整理，昨天的字數照常結算，今天從 0 開始', () => {
    let state = reduce(createState(NOON), { type: 'add-project', id: 'p-77', title: '【範例】暫存稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-77' });
    state = write(state, 'p-77', '霧從港口慢慢退去。');
    autoSave(state, NOON.getTime());
    const nextNoon = new Date(NOON.getTime() + 24 * 3600_000);
    vi.setSystemTime(nextNoon);
    const next = reload(nextNoon, 'p-77');
    expect(statsOf(next).todayWords).toBe(0);
    expect(statsOf(next).activeDays).toBe(1);
    expect(next.schedule.settled.map((day) => day.dayKey)).toEqual([TODAY]);
  });

  it('WO-77：另存時間重新整理後仍在，檔案頁「上次另存」與寫作頁小字都對', () => {
    let state = reduce(createState(NOON), { type: 'add-project', id: 'p-77', title: '【範例】另存稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-77' });
    state = write(state, 'p-77', '霧從港口慢慢退去。');
    const exportAt = NOON.getTime() + 5 * 60_000;
    state = reduce(state, { type: 'record-export', projectId: 'p-77', atMs: exportAt });
    persistDeviceSaveRecord(store, state);
    const autoAt = NOON.getTime() + 9 * 60_000;
    state = autoSave(state, autoAt);

    vi.setSystemTime(NOON.getTime() + 10 * 60_000);
    const reloaded = reload(new Date(), 'p-77');
    const meta = reloaded.saveMeta['p-77']!;
    expect(meta.lastExportMs).toBe(exportAt);
    expect(formatLastExportLabel(meta.lastExportMs, new Date())).toBe(`今天 ${formatClockTime(new Date(exportAt))}`);

    // 當天已另存＋之後自動暫存：正文底部顯示「已暫存 HH:MM」
    const status = editorSaveStatus({
      directWriteback: false,
      lastSaveMs: latestSaveTimestamp(meta),
      lastExportMs: meta.lastExportMs,
      now: new Date(),
    });
    expect(status).toEqual({ label: `已暫存 ${formatClockTime(new Date(autoAt))}`, openFiles: false });
    expect(status.label).toMatch(/^已暫存 \d{2}:\d{2}$/);
  });

  it('WO-77：當天還沒另存，重新整理後仍提示「今天還沒另存」可點到檔案頁；檔案頁不說還沒存進', () => {
    let state = reduce(createState(NOON), { type: 'add-project', id: 'p-77', title: '【範例】暫存稿', shape: 'novel' });
    state = reduce(state, { type: 'focus-project', id: 'p-77' });
    state = write(state, 'p-77', '霧從港口慢慢退去。');
    const autoAt = NOON.getTime() + 60_000;
    autoSave(state, autoAt);

    const reloaded = reload(NOON, 'p-77');
    const meta = reloaded.saveMeta['p-77']!;
    expect(meta.lastExportMs).toBeNull();
    expect(
      editorSaveStatus({ directWriteback: false, lastSaveMs: latestSaveTimestamp(meta), lastExportMs: null, now: NOON }),
    ).toEqual({ label: '今天還沒另存', openFiles: true });
    // 檔案頁依實際暫存時間說「已自動存在」，不再說「還沒存進」
    const lastSaveMs = latestSaveTimestamp(meta);
    const project = reloaded.projects.find((item) => item.id === 'p-77')!;
    const line = appSpaceStatusLine({ stored: project.origin === 'file' || lastSaveMs != null, computer: false, lastSaveMs });
    expect(line).toBe(`已自動存在這支手機的 App 空間・最後暫存 ${formatClockTime(new Date(autoAt))}`);
    expect(line).not.toContain('還沒存進');
  });

  it('WO-77：開回剛另存的同一份檔才對上另存時間，書名相同但內容不同的檔對不上', async () => {
    const saved = new Uint8Array([1, 2, 3, 4, 5]);
    const exportAt = NOON.getTime() + 5 * 60_000;
    await noteExportedBytes(store, saved, exportAt);
    expect(await exportTimeOfBytes(store, new Uint8Array([1, 2, 3, 4, 5]))).toBe(exportAt);
    expect(await exportTimeOfBytes(store, new Uint8Array([1, 2, 3, 4, 6]))).toBeNull();

    // 存檔紀錄之後再寫入，不會把另存檔案指紋洗掉
    persistDeviceSaveRecord(store, createState(NOON));
    expect(await exportTimeOfBytes(store, saved)).toBe(exportAt);
    // 指紋只在這台裝置，紀錄裡沒有正文
    expect(store.getItem(DEVICE_SAVE_RECORD_KEY)).not.toContain('霧');
  });
});
