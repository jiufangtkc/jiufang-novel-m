/**
 * WO-140 第 4 段：回到舊版與產品層「復原」的執行流程（不含畫面）。
 *
 * 比照 src/editor/formatFlow.ts 的設計：
 *   確認非唯讀、非過期、非組字 → 讀取 live draft → 先自動保存並確認成功（失敗絕不換正文）→
 *   再次確認期間未換章／未改字／未組字 → 以 replaceText(target.content, 0, { countForToday: false }) 替換正文 →
 *   寫入記憶體復原快照 versionRestoreUndo（同時清除 formatUndo）。
 * 全程不走 paste／beforeinput，也不呼叫 noteLarge 或觸發刪稿暫存區。
 */
import type { ChapterNode } from '../data/demo';
import { findNode } from '../data/demo';
import {
  MANUSCRIPT_VERSION_AUTO_NOTE,
  type CreateManuscriptVersionInput,
  type ManuscriptVersion,
  type SaveAutoVersionResult,
} from '../domain/manuscriptVersions';
import { isWritableNodeType } from '../domain/trash';

/** 最近一次回到舊版前的復原快照。只放記憶體，不寫入任何儲存格式、不進 .db。 */
export interface VersionRestoreUndoSnapshot {
  projectId: string;
  chapterId: string;
  targetVersionId: string;
  autoSavedVersionId: string;
  /** 回到舊版當下的 live draft 全文（按「復原」時還原回此內容） */
  beforeContent: string;
  /** 換上的舊版正文 */
  afterContent: string;
}

export type AutoSaveBeforeRestoreOutcome =
  | (SaveAutoVersionResult & { persisted: boolean })
  | { kind: 'read-only'; persisted: false };

export interface VersionRestoreFlowDeps {
  /** 目前稿子最新的節點樹；稿子不在了回 null */
  getNodes: () => readonly ChapterNode[] | null;
  /** 目前開著章幕的寫作框最新文字；沒有寫作框回 null */
  readLive: () => string | null;
  /** 目前是否正在組字（IME） */
  isComposing: () => boolean;
  /** 稿子版本附加表是否為唯讀（newer-revision 或 corrupt） */
  isReadOnly: () => boolean;
  /** 若可取得當下作用中的 projectId／chapterId，用於非同步存版期間防呆核對 */
  getCurrentProjectId?: () => string | null;
  getCurrentChapterId?: () => string | null;
  /** 回到舊版前先自動保存目前樣子並確認落盤 */
  saveAutoBeforeRestore: (
    input: Omit<CreateManuscriptVersionInput, 'source' | 'version_id' | 'saved_at_ms'>,
  ) => Promise<AutoSaveBeforeRestoreOutcome>;
  /** 把目前開著章幕的正文框整段換成新字，caret 置於 0，且預設不計入今日字數。組字中回 false。 */
  replaceText: (next: string, caret: number, options?: { countForToday?: boolean }) => boolean;
  /** 寫入記憶體復原快照（同時會清除殘留的 formatUndo） */
  setRestoreUndo: (snapshot: VersionRestoreUndoSnapshot) => void;
  /** 清除記憶體復原快照 */
  clearRestoreUndo: () => void;
  /** 換上舊版或復原後重掃（例如半形標點提醒重掃） */
  onAfterApplyOrUndo?: () => void;
}

export interface VersionRestoreRequest {
  projectId: string;
  currentId: string;
  /** 開啟版本流程時的稿子與章幕；和現在不同就取消 */
  openedProjectId: string;
  openedChapterId: string;
  targetVersion: ManuscriptVersion;
}

export type VersionRestoreOutcome =
  | {
      status: 'restored';
      snapshot: VersionRestoreUndoSnapshot;
      autoSave: Extract<SaveAutoVersionResult, { kind: 'saved' | 'reused-latest' }> & {
        persisted: true;
      };
      overLimit: boolean;
    }
  | { status: 'composing' }
  | { status: 'read-only' }
  | { status: 'no-target' }
  | { status: 'stale' }
  | { status: 'auto-save-failed'; reason?: 'blocked-full' };

/**
 * 執行「回到舊版」流程：
 * 1. 先檢查 stale／唯讀／目標章幕是否存在／是否組字中。
 * 2. 讀取 live draft，先執行自動保存並等待確認落盤成功（失敗絕不換正文）。
 * 3. 非同步返回後再次確認未換稿、未換章、未在期間改字、未進入組字。
 * 4. 以 replaceText(target.content, 0, { countForToday: false }) 只替換正文，不動章名與今日字數。
 * 5. 建立 versionRestoreUndo 快照（並清除互斥的 formatUndo）。
 */
