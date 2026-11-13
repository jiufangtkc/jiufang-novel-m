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

function renderWithLayout(
  element: ReactElement,
  path: string,
  initialRoute: string,
  mode: LayoutMode = 'phone-portrait',
): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
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
  it('WO-60：紀錄頁 HTML 不含「大量貼上」，仍含「大量刪除」，含「匯入　—」「匯出　—」與「準備中」', () => {
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

    // 3. 包含全形空白的「匯入　—」與「匯出　—」
    expect(html).toContain('匯入\u3000—');
    expect(html).toContain('匯出\u3000—');

    // 4. 旁標「準備中」
    expect(html).toContain('準備中');

    // 5. 不含簡體字
    expect(html).not.toMatch(/[导汇备录档开关写]/);
  });

  it('WO-60：統計頁含「匯入與匯出」「只算匯入文字檔、匯出全文的次數」「—」「準備中」', () => {
    const html = renderWithLayout(
      createElement(StatsScreen),
      '/p/:projectId/stats',
      '/p/fog/stats',
      'phone-portrait',
    );

    // 1. 區塊標題
    expect(html).toContain('匯入與匯出');
    expect(html).toContain(STATS_IMPORT_EXPORT_HEADING);

    // 2. 說明小字
    expect(html).toContain('只算匯入文字檔、匯出全文的次數');
    expect(html).toContain(STATS_IMPORT_EXPORT_SCOPE_HINT);

    // 3. 預留未開放數值為破折號
    expect(html).toContain('—');

    // 4. 旁標「準備中」徽章
    expect(html).toContain('準備中');
    expect(html).toContain(PREPARING_BADGE);

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
    expect(htmlWide).toContain('視覺化的寫作紀錄');
    expect(htmlWide).toContain('匯入\u3000—');
    expect(htmlWide).toContain('匯出\u3000—');
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
      expect(html).toContain('匯入與匯出');
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

  it('WO-60：檔案頁匯入與匯出兩顆按鈕帶 aria-disabled 或等效淡色狀態，說明小字正確', () => {
    const html = renderWithLayout(
      createElement(FilesScreen),
      '/p/:projectId/files',
      '/p/fog/files',
      'phone-portrait',
    );

    // 1. 匯入文字檔按鈕與說明
    expect(html).toContain(IMPORT_TEXT_FILE_BUTTON);
    expect(html).toContain(IMPORT_TEXT_FILE_HINT);
    expect(html).toContain('把文字檔的內容加進這份稿子');

    // 2. 匯出全文按鈕與說明
    expect(html).toContain(EXPORT_FULL_TEXT_BUTTON);
    expect(html).toContain(EXPORT_FULL_TEXT_HINT);
    expect(html).toContain('把整份稿子匯出成一個 TXT 或 Markdown 檔');

    // 3. aria-disabled 與淡色樣式
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('is-preparing');
    expect(html).toContain(PREPARING_BADGE);

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

  it('WO-60：檔案頁匯入與匯出兩顆按鈕點擊處理只叫出「功能還在準備中。」', () => {
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
        null,
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
    expect(importBtnProps['aria-disabled']).toBe('true');
    expect(exportBtnProps['aria-disabled']).toBe('true');

    // 觸發匯入按鈕點擊
    importBtnProps.onClick();
    expect(toastMessage).toBe(FEATURE_IN_PREPARATION);

    // 重設並觸發匯出按鈕點擊
    toastMessage = null;
    exportBtnProps.onClick();
    expect(toastMessage).toBe(FEATURE_IN_PREPARATION);
  });
});
