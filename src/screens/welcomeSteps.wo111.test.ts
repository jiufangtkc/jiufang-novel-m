/**
 * WO-111（歡迎-4）：三關內容與設定寫入、收尾分流、錯誤狀態。
 * 只用程式產生的假狀態、記憶體假儲存與靜態畫面輸出，不碰真稿或真 .db。
 */
import { readFileSync } from 'node:fs';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOK_NOTE,
  BOOK_OPTIONS,
  CUSTOM_INPUT_ARIA,
  customCurrentLabel,
  DAILY_DEMO_NOTE,
  DAILY_OPTIONS,
  dailyDemoAria,
  ERROR_BOOK,
  ERROR_DAILY,
  ERROR_EMPTY,
  FINISH_APPEARANCE_LINK_ARIA,
  FINISH_APPEARANCE_NOTE,
  FINISH_PRIMARY,
  IOS_SAVE_NOTE,
  START_NAMES,
  START_NOTES,
  STEP3_BODY_REVISIT,
  STEP_BODIES,
  startOptionAria,
  type FinishOutcome,
  type TourStepNumber,
} from '../copy/welcomeCopy';
import { applyWordDelta, glowing } from '../domain/dailyGoal';
import { LayoutProvider, type LayoutMode } from '../layout';
import {
  DEVICE_SAVE_RECORD_KEY,
  loadDeviceSaveRecord,
  saveDeviceSaveRecord,
  saveHomeDailyGoal,
} from '../state/deviceSaveRecord';
import {
  forgetNewBookGoalSession,
  NEW_BOOK_GOAL_STORAGE_KEY,
  readNewBookGoal,
  writeNewBookGoal,
} from '../state/newBookGoal';
import { forgetOnboardingSession } from '../state/onboardingRecord';
import {
  addProjectAction,
  commitTourDailyGoal,
  createState,
  reduce,
  SampleProvider,
  type Action,
  type SampleState,
} from '../state/sampleStore';
import { GoalStepView, StartStep, useWelcomeSteps } from './WelcomeSteps';
import { WelcomeTour } from './WelcomeTour';
import {
  appearanceIsLink,
  checkGoalChoice,
  commitGoalStep,
  demoGoal,
  finishOutcomeFor,
  initialGoalChoice,
  initialStartChoice,
  isIphoneOrIpad,
  parseGoalInput,
  showsIosSaveNote,
  startChoices,
  type GoalChoice,
} from './welcomeStepsModel';
import { recordStatusFor, type TourEntry, type TourPage } from './welcomeTourModel';

const NOW = new Date('2026-11-17T04:00:00Z');

class MemoryStore {
  readonly data = new Map<string, string>();
  readonly writes: string[] = [];
  failGet = false;
  failSet = false;
  getItem(key: string): string | null {
    if (this.failGet) throw new Error('SecurityError（測試模擬）');
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('QuotaExceededError（測試模擬）');
    this.writes.push(key);
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
  forgetNewBookGoalSession();
  forgetOnboardingSession();
});

afterEach(() => {
  forgetNewBookGoalSession();
  forgetOnboardingSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const goalOf = (state: SampleState) => state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;

/** 照 reduce 跑 dispatch 的假 store 流程。 */
function runner(initial: SampleState) {
  let current = initial;
  const actions: Action[] = [];
  return {
    get state() {
      return current;
    },
    actions,
    dispatch: (action: Action) => {
      actions.push(action);
      current = reduce(current, action);
    },
  };
}

function Harness(props: {
  entry: TourEntry;
  page: TourPage;
  project?: { id: string; title: string } | null;
  iosSaveNote?: boolean;
  finishOutcome?: FinishOutcome;
  appearanceTo?: string;
}) {
  const steps = useWelcomeSteps({ entry: props.entry, project: props.project ?? null, iosSaveNote: props.iosSaveNote ?? false });
  return createElement(WelcomeTour, {
    entry: props.entry,
    todayWords: 0,
    dailyGoal: 1000,
    met: false,
    onExit: () => undefined,
    initialPage: props.page,
    channel: 'preview',
    ...steps,
    ...(props.finishOutcome ? { finishOutcome: props.finishOutcome } : {}),
    appearanceTo: props.appearanceTo,
  });
}

function renderFlow(
  page: TourPage,
  opts: {
    entry?: TourEntry;
    state?: SampleState;
    project?: { id: string; title: string } | null;
    iosSaveNote?: boolean;
    mode?: LayoutMode;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: opts.state ?? createState(NOW) },
      createElement(
        LayoutProvider,
        { initialMode: opts.mode ?? 'phone-portrait' },
        createElement(
          MemoryRouter,
          null,
          createElement(Harness, {
            entry: opts.entry ?? 'first',
            page,
            project: opts.project ?? null,
            iosSaveNote: opts.iosSaveNote,
          }),
        ),
      ),
    ),
  );
}

function renderFinish(extra: Partial<Parameters<typeof WelcomeTour>[0]>): string {
  return renderToStaticMarkup(
    createElement(
      LayoutProvider,
      { initialMode: 'phone-portrait' },
      createElement(
        MemoryRouter,
        null,
        createElement(WelcomeTour, {
          entry: 'first',
          todayWords: 0,
          dailyGoal: 1000,
          met: false,
          onExit: () => undefined,
          initialPage: 'finish',
          channel: 'preview',
          ...extra,
        }),
      ),
    ),
  );
}

function renderGoalStep(step: 1 | 2, choice: GoalChoice, saved: number, error: string | null): string {
  return renderToStaticMarkup(
    createElement(GoalStepView, {
      step,
      choice,
      saved,
      error,
      inputRef: createRef<HTMLInputElement>(),
      onChoose: () => undefined,
      onLeave: () => undefined,
    }),
  );
}

