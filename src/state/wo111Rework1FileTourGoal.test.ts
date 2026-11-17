/**
 * WO-111 返工1：開著 .db 檔案稿時，歡迎導覽第 1 關按「下一關」當下就把每日目標存到這台裝置，
 * 重新載入（從手機暫存回復這份稿子）時套回。只用程式產生的假資料（假稿子、記憶體假儲存），不用真稿或真 .db。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleFromLogs, type ImportedBook } from '../db/library';
import {
  DEVICE_SAVE_RECORD_KEY,
  loadDeviceSaveRecord,
  recallTourFileGoal,
} from './deviceSaveRecord';
import {
  applyTourFileGoal,
  attachActionForBook,
  commitTourDailyGoal,
  createState,
  persistDeviceSaveRecord,
  reduce,
  type Action,
  type SampleState,
} from './sampleStore';

const NOW = new Date('2026-11-17T04:00:00Z');
const LATER = new Date(NOW.getTime() + 5 * 60_000);

class MemoryStore {
  readonly data = new Map<string, string>();
  failSet = false;
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('QuotaExceededError（測試模擬）');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
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

/** 假的檔案稿（每日目標 1,000，今天已寫 200 字）；每次呼叫都像重新從手機暫存讀出同一份檔。 */
function fakeBook(now: Date, dailyTarget = 1000): ImportedBook {
  const logs = [
    {
      date: '2026-11-17',
      duration: 0,
      word_count: 200,
      ai_continuation_count: 0,
      ai_continuation_chars: 0,
      ai_chat_count: 0,
      ai_details: '{}',
      paste_large_count: 0,
      delete_large_count: 0,
    },
  ];
  return {
    key: 'file-fake-1',
    filename: '假稿.db',
    title: '假稿',
    info: { title: '假稿', dailyTargetWordCount: dailyTarget, targetWordCount: 100000 },
    tree: [],
    cards: [],
    logs,
    wordCount: 200,
    schedule: scheduleFromLogs(logs, dailyTarget, now),
    bytes: new Uint8Array([1, 2, 3]),
    hasExternalFile: false,
    titleInFile: '假稿',
    titleSavePending: null,
    transfer: undefined,
  } as unknown as ImportedBook;
}

const goalOf = (state: SampleState) => state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;

function runner(initial: SampleState) {
  let current = initial;
  return {
    get state() {
      return current;
    },
    dispatch: (action: Action) => {
      current = reduce(current, action);
    },
  };
}

/** 模擬重新載入：重建 state，再照 App 從手機暫存回復檔案稿的流程（applyTourFileGoal → 安靜 attach），然後打開它。 */
function reload(now: Date, dailyTargetInFile = 1000): SampleState {
  const book = applyTourFileGoal(fakeBook(now, dailyTargetInFile), store, now);
  const restored = reduce(
    createState(now),
    attachActionForBook(book, { updatedLabel: '在手機上', quiet: true }),
  );
  return reduce(restored, { type: 'focus-project', id: 'file-fake-1' });
}

describe('WO-111 返工1：開著 .db 時導覽每日目標當下保存到裝置', () => {
  it('1,000 改 500 按下一關：當下寫進既有裝置紀錄；重新載入後仍是 500，檔案欄位與 .db 內容不動', () => {
    const opened = reduce(createState(NOW), attachActionForBook(fakeBook(NOW), { updatedLabel: '剛剛' }));
    expect(goalOf(opened)).toBe(1000);
    const run = runner(opened);

    expect(commitTourDailyGoal({ state: run.state, goal: 500, now: NOW, store, dispatch: run.dispatch })).toBe(true);

    // 當下（沒有正文編輯、沒有離頁存稿）就已在裝置紀錄裡，且只用既有鍵。
    expect([...store.data.keys()]).toEqual([DEVICE_SAVE_RECORD_KEY]);
    expect(recallTourFileGoal(store, 'file-fake-1')).toBe(500);
    // 導覽不改檔案欄位（不觸發寫回 .db）。
    expect(run.state.fileExtras['file-fake-1'].info.dailyTargetWordCount).toBe(1000);
    expect(goalOf(run.state)).toBe(500);

    // 之後畫面照常把裝置紀錄寫一次（persist effect），這一格要留著。
    persistDeviceSaveRecord(store, run.state);
    expect(recallTourFileGoal(store, 'file-fake-1')).toBe(500);

    // 重新載入：檔案裡仍是 1,000，但這份稿子回復成 500；當天以最後一次為準，今天字數照檔案。
    const back = reload(LATER);
    expect(goalOf(back)).toBe(500);
    expect(back.goalById['file-fake-1'].defaultGoal).toBe(500);
    expect(back.schedule.open!.wordCount).toBe(200);
    expect(back.schedule.open!.goals.map((g) => g.goal)).toEqual([1000, 500]);
    expect(back.fileExtras['file-fake-1'].info.dailyTargetWordCount).toBe(1000);
  });

  it('之後在設定頁改成別的值：下次寫裝置紀錄就拿掉導覽那一格，重新載入照稿子自己的值', () => {
    const run = runner(reduce(createState(NOW), attachActionForBook(fakeBook(NOW), { updatedLabel: '剛剛' })));
    commitTourDailyGoal({ state: run.state, goal: 500, now: NOW, store, dispatch: run.dispatch });
    run.dispatch({ type: 'set-goal', goal: 2000 });
    persistDeviceSaveRecord(store, run.state);
    expect(recallTourFileGoal(store, 'file-fake-1')).toBeNull();
    // 設定頁的值由既有流程寫進檔案；這裡用檔案已是 2,000 模擬。
    expect(goalOf(reload(LATER, 2000))).toBe(2000);
  });

  it('沒選過、不合法或寫不進去：照檔案的值，不丟錯；也不另記無稿的 homeGoal', () => {
    expect(goalOf(reload(NOW))).toBe(1000);
    store.data.set(DEVICE_SAVE_RECORD_KEY, JSON.stringify({ tourGoalById: { 'file-fake-1': 299 } }));
    expect(goalOf(reload(NOW))).toBe(1000);
    expect(loadDeviceSaveRecord(store, NOW).tourGoalById).toBeUndefined();

    store.data.clear();
    store.failSet = true;
    const run = runner(reduce(createState(NOW), attachActionForBook(fakeBook(NOW), { updatedLabel: '剛剛' })));
    expect(() => commitTourDailyGoal({ state: run.state, goal: 500, now: NOW, store, dispatch: run.dispatch })).not.toThrow();
    expect(goalOf(run.state)).toBe(500);
    store.failSet = false;
    commitTourDailyGoal({ state: run.state, goal: 700, now: NOW, store, dispatch: run.dispatch });
    expect(JSON.parse(store.data.get(DEVICE_SAVE_RECORD_KEY)!).homeGoal).toBeUndefined();
  });
});
