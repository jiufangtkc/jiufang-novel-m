/**
 * WO-110（歡迎-3）：歡迎導覽外框、第一次出現時機、跳過、本機紀錄。
 * 只用程式產生的假資料、記憶體假儲存與靜態畫面輸出，不碰真稿或真 .db。
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION } from '../copy/aboutCopy';
import {
  FINISH_APPEARANCE_NOTE,
  STEP_BACK_ARIA,
  STEP_PRIMARY_ARIA,
  STEP_SKIP_ARIA,
  stepKicker,
  trailAria,
  TRAIL_DONE_ARIA,
  WELCOME_BODY,
  WELCOME_HEADLINE,
  WELCOME_HEADLINE_SEGMENTS,
  WELCOME_PREVIEW_NOTE,
} from '../copy/welcomeCopy';
import { LIVE_DRAFT_KEY } from '../editor/liveDraft';
import { LayoutProvider, type LayoutMode } from '../layout';
import {
  buildOnboardingRecord,
  decideFirstRun,
  deviceHasExistingData,
  forgetOnboardingSession,
  hasOnboardingRecord,
  localIsoWithOffset,
  ONBOARDING_STORAGE_KEY,
  readOnboardingRecord,
  writeOnboardingRecord,
} from '../state/onboardingRecord';
import { SampleProvider, createState, useSample } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';
import { HomeScreen } from './HomeScreen';
import { resolveFirstRun } from './useFirstRunWelcome';
import { WelcomeRevisitScreen } from './WelcomeRevisitScreen';
import { WelcomeTour } from './WelcomeTour';
import {
  backPage,
  cornerAction,
  enterTriggersPrimary,
  escapeClosesTour,
  nextPage,
  radioArrowTarget,
  recordStatusFor,
  TOUR_PAGES,
  TOUR_SIZES,
  tourPresentation,
  trailDots,
  type TourPage,
} from './welcomeTourModel';
import { Workspace } from './Workspace';

const MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];
const PAGES: TourPage[] = ['welcome', 1, 2, 3, 'finish'];

/** 記憶體假儲存；可設定讀／寫丟錯，並記下寫入次數。 */
function fakeStore(initial: Record<string, string> = {}, opts: { throwGet?: boolean; throwSet?: boolean } = {}) {
  const data = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  return {
    data,
    writes,
    getItem(key: string) {
      if (opts.throwGet) throw new Error('blocked');
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (opts.throwSet) throw new Error('quota');
      writes.push([key, value]);
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

beforeEach(() => forgetOnboardingSession());
afterEach(() => forgetOnboardingSession());

function renderTour(
  mode: LayoutMode,
  page: TourPage,
  extra: Partial<Parameters<typeof WelcomeTour>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(
      LayoutProvider,
      { initialMode: mode },
      createElement(WelcomeTour, {
        entry: 'first',
        todayWords: 0,
        dailyGoal: 1000,
        met: false,
        onExit: () => undefined,
        initialPage: page,
        channel: 'preview',
        ...extra,
      }),
    ),
  );
}

describe('WO-110 本機紀錄 onboarding.v1', () => {
  it('鍵名與 JSON 格式；時間是寫入當下（含時區位移），版本取 WO-108 的單一來源', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('jiufang-novel-m.onboarding.v1');
    const store = fakeStore();
    const now = new Date(2026, 10, 17, 9, 5, 7);
    expect(writeOnboardingRecord('done', now, store)).toBe(true);
    const raw = store.data.get(ONBOARDING_STORAGE_KEY)!;
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed)).toEqual(['status', 'at', 'appVersion']);
    expect(parsed.status).toBe('done');
    expect(parsed.appVersion).toBe(APP_VERSION);
    expect(parsed.at).toBe(localIsoWithOffset(now));
    expect(parsed.at).toMatch(/^2026-11-17T09:05:07[+-]\d{2}:\d{2}$/);
    expect(new Date(parsed.at).getTime()).toBe(now.getTime());
    expect(parsed.at).not.toBe('2026-11-17T12:00:00+08:00');
  });

  it('時區位移格式：+08:00、-03:30、+00:00', () => {
    const fake = (offset: number) => {
      const d = new Date(2026, 10, 17, 12, 0, 0);
      return Object.assign(d, { getTimezoneOffset: () => offset });
    };
    expect(localIsoWithOffset(fake(-480))).toBe('2026-11-17T12:00:00+08:00');
    expect(localIsoWithOffset(fake(210))).toBe('2026-11-17T12:00:00-03:30');
    expect(localIsoWithOffset(fake(0))).toBe('2026-11-17T12:00:00+00:00');
  });

  it('status 只有 done 或 skipped', () => {
    const store = fakeStore();
    writeOnboardingRecord('skipped', new Date(), store);
    expect(readOnboardingRecord(store)?.status).toBe('skipped');
    expect(buildOnboardingRecord('done', new Date()).status).toBe('done');
    store.data.set(ONBOARDING_STORAGE_KEY, JSON.stringify({ status: 'seen', at: 'x', appVersion: '0.1.0' }));
    expect(readOnboardingRecord(store)).toBeNull();
  });

  it('鍵存在就算有紀錄，內容不合法也一樣，不因版本重跑', () => {
    for (const raw of ['', 'garbage', '{}', 'null', JSON.stringify({ status: 'done', at: 'x', appVersion: '0.0.1' })]) {
      forgetOnboardingSession();
      expect(hasOnboardingRecord(fakeStore({ [ONBOARDING_STORAGE_KEY]: raw }))).toBe(true);
    }
    expect(hasOnboardingRecord(fakeStore())).toBe(false);
  });

  it('模擬版本變更（不部署）：舊版本寫的紀錄仍讓首頁不自動出現', () => {
    const store = fakeStore({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify(buildOnboardingRecord('done', new Date(), '0.0.9')),
    });
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, store)).toBe('none');
    expect(store.writes).toEqual([]);
  });

  it('儲存例外：讀丟錯當作沒有、寫丟錯回 false 不丟錯；同次使用以記憶體防重現；重開可能再出現', () => {
    const broken = fakeStore({}, { throwGet: true, throwSet: true });
    expect(hasOnboardingRecord(broken)).toBe(false);
    expect(() => writeOnboardingRecord('skipped', new Date(), broken)).not.toThrow();
    forgetOnboardingSession();
    expect(writeOnboardingRecord('skipped', new Date(), broken)).toBe(false);
    expect(hasOnboardingRecord(broken)).toBe(true);
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, broken)).toBe('none');
    forgetOnboardingSession();
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, broken)).toBe('show');
  });

  it('沒有本機儲存（null）時也能用，不丟錯', () => {
    expect(hasOnboardingRecord(null)).toBe(false);
    expect(writeOnboardingRecord('done', new Date(), null)).toBe(false);
    expect(hasOnboardingRecord(null)).toBe(true);
  });

  it('程式不刪鍵：原始碼沒有 removeItem', () => {
    const src = readFileSync('src/state/onboardingRecord.ts', 'utf8');
    expect(src).not.toMatch(/removeItem|\.clear\(/);
    const hook = readFileSync('src/screens/useFirstRunWelcome.ts', 'utf8');
    expect(hook).not.toMatch(/removeItem|\.clear\(/);
  });
});