/* ── 用字 ── */

describe('WO-111 用字（H-2 定案字照寫；其餘【暫定】）', () => {
  it('H-2 定案：錯誤句、第 1 關小字、第 3 關名稱', () => {
    expect(ERROR_EMPTY).toBe('還沒填數字。也可以直接點上面的選項。');
    expect(ERROR_DAILY).toBe('每日目標請填 300 以上的整數。');
    expect(ERROR_BOOK).toBe('全書目標請填 1 以上的整數。');
    expect(DAILY_OPTIONS.map((o) => o.note)).toEqual(['一小步', '慢慢走', '穩穩前進', '大步走']);
    expect(START_NAMES.new).toBe('開新稿子');
    expect(START_NAMES.open).toBe('開啟稿子');
  });

  it('三關說明、選項、小字、iPhone／iPad 小卡、收尾按鈕', () => {
    expect(STEP_BODIES).toEqual({
      1: '挑一個不勉強的數字就好。之後隨時可以在「設定」裡改。',
      2: '還沒想好也沒關係，先選一個，寫著寫著再調。',
      3: '挑一個開始就好，這兩個在首頁也找得到。',
    });
    expect(STEP3_BODY_REVISIT).toBe('剛剛的目標已經存好了。');
    expect(DAILY_OPTIONS.map((o) => [o.value, o.amount])).toEqual([
      [300, '300 字'],
      [500, '500 字'],
      [1000, '1,000 字'],
      [2000, '2,000 字'],
    ]);
    expect(BOOK_OPTIONS.map((o) => `${o.amount}　${o.note}`)).toEqual([
      '5 萬字　中篇',
      '10 萬字　長篇',
      '20 萬字　大長篇',
      '30 萬字　超長篇',
    ]);
    expect(DAILY_DEMO_NOTE).toBe('寫作頁會有這條進度條，寫滿就會出現「達標了」。');
    expect(BOOK_NOTE).toBe('開新稿子時會自動帶入這個數字，已經有的稿子不會變。之後每本稿子都能在「設定」裡另外改。');
    expect(START_NOTES).toEqual({ new: '取個書名就能寫，會用剛剛定的全書目標', open: '選一個 .db 稿件檔，電腦上存的也可以' });
    expect(IOS_SAVE_NOTE).toBe('在 iPhone、iPad 上，稿子會自動暫存在 App 裡。要存一份到「檔案」App，請按「另存專案」。');
    expect(FINISH_PRIMARY.new).toEqual({ text: '開始寫', aria: '開始寫，開一本新稿子' });
    expect(FINISH_PRIMARY.open).toEqual({ text: '開始寫', aria: '開始寫，選一個 .db 稿件檔' });
    expect(FINISH_PRIMARY.home).toEqual({ text: '回首頁' });
    expect(FINISH_PRIMARY.continue).toEqual({ text: '繼續寫', aria: '繼續寫，回到剛剛寫的地方' });
    expect(FINISH_APPEARANCE_LINK_ARIA).toBe('到設定的外觀，換顏色或正文字級');
  });

  it('自己填顯示目前值：完整千分位、不換算萬，全形空格', () => {
    expect(customCurrentLabel(1500)).toBe('自己填　1,500 字');
    expect(customCurrentLabel(80000)).toBe('自己填　80,000 字');
  });

  it('朗讀：示範進度條不念斜線、跟著目標變；第 3 關名稱加小字', () => {
    expect(dailyDemoAria(1000)).toBe('寫作頁的進度條，今天寫了 0 字，每日目標 1,000 字');
    expect(dailyDemoAria(2000)).toBe('寫作頁的進度條，今天寫了 0 字，每日目標 2,000 字');
    expect(startOptionAria('new')).toBe('開新稿子，取個書名就能寫，會用剛剛定的全書目標');
    expect(startOptionAria('open')).toBe('開啟稿子，選一個 .db 稿件檔，電腦上存的也可以');
    expect(startOptionAria('continue', '月台上的狐狸')).toBe('繼續寫這份稿子，月台上的狐狸');
    expect(startOptionAria('continue', '')).toBe('繼續寫這份稿子，未命名稿子');
    expect(CUSTOM_INPUT_ARIA).toEqual({ 1: '自己填每日目標，單位是字，300 以上', 2: '自己填新稿子的全書目標，單位是字' });
  });

  it('沒有範例書、先不設、天數換算、全書進度', () => {
    const copy = readFileSync('src/copy/welcomeCopy.ts', 'utf8');
    const wo111 = copy.slice(copy.indexOf('WO-111：三關內容與收尾分流'));
    expect(wo111).not.toMatch(/範例|先不設|大約|天寫完|第 \d+ 天|全書進度/);
  });
});

/* ── 預選與檢查 ── */

