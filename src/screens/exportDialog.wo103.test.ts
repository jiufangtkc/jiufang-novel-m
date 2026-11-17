import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_DEVICE_FAIL,
  EXPORT_EMPTY_SELECTION,
  EXPORT_NO_CHAPTERS,
  EXPORT_READY_HINT,
} from '../copy/userFacing';
import * as copy from '../copy/userFacing';
import { findNode } from '../data/demo';
import { fakeBookNodes } from '../domain/testing/wo103FakeBook';
import type { FullTextExportOutcome, PreparedExport } from '../state/sampleStore';
import { ExportDialog } from './ExportDialog';
import {
  countSelected,
  exportDialogReducer,
  exportDisabled,
  initialExportDialogState,
  pickerRows,
  standingMessage,
  type ExportDialogEvent,
  type ExportDialogState,
} from './exportDialogModel';

/**
 * WO-103：匯出選單與自選章節清單（暫定第 4、5、7、8 條）。
 * 沒有瀏覽器的測試環境：用純函式逐步操作，並以靜態輸出核對畫面元素與樣式條件。
 * 這不是真機視覺驗收；四種版面的截圖由派工人在沙箱外做。
 */

const nodes = fakeBookNodes();
const run = (events: ExportDialogEvent[], start: ExportDialogState = initialExportDialogState()) =>
  events.reduce(exportDialogReducer, start);
const node = (id: string) => findNode(nodes, id)!;

function renderDialog(initialState: Partial<ExportDialogState> = {}, list = nodes): string {
  return renderToStaticMarkup(
    createElement(ExportDialog, {
      projectId: 'p-1',
      nodes: list,
      onClose: () => undefined,
      onExport: async (): Promise<FullTextExportOutcome> => ({ kind: 'cancelled' }),
      initialState,
    }),
  );
}

describe('WO-103 匯出選單狀態', () => {
  it('預設 Word＋全文；可切 TXT 與自選章節；沒有 Markdown 選項', () => {
    const state = initialExportDialogState();
    expect(state).toMatchObject({ format: 'docx', scope: 'all', view: 'menu', busy: false, message: null });
    expect(state.selected.size).toBe(0);
    expect(exportDisabled(state, nodes)).toBe(false);
    const txt = run([{ type: 'format', format: 'txt' }, { type: 'scope', scope: 'selected' }]);
    expect(txt).toMatchObject({ format: 'txt', scope: 'selected' });
    const html = renderDialog();
    expect(html).toContain('Word（.docx）');
    expect(html).toContain('TXT（.txt）');
    expect(html).toContain('>全文<');
    expect(html).toContain('>自選章節<');
    expect(html).not.toMatch(/Markdown|\.md\b/);
    expect(html).toContain('<input type="radio" name="export-format" checked="" value="docx"/>');
    expect(html).toContain('<input type="radio" name="export-format" value="txt"/>');
    expect(html).toContain('<input type="radio" name="export-scope" checked="" value="all"/>');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="export-dialog-title"');
    expect(html).toContain('>匯出稿子<');
    expect(html).toContain('data-testid="export-confirm"');
    expect(html).toContain('data-testid="export-cancel"');
  });

  it('自選章節初次全不選：匯出停用並顯示「請先選要匯出的章。」；選了之後才可按', () => {
    const selected = run([{ type: 'scope', scope: 'selected' }]);
    expect(exportDisabled(selected, nodes)).toBe(true);
    expect(standingMessage(selected, nodes)).toBe('empty-selection');
    const html = renderDialog({ scope: 'selected' });
    // 提示只留一次，位置在「選擇章節」列的小字
    expect(html.split(EXPORT_EMPTY_SELECTION)).toHaveLength(2);
    expect(html).toContain(`<small data-testid="export-selection-summary">${EXPORT_EMPTY_SELECTION}</small>`);
    expect(html).not.toContain('data-testid="export-message"');
    // 事件結果設定的同類訊息也不重複渲染
    const viaEvent = renderDialog({ scope: 'selected', message: 'empty-selection' });
    expect(viaEvent.split(EXPORT_EMPTY_SELECTION)).toHaveLength(2);
    expect(viaEvent).not.toContain('data-testid="export-message"');
    // 其他提示照常
    expect(renderDialog({ scope: 'selected', message: 'device-fail' })).toContain(EXPORT_DEVICE_FAIL);
    expect(renderDialog({ scope: 'selected', prepared: {} as PreparedExport })).toContain(EXPORT_READY_HINT);
    expect(html).toMatch(/data-testid="export-confirm" disabled=""/);
    const chosen = run([{ type: 'open-picker' }, { type: 'toggle-node', node: node('c2') }, { type: 'picker-done' }], selected);
    expect(exportDisabled(chosen, nodes)).toBe(false);
    expect(standingMessage(chosen, nodes)).toBeNull();
    expect(renderDialog({ scope: 'selected', selected: chosen.selected })).toContain('已選 1 章');
  });

  it('稿子沒有章：顯示「這份稿子還沒有章，先新增一章再匯出。」並停用匯出', () => {
    const empty = [{ id: 'v', type: 'folder' as const, title: '空卷', children: [] }];
    const state = initialExportDialogState();
    expect(exportDisabled(state, empty)).toBe(true);
    expect(standingMessage(state, empty)).toBe('no-chapters');
    const html = renderDialog({}, empty);
    expect(html).toContain(EXPORT_NO_CHAPTERS);
    expect(html).toMatch(/data-testid="export-confirm" disabled=""/);
  });

  it('處理中鎖住：不能改格式、範圍，匯出鈕停用；失敗顯示「這個裝置目前無法匯出，請稍後再試。」；取消安靜回原選單', () => {
    const busy = run([{ type: 'start' }]);
    expect(exportDisabled(busy, nodes)).toBe(true);
    expect(run([{ type: 'format', format: 'txt' }], busy).format).toBe('docx');
    expect(renderDialog({ busy: true })).toContain('正在準備檔案，請稍候。');
    const failed = run([{ type: 'finish', outcome: 'failed' }], busy);
    expect(failed).toMatchObject({ busy: false, message: 'device-fail' });
    const failedHtml = renderDialog({ message: 'device-fail' });
    expect(failedHtml).toContain(EXPORT_DEVICE_FAIL);
    expect(failedHtml).toContain('role="alert"');
    const cancelled = run([{ type: 'finish', outcome: 'cancelled' }], busy);
    expect(cancelled).toMatchObject({ busy: false, message: null, view: 'menu' });
  });

  it('手勢失效：顯示「檔案已備妥，請按「儲存檔案」。」與「儲存檔案」鈕（新用字，暫定）', () => {
    const prepared = { projectId: 'p-1', format: 'docx', scope: 'all', file: new File([], 'a.docx') } as PreparedExport;
    const state = run([{ type: 'start' }, { type: 'finish', outcome: 'needs-gesture', prepared }]);
    expect(state.prepared).toBe(prepared);
    const html = renderDialog({ prepared });
    expect(html).toContain(EXPORT_READY_HINT);
    expect(html).toContain('data-testid="export-save-file"');
    expect(html).toContain('>儲存檔案<');
    expect(html).not.toContain('data-testid="export-confirm"');
  });
});