describe('WO-110 首次判定', () => {
  it('決策順序：有鍵 → 不出現；不在首頁 → 不插隊；未載完 → 等；有資料 → 記 skipped；全新 → 出現', () => {
    const base = { hasRecord: false, atHome: true, deviceLoaded: true, hasExistingData: false };
    expect(decideFirstRun(base)).toBe('show');
    expect(decideFirstRun({ ...base, hasRecord: true })).toBe('none');
    expect(decideFirstRun({ ...base, hasRecord: true, hasExistingData: true })).toBe('none');
    expect(decideFirstRun({ ...base, atHome: false })).toBe('none');
    expect(decideFirstRun({ ...base, atHome: false, hasExistingData: true })).toBe('none');
    expect(decideFirstRun({ ...base, deviceLoaded: false })).toBe('wait');
    expect(decideFirstRun({ ...base, deviceLoaded: false, hasExistingData: true })).toBe('wait');
    expect(decideFirstRun({ ...base, hasExistingData: true })).toBe('mark-skipped');
  });

  it('清單空但有移出清單的暫存稿、或有即時草稿，都不是全新', () => {
    expect(deviceHasExistingData({ projectIds: [], recentIds: [], hasLiveDraft: false })).toBe(false);
    expect(deviceHasExistingData({ projectIds: ['p1'], recentIds: [], hasLiveDraft: false })).toBe(true);
    expect(deviceHasExistingData({ projectIds: [], recentIds: ['p1'], hasLiveDraft: false })).toBe(true);
    expect(deviceHasExistingData({ projectIds: [], recentIds: [], hasLiveDraft: true })).toBe(true);
  });

  it('全新裝置：首頁出現，不先寫紀錄（中途關掉下次重來）', () => {
    const store = fakeStore();
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, store)).toBe('show');
    expect(store.writes).toEqual([]);
  });

  it('舊裝置已有資料：不出現，直接記 skipped', () => {
    const store = fakeStore();
    const now = new Date(2026, 10, 17, 11, 30, 0);
    expect(
      resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: ['old'], recentIds: ['old'] }, store, now),
    ).toBe('none');
    expect(store.writes).toHaveLength(1);
    const rec = readOnboardingRecord(store)!;
    expect(rec.status).toBe('skipped');
    expect(rec.at).toBe(localIsoWithOffset(now));
    // 之後（含重開）都不再出現，也不再寫。
    forgetOnboardingSession();
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: ['old'], recentIds: [] }, store)).toBe('none');
    expect(store.writes).toHaveLength(1);
  });

  it('最近清單空但仍有暫存稿：記 skipped，不出現', () => {
    const store = fakeStore();
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: ['kept'], recentIds: [] }, store)).toBe('none');
    expect(readOnboardingRecord(store)?.status).toBe('skipped');
  });

  it('只有即時草稿：記 skipped', () => {
    const store = fakeStore({ [LIVE_DRAFT_KEY]: '{"projectId":"x"}' });
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, store)).toBe('none');
    expect(readOnboardingRecord(store)?.status).toBe('skipped');
  });

  it('延遲載入：暫存稿還沒回復前不判斷、不寫；載完才依結果決定', () => {
    const store = fakeStore();
    expect(resolveFirstRun({ atHome: true, deviceLoaded: false, projectIds: [], recentIds: [] }, store)).toBe('wait');
    expect(store.writes).toEqual([]);
    // 回復後發現有暫存稿 → 舊裝置。
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: ['restored'], recentIds: ['restored'] }, store)).toBe(
      'none',
    );
    expect(readOnboardingRecord(store)?.status).toBe('skipped');
  });

  it('直接打開稿子網址：不插隊、不寫；回首頁再判斷', () => {
    const store = fakeStore();
    expect(resolveFirstRun({ atHome: false, deviceLoaded: true, projectIds: ['p'], recentIds: ['p'] }, store)).toBe('none');
    expect(store.writes).toEqual([]);
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: ['p'], recentIds: ['p'] }, store)).toBe('none');
    expect(readOnboardingRecord(store)?.status).toBe('skipped');
  });

  it('既有鍵（之前按過跳過）：中途關掉也不刪鍵、不重現', () => {
    const store = fakeStore({ [ONBOARDING_STORAGE_KEY]: JSON.stringify(buildOnboardingRecord('skipped', new Date())) });
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, store)).toBe('none');
    expect(store.data.has(ONBOARDING_STORAGE_KEY)).toBe(true);
  });

  it('首頁 hook：只在首頁判斷、等 deviceLoaded、判斷一次就固定', () => {
    const src = readFileSync('src/screens/useFirstRunWelcome.ts', 'utf8');
    expect(src).toContain("pathname === '/'");
    expect(src).toMatch(/if \(decidedRef\.current \|\| !atHome\) return;/);
    expect(src).toMatch(/if \(result === 'wait'\) return;/);
    expect(src).toContain('deviceLoaded');
  });
});

