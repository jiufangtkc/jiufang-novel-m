/**
 * WO-122：排版範圍與復原快照的純函式。不操作 DOM、不讀 store、不寫儲存。
 * 只改章（file）與幕（scene）的 content；資料夾、標題、順序、卡片等一律不碰。
 */
import type { ChapterNode } from '../data/demo';
import { findNode } from '../data/demo';
import { formatText, type FormatKind } from './formatText';

export type FormatScope = 'chapter' | 'book';

export interface FormatChange {
  nodeId: string;
  /** 排版前的完整正文（以使用者眼前最新的字為準） */
  before: string;
  after: string;
}

export interface FormatSnapshotEntry {
  nodeId: string;
  before: string;
}

/** 最近一次有效排版。只放記憶體，不寫入任何儲存格式。 */
export interface FormatSnapshot {
  projectId: string;
  kind: FormatKind;
  scope: FormatScope;
  /** 只含本次有變更的章幕 */
  entries: FormatSnapshotEntry[];
}

export type FormatPlan =
  | { status: 'ok'; changes: FormatChange[] }
  /** 目前章幕不存在，或不是章／幕 */
  | { status: 'no-target' };

export function isWritableNode(node: ChapterNode | null | undefined): node is ChapterNode {
  return Boolean(node) && (node!.type === 'file' || node!.type === 'scene');
}

/** 遞迴走過所有層級（章本身與其下的幕都算），依樹的順序列出章與幕。 */
export function collectWritableNodes(nodes: readonly ChapterNode[]): ChapterNode[] {
  const out: ChapterNode[] = [];
  const walk = (list: readonly ChapterNode[]) => {
    for (const node of list) {
      if (isWritableNode(node)) out.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * 算出這次排版的完整變更集合（還沒套用）。
 * liveText 是目前開啟章幕寫作框裡最新的字；沒給就用稿子裡存的字。
 * 沒有實質變更的章幕不會進變更集合。
 */
export function planFormat(input: {
  nodes: readonly ChapterNode[];
  currentId: string;
  scope: FormatScope;
  kind: FormatKind;
  liveText?: string | null;
}): FormatPlan {
  const current = findNode(input.nodes, input.currentId);
  if (!isWritableNode(current)) return { status: 'no-target' };
  const targets = input.scope === 'chapter' ? [current] : collectWritableNodes(input.nodes);
  const changes: FormatChange[] = [];
  for (const node of targets) {
    const before =
      node.id === input.currentId && typeof input.liveText === 'string' ? input.liveText : (node.content ?? '');
    const after = formatText(input.kind, before);
    if (after !== before) changes.push({ nodeId: node.id, before, after });
  }
  return { status: 'ok', changes };
}

export function snapshotOf(input: {
  projectId: string;
  kind: FormatKind;
  scope: FormatScope;
  changes: readonly FormatChange[];
}): FormatSnapshot {
  return {
    projectId: input.projectId,
    kind: input.kind,
    scope: input.scope,
    entries: input.changes.map((change) => ({ nodeId: change.nodeId, before: change.before })),
  };
}

export type UndoPlan =
  | { status: 'ok'; entries: FormatSnapshotEntry[] }
  /** 沒有快照、不是這份稿子的快照，或其中有章幕已經不在（整批停止，不做一半） */
  | { status: 'none' }
  | { status: 'invalid' };

export function planUndo(
  snapshot: FormatSnapshot | null | undefined,
  projectId: string,
  nodes: readonly ChapterNode[] | null | undefined,
): UndoPlan {
  if (!snapshot || snapshot.projectId !== projectId) return { status: 'none' };
  if (!nodes) return { status: 'invalid' };
  for (const entry of snapshot.entries) {
    if (!isWritableNode(findNode(nodes, entry.nodeId))) return { status: 'invalid' };
  }
  return { status: 'ok', entries: snapshot.entries.map((entry) => ({ ...entry })) };
}
