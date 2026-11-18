import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOG_IMPORTED_DAY_NOTE, SETTINGS_WRITING_LOG_HINT, statsImportedOnLine } from '../copy/userFacing';
import { TRANSFER_TABLES } from '../db/transferMeta';
import { CURRENT_SCHEMA_VERSION } from '../db/migrations';
import {
  countImportEventsOn,
  emptyImportEvents,
  firstImportDayKey,
  projectImportEvents,
  withImportEvent,
} from './importEvents';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('WO-120 第一筆匯入事件的寫作日', () => {
  it('沒有事件回傳 null', () => {
    expect(firstImportDayKey({})).toBeNull();
  });

  it('取 atMs 最早的那一筆，與物件列舉順序無關', () => {
    const a = { dayKey: '2026-11-10', atMs: 100 };
    const b = { dayKey: '2026-11-12', atMs: 300 };
    const c = { dayKey: '2026-11-11', atMs: 200 };
    expect(firstImportDayKey({ x: a, y: b, z: c })).toBe('2026-11-10');
    expect(firstImportDayKey({ z: c, y: b, x: a })).toBe('2026-11-10');
    expect(firstImportDayKey({ y: b, x: a, z: c })).toBe('2026-11-10');
    // 最早的那筆不在最前面、也不在最後面
    expect(firstImportDayKey({ y: b, z: c })).toBe('2026-11-11');
    expect(firstImportDayKey({ b: { dayKey: '2026-11-12', atMs: 300 }, m: { dayKey: '2026-11-09', atMs: 50 }, c: { dayKey: '2026-11-11', atMs: 200 } })).toBe('2026-11-09');
  });

  it('回傳儲存的寫作日，不從事件時間重新換算（事件時間所屬日與寫作日不同）', () => {
    // 2026-11-19 20:00 UTC = 臺北 2026-11-20 04:00；儲存的寫作日是 2026-11-19（每日結束時刻之前算前一天）。
    const atMs = Date.UTC(2026, 10, 19, 20, 0, 0);
    const events = { e: { dayKey: '2026-11-19', atMs } };
    expect(firstImportDayKey(events)).toBe('2026-11-19');
    expect(statsImportedOnLine(firstImportDayKey(events)!)).toBe('這份稿子是 2026 年 11 月 19 日從文字檔匯入的。');
    // 事件時間的 UTC 日曆日（11-19）與臺北日曆日（11-20）都不是儲存的寫作日 11-18
    const shifted = { e: { dayKey: '2026-11-18', atMs } };
    expect(firstImportDayKey(shifted)).toBe('2026-11-18');
  });

  it('atMs 相同時取 dayKey 較小者，結果不隨列舉順序改變', () => {
    const p = { dayKey: '2026-11-05', atMs: 10 };
    const q = { dayKey: '2026-11-06', atMs: 10 };
    expect(firstImportDayKey({ p, q })).toBe('2026-11-05');
    expect(firstImportDayKey({ q, p })).toBe('2026-11-05');
  });

  it('沿用既有合併規則：檔內事件 ∪ 本機可靠對應，以事件代號去重，不混入其他稿子', () => {
    let record = emptyImportEvents();
    record = withImportEvent(record, 'book-a', 'e1', { dayKey: '2026-11-12', atMs: 2000 });
    record = withImportEvent(record, 'book-b', 'e9', { dayKey: '2026-11-01', atMs: 1 });
    // 檔內事件比本機早；同代號 e1 以檔內為準
    const merged = projectImportEvents(record, 'book-a', {
      e1: { dayKey: '2026-11-11', atMs: 1500 },
      e0: { dayKey: '2026-11-09', atMs: 900 },
    });
    expect(Object.keys(merged).sort()).toEqual(['e0', 'e1']);
    expect(firstImportDayKey(merged)).toBe('2026-11-09');
    // 另一份稿子的事件不混入
    expect(firstImportDayKey(projectImportEvents(record, 'book-a'))).toBe('2026-11-12');
    expect(firstImportDayKey(projectImportEvents(record, 'book-none'))).toBeNull();
    // 同日多筆仍是一天
    expect(countImportEventsOn({ a: { dayKey: 'D', atMs: 1 }, b: { dayKey: 'D', atMs: 2 } }, 'D')).toBe(2);
  });
});