describe('WO-110 裝置資料載入旗標', () => {
  function Probe() {
    const { deviceLoaded } = useSample();
    return createElement('span', { 'data-loaded': String(deviceLoaded) });
  }
  it('一開始是 false（非同步暫存稿回復前不可當作全新）', () => {
    const html = renderToStaticMarkup(createElement(SampleProvider, { initialState: createState(new Date()) }, createElement(Probe)));
    expect(html).toContain('data-loaded="false"');
  });
  it('回復完成與讀不到都會設為 true', () => {
    const src = readFileSync('src/state/sampleStore.tsx', 'utf8');
    const block = src.slice(src.indexOf('void loadStoredBooks()'), src.indexOf('void loadStoredBooks()') + 2200);
    expect(block.match(/setDeviceLoaded\(true\)/g)?.length).toBe(2);
    expect(block.indexOf('dispatch(attachActionForBook')).toBeLessThan(block.indexOf('setDeviceLoaded(true)'));
  });
  it('首頁靜態第一次畫面不出現導覽（等載入與判斷後才出現）', () => {
    const html = renderToStaticMarkup(
      createElement(
        SampleProvider,
        { initialState: createState(new Date()) },
        createElement(
          LayoutProvider,
          { initialMode: 'phone-portrait' },
          createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(HomeScreen)),
        ),
      ),
    );
    expect(html).toContain('data-testid="home-screen"');
    expect(html).not.toContain('data-testid="welcome-tour"');
  });
});

