import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FULL_TEXT_BUTTON,
  EXPORT_FULL_TEXT_HINT,
  FEATURE_IN_PREPARATION,
  FILES_GROUP_IMPORT_EXPORT,
  FILES_GROUP_OPEN_CLOSE,
  FILES_GROUP_SAVE,
  IMPORT_TEXT_FILE_BUTTON,
  IMPORT_TEXT_FILE_HINT,
  LOG_IMPORTED_DAY_NOTE,
  PREPARING_BADGE,
  statsImportedOnLine,
} from '../copy/userFacing';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider, useSample } from '../state/sampleStore';
import { FilesScreen } from './FilesScreen';
import { LogsScreen } from './LogsScreen';
import { StatsScreen } from './StatsScreen';
import { demoFixtureState } from '../state/testing/sampleFixture';

type DemoState = ReturnType<typeof demoFixtureState>;

/** WO-120：假稿 fog 的匯入事件（事件代號 → 寫作日、時間）；全部假資料。 */
function withFogImportEvents(
  base: DemoState,
  events: Record<string, { dayKey: string; atMs: number }>,
  options: { largeDelete?: number } = {},
): DemoState {
  return {
    ...base,
    logs:
      options.largeDelete === undefined
        ? base.logs
        : base.logs.map((log) => ({ ...log, delete_large_count: options.largeDelete! })),
    importEvents: {
      events: { ...base.importEvents.events, ...events },
      byProject: { ...base.importEvents.byProject, fog: Object.keys(events) },
      byFile: base.importEvents.byFile,
    },
  };
}

function renderWithLayout(
  element: ReactElement,
  path: string,
  initialRoute: string,
  mode: LayoutMode = 'phone-portrait',
  state: DemoState = demoFixtureState(new Date(), { withDemoStats: true }),
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      // WO-95：統計與紀錄頁要有紀錄列才看得到各欄，明確放入舊版範例紀錄當測試資料。
      { initialState: state },
      createElement(
        LayoutProvider,
        { initialMode: mode },
        createElement(
          MemoryRouter,
          { initialEntries: [initialRoute] },
          createElement(
            Routes,
            null,
            createElement(Route, { path, element }),
          ),
        ),
      ),
    ),
  );
}

const SIMPLIFIED = /[导汇备录档开关写]/;

