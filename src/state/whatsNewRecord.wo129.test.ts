/**
 * WO-129 甲段單元測試：改版資料檔、版號比較、新舊使用者判斷狀態機、隱私模式與用字守衛。
 * 只用記憶體假儲存與範例資料，不讀寫真實書稿或 .db。
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION } from '../copy/aboutCopy';
import * as userFacing from '../copy/userFacing';
import {
  compareVersions,
  findReleaseNote,
  isNewerVersion,
  parseVersion,
  previousReleaseNotes,
  RELEASE_NOTES,
  type ReleaseNote,
} from '../data/whatsNew';
import { LIVE_DRAFT_KEY } from '../editor/liveDraft';
import { BODY_FONT_SCALE_STORAGE_KEY } from '../layout/bodyFontScale';
import { hasStoredDeviceTheme, THEME_STORAGE_KEY } from '../layout/deviceTheme';
import { DEVICE_KIND_STORAGE_KEY, INPUT_MODE_STORAGE_KEY } from '../layout/inputMode';
import { WIDE_PANELS_STORAGE_KEY } from '../layout/widePanels';
import { OUTLINE_STORAGE_KEY } from '../domain/outline';
import { DEVICE_SAVE_RECORD_KEY } from './deviceSaveRecord';
import { HALF_WIDTH_REMINDER_STORAGE_KEY } from './halfWidthReminder';
import { EXPORT_EVENTS_KEY, IMPORT_EVENTS_KEY } from './importEvents';
import { NEW_BOOK_GOAL_STORAGE_KEY } from './newBookGoal';
import { forgetOnboardingSession, ONBOARDING_STORAGE_KEY } from './onboardingRecord';
import {
  decideWhatsNew,
  forgetWhatsNewSession,
  hasPriorUsage,
  probeStorageAvailable,
  readSeenVersion,
  WHATS_NEW_SEEN_KEY,
  writeSeenVersion,
  type WhatsNewStore,
} from './whatsNewRecord';

interface FakeStore extends WhatsNewStore {
  data: Map<string, string>;
  writes: Array<[string, string]>;
  removes: string[];
  cleared: boolean;
}

function fakeStore(
  initial: Record<string, string> = {},
  opts: { throwGet?: boolean; throwSet?: boolean; withoutRemoveItem?: boolean } = {},
): FakeStore {
  const data = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  const removes: string[] = [];
  const store: FakeStore = {
    data,
    writes,
    removes,
    cleared: false,
    getItem(key: string) {
      if (opts.throwGet) throw new Error('SecurityError: blocked');
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (opts.throwSet) throw new Error('QuotaExceededError');
      writes.push([key, value]);
      data.set(key, value);
    },
  };
  if (!opts.withoutRemoveItem) {
    store.removeItem = (key: string) => {
      removes.push(key);
      data.delete(key);
    };
  }
  return store;
}

const EMPTY_SAVE_RECORD_SHELL = JSON.stringify({
  saveMeta: {},
  logsById: {},
  goalById: {},
  exportedFiles: {},
  startedById: {},
});

beforeEach(() => {
  forgetWhatsNewSession();
  forgetOnboardingSession();
});

afterEach(() => {
  forgetWhatsNewSession();
  forgetOnboardingSession();
});

describe('WO-129 版號比較與查詢', () => {
  it('parseVersion 只接受嚴格 X.Y.Z 三段非負整數', () => {
    expect(parseVersion('0.3.0')).toEqual([0, 3, 0]);
    expect(parseVersion('0.3.1')).toEqual([0, 3, 1]);
    expect(parseVersion('0.10.25')).toEqual([0, 10, 25]);
    expect(parseVersion('1.0.0')).toEqual([1, 0, 0]);

    for (const invalid of ['', 'v0.3.0', ' 0.3.0', '0.3.0 ', '0.3', '0.3.0.1', '-1.0.0', '0.3.x']) {
      expect(parseVersion(invalid)).toBeNull();
    }
  });

  it('compareVersions 與 isNewerVersion 正確比較大小與進位（含最後一碼小修）', () => {
    expect(compareVersions('0.3.0', '0.2.0')).toBe(1);
    expect(compareVersions('0.3.1', '0.3.0')).toBe(1);
    expect(compareVersions('0.10.0', '0.2.0')).toBe(1);
    expect(compareVersions('0.3.10', '0.3.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.3.0')).toBe(-1);
    expect(compareVersions('0.3.0', 'corrupted')).toBeNull();

    expect(isNewerVersion('0.3.0', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.3.1', '0.3.0')).toBe(true);
    expect(isNewerVersion('0.10.0', '0.2.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.2.0', '0.3.0')).toBe(false);
    // 損壞的舊值只要與目前版號不同，就視為需要重記一次
    expect(isNewerVersion('0.3.0', 'corrupted')).toBe(true);
    expect(isNewerVersion('0.3.0', '')).toBe(true);
  });

  it('findReleaseNote 與 previousReleaseNotes 過濾空白並保留新版在前順序', () => {
    const sampleNotes: readonly ReleaseNote[] = [
      { version: '0.4.0', items: ['新功能甲'] },
      { version: '0.3.1', items: ['   ', ''] },
      { version: '0.3.0', items: ['舊功能乙', ''] },
      { version: '0.2.0', items: ['更早功能丙'] },
    ];

    expect(findReleaseNote('0.4.0', sampleNotes)).toEqual({ version: '0.4.0', items: ['新功能甲'] });
    expect(findReleaseNote('0.3.1', sampleNotes)).toBeNull();
    expect(findReleaseNote('0.9.9', sampleNotes)).toBeNull();
    expect(findReleaseNote('0.3.0', sampleNotes)).toEqual({ version: '0.3.0', items: ['舊功能乙'] });

    expect(previousReleaseNotes('0.4.0', sampleNotes)).toEqual([
      { version: '0.3.0', items: ['舊功能乙'] },
      { version: '0.2.0', items: ['更早功能丙'] },
    ]);
  });
});

describe('WO-129 改版資料檔格式守衛', () => {
  it('RELEASE_NOTES 非空、版號合法、不重複、嚴格由新到舊遞減', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (let i = 0; i < RELEASE_NOTES.length; i += 1) {
      const note = RELEASE_NOTES[i]!;
      expect(note.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(parseVersion(note.version)).not.toBeNull();
      expect(seen.has(note.version)).toBe(false);
      seen.add(note.version);
      expect(note.items.length).toBeGreaterThan(0);
      for (const item of note.items) {
        expect(item.trim().length).toBeGreaterThan(0);
      }
      if (i > 0) {
        const prev = RELEASE_NOTES[i - 1]!;
        expect(compareVersions(prev.version, note.version)).toBe(1);
      }
    }
  });

  it('0.3.0 條列與 WO-129 核准原文一字不差，且目前 APP_VERSION 查得到條目', () => {
    const note = findReleaseNote('0.3.0');
    expect(note).not.toBeNull();
    expect(note!.items).toEqual([
      '事件時間線：照故事順序或章節順序排事件，電腦寬螢幕還能雙線對照',
      '設定頁新增贊助按鈕',
    ]);
    expect(findReleaseNote(APP_VERSION)).not.toBeNull();
  });
});

describe('WO-129 記號讀寫與隱私模式保護', () => {
  it('鍵名為 jiufang-novel-m.whats-new-seen.v1，儲存純版號字串', () => {
    expect(WHATS_NEW_SEEN_KEY).toBe('jiufang-novel-m.whats-new-seen.v1');
    const store = fakeStore();
    expect(writeSeenVersion('0.3.0', store)).toBe(true);
    expect(store.data.get(WHATS_NEW_SEEN_KEY)).toBe('0.3.0');
    expect(readSeenVersion(store)).toEqual({ available: true, version: '0.3.0' });
  });

  it('探測權限後會移除暫時探測鍵，且不對業務鍵呼叫 removeItem', () => {
    const store = fakeStore({ [THEME_STORAGE_KEY]: 'forest' });
    expect(probeStorageAvailable(store)).toBe(true);
    expect(store.data.has('jiufang-novel-m.__probe__')).toBe(false);
    expect(store.removes).toEqual(['jiufang-novel-m.__probe__']);
    expect(store.data.get(THEME_STORAGE_KEY)).toBe('forest');

    const noRemoveStore = fakeStore({}, { withoutRemoveItem: true });
    expect(probeStorageAvailable(noRemoveStore)).toBe(true);
    expect(noRemoveStore.data.get('jiufang-novel-m.__probe__')).toBe('');
  });

  it('儲存不可用（null、getItem 丟錯、setItem 丟錯）不拋錯，且 available 為 false', () => {
    expect(readSeenVersion(null)).toEqual({ available: false, version: null });
    expect(probeStorageAvailable(null)).toBe(false);
    expect(writeSeenVersion('0.3.0', null)).toBe(false);

    forgetWhatsNewSession();
    const blockedGet = fakeStore({}, { throwGet: true });
    expect(readSeenVersion(blockedGet)).toEqual({ available: false, version: null });
    expect(probeStorageAvailable(blockedGet)).toBe(false);

    forgetWhatsNewSession();
    const quotaSet = fakeStore({}, { throwSet: true });
    expect(probeStorageAvailable(quotaSet)).toBe(false);
    expect(readSeenVersion(quotaSet)).toEqual({ available: false, version: null });
    expect(writeSeenVersion('0.3.0', quotaSet)).toBe(false);
    // 寫不進去時，當次使用仍記在記憶體；重開（forgetWhatsNewSession）後清空
    expect(readSeenVersion(quotaSet)).toEqual({ available: false, version: '0.3.0' });
    forgetWhatsNewSession();
    expect(readSeenVersion(quotaSet)).toEqual({ available: false, version: null });
  });
});

describe('WO-129 舊使用者判斷與狀態機決策', () => {
  it('deviceLoaded 未完成且尚無記號時回 wait，不跳也不寫入', () => {
    const store = fakeStore();
    const seen = readSeenVersion(store);
    expect(
      decideWhatsNew({
        storageAvailable: seen.available,
        seenVersion: seen.version,
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: false,
        hasPriorUsage: false,
        welcomeOpen: false,
      }),
    ).toBe('wait');
    expect(store.data.has(WHATS_NEW_SEEN_KEY)).toBe(false);
  });

  it('全新裝置（含僅有首開自動寫入的空殼鍵反例）判定無舊痕跡 → mark-seen，即使歡迎導覽開啟中亦同', () => {
    const firstBootStore = fakeStore({
      [INPUT_MODE_STORAGE_KEY]: 'touch',
      [DEVICE_KIND_STORAGE_KEY]: 'phone',
      [OUTLINE_STORAGE_KEY]: '[]',
      [DEVICE_SAVE_RECORD_KEY]: EMPTY_SAVE_RECORD_SHELL,
    });

    const hasTheme = hasStoredDeviceTheme(firstBootStore);
    expect(hasTheme).toBe(false);
    const prior = hasPriorUsage(
      { projectIds: [], recentIds: [], hasThemePreference: hasTheme },
      firstBootStore,
    );
    expect(prior).toBe(false);

    const seen = readSeenVersion(firstBootStore);
    expect(
      decideWhatsNew({
        storageAvailable: seen.available,
        seenVersion: seen.version,
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: prior,
        welcomeOpen: true,
      }),
    ).toBe('mark-seen');
  });

  it('0.2.0 舊使用者的各種單獨痕跡皆判定 hasPriorUsage 為 true，進而決策 show', () => {
    const singleKeyCases: Array<[string, Record<string, string>]> = [
      ['onboarding.v1', { [ONBOARDING_STORAGE_KEY]: '{"status":"done","at":"2026-11-18T10:00:00+08:00","appVersion":"0.2.0"}' }],
      ['live-draft.v1', { [LIVE_DRAFT_KEY]: '{"projectId":"p1","chapterId":"c1","text":"abc","at":1}' }],
      ['body-font-scale.v1', { [BODY_FONT_SCALE_STORAGE_KEY]: '120' }],
      ['new-book-goal.v1', { [NEW_BOOK_GOAL_STORAGE_KEY]: '200000' }],
      ['half-width-reminder.v1', { [HALF_WIDTH_REMINDER_STORAGE_KEY]: '0' }],
      ['wide-panels-v1', { [WIDE_PANELS_STORAGE_KEY]: '{"left":true,"right":false}' }],
      ['import-events.v1', { [IMPORT_EVENTS_KEY]: '{"events":{},"byProject":{},"byFile":{}}' }],
      ['export-events.v1', { [EXPORT_EVENTS_KEY]: '{"events":{},"byProject":{},"byFile":{}}' }],
      ['save-record.v1 含 homeGoal', { [DEVICE_SAVE_RECORD_KEY]: JSON.stringify({ saveMeta: {}, logsById: {}, goalById: {}, exportedFiles: {}, startedById: {}, homeGoal: 2000 }) }],
      ['save-record.v1 含 saveMeta', { [DEVICE_SAVE_RECORD_KEY]: JSON.stringify({ saveMeta: { p1: { lastAutoSaveMs: 1, lastManualSaveMs: null, lastExportMs: null, lastProjectSaveMs: null } }, logsById: {}, goalById: {}, exportedFiles: {}, startedById: {} }) }],
      ['save-record.v1 含 startedById', { [DEVICE_SAVE_RECORD_KEY]: JSON.stringify({ saveMeta: {}, logsById: {}, goalById: {}, exportedFiles: {}, startedById: { p1: 1234 } }) }],
      ['save-record.v1 含 exportedFiles', { [DEVICE_SAVE_RECORD_KEY]: JSON.stringify({ saveMeta: {}, logsById: {}, goalById: {}, exportedFiles: { abc: 1234 }, startedById: {} }) }],
      ['save-record.v1 含 tourGoalById', { [DEVICE_SAVE_RECORD_KEY]: JSON.stringify({ saveMeta: {}, logsById: {}, goalById: {}, exportedFiles: {}, startedById: {}, tourGoalById: { p1: 1500 } }) }],
    ];

    for (const [label, initial] of singleKeyCases) {
      forgetOnboardingSession();
      const store = fakeStore(initial);
      const prior = hasPriorUsage(
        { projectIds: [], recentIds: [], hasThemePreference: hasStoredDeviceTheme(store) },
        store,
      );
      expect(prior, label).toBe(true);

      const seen = readSeenVersion(store);
      expect(
        decideWhatsNew({
          storageAvailable: seen.available,
          seenVersion: seen.version,
          currentVersion: '0.3.0',
          hasReleaseNote: true,
          deviceLoaded: true,
          hasPriorUsage: prior,
          welcomeOpen: false,
        }),
        label,
      ).toBe('show');
    }

    // 主題偏好由 layout/deviceTheme.hasStoredDeviceTheme 唯讀判斷後傳入 hasPriorUsage
    const themeOnlyStore = fakeStore({ [THEME_STORAGE_KEY]: 'celadon' });
    expect(hasStoredDeviceTheme(themeOnlyStore)).toBe(true);
    expect(hasPriorUsage({ projectIds: [], recentIds: [] }, themeOnlyStore)).toBe(false);
    const themePrior = hasPriorUsage(
      { projectIds: [], recentIds: [], hasThemePreference: hasStoredDeviceTheme(themeOnlyStore) },
      themeOnlyStore,
    );
    expect(themePrior).toBe(true);
    const themeSeen = readSeenVersion(themeOnlyStore);
    expect(
      decideWhatsNew({
        storageAvailable: themeSeen.available,
        seenVersion: themeSeen.version,
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: themePrior,
        welcomeOpen: false,
      }),
    ).toBe('show');
    expect(hasStoredDeviceTheme(fakeStore())).toBe(false);
    expect(hasStoredDeviceTheme(null)).toBe(false);
    expect(hasStoredDeviceTheme(fakeStore({}, { throwGet: true }))).toBe(false);

    expect(hasPriorUsage({ projectIds: ['demo-1'], recentIds: [] }, fakeStore())).toBe(true);
    expect(hasPriorUsage({ projectIds: [], recentIds: ['demo-1'] }, fakeStore())).toBe(true);
  });

  it('已有新記號時：同版與降版回 none，升小修版且有條目回 show，無條目回 none', () => {
    expect(
      decideWhatsNew({
        storageAvailable: true,
        seenVersion: '0.3.0',
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: false,
      }),
    ).toBe('none');

    expect(
      decideWhatsNew({
        storageAvailable: true,
        seenVersion: '0.3.0',
        currentVersion: '0.3.1',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: false,
      }),
    ).toBe('show');

    expect(
      decideWhatsNew({
        storageAvailable: true,
        seenVersion: '0.3.0',
        currentVersion: '0.3.1',
        hasReleaseNote: false,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: false,
      }),
    ).toBe('none');

    expect(
      decideWhatsNew({
        storageAvailable: true,
        seenVersion: '0.3.0',
        currentVersion: '0.2.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: false,
      }),
    ).toBe('none');
  });

  it('歡迎導覽開啟中時，舊使用者暫緩為 wait，關閉後改回 show', () => {
    expect(
      decideWhatsNew({
        storageAvailable: true,
        seenVersion: null,
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: true,
      }),
    ).toBe('wait');

    expect(
      decideWhatsNew({
        storageAvailable: true,
        seenVersion: '0.2.0',
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: true,
      }),
    ).toBe('wait');

    expect(
      decideWhatsNew({
        storageAvailable: true,
        seenVersion: '0.2.0',
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: false,
      }),
    ).toBe('show');
  });

  it('隱私模式 storageAvailable 為 false 時一律回 none', () => {
    expect(
      decideWhatsNew({
        storageAvailable: false,
        seenVersion: null,
        currentVersion: '0.3.0',
        hasReleaseNote: true,
        deviceLoaded: true,
        hasPriorUsage: true,
        welcomeOpen: false,
      }),
    ).toBe('none');
  });
});

describe('WO-129 暫定用字與臺灣繁體白話守衛', () => {
  it('userFacing.ts 匯出全部 WO-129 暫定用字常數並標註待九方審', () => {
    expect(userFacing.WHATS_NEW_TITLE).toBe('這一版新增了什麼');
    expect(userFacing.WHATS_NEW_CONFIRM).toBe('知道了');
    expect(userFacing.WHATS_NEW_SETTINGS_TITLE).toBe('看改版內容');
    expect(userFacing.WHATS_NEW_SETTINGS_HINT).toBe('看看這一版和之前改了什麼');
    expect(userFacing.WHATS_NEW_PREVIOUS_TOGGLE).toBe('之前的版本');
    expect(userFacing.WHATS_NEW_EMPTY_CURRENT).toBe('這一版沒有另外列出更新項目。');
    expect(userFacing.whatsNewVersionLabel('0.3.0')).toBe('版本 0.3.0');

    const userFacingSrc = readFileSync(new URL('../copy/userFacing.ts', import.meta.url), 'utf8');
    const wo129Idx = userFacingSrc.indexOf('WO-129');
    expect(wo129Idx).toBeGreaterThan(-1);
    const wo129Section = userFacingSrc.slice(wo129Idx);
    expect(wo129Section).toContain('WO-129（暫定，待九方審）');
  });

  it('甲段新增程式碼與暫定用字不含常見簡體字與英文改版術語', () => {
    const whatsNewSrc = readFileSync(new URL('../data/whatsNew.ts', import.meta.url), 'utf8');
    const recordSrc = readFileSync(new URL('./whatsNewRecord.ts', import.meta.url), 'utf8');
    const userFacingSrc = readFileSync(new URL('../copy/userFacing.ts', import.meta.url), 'utf8');
    const wo129CopySrc = userFacingSrc.slice(userFacingSrc.indexOf('WO-129'));

    expect(whatsNewSrc).toContain('WO-129（暫定，待九方審）');

    const simplifiedChars = /[简体说资这为与从对进过连选门问间点谁让将则虽仅并无会须该当经刚们档设条阵断隐暂赞时顺宽双钮浏览储记忆显删写读关开装项导录错误确认验证测试]/;
    const forbiddenTerms = /Changelog|Release\s+Notes|更新日誌|版本歷程|彈窗/i;

    for (const [name, content] of [
      ['whatsNew.ts', whatsNewSrc],
      ['whatsNewRecord.ts', recordSrc],
      ['userFacing.ts (WO-129)', wo129CopySrc],
    ] as const) {
      expect(content, `${name} 不可含簡體字`).not.toMatch(simplifiedChars);
      expect(content, `${name} 不可含術語`).not.toMatch(forbiddenTerms);
    }

    const userFacingTexts = [
      userFacing.WHATS_NEW_TITLE,
      userFacing.WHATS_NEW_CONFIRM,
      userFacing.WHATS_NEW_SETTINGS_TITLE,
      userFacing.WHATS_NEW_SETTINGS_HINT,
      userFacing.WHATS_NEW_PREVIOUS_TOGGLE,
      userFacing.WHATS_NEW_EMPTY_CURRENT,
      userFacing.whatsNewVersionLabel('0.3.0'),
      ...RELEASE_NOTES.flatMap((note) => note.items),
    ];
    for (const text of userFacingTexts) {
      expect(text).not.toMatch(simplifiedChars);
      expect(text).not.toMatch(forbiddenTerms);
    }
  });
});