describe('WO-110 頁序、跳過、上一步、紀錄時機', () => {
  it('五頁：歡迎→每天→全書→出發→收尾', () => {
    expect(TOUR_PAGES).toEqual(['welcome', 1, 2, 3, 'finish']);
    expect(nextPage('welcome')).toBe(1);
    expect(nextPage(1)).toBe(2);
    expect(nextPage(2)).toBe(3);
    expect(nextPage(3)).toBe('finish');
    expect(nextPage('finish')).toBeNull();
  });

  it('上一步：只有三關有，回歡迎／第 1／第 2 關', () => {
    expect(backPage('welcome')).toBeNull();
    expect(backPage(1)).toBe('welcome');
    expect(backPage(2)).toBe(1);
    expect(backPage(3)).toBe(2);
    expect(backPage('finish')).toBeNull();
  });

  it('右上：第一次歡迎＝整趟跳過；再看一次＝關閉；三關＝這關跳過；收尾沒有', () => {
    expect(cornerAction('welcome', 'first')).toBe('skip-all');
    expect(cornerAction('welcome', 'revisit')).toBe('close');
    for (const s of [1, 2, 3] as const) {
      expect(cornerAction(s, 'first')).toBe('skip-step');
      expect(cornerAction(s, 'revisit')).toBe('skip-step');
    }
    expect(cornerAction('finish', 'first')).toBeNull();
    expect(cornerAction('finish', 'revisit')).toBeNull();
  });

  it('第一次：整趟跳過記 skipped；走到收尾記 done', () => {
    const ctx = { entry: 'first' as const, writtenThisRun: false, hadRecordAtStart: false };
    expect(recordStatusFor('skip-all', ctx)).toBe('skipped');
    expect(recordStatusFor('reach-finish', ctx)).toBe('done');
  });

  it('某關跳過當下記 skipped；WO-111：第 1、2 關跳過後照常走到收尾改記 done，第 3 關跳過到收尾維持 skipped', () => {
    const ctx = { entry: 'first' as const, writtenThisRun: false, hadRecordAtStart: false };
    expect(recordStatusFor('skip-step', ctx)).toBe('skipped');
    expect(recordStatusFor('skip-step', { ...ctx, writtenThisRun: true })).toBeNull();
    expect(recordStatusFor('reach-finish', { ...ctx, writtenThisRun: true })).toBe('done');
    expect(recordStatusFor('skip-last-step', ctx)).toBe('skipped');
    expect(recordStatusFor('reach-finish', { ...ctx, writtenThisRun: true, skippedLastStep: true })).toBeNull();
  });

  it('關閉（再看一次）什麼都不寫；再看一次原本有紀錄就不覆寫，沒有才補寫', () => {
    expect(recordStatusFor('close', { entry: 'revisit', writtenThisRun: false, hadRecordAtStart: false })).toBeNull();
    expect(recordStatusFor('reach-finish', { entry: 'revisit', writtenThisRun: false, hadRecordAtStart: true })).toBeNull();
    expect(recordStatusFor('skip-step', { entry: 'revisit', writtenThisRun: false, hadRecordAtStart: true })).toBeNull();
    expect(recordStatusFor('reach-finish', { entry: 'revisit', writtenThisRun: false, hadRecordAtStart: false })).toBe('done');
  });

  it('途中重入：中途關掉沒寫紀錄，下次首頁從歡迎重來', () => {
    const store = fakeStore();
    // 第一次：出現，走到第 2 關就關掉（沒有任何寫紀錄的事件）。
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, store)).toBe('show');
    forgetOnboardingSession();
    expect(resolveFirstRun({ atHome: true, deviceLoaded: true, projectIds: [], recentIds: [] }, store)).toBe('show');
    expect(store.writes).toEqual([]);
    // 導覽每次都從歡迎頁開始。
    expect(readFileSync('src/screens/WelcomeTour.tsx', 'utf8')).toContain("initialPage = 'welcome'");
  });

  it('走到收尾的寫入在切到收尾那一刻，不延到離開收尾', () => {
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toMatch(/if \(target === 'finish'\) record\('reach-finish'\);\s*setPage\(target\);/);
    const primary = src.slice(src.indexOf('const onPrimary'), src.indexOf('const onKeyDown'));
    expect(primary).toMatch(/if \(page === 'finish'\) \{\s*onExit\('finish-home'\);\s*return;/);
  });

  it('上一步不回滾設定：只換頁', () => {
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toContain('onClick={() => setPage(back)}');
  });
});