describe('WO-103 自選章節清單', () => {
  it('確定套用、取消捨棄這次修改並保留進入前狀態；未選時「確定」停用且事件也不套用空選取', () => {
    let state = run([{ type: 'scope', scope: 'selected' }, { type: 'open-picker' }]);
    expect(state.view).toBe('picker');
    expect(run([{ type: 'picker-done' }], state).view).toBe('picker'); // 空的不套用
    expect(renderDialog({ view: 'picker' })).toMatch(/data-testid="export-picker-done" disabled=""/);
    state = run([{ type: 'toggle-node', node: node('c4') }, { type: 'picker-done' }], state);
    expect([...state.selected].sort()).toEqual(['c4', 's3']);
    // 再進去改一改然後取消：保留進入前
    const edited = run([{ type: 'open-picker' }, { type: 'select-all', nodes }, { type: 'picker-cancel' }], state);
    expect(edited.view).toBe('menu');
    expect([...edited.selected].sort()).toEqual(['c4', 's3']);
    // 全選、取消全選
    const all = run([{ type: 'open-picker' }, { type: 'select-all', nodes }], state);
    expect(all.draft.size).toBe(8);
    expect(run([{ type: 'select-none' }], all).draft.size).toBe(0);
  });

  it('展開與勾選分開：收合不清選取、收合的子列不畫但仍保留；列依目錄順序、用縮排與類型名稱呈現', () => {
    let state = run([{ type: 'open-picker' }, { type: 'toggle-node', node: node('v1') }]);
    expect(state.draft.size).toBe(4);
    state = run([{ type: 'toggle-expand', id: 'v1' }], state);
    expect(state.draft.size).toBe(4);
    expect(pickerRows(nodes, state.collapsed).map((row) => row.node.id)).toEqual(['v1', 'v2', 'c3', 'v3', 'c4', 's3', 'c5']);
    expect(pickerRows(nodes, new Set()).map((row) => [row.node.id, row.depth])).toEqual([
      ['v1', 0], ['c1', 1], ['s1', 2], ['s2', 2], ['c2', 1], ['v2', 0], ['c3', 0], ['v3', 0], ['c4', 1], ['s3', 2], ['c5', 1],
    ]);
    const html = renderDialog({ view: 'picker', draft: new Set(['c1', 's1']) });
    // 卷、章、幕用既有類型名稱（不是只靠顏色）
    expect(html).toMatch(/data-testid="export-row-v1"[^>]*data-check="partial"/);
    expect(html).toMatch(/data-testid="export-check-c1"[^>]*aria-label="章　第一章　燈號，部分選取"|aria-label="章　第一章　燈號，部分選取"[^>]*data-testid="export-check-c1"/);
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain('>卷<');
    expect(html).toContain('>章<');
    expect(html).toContain('>幕<');
    expect(html).toContain('padding-inline-start:40px');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('>全選<');
    expect(html).toContain('>取消全選<');
    expect(html).toContain('>確定<');
    expect(html).toContain('>取消<');
    expect(html).toContain('已選 1 章、1 幕');
    expect(countSelected(nodes, new Set(['c1', 's1', 's2']))).toEqual({ chapters: 1, scenes: 2 });
  });

  it('稿子在清單開著時被改：已刪掉的代號自動拿掉，不會輸出不存在的章', () => {
    const state = run([{ type: 'open-picker' }, { type: 'select-all', nodes }, { type: 'picker-done' }]);
    const smaller = nodes.filter((item) => item.id !== 'v3');
    const synced = run([{ type: 'sync-nodes', nodes: smaller }], state);
    expect([...synced.selected].sort()).toEqual(['c1', 'c2', 'c3', 's1', 's2']);
  });
});