describe('WO-111 預選、單選互斥、自己填檢查', () => {
  it('預選：目前值在選項就選那格；不在就直接選自己填並填好千分位；首次每日 1,000、全書 100,000', () => {
    expect(initialGoalChoice(1, 1000)).toEqual({ kind: 'option', value: 1000 });
    expect(initialGoalChoice(1, 1500)).toEqual({ kind: 'custom', text: '1,500' });
    expect(initialGoalChoice(2, 100000)).toEqual({ kind: 'option', value: 100000 });
    expect(initialGoalChoice(2, 80000)).toEqual({ kind: 'custom', text: '80,000' });
    expect(goalOf(createState(NOW))).toBe(1000);
    expect(readNewBookGoal()).toBe(100000);
  });

  it('讀自己填：空白不當 0；千分位逗號可收；小數、負數、亂碼、逗號位置不對都不收', () => {
    expect(parseGoalInput('')).toEqual({ kind: 'empty' });
    expect(parseGoalInput('   ')).toEqual({ kind: 'empty' });
    expect(parseGoalInput('1,500')).toEqual({ kind: 'number', value: 1500 });
    expect(parseGoalInput('1500')).toEqual({ kind: 'number', value: 1500 });
    expect(parseGoalInput(' 80,000 ')).toEqual({ kind: 'number', value: 80000 });
    expect(parseGoalInput('１，５００')).toEqual({ kind: 'number', value: 1500 });
    expect(parseGoalInput('0')).toEqual({ kind: 'number', value: 0 });
    for (const bad of ['1.5', '-5', '-1', 'abc', '15,00', '1,5000', '1e3', '+300', '99999999999999999999']) {
      expect(parseGoalInput(bad), bad).toEqual({ kind: 'invalid' });
    }
  });

  it('第 1 關：空白／299／1.5／300／1,500', () => {
    const c = (text: string) => checkGoalChoice(1, { kind: 'custom', text });
    expect(c('')).toEqual({ ok: false, message: ERROR_EMPTY });
    expect(c('299')).toEqual({ ok: false, message: ERROR_DAILY });
    expect(c('1.5')).toEqual({ ok: false, message: ERROR_DAILY });
    expect(c('abc')).toEqual({ ok: false, message: ERROR_DAILY });
    expect(c('0')).toEqual({ ok: false, message: ERROR_DAILY });
    expect(c('300')).toEqual({ ok: true, value: 300 });
    expect(c('1,500')).toEqual({ ok: true, value: 1500 });
    expect(checkGoalChoice(1, { kind: 'option', value: 2000 })).toEqual({ ok: true, value: 2000 });
  });

  it('第 2 關：空白／0／負數／小數／逗號', () => {
    const c = (text: string) => checkGoalChoice(2, { kind: 'custom', text });
    expect(c(' ')).toEqual({ ok: false, message: ERROR_EMPTY });
    expect(c('0')).toEqual({ ok: false, message: ERROR_BOOK });
    expect(c('-100')).toEqual({ ok: false, message: ERROR_BOOK });
    expect(c('1.5')).toEqual({ ok: false, message: ERROR_BOOK });
    expect(c('80,000')).toEqual({ ok: true, value: 80000 });
    expect(c('1')).toEqual({ ok: true, value: 1 });
  });

  it('錯誤不寫：檢查沒過不呼叫寫入；值沒變也不寫；通過且有變才寫', () => {
    const write = vi.fn();
    expect(commitGoalStep(1, { kind: 'custom', text: '' }, 1000, write)).toEqual({ ok: false, message: ERROR_EMPTY });
    expect(commitGoalStep(1, { kind: 'custom', text: '299' }, 1000, write).ok).toBe(false);
    expect(commitGoalStep(2, { kind: 'custom', text: '0' }, 100000, write).ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(commitGoalStep(1, { kind: 'option', value: 1000 }, 1000, write)).toEqual({ ok: true, value: 1000, wrote: false });
    expect(write).not.toHaveBeenCalled();
    expect(commitGoalStep(1, { kind: 'custom', text: '1,500' }, 1000, write)).toEqual({ ok: true, value: 1500, wrote: true });
    expect(write).toHaveBeenCalledWith(1500);
  });

  it('示範進度條的目標跟著有效選取變；自己填還沒填好時維持已存的值', () => {
    expect(demoGoal({ kind: 'option', value: 2000 }, 1000)).toBe(2000);
    expect(demoGoal({ kind: 'custom', text: '1,500' }, 1000)).toBe(1500);
    expect(demoGoal({ kind: 'custom', text: '' }, 1000)).toBe(1000);
    expect(demoGoal({ kind: 'custom', text: '200' }, 500)).toBe(500);
  });
});

/* ── 第 1 關：每日目標寫入 ── */

describe('WO-111 第 1 關寫入：和設定頁同一個每日目標', () => {
  it('無稿：寫進 state（設定頁讀的同一值），並記在既有裝置紀錄；重開後預選；不新增每日鍵', () => {
    const run = runner(createState(NOW));
    expect(commitTourDailyGoal({ state: run.state, goal: 1500, now: NOW, store, dispatch: run.dispatch })).toBe(true);
    expect(goalOf(run.state)).toBe(1500);
    expect(run.actions).toEqual([{ type: 'set-tour-goal', goal: 1500 }]);
    expect(store.writes).toEqual([DEVICE_SAVE_RECORD_KEY]);
    expect(JSON.parse(store.data.get(DEVICE_SAVE_RECORD_KEY)!).homeGoal).toBe(1500);
    // 重開 App：讀回同一個值；新開稿子也帶同一個每日目標。
    const reopened = createState(new Date(NOW.getTime() + 60_000));
    expect(goalOf(reopened)).toBe(1500);
    expect(initialGoalChoice(1, goalOf(reopened))).toEqual({ kind: 'custom', text: '1,500' });
    const withBook = reduce(reopened, addProjectAction('p-new', '新稿', 'novel', NOW.getTime(), store));
    expect(withBook.goalById['p-new'].defaultGoal).toBe(1500);
    // 只用既有鍵（save-record.v1），沒有其他每日目標鍵。
    expect([...store.data.keys()]).toEqual([DEVICE_SAVE_RECORD_KEY]);
  });

  it('值沒變不寫；不合法（299、1.5）不寫、回 false', () => {
    const run = runner(createState(NOW));
    expect(commitTourDailyGoal({ state: run.state, goal: 1000, now: NOW, store, dispatch: run.dispatch })).toBe(true);
    expect(commitTourDailyGoal({ state: run.state, goal: 299, now: NOW, store, dispatch: run.dispatch })).toBe(false);
    expect(commitTourDailyGoal({ state: run.state, goal: 1.5, now: NOW, store, dispatch: run.dispatch })).toBe(false);
    expect(run.actions).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  it('當天以最後一次為準：達標判斷跟著導覽改的新值', () => {
    const base = createState(NOW);
    const run = runner({ ...base, schedule: applyWordDelta(base.schedule, 1200, NOW) });
    expect(glowing(run.state.schedule)).toBe(true);
    commitTourDailyGoal({ state: run.state, goal: 1500, now: NOW, store, dispatch: run.dispatch });
    expect(glowing(run.state.schedule)).toBe(false);
    commitTourDailyGoal({ state: run.state, goal: 1000, now: NOW, store, dispatch: run.dispatch });
    expect(glowing(run.state.schedule)).toBe(true);
    expect(run.state.schedule.open!.goals.map((g) => g.goal)).toEqual([1000, 1500, 1000]);
  });

  it('儲存例外：寫不進去也不丟錯，這次使用照樣是新值；讀不到時重開回 1,000', () => {
    store.failSet = true;
    const run = runner(createState(NOW));
    expect(() => commitTourDailyGoal({ state: run.state, goal: 2000, now: NOW, store, dispatch: run.dispatch })).not.toThrow();
    expect(goalOf(run.state)).toBe(2000);
    store.failSet = false;
    store.failGet = true;
    expect(goalOf(createState(NOW))).toBe(1000);
    expect(commitTourDailyGoal({ state: createState(NOW), goal: 500, now: NOW, store: null, dispatch: () => undefined })).toBe(true);
  });

  it('既有紀錄照舊保留 homeGoal；不合法的 homeGoal 當作沒設', () => {
    saveHomeDailyGoal(store, 1500);
    saveDeviceSaveRecord(store, { saveMeta: {}, logsById: {}, goalById: {}, draftIds: [] });
    expect(loadDeviceSaveRecord(store, NOW).homeGoal).toBe(1500);
    for (const bad of [299, 1.5, '1000', -1, null]) {
      store.data.set(DEVICE_SAVE_RECORD_KEY, JSON.stringify({ homeGoal: bad }));
      expect(loadDeviceSaveRecord(store, NOW).homeGoal).toBeUndefined();
      expect(goalOf(createState(NOW))).toBe(1000);
    }
    expect(saveHomeDailyGoal(store, 299)).toBe(false);
  });

  it('有開著的稿子（再看一次）：改那份稿子的每日目標（設定頁同值），不另記 homeGoal，不改全書目標', () => {
    const created = reduce(createState(NOW), addProjectAction('p-a', '甲稿', 'novel', NOW.getTime(), store));
    const focused = reduce(created, { type: 'focus-project', id: 'p-a' });
    const run = runner(focused);
    commitTourDailyGoal({ state: run.state, goal: 500, now: NOW, store, dispatch: run.dispatch });
    expect(goalOf(run.state)).toBe(500);
    expect(run.state.goalById['p-a'].open!.goals.at(-1)!.goal).toBe(500);
    expect(run.state.projects.find((p) => p.id === 'p-a')!.bookGoal).toBe(focused.projects.find((p) => p.id === 'p-a')!.bookGoal);
    expect(store.data.has(DEVICE_SAVE_RECORD_KEY)).toBe(false);
  });

  it('隔離 setGoal 的檔案副作用：開著檔案稿時不改 fileExtras、不跳提示；設定頁的 set-goal 照舊會改', () => {
    const created = reduce(createState(NOW), addProjectAction('f-1', '檔案稿', 'novel', NOW.getTime(), store));
    const fileExtras = {
      k1: { info: { dailyTargetWordCount: 1000, targetWordCount: 100000 }, cards: [], logs: [] },
    } as unknown as SampleState['fileExtras'];
    const fileState: SampleState = {
      ...created,
      projects: created.projects.map((p) => (p.id === 'f-1' ? { ...p, origin: 'file', dbKey: 'k1' } : p)),
      activeProjectId: 'f-1',
      fileExtras,
      toast: null,
    };
    const tour = reduce(fileState, { type: 'set-tour-goal', goal: 1500 });
    expect(goalOf(tour)).toBe(1500);
    expect(tour.fileExtras).toBe(fileExtras);
    expect(tour.projects).toBe(fileState.projects);
    expect(tour.toast).toBeNull();
    const settings = reduce(fileState, { type: 'set-goal', goal: 1500 });
    expect((settings.fileExtras.k1.info as { dailyTargetWordCount: number }).dailyTargetWordCount).toBe(1500);
    // 值沒變：完全不動。
    expect(reduce(tour, { type: 'set-tour-goal', goal: 1500 })).toBe(tour);
  });
});

/* ── 第 2 關：新稿子全書目標 ── */

describe('WO-111 第 2 關寫入：新稿子全書目標預設', () => {
  it('選 20 萬：立即存整數字串 200000，目前稿子全書目標不變', () => {
    const created = reduce(createState(NOW), addProjectAction('p-a', '甲稿', 'novel', NOW.getTime(), store));
    const before = created.projects[0].bookGoal;
    const result = commitGoalStep(2, { kind: 'option', value: 200000 }, readNewBookGoal(), (v) => writeNewBookGoal(v));
    expect(result).toEqual({ ok: true, value: 200000, wrote: true });
    expect(store.data.get(NEW_BOOK_GOAL_STORAGE_KEY)).toBe('200000');
    expect(created.projects[0].bookGoal).toBe(before);
    // 之後開新稿子才帶入。
    const next = reduce(created, addProjectAction('p-b', '乙稿', 'novel', NOW.getTime(), store));
    expect(next.projects.find((p) => p.id === 'p-b')!.bookGoal).toBe(200000);
    expect(next.projects.find((p) => p.id === 'p-a')!.bookGoal).toBe(before);
  });

  it('自己填 80,000：存 80000；重開預選「自己填　80,000 字」', () => {
    commitGoalStep(2, { kind: 'custom', text: '80,000' }, readNewBookGoal(), (v) => writeNewBookGoal(v));
    forgetNewBookGoalSession();
    expect(readNewBookGoal()).toBe(80000);
    expect(initialGoalChoice(2, readNewBookGoal())).toEqual({ kind: 'custom', text: '80,000' });
  });

  it('導覽三關程式不改目前稿子全書目標、不寫 .db、不用設定頁 setGoal', () => {
    const src = readFileSync('src/screens/WelcomeSteps.tsx', 'utf8');
    expect(src).not.toMatch(/setBookGoal|actions\.setGoal\(|saveBookBytes|writeFileProject|importFile/);
    expect(src).toContain('actions.setTourDailyGoal(value)');
    expect(src).toContain('writeNewBookGoal(value)');
  });
});

/* ── 畫面 ── */

describe('WO-111 第 1 關畫面', () => {
  it('首次：預選 1,000、四選項與自己填同一組單選、示範進度條 0／1,000、說明與小字', () => {
    const html = renderFlow(1);
    expect(html).toContain('>第 1 關　每天</p>');
    expect(html).toContain('>每天想寫多少字？</h2>');
    expect(html).toContain(`data-testid="welcome-step-lead">${STEP_BODIES[1]}</p>`);
    expect(html).toContain('role="radiogroup" aria-label="每日目標"');
    expect(html.match(/role="radio"/g)).toHaveLength(5);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="1,000 字，穩穩前進"/);
    expect(html).toContain('aria-label="300 字，一小步"');
    expect(html).toContain('aria-label="2,000 字，大步走"');
    expect(html).toContain('aria-label="自己填，點了可以輸入數字"');
    expect(html).not.toContain('<input');
    expect(html).toContain('role="img" aria-label="寫作頁的進度條，今天寫了 0 字，每日目標 1,000 字"');
    expect(html).toContain('今天 0／1,000 字');
    expect(html).toContain(DAILY_DEMO_NOTE);
    expect(html).not.toMatch(/上方|分鐘|小時/);
  });

  it('再看一次、目前 1,500：直接選自己填並顯示「自己填　1,500 字」；示範跟著 1,500', () => {
    saveHomeDailyGoal(store, 1500);
    const html = renderFlow(1, { state: createState(NOW) });
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="welcome-option-1-custom"/);
    expect(html).toContain('自己填　1,500 字');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('placeholder="300 以上"');
    expect(html).toContain('aria-label="自己填每日目標，單位是字，300 以上"');
    expect(html).toContain('value="1,500"');
    expect(html).toContain('>字</span>');
    expect(html).toContain('每日目標 1,500 字');
    expect(html).not.toContain('aria-invalid');
  });
});

describe('WO-111 第 2 關畫面', () => {
  it('首次：預選 10 萬；四選項；小字；沒有先不設、沒有天數', () => {
    const html = renderFlow(2);
    expect(html).toContain('>第 2 關　全書</p>');
    expect(html).toContain('>新稿子想寫多長？</h2>');
    expect(html).toContain('role="radiogroup" aria-label="新稿子的全書目標"');
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="10 萬字，長篇"/);
    expect(html).toContain(BOOK_NOTE);
    expect(html).not.toMatch(/先不設|天寫完|大約|第 \d+ 天/);
    expect(html).not.toContain('data-testid="welcome-demo"');
  });

  it('目前預設 80,000：自己填　80,000 字、提示「例如 80,000」', () => {
    writeNewBookGoal(80000);
    const html = renderFlow(2);
    expect(html).toContain('自己填　80,000 字');
    expect(html).toContain('placeholder="例如 80,000"');
    expect(html).toContain('aria-label="自己填新稿子的全書目標，單位是字"');
    expect(html).toContain('value="80,000"');
  });
});

describe('WO-111 自己填錯誤狀態', () => {
  for (const [step, message] of [
    [1, ERROR_EMPTY],
    [1, ERROR_DAILY],
    [2, ERROR_EMPTY],
    [2, ERROR_BOOK],
  ] as const) {
    it(`第 ${step} 關「${message}」：輸入框正下方提醒、aria-invalid、aria-describedby`, () => {
      const html = renderGoalStep(step, { kind: 'custom', text: '' }, step === 1 ? 1000 : 100000, message);
      const id = `welcome-goal-error-${step}`;
      expect(html).toContain(`aria-invalid="true" aria-describedby="${id}"`);
      expect(html).toContain(`<p id="${id}" class="welcome-error" role="alert" data-testid="welcome-error-${step}">${message}</p>`);
      expect(html).toContain('data-invalid="true"');
      // 錯誤句緊接在輸入框那一列後面。
      expect(html.indexOf('welcome-custom-field')).toBeLessThan(html.indexOf('welcome-error'));
      expect(html.indexOf('welcome-error')).toBeLessThan(html.indexOf('welcome-note'));
    });
  }

  it('沒有錯誤時：無提醒、無 aria-invalid、外框還原', () => {
    const html = renderGoalStep(1, { kind: 'custom', text: '12' }, 1000, null);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('data-invalid="false"');
  });

  it('按鈕不灰：「下一關」沒有 disabled；錯誤只擋換頁、不寫', () => {
    const html = renderFlow(1);
    expect(html).toMatch(/data-testid="welcome-primary"[^>]*>下一關<\/button>/);
    expect(html).not.toMatch(/welcome-primary"[^>]*disabled/);
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toContain('if (isStep(page) && onStepNext && !onStepNext(page)) return;');
    const steps = readFileSync('src/screens/WelcomeSteps.tsx', 'utf8');
    expect(steps).toMatch(/if \(!result\.ok\) \{[\s\S]*?setError\(\{ step, message: result\.message \}\);\s*inputRef\.current\?\.focus\(\);\s*return false;/);
  });

  it('開始輸入、改選項、離開這一關都清掉錯誤', () => {
    const steps = readFileSync('src/screens/WelcomeSteps.tsx', 'utf8');
    expect(steps).toMatch(/const choose = [\s\S]*?setError\(null\);/);
    expect(steps).toContain('useEffect(() => () => leaveRef.current(), []);');
    expect(steps).toMatch(/const onStepSkip = [\s\S]*?setError\(null\);/);
  });

  it('錯誤色：--danger、外框 2px（1px＋1px 內框）、焦點仍是 danger、錯誤句不乘透明度不放正文欄底、輸入框底色不變；不新增色', () => {
    const css = readFileSync('src/screens/welcomeTour.css', 'utf8');
    const wo111 = css.slice(css.indexOf('WO-111：三關內容'));
    expect(wo111).toMatch(
      /\.welcome-custom-field\[data-invalid="true"\] \.welcome-custom-input,\s*\.welcome-custom-field\[data-invalid="true"\] \.welcome-custom-input:focus,\s*\.welcome-custom-field\[data-invalid="true"\] \.welcome-custom-input:focus-visible \{\s*border: 1px solid var\(--danger\);\s*box-shadow: inset 0 0 0 1px var\(--danger\);\s*outline: 2px solid var\(--danger\);/,
    );
    const errorRule = wo111.match(/\.welcome-error \{([^}]*)\}/)![1];
    expect(errorRule).toContain('color: var(--danger);');
    expect(errorRule).not.toMatch(/opacity|background|color-mix/);
    const invalidRules = wo111.match(/data-invalid="true"\][^{]*\{[^}]*\}/g)!.join('\n');
    expect(invalidRules).not.toMatch(/background/);
    expect(wo111.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|--editor/);
    // 三套主題同值（global.css 只在共用語意色定義一次）。
    const global = readFileSync('src/styles/global.css', 'utf8');
    expect(global.match(/--danger:/g)).toHaveLength(1);
    expect(global).toContain('--danger: #E06C75;');
  });
});

describe('WO-111 第 3 關畫面', () => {
  it('首次：只有開新稿子（預選）、開啟稿子；沒有範例書；說明', () => {
    const html = renderFlow(3);
    expect(html).toContain('>第 3 關　出發</p>');
    expect(html).toContain(`>${STEP_BODIES[3]}</p>`);
    expect(html).toContain('role="radiogroup" aria-label="今天從哪裡開始"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="開新稿子，取個書名就能寫，會用剛剛定的全書目標"/);
    expect(html).toContain('aria-label="開啟稿子，選一個 .db 稿件檔，電腦上存的也可以"');
    expect(html).not.toMatch(/範例|繼續寫這份稿子/);
    expect(html).not.toContain('welcome-ios-note');
    expect(html).toMatch(/>就這樣，出發<\/button>/);
  });

  it('iPhone／iPad 才有另存小卡（再看一次也有）', () => {
    expect(renderFlow(3, { iosSaveNote: true })).toContain(`data-testid="welcome-ios-note">${IOS_SAVE_NOTE}</p>`);
    expect(
      renderFlow(3, { iosSaveNote: true, entry: 'revisit', project: { id: 'p', title: '甲稿' } }),
    ).toContain(IOS_SAVE_NOTE);
  });

  it('再看一次：多「繼續寫這份稿子」排第一並預選，小字書名；說明換成「剛剛的目標已經存好了。」；小標不加括號', () => {
    const html = renderFlow(3, { entry: 'revisit', project: { id: 'p', title: '月台上的狐狸' } });
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="繼續寫這份稿子，月台上的狐狸"/);
    expect(html.indexOf('welcome-start-continue')).toBeLessThan(html.indexOf('welcome-start-new'));
    expect(html.indexOf('welcome-start-new')).toBeLessThan(html.indexOf('welcome-start-open'));
    expect(html).toContain('aria-hidden="true">月台上的狐狸</span>');
    expect(html).toContain(`>${STEP3_BODY_REVISIT}</p>`);
    expect(html).toContain('>第 3 關　出發</p>');
    expect(html).not.toMatch(/第 3 關　出發（|再看一次）/);
  });

  it('沒有書名寫「未命名稿子」', () => {
    const html = renderToStaticMarkup(
      createElement(StartStep, {
        choices: ['continue', 'new', 'open'],
        selected: 'continue',
        projectTitle: '  ',
        showIosNote: false,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('aria-hidden="true">未命名稿子</span>');
    expect(html).toContain('aria-label="繼續寫這份稿子，未命名稿子"');
  });

  it('選項模型：首次兩項、再看一次三項；預選第一項；沒有範例書', () => {
    expect(startChoices('first', false)).toEqual(['new', 'open']);
    expect(startChoices('revisit', true)).toEqual(['continue', 'new', 'open']);
    expect(startChoices('revisit', false)).toEqual(['new', 'open']);
    expect(initialStartChoice('first', false)).toBe('new');
    expect(initialStartChoice('revisit', true)).toBe('continue');
  });
});

describe('WO-111 iPhone／iPad 判斷：沿用只能另存能力＋裝置訊號', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36';
  it('iPhone、iPad（含回報成 Macintosh 的多點觸控 iPad）', () => {
    expect(isIphoneOrIpad(IPHONE, 5)).toBe(true);
    expect(isIphoneOrIpad(IPAD, 5)).toBe(true);
    expect(isIphoneOrIpad(MAC, 5)).toBe(true);
    expect(isIphoneOrIpad(MAC, 0)).toBe(false);
    expect(isIphoneOrIpad(ANDROID, 5)).toBe(false);
  });
  it('沒有 picker 的桌面瀏覽器、Android 不算；有 picker 時不顯示', () => {
    expect(showsIosSaveNote({ canPickLocalFiles: false, userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(showsIosSaveNote({ canPickLocalFiles: false, userAgent: FIREFOX, maxTouchPoints: 0 })).toBe(false);
    expect(showsIosSaveNote({ canPickLocalFiles: false, userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
    expect(showsIosSaveNote({ canPickLocalFiles: true, userAgent: MAC, maxTouchPoints: 5 })).toBe(false);
  });
});

/* ── 收尾 ── */

describe('WO-111 收尾', () => {
  it('四種分流：按鈕字與朗讀', () => {
    expect(renderFinish({ finishOutcome: 'new' })).toContain('aria-label="開始寫，開一本新稿子">開始寫</button>');
    expect(renderFinish({ finishOutcome: 'open' })).toContain('aria-label="開始寫，選一個 .db 稿件檔">開始寫</button>');
    expect(renderFinish({ finishOutcome: 'continue' })).toContain('aria-label="繼續寫，回到剛剛寫的地方">繼續寫</button>');
    const home = renderFinish({ finishOutcome: 'home' });
    expect(home).toContain('data-testid="welcome-primary">回首頁</button>');
    expect(renderFinish({})).toContain('>回首頁</button>');
  });

  it('第 3 關結果對應收尾：跳過＝回首頁；選什麼就做什麼', () => {
    expect(finishOutcomeFor({ kind: 'skip' })).toBe('home');
    expect(finishOutcomeFor({ kind: 'next', choice: 'new' })).toBe('new');
    expect(finishOutcomeFor({ kind: 'next', choice: 'open' })).toBe('open');
    expect(finishOutcomeFor({ kind: 'next', choice: 'continue' })).toBe('continue');
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toMatch(/if \(page === 'finish' && finishOutcome !== 'home'\) \{\s*onExit\(FINISH_EXIT\[finishOutcome\]\);/);
  });

  it('今天進度：已存目標與實際字數；沒寫 0；達標「　達標了」與「，已經達標」', () => {
    const zero = renderFinish({ todayWords: 0, dailyGoal: 1500, met: false });
    expect(zero).toContain('今天 0／1,500 字');
    expect(zero).toContain('aria-label="今天寫了 0 字，每日目標 1,500 字"');
    const met = renderFinish({ todayWords: 1020, dailyGoal: 1000, met: true });
    expect(met).toContain('今天 1,020／1,000 字　達標了');
    expect(met).toContain('aria-label="今天寫了 1,020 字，每日目標 1,000 字，已經達標"');
    expect(met).toContain('>今天先寫一點就好</h2>');
    expect(met).not.toMatch(/第 \d+ 天|天寫完|全書進度|welcome-back|welcome-corner/);
  });

  it('外觀那一行：首次只是文字；再看一次且有開著的稿子才是連結', () => {
    const plain = renderFinish({});
    expect(plain).toContain(`data-testid="welcome-appearance-note">${FINISH_APPEARANCE_NOTE}</p>`);
    expect(plain).not.toMatch(/<a\b/);
    const link = renderFinish({ entry: 'revisit', appearanceTo: '/p/x/settings' });
    const anchor = link.match(/<a [^>]*>([^<]*)<\/a>/)!;
    expect(anchor[0]).toContain('class="welcome-appearance-link"');
    expect(anchor[0]).toContain('href="/p/x/settings"');
    expect(anchor[0]).toContain('aria-label="到設定的外觀，換顏色或正文字級"');
    expect(anchor[1]).toBe(FINISH_APPEARANCE_NOTE);
    expect(appearanceIsLink('first', false)).toBe(false);
    expect(appearanceIsLink('revisit', true)).toBe(true);
    const revisit = readFileSync('src/screens/WelcomeRevisitScreen.tsx', 'utf8');
    expect(revisit).toContain('appearanceTo={project ? `/p/${project.id}/settings` : undefined}');
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    expect(home).not.toContain('appearanceTo');
  });

  it('首頁收尾：開新稿子＝打開現有對話框（不直接建稿）；開啟稿子＝沿用 picker／file input；回首頁只關掉', () => {
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    expect(home).toMatch(/onExit=\{\(exit\) => \{\s*welcome\.dismiss\(\);\s*if \(exit === 'finish-new'\) setCreating\(true\);\s*else if \(exit === 'finish-open'\) openFile\.open\(\);\s*\}\}/);
    expect(home).toContain('onClick={() => openFile.open()}');
    expect(home).not.toMatch(/finish-new'\)[^\n]*addProject/);
    const hook = readFileSync('src/screens/useOpenManuscriptFile.tsx', 'utf8');
    expect(hook).toContain('if (canPickLocalFiles()) {');
    expect(hook).toContain('.openWithPicker()');
    expect(hook).toContain('inputRef.current?.click();');
    expect(hook).toContain('.importFile(file)');
    expect(hook).toContain('accept=".db,application/octet-stream,application/x-sqlite3"');
  });

  it('再看一次收尾：繼續寫回原寫作頁（游標由寫作頁既有記憶還原）；開新稿子回首頁開對話框；開啟稿子在點擊裡開選檔', () => {
    const revisit = readFileSync('src/screens/WelcomeRevisitScreen.tsx', 'utf8');
    expect(revisit).toContain("else if (exit === 'finish-continue' && project) navigate(manuscriptWritePath(project));");
    expect(revisit).toContain("else if (exit === 'finish-new') navigate('/', { state: WELCOME_START_NEW_STATE });");
    expect(revisit).toMatch(/exit === 'finish-open'\) \{[\s\S]*?openFile\.open\(/);
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    expect(home).toMatch(/if \(!isWelcomeStartNew\(location\.state\)\) return;\s*setCreating\(true\);\s*navigate\(location\.pathname, \{ replace: true, state: null \}\);/);
  });
});

/* ── 紀錄時機、跳過、重看 ── */

describe('WO-111 紀錄時機與跳過', () => {
  it('第 1、2 關跳過當下記 skipped，之後走到收尾記 done；第 3 關跳過維持 skipped', () => {
    const ctx = { entry: 'first' as const, writtenThisRun: false, hadRecordAtStart: false };
    expect(recordStatusFor('skip-step', ctx)).toBe('skipped');
    expect(recordStatusFor('reach-finish', { ...ctx, writtenThisRun: true })).toBe('done');
    expect(recordStatusFor('skip-last-step', ctx)).toBe('skipped');
    expect(recordStatusFor('skip-last-step', { ...ctx, writtenThisRun: true })).toBeNull();
    expect(recordStatusFor('reach-finish', { ...ctx, writtenThisRun: true, skippedLastStep: true })).toBeNull();
    // 再看一次原本有紀錄：都不覆寫。
    expect(recordStatusFor('reach-finish', { entry: 'revisit', writtenThisRun: false, hadRecordAtStart: true })).toBeNull();
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toMatch(/if \(page === 3\) \{\s*record\('skip-last-step'\);\s*skippedLastRef\.current = true;\s*\} else \{\s*record\('skip-step'\);\s*\}\s*onStepSkip\?\.\(page\);/);
  });

  it('跳過只不改該關：選取回到已存的值；上一步不回滾', () => {
    const steps = readFileSync('src/screens/WelcomeSteps.tsx', 'utf8');
    const skip = steps.slice(steps.indexOf('const onStepSkip'), steps.indexOf('const stepBody'));
    expect(skip).not.toMatch(/setTourDailyGoal|writeNewBookGoal/);
    expect(skip).toContain("else setFinishOutcome(finishOutcomeFor({ kind: 'skip' }));");
    const tour = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(tour).toContain('onClick={() => setPage(back)}');
  });

  it('從設定再看一次：第 1、2 關帶目前值（含非選項值），第 2 關不改目前稿子', () => {
    const created = reduce(createState(NOW), addProjectAction('p-a', '甲稿', 'novel', NOW.getTime(), store));
    const focused = reduce(reduce(created, { type: 'focus-project', id: 'p-a' }), { type: 'set-goal', goal: 2000 });
    writeNewBookGoal(300000);
    const step1 = renderFlow(1, { entry: 'revisit', state: focused, project: { id: 'p-a', title: '甲稿' } });
    expect(step1).toMatch(/aria-checked="true"[^>]*aria-label="2,000 字，大步走"/);
    const step2 = renderFlow(2, { entry: 'revisit', state: focused, project: { id: 'p-a', title: '甲稿' } });
    expect(step2).toMatch(/aria-checked="true"[^>]*aria-label="30 萬字，超長篇"/);
    expect(focused.projects.find((p) => p.id === 'p-a')!.bookGoal).toBe(100000);
  });

  it('首頁與再看一次都接上三關內容', () => {
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    expect(home).toContain("useWelcomeSteps({ entry: 'first', project: null })");
    expect(home).toMatch(/<WelcomeTour\s+entry="first"[\s\S]*?\{\.\.\.steps\}/);
    const revisit = readFileSync('src/screens/WelcomeRevisitScreen.tsx', 'utf8');
    expect(revisit).toMatch(/useWelcomeSteps\(\{\s*entry: 'revisit',/);
    expect(revisit).toContain('{...steps}');
  });
});

/* ── 四版 ── */

describe('WO-111 四版結構與尺寸', () => {
  const MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];
  for (const mode of MODES) {
    for (const step of [1, 2, 3] as TourStepNumber[]) {
      it(`${mode} × 第 ${step} 關：說明在左欄、選項在右欄`, () => {
        const html = renderFlow(step, { mode });
        expect(html.indexOf('data-testid="welcome-step-lead"')).toBeLessThan(html.indexOf('class="welcome-content"'));
        expect(html.indexOf('class="welcome-content"')).toBeLessThan(html.indexOf('role="radiogroup"'));
      });
    }
  }

  it('CSS：2×2、自己填佔整列、選項放大可換行；連結 44 以上；輸入框 52', () => {
    const css = readFileSync('src/screens/welcomeTour.css', 'utf8');
    expect(css).toMatch(/\.welcome-options\.is-grid \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.welcome-options\.is-grid \.welcome-option-custom \{\s*grid-column: 1 \/ -1;/);
    expect(css).toMatch(/\.welcome-option \{[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/\.welcome-appearance-link \{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.welcome-custom-input \{[^}]*min-height: 52px;/);
  });

  it('自己填叫數字鍵盤；手點才把焦點移到輸入框，方向鍵在選項間移動不搶焦點', () => {
    const steps = readFileSync('src/screens/WelcomeSteps.tsx', 'utf8');
    expect(steps).toContain('inputMode="numeric"');
    expect(steps).toContain('if (event.detail > 0) window.requestAnimationFrame(() => inputRef.current?.focus());');
  });
});