export async function executeVersionRestore(
  deps: VersionRestoreFlowDeps,
  request: VersionRestoreRequest,
): Promise<VersionRestoreOutcome> {
  if (
    request.openedProjectId !== request.projectId ||
    request.openedChapterId !== request.currentId
  ) {
    return { status: 'stale' };
  }
  if (deps.isReadOnly()) {
    return { status: 'read-only' };
  }

  const nodes = deps.getNodes();
  const node = nodes ? findNode(nodes, request.currentId) : null;
  if (!node || !isWritableNodeType(node.type) || request.targetVersion.chapter_id !== request.currentId) {
    return { status: 'no-target' };
  }
  if (deps.isComposing()) {
    return { status: 'composing' };
  }

  const liveBefore = deps.readLive();
  const beforeContent = liveBefore !== null ? liveBefore : (node.content ?? '');

  let autoResult: AutoSaveBeforeRestoreOutcome;
  try {
    autoResult = await deps.saveAutoBeforeRestore({
      chapter_id: request.currentId,
      chapter_title_snapshot: node.title ?? '',
      content: beforeContent,
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
    });
  } catch {
    return { status: 'auto-save-failed' };
  }

  if (autoResult.kind === 'read-only') {
    return { status: 'read-only' };
  }
  if (autoResult.kind === 'blocked-full') {
    return { status: 'auto-save-failed', reason: 'blocked-full' };
  }
  if (!autoResult.persisted) {
    return { status: 'auto-save-failed' };
  }

  // 自動保存期間若有換稿、換章、刪章或編輯正文，立即中止，不覆寫新內容。
  if (
    (deps.getCurrentProjectId && deps.getCurrentProjectId() !== request.openedProjectId) ||
    (deps.getCurrentChapterId && deps.getCurrentChapterId() !== request.openedChapterId)
  ) {
    return { status: 'stale' };
  }
  const nodesAfter = deps.getNodes();
  const nodeAfter = nodesAfter ? findNode(nodesAfter, request.currentId) : null;
  if (!nodeAfter || !isWritableNodeType(nodeAfter.type)) {
    return { status: 'no-target' };
  }
  const liveAfter = deps.readLive();
  if (liveBefore !== null) {
    if (liveAfter !== liveBefore) return { status: 'stale' };
  } else if ((nodeAfter.content ?? '') !== beforeContent) {
    return { status: 'stale' };
  }
  if (deps.isComposing()) {
    return { status: 'composing' };
  }

  const replaced = deps.replaceText(request.targetVersion.content, 0, {
    countForToday: false,
  });
  if (!replaced) {
    return { status: 'composing' };
  }

  const snapshot: VersionRestoreUndoSnapshot = {
    projectId: request.projectId,
    chapterId: request.currentId,
    targetVersionId: request.targetVersion.version_id,
    autoSavedVersionId: autoResult.version.version_id,
    beforeContent,
    afterContent: request.targetVersion.content,
  };
  deps.setRestoreUndo(snapshot);
  deps.onAfterApplyOrUndo?.();

  return {
    status: 'restored',
    snapshot,
    autoSave: { ...autoResult, persisted: true },
    overLimit: autoResult.overLimit,
  };
}

export type VersionRestoreUndoOutcome =
  | { status: 'restored'; snapshot: VersionRestoreUndoSnapshot }
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'composing' };

/**
 * 執行產品層「復原」：
 * - 換成舊版後即使在該章新打字仍可復原（連之後新打的字一起還原回 beforeContent）。
 * - 走 replaceText(snapshot.beforeContent, 0, { countForToday: false })，不動今日字數與章名。
 * - 清除 versionRestoreUndo，但保留剛才那則自動保存版本不刪除。
 */
export function executeVersionRestoreUndo(
  deps: Pick<
    VersionRestoreFlowDeps,
    'getNodes' | 'isComposing' | 'replaceText' | 'clearRestoreUndo' | 'onAfterApplyOrUndo'
  >,
  input: {
    projectId: string;
    currentId: string;
    snapshot: VersionRestoreUndoSnapshot | null | undefined;
  },
): VersionRestoreUndoOutcome {
  const { snapshot } = input;
  if (!snapshot || snapshot.projectId !== input.projectId) {
    return { status: 'none' };
  }
  const nodes = deps.getNodes();
  const node = nodes ? findNode(nodes, snapshot.chapterId) : null;
  if (!node || !isWritableNodeType(node.type)) {
    deps.clearRestoreUndo();
    return { status: 'invalid' };
  }
  if (input.currentId !== snapshot.chapterId) {
    return { status: 'none' };
  }
  if (deps.isComposing()) {
    return { status: 'composing' };
  }
  const replaced = deps.replaceText(snapshot.beforeContent, 0, {
    countForToday: false,
  });
  if (!replaced) {
    return { status: 'composing' };
  }
  deps.clearRestoreUndo();
  deps.onAfterApplyOrUndo?.();
  return { status: 'restored', snapshot };
}