describe('WO-60／WO-120 畫面驗收測試', () => {
  it('WO-120：紀錄頁沒有匯入事件時，不含「大量貼上」「大量刪除」、匯入次數與匯入日那一行，也沒有「準備中」', () => {
    // 即使 delete_large_count 非零，也不顯示（資料保留，只是畫面不列）
    const base = demoFixtureState(new Date(), { withDemoStats: true });
    const html = renderWithLayout(
      createElement(LogsScreen),
      '/p/:projectId/logs',
      '/p/fog/logs',
      'phone-portrait',
      withFogImportEvents(base, {}, { largeDelete: 7 }),
    );
    expect(base.logs.length).toBeGreaterThan(1);
    expect(html).toContain('log-card-');

    expect(html).not.toContain('大量貼上');
    expect(html).not.toContain('大量刪除');
    expect(html).not.toContain(LOG_IMPORTED_DAY_NOTE);
    expect(html).not.toContain('log-import-row');
    expect(html).not.toMatch(/匯入[\s　]*[\d—]+\s*次/);
    // 不顯示匯出次數
    expect(html).not.toMatch(/匯出[\s　]*[\d—]+\s*次/);
    expect(html).not.toContain('log-export-row');
    expect(html).not.toContain('準備中');
    expect(html).not.toContain('is-preparing');
    expect(html).not.toContain('log-metric-preparing');
    expect(html).not.toMatch(SIMPLIFIED);
  });

  it('WO-120：紀錄卡只有匯入那一天多「這天從文字檔匯入」；同日多筆只顯示一行；沒有次數與大量刪除', () => {
    const base = demoFixtureState(new Date(), { withDemoStats: true });
    const importDay = base.logs[0]!.date;
    const otherDay = base.logs[1]!.date;
    expect(otherDay).not.toBe(importDay);
    const state = withFogImportEvents(
      base,
      {
        a: { dayKey: importDay, atMs: 1_000 },
        b: { dayKey: importDay, atMs: 2_000 },
        c: { dayKey: importDay, atMs: 3_000 },
      },
      { largeDelete: 4 },
    );
    const html = renderWithLayout(createElement(LogsScreen), '/p/:projectId/logs', '/p/fog/logs', 'phone-portrait', state);
    const card = (day: string) =>
      html.match(new RegExp(`<li class="log-card" data-testid="log-card-${day}">.*?</li>`))?.[0] ?? '';
    expect(card(importDay)).toContain('這天從文字檔匯入');
    expect(card(importDay).split('這天從文字檔匯入').length - 1).toBe(1);
    expect(card(otherDay)).not.toBe('');
    expect(card(otherDay)).not.toContain('這天從文字檔匯入');
    expect(html.split('這天從文字檔匯入').length - 1).toBe(1);
    expect(html).not.toMatch(/匯入[\s　]*\d+\s*次/);
    expect(html).not.toContain('大量刪除');
  });

  it('WO-120：只有匯入事件、沒有寫作紀錄列的日子仍有卡片，並顯示匯入那一行', () => {
    const base = demoFixtureState(new Date(), { withDemoStats: true });
    expect(base.logs.map((log) => log.date)).not.toContain('2020-02-03');
    const state = withFogImportEvents(base, { x: { dayKey: '2020-02-03', atMs: 5 } });
    const html = renderWithLayout(createElement(LogsScreen), '/p/:projectId/logs', '/p/fog/logs', 'phone-portrait', state);
    const card = html.match(/<li class="log-card" data-testid="log-card-2020-02-03">.*?<\/li>/)?.[0] ?? '';
    expect(card).toContain('這天從文字檔匯入');
  });

  it('WO-120：統計頁沒有匯入事件時，整組（標題、次數、說明句）都不出現，也沒有匯出列與「準備中」', () => {
    const html = renderWithLayout(
      createElement(StatsScreen),
      '/p/:projectId/stats',
      '/p/fog/stats',
      'phone-portrait',
    );

    expect(html).not.toContain('匯入次數');
    expect(html).not.toContain('只算匯入文字檔的次數');
    expect(html).not.toContain('匯入 次數');
    expect(html).not.toContain('從文字檔匯入的');
    expect(html).not.toContain('stats-import-export');
    expect(html).not.toContain('stats-import-count');
    expect(html).not.toContain('stats-import-note');
    expect(html).not.toContain('stats-export-row');
    expect(html).not.toContain('stats-export-count');
    expect(html).not.toContain('匯出 次數');

    expect(html).not.toContain(PREPARING_BADGE);
    expect(html).not.toContain('stats-preparing-badge');
    expect(html).not.toContain('is-preparing');

    // 達成目標次數與寫作統計仍正常存在
    expect(html).toContain('達成目標次數');
    expect(html).toContain('寫作統計');
  });

  it('WO-120：統計頁有匯入事件時顯示完整一句；取第一筆（atMs 最早）的寫作日，與輸入順序、事件實際日期無關', () => {
    const base = demoFixtureState(new Date(), { withDemoStats: true });
    // 事件時間（atMs）所屬的日曆日與儲存的寫作日刻意不同：
    // early 的 UTC 日曆日是 2026-11-19、臺北是 11-20，但儲存的寫作日是 2026-11-18。
    const early = Date.UTC(2026, 10, 19, 20, 0, 0);
    const late = Date.UTC(2026, 10, 25, 4, 0, 0);
    const orders: Array<Record<string, { dayKey: string; atMs: number }>> = [
      { z: { dayKey: '2026-11-18', atMs: early }, a: { dayKey: '2026-11-25', atMs: late } },
      { a: { dayKey: '2026-11-25', atMs: late }, z: { dayKey: '2026-11-18', atMs: early } },
    ];
    for (const events of orders) {
      for (const mode of ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as LayoutMode[]) {
        const html = renderWithLayout(
          createElement(StatsScreen),
          '/p/:projectId/stats',
          '/p/fog/stats',
          mode,
          withFogImportEvents(base, events),
        );
        expect(html).toContain('這份稿子是 2026 年 11 月 18 日從文字檔匯入的。');
        expect(html).not.toContain('2026 年 11 月 25 日從文字檔匯入的');
        expect(html).not.toContain('2026 年 11 月 19 日從文字檔匯入的');
        expect(html).not.toContain('2026 年 11 月 20 日從文字檔匯入的');
        // 沒有次數字樣
        expect(html).not.toContain('匯入次數');
        expect(html).not.toContain('只算匯入文字檔的次數');
        expect(html).not.toContain('stats-import-count');
        expect(html).not.toContain('stats-export-row');
        expect(html).not.toContain(PREPARING_BADGE);
      }
    }
  });

  it('WO-120：統計句月日不補 0、年份一定寫、不加星期', () => {
    const base = demoFixtureState(new Date(), { withDemoStats: true });
    const html = renderWithLayout(
      createElement(StatsScreen),
      '/p/:projectId/stats',
      '/p/fog/stats',
      'phone-portrait',
      withFogImportEvents(base, { only: { dayKey: '2026-01-05', atMs: 10 } }),
    );
    expect(html).toContain('這份稿子是 2026 年 1 月 5 日從文字檔匯入的。');
    expect(html).not.toContain('01 月');
    expect(html).not.toContain('05 日');
    expect(html).not.toMatch(/這份稿子是[^<]*(星期|週|禮拜)/);
    expect(statsImportedOnLine('2026-01-05')).toBe('這份稿子是 2026 年 1 月 5 日從文字檔匯入的。');
  });

  it('WO-120：只有匯出事件、沒有匯入事件時，統計頁不出現匯入說明，紀錄卡也不出現匯入那一行', () => {
    const base = demoFixtureState(new Date(), { withDemoStats: true });
    const state = {
      ...base,
      exportEvents: {
        events: { e1: { dayKey: base.logs[0]!.date, atMs: 100 } },
        byProject: { fog: ['e1'] },
        byFile: {},
      },
    } as DemoState;
    const stats = renderWithLayout(createElement(StatsScreen), '/p/:projectId/stats', '/p/fog/stats', 'wide', state);
    expect(stats).not.toContain('從文字檔匯入');
    expect(stats).not.toContain('stats-import-export');
    const logs = renderWithLayout(createElement(LogsScreen), '/p/:projectId/logs', '/p/fog/logs', 'phone-portrait', state);
    expect(logs).not.toContain('從文字檔匯入');
    expect(logs).not.toMatch(/匯出[\s　]*[\d—]+\s*次/);
  });

  it('WO-60／WO-120：寬版統計頁雙欄並排，右欄並排寫作過程紀錄（沒有次數字樣）', () => {
    const htmlWide = renderWithLayout(
      createElement(StatsScreen),
      '/p/:projectId/stats',
      '/p/fog/stats',
      'wide',
    );

    // 寬版有右欄寫作過程紀錄容器
    expect(htmlWide).toContain('is-wide');
    expect(htmlWide).toContain('stats-wide-logs');
    expect(htmlWide).toContain('視覺化的寫作記錄');
    expect(htmlWide).not.toMatch(/匯入[\s　]*[\d—]+\s*次/);
    expect(htmlWide).not.toMatch(/匯出[\s　]*[\d—]+\s*次/);
    expect(htmlWide).not.toContain(PREPARING_BADGE);
    expect(htmlWide).not.toContain('大量貼上');
    expect(htmlWide).not.toContain('大量刪除');
  });

  it('WO-60：手機與中等版面統計頁為單欄，不顯示右欄並排', () => {
    for (const mode of ['phone-portrait', 'phone-landscape', 'medium'] as LayoutMode[]) {
      const html = renderWithLayout(
        createElement(StatsScreen),
        '/p/:projectId/stats',
        '/p/fog/stats',
        mode,
      );
      expect(html).not.toContain('stats-wide-logs');
      expect(html).toContain('查看寫作過程紀錄');
    }
  });

  it('WO-60：檔案頁三組標題依序為「存檔」「開啟與關閉」「匯入與匯出」，且不出現「開稿」', () => {
    const html = renderWithLayout(
      createElement(FilesScreen),
      '/p/:projectId/files',
      '/p/fog/files',
      'phone-portrait',
    );

    // 1. 依序出現三組標題（WO-120：匯入搬走後組名未另定案，維持原樣）
    const saveIndex = html.indexOf('存檔');
    const openCloseIndex = html.indexOf('開啟與關閉');
    const importExportIndex = html.indexOf('匯入與匯出');

    expect(saveIndex).toBeGreaterThan(-1);
    expect(openCloseIndex).toBeGreaterThan(saveIndex);
    expect(importExportIndex).toBeGreaterThan(openCloseIndex);

    // 2. 絕不出現「開稿」
    expect(html).not.toContain('開稿');

    // 3. 存檔組保有既有按鈕（無 FSA 時主動作為另存專案，並含暫存按鈕）
    expect(html).toContain('另存專案');
    expect(html).toContain('立刻暫存稿子');

    // 4. 開啟與關閉組保有既有按鈕
    expect(html).toContain('開啟別的稿子');
    expect(html).toContain('關閉稿子並回首頁');
  });

  it('WO-60／WO-103／WO-120：檔案頁只剩匯出（開放、無 aria-disabled、無淡色、無準備中），沒有匯入文字檔按鈕，沒有 Markdown', () => {
    const html = renderWithLayout(
      createElement(FilesScreen),
      '/p/:projectId/files',
      '/p/fog/files',
      'phone-portrait',
    );

    // 1. WO-120：匯入文字檔入口已搬到首頁，檔案頁不再有按鈕、說明、選檔欄位與錯誤區
    expect(html).not.toContain(IMPORT_TEXT_FILE_BUTTON);
    expect(html).not.toContain(IMPORT_TEXT_FILE_HINT);
    expect(html).not.toContain('import-text-file');
    expect(html).not.toContain('import-text-input');
    expect(html).not.toContain('import-text-error');

    // 2. 匯出全文按鈕與說明
    expect(html).toContain(EXPORT_FULL_TEXT_BUTTON);
    expect(html).toContain(EXPORT_FULL_TEXT_HINT);
    // WO-103（暫定，交九方審）：說明改為已開放的格式與範圍，不提 Markdown
    expect(html).toContain('把全文或自選章節匯出成一個 Word 或 TXT 檔');
    expect(html).not.toContain('Markdown');

    // 3. 匯出按鈕沒有 aria-disabled、淡色與準備中徽章
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('is-preparing');
    expect(html).not.toContain(PREPARING_BADGE);
    const exportTag = html.match(/<button[^>]*data-testid="export-full-text"[^>]*>/)?.[0] ?? '';
    expect(exportTag).not.toBe('');
    expect(exportTag).not.toContain('aria-disabled');
    expect(exportTag).not.toContain('is-preparing');
    // 按下去會打開匯出選單（對話框）
    expect(exportTag).toContain('aria-haspopup="dialog"');
    // 選單只在按下後才出現
    expect(html).not.toContain('data-testid="export-dialog"');

    // 4. 新文字沒有簡體字
    expect(html).not.toMatch(SIMPLIFIED);
  });

  it('WO-60：新文字沒有簡體字，新文字未出現「.db」字樣', () => {
    const newPhrases = [
      FILES_GROUP_SAVE,
      FILES_GROUP_OPEN_CLOSE,
      FILES_GROUP_IMPORT_EXPORT,
      PREPARING_BADGE,
      FEATURE_IN_PREPARATION,
      IMPORT_TEXT_FILE_BUTTON,
      IMPORT_TEXT_FILE_HINT,
      EXPORT_FULL_TEXT_BUTTON,
      EXPORT_FULL_TEXT_HINT,
      LOG_IMPORTED_DAY_NOTE,
      statsImportedOnLine('2026-11-18')!,
    ];

    for (const phrase of newPhrases) {
      expect(phrase).not.toContain('.db');
      expect(phrase).not.toContain('開稿');
      // 繁體中文檢查
      expect(phrase).not.toMatch(/[导汇备录档开关写预]/);
    }
  });

  it('WO-60／WO-103／WO-120：匯出按鈕點擊不叫出「功能還在準備中。」；檔案頁已沒有匯入按鈕', () => {
    let importBtnProps: any = null;
    let exportBtnProps: any = null;
    let toastMessage: string | null = null;

    function Harness() {
      const { actions } = useSample();
      const origToast = actions.toast;
      actions.toast = (msg: string | null) => {
        toastMessage = msg;
        origToast(msg);
      };

      const vdom = FilesScreen();
      function traverse(node: any) {
        if (!node || typeof node !== 'object') return;
        if (node.props?.['data-testid'] === 'import-text-file') {
          importBtnProps = node.props;
        }
        if (node.props?.['data-testid'] === 'export-full-text') {
          exportBtnProps = node.props;
        }
        const children = node.props?.children;
        if (Array.isArray(children)) {
          children.forEach(traverse);
        } else if (children) {
          traverse(children);
        }
      }
      traverse(vdom);
      return vdom;
    }

    renderToStaticMarkup(
      createElement(
        SampleProvider,
        { initialState: demoFixtureState() },
        createElement(
          LayoutProvider,
          { initialMode: 'phone-portrait' },
          createElement(
            MemoryRouter,
            { initialEntries: ['/p/fog/files'] },
            createElement(
              Routes,
              null,
              createElement(Route, { path: '/p/:projectId/files', element: createElement(Harness) }),
            ),
          ),
        ),
      ),
    );

    // WO-120：匯入入口已移到首頁
    expect(importBtnProps).toBeNull();
    expect(exportBtnProps).not.toBeNull();
    expect(exportBtnProps['aria-disabled']).toBeUndefined();

    // 觸發匯出按鈕點擊：打開匯出選單，不叫出準備中提示
    exportBtnProps.onClick();
    expect(toastMessage).toBeNull();
    expect(toastMessage).not.toBe(FEATURE_IN_PREPARATION);
  });
});