describe('WO-110 小徑', () => {
  it('歡迎頁沒有小徑；目前外圈亮、走過實心；收尾全亮', () => {
    expect(trailDots('welcome')).toBeNull();
    expect(trailDots(1)).toEqual(['current', 'todo', 'todo']);
    expect(trailDots(2)).toEqual(['done', 'current', 'todo']);
    expect(trailDots(3)).toEqual(['done', 'done', 'current']);
    expect(trailDots('finish')).toEqual(['done', 'done', 'done']);
  });

  it('小標與朗讀逐字（全形空格、不用「・」）', () => {
    expect(stepKicker(1)).toBe('第 1 關　每天');
    expect(stepKicker(2)).toBe('第 2 關　全書');
    expect(stepKicker(3)).toBe('第 3 關　出發');
    expect(trailAria(1)).toBe('第 1 關，共 3 關，每天想寫多少');
    expect(trailAria(2)).toBe('第 2 關，共 3 關，新稿子想寫多長');
    expect(trailAria(3)).toBe('第 3 關，共 3 關，今天從哪裡開始');
    expect(TRAIL_DONE_ARIA).toBe('3 關都走完了');
    const copy = readFileSync('src/copy/welcomeCopy.ts', 'utf8');
    expect(copy).not.toMatch(/['`][^'`\n]*・[^'`\n]*['`]/);
  });

  for (const page of [1, 2, 3, 'finish'] as const) {
    it(`畫面：${page} 小徑點狀態與朗讀`, () => {
      const html = renderTour('phone-portrait', page);
      const dots = trailDots(page)!;
      dots.forEach((state, i) => {
        expect(html).toMatch(new RegExp(`data-state="${state}" data-testid="welcome-trail-dot-${i + 1}"`));
      });
      expect(html).toContain(`aria-label="${page === 'finish' ? TRAIL_DONE_ARIA : trailAria(page)}"`);
      expect(html).toMatch(/class="welcome-trail" role="img"/);
      for (const name of ['每天', '全書', '出發']) expect(html).toContain(`aria-hidden="true">${name}</span>`);
    });
  }
});

describe('WO-110 歡迎頁', () => {
  it('小標、主句（定案，保留句號）、說明、版本與預覽版', () => {
    const html = renderTour('phone-portrait', 'welcome');
    expect(html).toContain('>歡迎來到九方小說編輯器M</p>');
    expect(WELCOME_HEADLINE).toBe('故事，是一步步走完的。');
    expect(WELCOME_HEADLINE_SEGMENTS.join('')).toBe(WELCOME_HEADLINE);
    expect(html).toContain(WELCOME_BODY);
    expect(WELCOME_BODY).toBe('花一分鐘，定好你自己的目標，之後隨時都能改。每天打開，就看得到今天走了多遠。');
    expect(html).toContain('role="group" aria-label="版本 0.1.0，預覽版"');
    expect(html).toContain('<span aria-hidden="true">版本 0.1.0</span>');
    expect(html).toContain('data-channel="preview" aria-hidden="true">預覽版</span>');
    expect(html).not.toMatch(/v0\.1\.0/);
    expect(html).not.toContain('data-testid="welcome-trail"');
  });

  it('主句用巢狀 inline-block 分段，不寫死換行；「一步步」不拆、句號跟「走完的」', () => {
    const html = renderTour('wide', 'welcome');
    expect(html).toContain(
      '<span class="welcome-headline-seg">故事，</span><span class="welcome-headline-group"><span class="welcome-headline-seg">是一步步</span><span class="welcome-headline-seg">走完的。</span></span>',
    );
    expect(html).not.toMatch(/<br/);
    expect(WELCOME_HEADLINE_SEGMENTS).toEqual(['故事，', '是一步步', '走完的。']);
    const css = readFileSync('src/screens/welcomeTour.css', 'utf8');
    expect(css).toMatch(/\.welcome-headline-seg \{\s*display: inline-block;\s*white-space: nowrap;/);
    expect(css).toMatch(/\.welcome-headline-group \{\s*display: inline-block;\s*white-space: normal;/);
    // 主句字級（直拿、中等 26，寬版 24，橫拿 22）用 rem，跟著系統放大。
    expect(css).toMatch(/\.welcome-title\.is-headline \{\s*font-size: 1\.625rem;/);
    expect(css).toMatch(/data-tour-layout="wide"\] \.welcome-title\.is-headline \{\s*font-size: 1\.5rem;/);
    expect(css).toMatch(/data-tour-layout="phone-landscape"\] \.welcome-title\.is-headline \{\s*font-size: 1\.375rem;/);
  });

  it('預覽版才有小字，正式版沒有', () => {
    const preview = renderTour('phone-portrait', 'welcome', { channel: 'preview' });
    expect(preview).toContain(WELCOME_PREVIEW_NOTE);
    expect(WELCOME_PREVIEW_NOTE).toBe('預覽版還在測試，有些功能之後可能會改。寫完記得按「另存專案」，把稿子存一份在自己手上。');
    const prod = renderTour('phone-portrait', 'welcome', { channel: 'production' });
    expect(prod).not.toContain('welcome-preview-note');
    expect(prod).toContain('aria-label="版本 0.1.0，正式版"');
    expect(prod).toContain('>正式版</span>');
  });

  it('第一次：右上「跳過」與朗讀；開始與朗讀', () => {
    const html = renderTour('phone-portrait', 'welcome');
    expect(html).toContain('data-action="skip-all" aria-label="跳過導覽，目標先用預設值，直接到首頁">跳過</button>');
    expect(html).toContain('aria-label="開始，到第 1 關">開始</button>');
    expect(html).not.toContain('data-testid="welcome-back"');
  });

  it('再看一次：右上「關閉」與朗讀', () => {
    const html = renderTour('phone-portrait', 'welcome', { entry: 'revisit' });
    expect(html).toContain('data-action="close" aria-label="關閉導覽，回到設定，什麼都不改">關閉</button>');
    expect(html).not.toContain('data-action="skip-all"');
  });

  it('插圖是裝飾，不朗讀', () => {
    const html = renderTour('phone-portrait', 'welcome');
    expect(html).toMatch(/class="welcome-illustration" aria-hidden="true"/);
    expect(html).toMatch(/<svg[^>]*focusable="false"[^>]*aria-hidden="true"/);
    expect(renderTour('phone-portrait', 1)).not.toContain('welcome-illustration');
  });
});

describe('WO-110 三關外框與收尾', () => {
  for (const step of [1, 2, 3] as const) {
    it(`第 ${step} 關：小標、上一步、跳過、主要按鈕與朗讀；內容是占位區`, () => {
      const html = renderTour('phone-portrait', step);
      expect(html).toContain(`>${stepKicker(step)}</p>`);
      expect(html).toContain(`aria-label="${STEP_BACK_ARIA[step]}">上一步</button>`);
      expect(html).toContain(`data-action="skip-step" aria-label="${STEP_SKIP_ARIA[step]}">跳過</button>`);
      expect(html).toContain(`aria-label="${STEP_PRIMARY_ARIA[step]}">${step === 3 ? '就這樣，出發' : '下一關'}</button>`);
      expect(html).toContain(`data-testid="welcome-step-body" data-step="${step}"></div>`);
      // 占位不寫目標、不放選項。
      expect(html).not.toContain('<input');
      expect(html).not.toContain('role="radio"');
    });
  }

  it('朗讀標籤逐字（第八節）', () => {
    expect(STEP_BACK_ARIA).toEqual({ 1: '上一步，回到歡迎頁', 2: '上一步，回到第 1 關', 3: '上一步，回到第 2 關' });
    expect(STEP_PRIMARY_ARIA).toEqual({ 1: '下一關，到第 2 關', 2: '下一關，到第 3 關', 3: '就這樣，出發，到最後一頁' });
    expect(STEP_SKIP_ARIA).toEqual({
      1: '跳過這一關，每日目標不變，到第 2 關',
      2: '跳過這一關，新稿子的全書目標不變，到第 3 關',
      3: '跳過這一關，直接看最後一頁',
    });
  });

  it('WO-111 接點：renderStep 的內容放進該關內容區', () => {
    const html = renderTour('phone-portrait', 2, {
      renderStep: (s) => createElement('div', { role: 'radiogroup', 'data-probe': String(s) }),
    });
    expect(html).toContain('data-step="2"><div role="radiogroup" data-probe="2"></div></div>');
  });

  it('收尾：小標、唯一一句鼓勵、今天進度條、外觀提示是文字、回首頁；無上一步、無跳過、無天數', () => {
    const html = renderTour('phone-portrait', 'finish', { todayWords: 320, dailyGoal: 1000 });
    expect(html).toContain('>都設好了</p>');
    expect(html).toContain('>今天先寫一點就好</h2>');
    expect(html).toContain('data-testid="daily-progress"');
    expect(html).toContain('aria-label="今天寫了 320 字，每日目標 1,000 字"');
    expect(html).toContain(`<p class="welcome-appearance-note" data-testid="welcome-appearance-note">${FINISH_APPEARANCE_NOTE}</p>`);
    expect(FINISH_APPEARANCE_NOTE).toBe('想換顏色或正文字級，可以到「設定」的「外觀」改。');
    expect(html).toContain('data-testid="welcome-primary">回首頁</button>');
    expect(html).not.toContain('data-testid="welcome-back"');
    expect(html).not.toContain('data-testid="welcome-corner"');
    expect(html).not.toMatch(/第 \d+ 天|天寫完|全書進度/);
    expect(html.match(/<a\b/g)).toBeNull();
  });
});

describe('WO-110 焦點、鍵盤、不設 Esc、點外不關', () => {
  it('標題可程式聚焦，切頁時焦點移到標題；對話框語意', () => {
    for (const page of PAGES) {
      const html = renderTour('phone-portrait', page);
      expect(html).toMatch(/<h2 id="welcome-tour-title" tabindex="-1"/);
      expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="welcome-tour-title"');
    }
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toMatch(/useEffect\(\(\) => \{\s*titleRef\.current\?\.focus\(\);\s*\}, \[page\]\);/);
  });

  it('Enter：在頁面、輸入框、單選上按主要按鈕；在其他按鈕、連結、多行輸入上照原生', () => {
    expect(enterTriggersPrimary({ tagName: 'H2' })).toBe(true);
    expect(enterTriggersPrimary({ tagName: 'DIV' })).toBe(true);
    expect(enterTriggersPrimary({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(enterTriggersPrimary({ tagName: 'INPUT', type: null })).toBe(true);
    expect(enterTriggersPrimary({ tagName: 'BUTTON', role: 'radio' })).toBe(true);
    expect(enterTriggersPrimary({ tagName: 'BUTTON' })).toBe(false);
    expect(enterTriggersPrimary({ tagName: 'A' })).toBe(false);
    expect(enterTriggersPrimary({ tagName: 'TEXTAREA' })).toBe(false);
    expect(enterTriggersPrimary({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(enterTriggersPrimary({ tagName: 'DIV', isContentEditable: true })).toBe(false);
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    // 注音選字中的 Enter 不當成按主要按鈕。
    expect(src).toContain('event.nativeEvent.isComposing');
  });

  it('方向鍵同組單選：前後移動、頭尾相接', () => {
    expect(radioArrowTarget('ArrowDown', 0, 5)).toBe(1);
    expect(radioArrowTarget('ArrowRight', 4, 5)).toBe(0);
    expect(radioArrowTarget('ArrowUp', 0, 5)).toBe(4);
    expect(radioArrowTarget('ArrowLeft', 2, 5)).toBe(1);
    expect(radioArrowTarget('Tab', 2, 5)).toBeNull();
    expect(radioArrowTarget('ArrowDown', -1, 5)).toBeNull();
    expect(radioArrowTarget('ArrowDown', 0, 0)).toBeNull();
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toContain(`closest('[role="radiogroup"]')`);
  });

  it('不設 Esc 關閉；遮罩點了不關', () => {
    expect(escapeClosesTour()).toBe(false);
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).not.toMatch(/['"]Escape['"]|['"]Esc['"]/);
    const html = renderTour('medium', 'welcome');
    expect(html).toContain('<div class="welcome-scrim" aria-hidden="true" data-testid="welcome-scrim"></div>');
    expect(src).not.toMatch(/welcome-scrim"[^>]*onClick/);
  });

  it('Tab 在導覽裡繞；首頁後面設為 inert', () => {
    const src = readFileSync('src/screens/WelcomeTour.tsx', 'utf8');
    expect(src).toContain("event.key === 'Tab'");
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    // WO-126：匯入視窗開啟時同樣 inert；歡迎導覽仍覆蓋這三處。
    expect(home.match(/inert=\{welcome\.show \|\| importText\.open\}/g)?.length).toBe(3);
  });
});

describe('WO-110 四種版面', () => {
  it('排法數字：直拿整頁、橫拿兩欄左右 60、中等卡片 480、寬版 520、最高畫面減 80', () => {
    expect(tourPresentation('phone-portrait')).toEqual({ kind: 'page', columns: 1, cardWidth: null, cardMaxHeightInset: null, sideInset: null });
    expect(tourPresentation('phone-landscape')).toEqual({ kind: 'page', columns: 2, cardWidth: null, cardMaxHeightInset: null, sideInset: 60 });
    expect(tourPresentation('medium')).toEqual({ kind: 'card', columns: 1, cardWidth: 480, cardMaxHeightInset: 80, sideInset: null });
    expect(tourPresentation('wide')).toEqual({ kind: 'card', columns: 1, cardWidth: 520, cardMaxHeightInset: 80, sideInset: null });
  });

  for (const mode of MODES) {
    for (const page of PAGES) {
      it(`${mode} × ${String(page)}：結構`, () => {
        const html = renderTour(mode, page);
        const p = tourPresentation(mode);
        expect(html).toContain(`data-tour-layout="${mode}" data-presentation="${p.kind}" data-columns="${p.columns}"`);
        expect(html.includes('welcome-scrim')).toBe(p.kind === 'card');
        // 頂端 → 內容（可捲）→ 底部按鈕，順序固定。
        const top = html.indexOf('class="welcome-top"');
        const scroll = html.indexOf('class="welcome-scroll"');
        const actions = html.indexOf('class="welcome-actions"');
        expect(top).toBeGreaterThan(0);
        expect(scroll).toBeGreaterThan(top);
        expect(actions).toBeGreaterThan(scroll);
        // 左欄（小標、標題、說明）在右欄內容之前。
        expect(html.indexOf('class="welcome-lead"')).toBeLessThan(html.indexOf('class="welcome-content"'));
        expect(html.includes('welcome-illustration')).toBe(page === 'welcome');
      });
    }
  }

  it('CSS：尺寸四版相同、寬版用滑鼠不縮小', () => {
    const css = readFileSync('src/screens/welcomeTour.css', 'utf8');
    expect(TOUR_SIZES).toEqual({ primaryHeight: 52, backWidth: 96, backHeight: 52, optionHeight: 64, optionGap: 10, skipMin: 44 });
    expect(css).toMatch(/\.welcome-primary \{[^}]*min-height: 52px;/);
    expect(css).toMatch(/\.welcome-primary \{[^}]*flex: 1 1 auto;/);
    expect(css).toMatch(/\.welcome-back \{[^}]*width: 96px;[^}]*min-height: 52px;/);
    expect(css).toMatch(/\.welcome-skip \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.welcome-option \{[^}]*min-height: 64px;/);
    expect(css).toMatch(/\.welcome-options \{[^}]*gap: 10px;/);
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/data-pointer/);
    expect(rules).not.toMatch(/--hit-size/);
  });

  it('CSS：卡片寬與最高、內捲、按鈕固定底部；橫拿左右 60 依安全區；遮罩公式', () => {
    const css = readFileSync('src/screens/welcomeTour.css', 'utf8');
    expect(css).toMatch(/data-presentation="card"\] \.welcome-card \{[^}]*width: min\(480px, calc\(100vw - 32px\)\);[^}]*max-height: calc\(100dvh - 80px\);/);
    expect(css).toMatch(/data-tour-layout="wide"\] \.welcome-card \{\s*width: min\(520px, calc\(100vw - 32px\)\);/);
    expect(css).toMatch(/\.welcome-scroll \{[^}]*overflow-y: auto;/);
    expect(css).toMatch(/\.welcome-actions \{\s*flex: none;/);
    expect(css).toContain('padding-left: max(60px, env(safe-area-inset-left, 0px));');
    expect(css).toContain('padding-right: max(60px, env(safe-area-inset-right, 0px));');
    expect(css).toMatch(/data-tour-layout="phone-landscape"\] \.welcome-cols \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(css).toContain('background: color-mix(in srgb, #000 55%, transparent);');
    expect(css).not.toMatch(/#E3C26F|--final|backdrop-filter/i);
  });
});

describe('WO-110 接線', () => {
  it('首頁用第一次判斷顯示導覽（entry first）；再看一次路由換成正式導覽', () => {
    const home = readFileSync('src/screens/HomeScreen.tsx', 'utf8');
    expect(home).toContain('useFirstRunWelcome()');
    expect(home).toMatch(/<WelcomeTour\s+entry="first"/);
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('<Route path="welcome" element={<WelcomeRevisitScreen />} />');
    expect(app).not.toContain('<WelcomePlaceholder');
  });

  it('再看一次：在稿子底下出現導覽、右上是關閉；關閉回設定、回首頁到 /', () => {
    const html = renderToStaticMarkup(
      createElement(
        SampleProvider,
        { initialState: demoFixtureState() },
        createElement(
          LayoutProvider,
          { initialMode: 'phone-portrait' },
          createElement(
            MemoryRouter,
            { initialEntries: ['/p/fog/welcome'] },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '/p/:projectId',
                element: createElement(Workspace),
                children: [createElement(Route, { path: 'welcome', element: createElement(WelcomeRevisitScreen) })],
              }),
            ),
          ),
        ),
      ),
    );
    expect(html).toContain('data-entry="revisit"');
    expect(html).toContain('data-action="close"');
    const src = readFileSync('src/screens/WelcomeRevisitScreen.tsx', 'utf8');
    expect(src).toContain("if (exit === 'finish-home') navigate('/');");
    expect(src).toContain('else navigate(`/p/${projectId}/settings`);');
  });

  it('導覽不寫 .db、不改目標：外框原始碼沒有 setGoal／setBookGoal／writeNewBookGoal', () => {
    for (const f of ['src/screens/WelcomeTour.tsx', 'src/screens/WelcomeRevisitScreen.tsx', 'src/screens/useFirstRunWelcome.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/setGoal|setBookGoal|writeNewBookGoal|saveBookBytes|\.db['"]/);
    }
  });
});
