/**
 * WO-122：排版與復原的執行流程（不含畫面）。
 *
 * 這裡是排版的「獨立內部入口」：
 *   計算變更集合 → 確認沒有組字 → 同步目前寫作框 → 一次寫入其他章幕與快照。
 * 全程不走 paste、input、beforeinput，也不呼叫 noteLarge；
 * 字數與暫存沿用 store 的 commit-text（目前章幕由寫作框 replaceText 送出，其他章幕由 store 的 format-apply 送出）。
 * 所有相依都由呼叫端傳入，所以可以在 node 環境直接測試。
 */
import type { ChapterNode } from '../data/demo';
import {
  planFormat,
  planUndo,
  snapshotOf,
  type FormatChange,
  type FormatScope,
  type FormatSnapshot,
  type FormatSnapshotEntry,
} from './formatScope';
import type { FormatKind } from './formatText';

export interface FormatFlowDeps {
  /** 目前稿子最新的節點樹；稿子不在了回 null */
  getNodes: () => readonly ChapterNode[] | null;
  /** 目前開著章幕的寫作框最新文字；沒有寫作框回 null */
  readLive: () => string | null;
  isComposing: () => boolean;
  /** 把目前開著章幕的寫作框整段換成新字（同步畫面、內部基準、草稿讀取器，並送出一次 commit-text）。組字中回 false。 */
  syncCurrent: (next: string) => boolean;
  /** 其他章幕：store 一次寫入並放入快照 */
  applyOthers: (changes: FormatChange[], snapshot: FormatSnapshot) => void;
  /** 其他章幕：store 一次還原並清空快照 */
  undoOthers: (entries: FormatSnapshotEntry[]) => void;
  /** 清掉失效快照 */
  clearSnapshot: () => void;
}

export type FormatOutcome =
  | { status: 'applied'; changedCount: number }
  | { status: 'unchanged' }
  | { status: 'composing' }
  /** 章幕已關閉或失效：先打開一章或一幕 */
  | { status: 'no-target' }
  /** 稿子或章幕換了：取消舊流程 */
  | { status: 'stale' };

export interface FormatRequest {
  projectId: string;
  currentId: string;
  /** 開啟流程時的稿子與章幕；和現在不同就取消 */
  openedProjectId: string;
  openedChapterId: string;
  kind: FormatKind;
  scope: FormatScope;
}

export function executeFormat(deps: FormatFlowDeps, request: FormatRequest): FormatOutcome {
  if (request.openedProjectId !== request.projectId || request.openedChapterId !== request.currentId) {
    return { status: 'stale' };
  }
  const nodes = deps.getNodes();
  if (!nodes) return { status: 'no-target' };
  const live = deps.readLive();
  const plan = planFormat({
    nodes,
    currentId: request.currentId,
    scope: request.scope,
    kind: request.kind,
    liveText: live,
  });
  if (plan.status === 'no-target') return { status: 'no-target' };
  // 組字未完成先暫停，不執行半套更新（連無改動也先請使用者打完字，避免判斷到一半的字）。
  if (deps.isComposing()) return { status: 'composing' };
  if (plan.changes.length === 0) return { status: 'unchanged' };

  const snapshot = snapshotOf({
    projectId: request.projectId,
    kind: request.kind,
    scope: request.scope,
    changes: plan.changes,
  });
  const currentChange = live === null ? undefined : plan.changes.find((c) => c.nodeId === request.currentId);
  const others = plan.changes.filter((c) => c !== currentChange);
  if (currentChange && !deps.syncCurrent(currentChange.after)) return { status: 'composing' };
  deps.applyOthers(others, snapshot);
  return { status: 'applied', changedCount: plan.changes.length };
}

export type UndoOutcome =
  | { status: 'restored'; restoredCount: number }
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'composing' };

export function executeUndo(
  deps: FormatFlowDeps,
  input: { projectId: string; currentId: string; snapshot: FormatSnapshot | null | undefined },
): UndoOutcome {
  const plan = planUndo(input.snapshot, input.projectId, deps.getNodes());
  if (plan.status === 'none') return { status: 'none' };
  if (plan.status === 'invalid') {
    deps.clearSnapshot();
    return { status: 'invalid' };
  }
  if (deps.isComposing()) return { status: 'composing' };
  const live = deps.readLive();
  const currentEntry = live === null ? undefined : plan.entries.find((e) => e.nodeId === input.currentId);
  const others = plan.entries.filter((e) => e !== currentEntry);
  if (currentEntry && !deps.syncCurrent(currentEntry.before)) return { status: 'composing' };
  deps.undoOthers(others);
  return { status: 'restored', restoredCount: plan.entries.length };
}