describe('WO-103 選單樣式條件（四種版面可捲動、操作列不遮內容、可點範圍至少 44）', () => {
  const css = readFileSync(new URL('./importExport.css', import.meta.url), 'utf8');
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, selector).not.toBeNull();
    return match![1]!;
  };

  it('背景蓋滿視窗、框不超過視窗高；內容區自己捲動且不水平溢出；操作列在框底部、不浮在內容上', () => {
    expect(rule('.export-dialog-backdrop')).toMatch(/position:\s*fixed/);
    expect(rule('.export-dialog-backdrop')).toMatch(/inset:\s*0/);
    expect(rule('.export-dialog')).toMatch(/max-height:\s*100%/);
    expect(rule('.export-dialog')).toMatch(/max-width:\s*100%/);
    expect(rule('.export-dialog')).toMatch(/flex-direction:\s*column/);
    const body = rule('.export-dialog-body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/overflow-x:\s*hidden/);
    expect(body).toMatch(/min-height:\s*0/);
    const actions = rule('.export-dialog-actions');
    expect(actions).toMatch(/flex:\s*0 0 auto/);
    expect(actions).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
    // 長章名換行，不撐出水平捲軸
    expect(rule('.export-node-title')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.export-choice')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('選項、清單列、展開鈕、操作鈕、全選鈕都至少 44×44 CSS 像素', () => {
    expect(rule('.export-choice')).toMatch(/min-height:\s*44px/);
    expect(rule('.export-pick-row')).toMatch(/min-height:\s*44px/);
    expect(rule('.export-check')).toMatch(/min-height:\s*44px/);
    expect(rule('.export-expand')).toMatch(/width:\s*44px/);
    expect(rule('.export-expand')).toMatch(/height:\s*44px/);
    expect(rule('.export-dialog-actions .button')).toMatch(/min-height:\s*44px/);
    expect(rule('.export-dialog-actions .button')).toMatch(/min-width:\s*44px/);
    expect(rule('.export-picker-tools .button')).toMatch(/min-height:\s*44px/);
  });
});

describe('WO-103 新用字', () => {
  it('新用字都是臺灣繁體中文，沒有簡體字、沒有技術資料表名稱、沒有 Markdown', () => {
    const texts = Object.entries(copy)
      .filter(([key, value]) => key.startsWith('EXPORT_') && typeof value === 'string')
      .map(([, value]) => value as string);
    texts.push(copy.exportSelectionSummary(0, 0), copy.exportSelectionSummary(2, 0), copy.exportSelectionSummary(1, 3));
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) {
      expect(text).not.toMatch(/[导汇备录档开关写预选择确认删储设页节无请]/);
      expect(text).not.toMatch(/jiufangm_|transfer|Markdown|\.db/);
    }
    expect(copy.exportSelectionSummary(0, 0)).toBe('請先選要匯出的章。');
    expect(copy.exportSelectionSummary(2, 0)).toBe('已選 2 章');
    expect(copy.exportSelectionSummary(1, 3)).toBe('已選 1 章、3 幕');
  });
});
