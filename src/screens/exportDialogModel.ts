import type { ChapterNode } from '../data/demo';
import {
  hasExportableChapter,
  pruneSelection,
  selectAll,
  toggleSelection,
  type ExportFormat,
  type ExportScope,
} from '../domain/fullTextExport';
import type { PreparedExport } from '../state/sampleStore';

/**
 * WO-103：匯出選單（暫定第 4、5、7、8 條）的畫面狀態。純函式，方便在沒有瀏覽器的測試裡逐步操作。
 *
 * - 預設 Word＋全文；自選章節初次進入全不選。
 * - 自選清單裡的修改先放在 draft，按「確定」才套用；按「取消」捨棄這次修改、保留進入前的選取。
 * - 展開／收合與勾選分開，收合不會清掉選取。
 */
export interface ExportDialogState {
  format: ExportFormat;
  scope: ExportScope;
  /** 已確定的自選章節（章與幕的代號）。 */
  selected: ReadonlySet<string>;
  view: 'menu' | 'picker';
  /** 自選清單開著時正在改的那一份。 */
  draft: ReadonlySet<string>;
  /** 自選清單裡收合起來的節點（預設全部展開）。 */
  collapsed: ReadonlySet<string>;
  busy: boolean;
  /** 白話提示（無章、未選、無法匯出）。 */
  message: 'no-chapters' | 'empty-selection' | 'device-fail' | null;
  /** 手勢失效時已備妥、等使用者再點「儲存檔案」的檔案。 */
  prepared: PreparedExport | null;
}

export type ExportDialogEvent =
  | { type: 'format'; format: ExportFormat }
  | { type: 'scope'; scope: ExportScope }
  | { type: 'open-picker' }
  | { type: 'toggle-node'; node: ChapterNode }
  | { type: 'select-all'; nodes: readonly ChapterNode[] }
  | { type: 'select-none' }
  | { type: 'toggle-expand'; id: string }
  | { type: 'picker-done' }
  | { type: 'picker-cancel' }
  | { type: 'start' }
  | { type: 'finish'; outcome: 'delivered' | 'cancelled' | 'failed' | 'empty' | 'busy' | 'needs-gesture'; prepared?: PreparedExport }
  | { type: 'sync-nodes'; nodes: readonly ChapterNode[] };

export function initialExportDialogState(overrides: Partial<ExportDialogState> = {}): ExportDialogState {
  return {
    format: 'docx',
    scope: 'all',
    selected: new Set(),
    view: 'menu',
    draft: new Set(),
    collapsed: new Set(),
    busy: false,
    message: null,
    prepared: null,
    ...overrides,
  };
}

export function exportDialogReducer(state: ExportDialogState, event: ExportDialogEvent): ExportDialogState {
  switch (event.type) {
    case 'format':
      if (state.busy) return state;
      return { ...state, format: event.format, prepared: null, message: null };
    case 'scope':
      if (state.busy) return state;
      return { ...state, scope: event.scope, prepared: null, message: null };
    case 'open-picker':
      if (state.busy) return state;
      return { ...state, view: 'picker', draft: new Set(state.selected), message: null };
    case 'toggle-node':
      return { ...state, draft: toggleSelection(event.node, state.draft) };
    case 'select-all':
      return { ...state, draft: selectAll(event.nodes) };
    case 'select-none':
      return { ...state, draft: new Set() };
    case 'toggle-expand': {
      const collapsed = new Set(state.collapsed);
      if (collapsed.has(event.id)) collapsed.delete(event.id);
      else collapsed.add(event.id);
      return { ...state, collapsed };
    }
    case 'picker-done':
      // 未選任何章時「確定」是停用的；事件仍防守檢查，不套用空選取。
      if (state.draft.size === 0) return state;
      return { ...state, view: 'menu', selected: new Set(state.draft), scope: 'selected', prepared: null };
    case 'picker-cancel':
      return { ...state, view: 'menu', draft: new Set(state.selected) };
    case 'start':
      return { ...state, busy: true, message: null };
    case 'finish':
      if (event.outcome === 'needs-gesture') return { ...state, busy: false, prepared: event.prepared ?? null };
      if (event.outcome === 'failed') return { ...state, busy: false, prepared: null, message: 'device-fail' };
      if (event.outcome === 'empty') {
        return { ...state, busy: false, prepared: null, message: state.scope === 'selected' ? 'empty-selection' : 'no-chapters' };
      }
      // 取消：安靜回到原選單；成功：由畫面關閉選單。
      return { ...state, busy: false, prepared: null };
    case 'sync-nodes':
      return {
        ...state,
        selected: pruneSelection(event.nodes, state.selected),
        draft: pruneSelection(event.nodes, state.draft),
      };
  }
}

/** 「匯出」按鈕要不要停用：處理中、沒有章、或自選卻還沒選。 */
export function exportDisabled(state: ExportDialogState, nodes: readonly ChapterNode[]): boolean {
  if (state.busy) return true;
  if (!hasExportableChapter(nodes)) return true;
  return state.scope === 'selected' && state.selected.size === 0;
}

/** 選單上要顯示的提示（不按也看得到的那種）。 */
export function standingMessage(state: ExportDialogState, nodes: readonly ChapterNode[]): ExportDialogState['message'] {
  if (state.message) return state.message;
  if (!hasExportableChapter(nodes)) return 'no-chapters';
  if (state.scope === 'selected' && state.selected.size === 0) return 'empty-selection';
  return null;
}

/** 已選了幾章、幾幕（依完整目錄計算）。 */
export function countSelected(nodes: readonly ChapterNode[], selected: ReadonlySet<string>): { chapters: number; scenes: number } {
  let chapters = 0;
  let scenes = 0;
  const walk = (list: readonly ChapterNode[]) => {
    for (const node of list) {
      if (selected.has(node.id)) {
        if (node.type === 'file') chapters += 1;
        if (node.type === 'scene') scenes += 1;
      }
      walk(node.children ?? []);
    }
  };
  walk(nodes);
  return { chapters, scenes };
}

export interface PickerRow {
  node: ChapterNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/**
 * 自選清單要畫出來的列：依目錄順序，收合的節點不畫子列（但子列的選取仍保留）。
 * 這只決定畫面，匯出內容一律走完整目錄（見 domain/fullTextExport.planExport）。
 */
export function pickerRows(nodes: readonly ChapterNode[], collapsed: ReadonlySet<string>): PickerRow[] {
  const rows: PickerRow[] = [];
  const walk = (list: readonly ChapterNode[], depth: number) => {
    for (const node of list) {
      const hasChildren = Boolean(node.children?.length);
      const expanded = hasChildren && !collapsed.has(node.id);
      rows.push({ node, depth, hasChildren, expanded });
      if (expanded) walk(node.children ?? [], depth + 1);
    }
  };
  walk(nodes, 0);
  return rows;
}
