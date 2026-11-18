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
  PREPARING_BADGE,
  STATS_IMPORT_EXPORT_HEADING,
  STATS_IMPORT_EXPORT_SCOPE_HINT,
} from '../copy/userFacing';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider, useSample } from '../state/sampleStore';
import { FilesScreen } from './FilesScreen';
import { LogsScreen } from './LogsScreen';
import { StatsScreen } from './StatsScreen';
import { demoFixtureState } from '../state/testing/sampleFixture';

function renderWithLayout(
  element: ReactElement,
  path: string,
  initialRoute: string,
  mode: LayoutMode = 'phone-portrait',
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      // WO-95：統計與紀錄頁要有紀錄列才看得到各欄，明確放入舊版範例紀錄當測試資料。
      { initialState: demoFixtureState(new Date(), { withDemoStats: true }) },
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

describe('WO-60 畫面驗收測試', () => {
  it('WO-60／WO-99／WO-103：紀錄頁 HTML 不含「大量貼上」，仍含「大量刪除」，匯入、匯出都顯示實際次數，沒有「準備中」', () => {
    const html = renderWithLayout(
      createElement(LogsScreen),
      '/p/:projectId/logs',
      '/p/fog/logs',
      'phone-portrait',
    );

    // 1. 拿掉「大量貼上」
    expect(html).not.toContain('大量貼上');

    // 2. 仍保留「大量刪除」
    expect(html).toContain('大量刪除');

    // 3. WO-99：匯入已開放；WO-113：畫面不顯示匯出次數
    expect(html).toContain('匯入\u30000 次');
    expect(html).not.toContain('匯入\u3000—');
    expect(html).not.toContain('匯出\u30000 次');
    expect(html).not.toContain('匯出\u3000—');

    // 4. WO-103：匯出列不再有「準備中」徽章、淡色或點擊提示，和匯入列同一種一般樣式
    expect(html).not.toContain('準備中');
    expect(html).not.toContain('is-preparing');
    expect(html).not.toContain('log-metric-preparing');
    const importRows = html.match(/data-testid="log-import-row"><span>[^<]*<\/span><\/span>/g) ?? [];
    expect(importRows.length).toBeGreaterThan(0);
    const exportRows = html.match(/<span class="log-metric" data-testid="log-export-row"><span>[^<]*<\/span><\/span>/g) ?? [];
    // WO-113：不再有匯出列
    expect(exportRows.length).toBe(0);
    for (const row of exportRows) expect(row).toContain('匯出\u30000 次');

    // 5. 不含簡體字
    expect(html).not.toMatch(/[导汇备录档开关写]/);
  });

  it('WO-113：統計頁只顯示匯入次數，沒有匯出列，也沒有「準備中」', () => {
    const html = renderWithLayout(
      createElement(StatsScreen),
      '/p/:projectId/stats',
      '/p/fog/stats',
      'phone-portrait',
    );

    // 1. 區塊標題
    expect(html).toContain('匯入次數');
    expect(html).toContain(STATS_IMPORT_EXPORT_HEADING);

    // 2. 說明小字
    expect(html).toContain('只算匯入文字檔的次數');
    expect(html).toContain(STATS_IMPORT_EXPORT_SCOPE_HINT);

    // 3. 只留匯入次數，整列匯出都不在畫面上
    expect(html).toMatch(/data-testid="stats-import-count">0</);
    expect(html).not.toContain('stats-export-row');
    expect(html).not.toContain('stats-export-count');
    expect(html).not.toContain('匯出 次數');

    // 4. 沒有「準備中」
    expect(html).not.toContain(PREPARING_BADGE);
    expect(html).not.toContain('stats-preparing-badge');
    expect(html).not.toContain('is-preparing');

    // 5. 達成目標次數與寫作統計仍正常存在
    expect(html).toContain('達成目標次數');
    expect(html).toContain('寫作統計');
  });

  it('WO-60：寬版統計頁雙欄並排，右欄並排寫作過程紀錄', () => {
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
    expect(htmlWide).toContain('匯入\u30000 次');
    // WO-103：統計頁內共用的紀錄卡也接真實匯出數
    expect(htmlWide).not.toContain('匯出\u30000 次');
    expect(htmlWide).not.toContain('匯出\u3000—');
    expect(htmlWide).not.toContain(PREPARING_BADGE);
    expect(htmlWide).not.toContain('大量貼上');
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
      expect(html).toContain(STATS_IMPORT_EXPORT_HEADING);
    }
  });

  it('WO-60：檔案頁三組標題依序為「存檔」「開啟與關閉」「匯入與匯出」，且不出現「開稿」', () => {
    const html = renderWithLayout(
      createElement(FilesScreen),
      '/p/:projectId/files',
      '/p/fog/files',
      'phone-portrait',
    );

    // 1. 依序出現三組標題
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

  it('WO-60／WO-99／WO-103：檔案頁匯入、匯出都開放（無 aria-disabled、無淡色、無準備中），說明小字正確、沒有 Markdown', () => {
    const html = renderWithLayout(
      createElement(FilesScreen),
      '/p/:projectId/files',
      '/p/fog/files',
      'phone-portrait',
    );

    // 1. 匯入文字檔按鈕與說明
    expect(html).toContain(IMPORT_TEXT_FILE_BUTTON);
    expect(html).toContain(IMPORT_TEXT_FILE_HINT);
    expect(html).toContain('把文字檔的內容開成新稿子');
    expect(html).not.toContain('把文字檔的內容加進這份稿子');

    // 2. 匯出全文按鈕與說明
    expect(html).toContain(EXPORT_FULL_TEXT_BUTTON);
    expect(html).toContain(EXPORT_FULL_TEXT_HINT);
    // WO-103（暫定，交九方審）：說明改為已開放的格式與範圍，不提 Markdown
    expect(html).toContain('把全文或自選章節匯出成一個 Word 或 TXT 檔');
    expect(html).not.toContain('Markdown');

    // 3. WO-103：匯入、匯出按鈕都沒有 aria-disabled、淡色與準備中徽章
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('is-preparing');
    expect(html).not.toContain(PREPARING_BADGE);
    const importTag = html.match(/<button[^>]*data-testid="import-text-file"[^>]*>/)?.[0] ?? '';
    expect(importTag).not.toBe('');
    expect(importTag).not.toContain('aria-disabled');
    expect(importTag).not.toContain('is-preparing');
    const exportTag = html.match(/<button[^>]*data-testid="export-full-text"[^>]*>/)?.[0] ?? '';
    expect(exportTag).not.toBe('');
    expect(exportTag).not.toContain('aria-disabled');
    expect(exportTag).not.toContain('is-preparing');
    // 按下去會打開匯出選單（對話框）
    expect(exportTag).toContain('aria-haspopup="dialog"');
    // 選單只在按下後才出現
    expect(html).not.toContain('data-testid="export-dialog"');
    // 選檔欄位只收文字檔
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.txt,text\/plain"[^>]*data-testid="import-text-input"/);

    // 4. 新文字沒有簡體字
    expect(html).not.toMatch(/[导汇备录档开关写]/);
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
      STATS_IMPORT_EXPORT_HEADING,
      STATS_IMPORT_EXPORT_SCOPE_HINT,
    ];

    for (const phrase of newPhrases) {
      expect(phrase).not.toContain('.db');
      expect(phrase).not.toContain('開稿');
      // 繁體中文檢查
      expect(phrase).not.toMatch(/[导汇备录档开关写预]/);
    }
  });

  it('WO-60／WO-99／WO-103：匯入、匯出按鈕點擊都不再叫出「功能還在準備中。」', () => {
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

    expect(importBtnProps).not.toBeNull();
    expect(exportBtnProps).not.toBeNull();
    expect(importBtnProps['aria-disabled']).toBeUndefined();
    expect(exportBtnProps['aria-disabled']).toBeUndefined();

    // 觸發匯入按鈕點擊：只會去開選檔（測試環境沒有真的 input），不叫出準備中
    importBtnProps.onClick();
    expect(toastMessage).toBeNull();

    // 重設並觸發匯出按鈕點擊：改成打開匯出選單，不叫出準備中提示
    toastMessage = null;
    exportBtnProps.onClick();
    expect(toastMessage).toBeNull();
    expect(toastMessage).not.toBe(FEATURE_IN_PREPARATION);
  });
});