describe('WO-120 用字與日期格式', () => {
  it('完整一句逐字符合，年份一定寫、月日不補 0、不加星期', () => {
    expect(statsImportedOnLine('2026-11-18')).toBe('這份稿子是 2026 年 11 月 18 日從文字檔匯入的。');
    expect(statsImportedOnLine('2026-01-05')).toBe('這份稿子是 2026 年 1 月 5 日從文字檔匯入的。');
    expect(statsImportedOnLine('2027-12-31')).toBe('這份稿子是 2027 年 12 月 31 日從文字檔匯入的。');
    expect(statsImportedOnLine('2026-01-05')).not.toMatch(/星期|週|禮拜/);
  });

  it('日期格式不對時不產生句子（不自行發明日期）', () => {
    for (const bad of ['', 'x', '2026-1-5', '2026-00-10', '2026-13-10', '2026-11-00', '2026-11-32', '2026/11/18']) {
      expect(statsImportedOnLine(bad)).toBeNull();
    }
  });

  it('紀錄卡匯入日一句、設定說明小字逐字符合', () => {
    expect(LOG_IMPORTED_DAY_NOTE).toBe('這天從文字檔匯入');
    expect(SETTINGS_WRITING_LOG_HINT).toBe('每日字數、寫作時間、匯入紀錄');
  });
});

describe('WO-120 原始碼層面：入口搬到首頁、重用既有 action、資料格式不變', () => {
  it('首頁重用 useImportTextFile，該 hook 呼叫既有 actions.importTextFile，成功開成新稿子', () => {
    const home = read('../screens/HomeScreen.tsx');
    expect(home).toContain('useImportTextFile()');
    expect(home).toContain('IMPORT_TEXT_FILE_BUTTON');
    // 三顆按鈕順序：開新稿子、開啟稿子、匯入文字檔
    const create = home.indexOf('開新稿子\n        </button>');
    const open = home.indexOf('開啟稿子\n        </button>');
    const imp = home.indexOf('{IMPORT_TEXT_FILE_BUTTON}');
    expect(create).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(create);
    expect(imp).toBeGreaterThan(open);

    const hook = read('../screens/useImportTextFile.tsx');
    expect(hook).toContain('actions.importTextFile(file)');
    expect(hook).toContain("result.kind === 'imported'");
    expect(hook).toContain('navigate(writePath(result.id, result.chapterId))');
    expect(hook).toContain('IMPORT_TEXT_UNREADABLE');
    expect(hook).toContain('IMPORT_TEXT_STORAGE_FAIL');
    // 取消選檔（沒有選到檔）直接返回，不呼叫匯入
    expect(hook).toMatch(/if \(!file \|\| busy\) return;/);
    expect(hook).toContain('accept=".txt,text/plain"');
  });

  it('檔案頁不再有匯入入口與相關狀態', () => {
    const files = read('../screens/FilesScreen.tsx');
    expect(files).not.toContain('importTextFile');
    expect(files).not.toContain('IMPORT_TEXT_FILE_BUTTON');
    expect(files).not.toContain('import-text-file');
    expect(files).not.toContain('import-text-input');
    expect(files).toContain('FILES_GROUP_IMPORT_EXPORT');
    expect(files).toContain('export-full-text');
  });

  it('統計頁、紀錄頁不再顯示次數或大量刪除，但不動資料：writing_logs 欄位與附加表照舊', () => {
    const stats = read('../screens/StatsScreen.tsx');
    expect(stats).toContain('firstImportDayKey(importEvents)');
    expect(stats).not.toContain('STATS_IMPORT');
    expect(stats).not.toContain('stats-import-count');
    const logs = read('../screens/LogsScreen.tsx');
    // 畫面不得顯示「大量刪除」；註解可以說明資料仍保留，所以先去掉註解再斷言。
    const logsWithoutComments = logs
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(logsWithoutComments).not.toContain('大量刪除');
    expect(logsWithoutComments).not.toContain('delete_large_count');
    // 資料層仍保留大量刪除欄位與匯出事件的讀寫
    expect(read('../domain/writingLog.ts')).toContain('delete_large_count');
    expect(TRANSFER_TABLES.length).toBeGreaterThan(0);
    expect(CURRENT_SCHEMA_VERSION).toBe(14);
  });

  it('首頁動作列允許換行（窄版三鈕不切字），不改按鈕名', () => {
    const css = read('../styles/global.css');
    const block = css.slice(css.indexOf('.home-actions {'));
    expect(block.slice(0, block.indexOf('}'))).toContain('flex-wrap: wrap');
    expect(css).toContain('.home-actions > .button');
    expect(css).toContain('white-space: nowrap');
  });
});
