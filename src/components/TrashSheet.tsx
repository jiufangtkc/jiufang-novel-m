import { useEffect, useState } from 'react';
import {
  TRASH_BACK_LABEL,
  TRASH_CLOSE_ARIA,
  TRASH_CLOSE_LABEL,
  TRASH_COMPOSING_TOAST,
  TRASH_CORRUPT_HINT,
  TRASH_DETAIL_CONTENT_ARIA,
  TRASH_DISCARD_BUTTON,
  TRASH_DISCARD_CANCEL,
  TRASH_DISCARD_CONFIRM_HINT,
  TRASH_DISCARD_CONFIRM_OK,
  TRASH_DISCARD_CONFIRM_TITLE,
  TRASH_DISCARDED_BAR,
  TRASH_EMPTY_HINT,
  TRASH_LIMIT_FULL_EVICTABLE_HINT,
  TRASH_LIMIT_FULL_LOCKED_HINT,
  TRASH_LIMIT_NEAR_HINT,
  TRASH_NEWER_REVISION_HINT,
  TRASH_NO_CHAPTER_AVAILABLE,
  TRASH_PICK_CHAPTER_BUTTON,
  TRASH_PICK_CHAPTER_HINT,
  TRASH_PICK_CHAPTER_TITLE,
  TRASH_PUT_BACK_BUTTON,
  TRASH_REASON_LABEL,
  TRASH_REASON_PLACEHOLDER,
  TRASH_REASON_SAVE,
  TRASH_REASON_SAVED_TOAST,
  TRASH_RESTORED_TOAST,
  TRASH_SHEET_TITLE,
  TRASH_UNDO_BUTTON,
  trashBlockedMessage,
  trashItemWords,
  trashOriginalChapterGone,
  trashSceneTargetLabel,
  trashUsageSummary,
} from '../copy/trashCopy';
import type { ChapterNode } from '../data/demo';
import type { TrashRead } from '../db/trashMeta';
import { formatCalendarDateFromDate } from '../domain/formatCalendarDate';
import { formatClockTime } from '../domain/saveClock';
import {
  appendToChapterEndPlan,
  computePutBackPlan,
  isTrashOriginalNodeAlive,
  listWritableTargetNodes,
  summarizeTrashUsage,
  type TrashInsertResult,
  type TrashItem,
  type TrashPutBackPlan,
} from '../domain/trash';
import type { LayoutMode } from '../layout';

const UNDO_BAR_DURATION_MS = 10_000;
const SHEET_STATUS_DURATION_MS = 3_500;

type SheetView = 'list' | 'detail' | 'pick';

export interface TrashSheetProps {
  open: boolean;
  items: readonly TrashItem[];
  trashRead: TrashRead;
  nodes: readonly ChapterNode[];
  layoutMode: LayoutMode;
  isComposing: () => boolean;
  onClose: () => void;
  onUpdateReason: (itemId: string, reason: string) => void;
  onPutBack: (
    item: TrashItem,
    targetNodeId: string,
    plan: TrashPutBackPlan,
    isPicked: boolean,
  ) => boolean | void;
  onDiscard: (item: TrashItem) => void;
  onUndoDiscard: (item: TrashItem) => TrashInsertResult | void;
  onToast?: (message: string) => void;
}

function formatTrashTime(deletedAtMs: number): string {
  const date = new Date(deletedAtMs);
  return `${formatCalendarDateFromDate(date)} ${formatClockTime(date)}`;
}

function previewSnippet(content: string): string {
  return content.trim().replace(/\s+/g, ' ');
}

/**
 * WO-138：刪稿暫存區底部清單（列表、空狀態、上限提示、詳情全文、補／改原因、放回原章／選章、丟掉確認與 10 秒復原條）。
 */
export function TrashSheet({
  open,
  items,
  trashRead,
  nodes,
  layoutMode,
  isComposing,
  onClose,
  onUpdateReason,
  onPutBack,
  onDiscard,
  onUndoDiscard,
}: TrashSheetProps) {
  const [view, setView] = useState<SheetView>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<{ item: TrashItem; token: number } | null>(null);
  const [sheetStatus, setSheetStatus] = useState<{ message: string; token: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setView('list');
      setSelectedId(null);
      setReasonDraft('');
      setConfirmDiscardId(null);
      setUndoState(null);
      setSheetStatus(null);
    }
  }, [open]);

  useEffect(() => {
    if (!undoState) return;
    const timer = window.setTimeout(() => {
      setUndoState((prev) => (prev && prev.token === undoState.token ? null : prev));
    }, UNDO_BAR_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [undoState]);

  useEffect(() => {
    if (!sheetStatus) return;
    const timer = window.setTimeout(() => {
      setSheetStatus((prev) => (prev && prev.token === sheetStatus.token ? null : prev));
    }, SHEET_STATUS_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [sheetStatus]);

  const showSheetStatus = (message: string) => {
    setSheetStatus({ message, token: Date.now() });
  };

  // 中／寬版支援 Esc 關閉（排除組字中）
  useEffect(() => {
    if (!open) return;
    if (layoutMode !== 'medium' && layoutMode !== 'wide') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      if (confirmDiscardId) {
        setConfirmDiscardId(null);
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, layoutMode, confirmDiscardId, onClose]);

  if (!open) return null;

  const isReadOnly = trashRead.kind === 'newer-revision' || trashRead.kind === 'corrupt';
  const selectedItem = selectedId ? items.find((item) => item.itemId === selectedId) ?? null : null;
  const activeView: SheetView = selectedItem ? view : 'list';
  const confirmItem = confirmDiscardId
    ? items.find((item) => item.itemId === confirmDiscardId) ?? null
    : null;
  const usage = summarizeTrashUsage(items);

  const openDetail = (item: TrashItem) => {
    setSelectedId(item.itemId);
    setReasonDraft(item.reason);
    setView('detail');
  };

  const handleBack = () => {
    if (activeView === 'pick') {
      setView('detail');
    } else {
      setSelectedId(null);
      setView('list');
    }
  };

  const handleSaveReason = () => {
    if (!selectedItem || isReadOnly) return;
    onUpdateReason(selectedItem.itemId, reasonDraft.trim());
    showSheetStatus(TRASH_REASON_SAVED_TOAST);
  };

  const handlePutBackOriginal = () => {
    if (!selectedItem) return;
    if (isComposing()) {
      showSheetStatus(TRASH_COMPOSING_TOAST);
      return;
    }
    const alive = isTrashOriginalNodeAlive(nodes, selectedItem.chapterId);
    if (!alive) {
      setView('pick');
      return;
    }
    const plan = computePutBackPlan(alive.content ?? '', selectedItem);
    if (onPutBack(selectedItem, alive.id, plan, false) === false) {
      showSheetStatus(TRASH_COMPOSING_TOAST);
    }
  };

  const handleConfirmDiscard = () => {
    if (!confirmItem) return;
    onDiscard(confirmItem);
    setUndoState({ item: confirmItem, token: Date.now() });
    setConfirmDiscardId(null);
    setSelectedId(null);
    setView('list');
  };

  const handleUndoDiscard = () => {
    if (!undoState) return;
    const item = undoState.item;
    setUndoState(null);
    const result = onUndoDiscard(item);
    if (result) {
      showSheetStatus(
        result.kind === 'added' ? TRASH_RESTORED_TOAST : trashBlockedMessage(result.reason),
      );
    }
  };

  const renderChapterLabel = (item: TrashItem): string => {
    const alive = isTrashOriginalNodeAlive(nodes, item.chapterId);
    if (alive) return alive.title;
    return trashOriginalChapterGone(item.chapterTitleSnapshot);
  };

  const renderLimitHint = (): string | null => {
    if (usage.atLimit) {
      return usage.hasEvictable ? TRASH_LIMIT_FULL_EVICTABLE_HINT : TRASH_LIMIT_FULL_LOCKED_HINT;
    }
    if (usage.nearLimit) {
      return TRASH_LIMIT_NEAR_HINT;
    }
    return null;
  };

  const limitHint = renderLimitHint();
  const writableTargets = activeView === 'pick' ? listWritableTargetNodes(nodes) : [];

  return (
    <div
      className="sheet-backdrop trash-sheet-backdrop"
      role="presentation"
      data-testid="trash-sheet-backdrop"
      onClick={onClose}
    >
      <div
        className="sheet trash-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trash-sheet-title"
        data-testid="trash-sheet"
        data-layout={layoutMode}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="trash-sheet-header">
          {activeView !== 'list' ? (
            <button
              type="button"
              className="trash-header-btn"
              data-testid="trash-back"
              onClick={handleBack}
            >
              {TRASH_BACK_LABEL}
            </button>
          ) : null}
          <h2 id="trash-sheet-title" className="trash-sheet-title">
            {activeView === 'pick' ? TRASH_PICK_CHAPTER_TITLE : TRASH_SHEET_TITLE}
          </h2>
          <button
            type="button"
            className="trash-header-btn"
            aria-label={TRASH_CLOSE_ARIA}
            data-testid="trash-close"
            onClick={onClose}
          >
            {TRASH_CLOSE_LABEL}
          </button>
        </header>

        {sheetStatus ? (
          <div
            className="trash-sheet-status"
            role="status"
            aria-live="polite"
            data-testid="trash-sheet-status"
          >
            {sheetStatus.message}
          </div>
        ) : null}

        <div className="trash-sheet-body">
          {trashRead.kind === 'newer-revision' ? (
            <p className="trash-status-banner is-warning" data-testid="trash-newer-revision-hint">
              {TRASH_NEWER_REVISION_HINT}
            </p>
          ) : null}
          {trashRead.kind === 'corrupt' ? (
            <p className="trash-status-banner is-danger" data-testid="trash-corrupt-hint">
              {TRASH_CORRUPT_HINT}
            </p>
          ) : null}

          {activeView === 'list' && !isReadOnly ? (
            <>
              {undoState ? (
                <div className="undo-bar trash-undo-bar" data-testid="trash-undo-bar" key={undoState.token}>
                  <span>{TRASH_DISCARDED_BAR}</span>
                  <button
                    type="button"
                    data-testid="trash-undo-btn"
                    onClick={handleUndoDiscard}
                  >
                    {TRASH_UNDO_BUTTON}
                  </button>
                  <span className="undo-meter" />
                </div>
              ) : null}

              {items.length > 0 ? (
                <div className="trash-usage-box">
                  <p className="trash-usage-summary" data-testid="trash-usage-summary">
                    {trashUsageSummary(usage.count, usage.totalWords)}
                  </p>
                  {limitHint ? (
                    <p
                      className={
                        usage.atLimit && !usage.hasEvictable
                          ? 'trash-limit-hint is-locked'
                          : 'trash-limit-hint'
                      }
                      data-testid="trash-limit-hint"
                    >
                      {limitHint}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {items.length === 0 ? (
                <p className="hint trash-empty" data-testid="trash-empty">
                  {TRASH_EMPTY_HINT}
                </p>
              ) : (
                <ul className="trash-list" data-testid="trash-list">
                  {items.map((item) => (
                    <li key={item.itemId} className="trash-list-item">
                      <button
                        type="button"
                        className="trash-item-btn"
                        data-testid={`trash-item-${item.itemId}`}
                        onClick={() => openDetail(item)}
                      >
                        <div className="trash-item-top">
                          <span className="trash-item-chapter">{renderChapterLabel(item)}</span>
                          <span className="trash-item-words">{trashItemWords(item.wordCount)}</span>
                        </div>
                        <p className="trash-item-preview">{previewSnippet(item.content)}</p>
                        <div className="trash-item-meta">
                          <span>{formatTrashTime(item.deletedAtMs)}</span>
                          {item.reason.trim() !== '' ? (
                            <span
                              className="trash-item-reason"
                              data-testid={`trash-item-reason-${item.itemId}`}
                            >
                              {item.reason.trim()}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {activeView === 'detail' && selectedItem && !isReadOnly ? (
            <div className="trash-detail" data-testid="trash-detail">
              <div className="trash-detail-meta">
                <span>{renderChapterLabel(selectedItem)}</span>
                <span>·</span>
                <span>{trashItemWords(selectedItem.wordCount)}</span>
                <span>·</span>
                <span>{formatTrashTime(selectedItem.deletedAtMs)}</span>
              </div>

              <textarea
                className="version-preview trash-detail-content"
                readOnly
                value={selectedItem.content}
                aria-label={TRASH_DETAIL_CONTENT_ARIA}
                data-testid="trash-detail-content"
              />

              <div className="trash-reason-box">
                <label htmlFor="trash-reason-input" className="trash-reason-label">
                  {TRASH_REASON_LABEL}
                </label>
                <div className="trash-reason-row">
                  <textarea
                    id="trash-reason-input"
                    rows={2}
                    className="trash-reason-input"
                    value={reasonDraft}
                    placeholder={TRASH_REASON_PLACEHOLDER}
                    data-testid="trash-reason-input"
                    onChange={(event) => setReasonDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button secondary trash-reason-save"
                    data-testid="trash-reason-save"
                    onClick={handleSaveReason}
                  >
                    {TRASH_REASON_SAVE}
                  </button>
                </div>
              </div>

              <div className="dialog-actions trash-detail-actions">
                {isTrashOriginalNodeAlive(nodes, selectedItem.chapterId) ? (
                  <button
                    type="button"
                    className="button primary"
                    data-testid="trash-put-back"
                    onClick={handlePutBackOriginal}
                  >
                    {TRASH_PUT_BACK_BUTTON}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button primary"
                    data-testid="trash-pick-chapter"
                    onClick={() => setView('pick')}
                  >
                    {TRASH_PICK_CHAPTER_BUTTON}
                  </button>
                )}
                <button
                  type="button"
                  className="button danger"
                  data-testid="trash-discard"
                  onClick={() => setConfirmDiscardId(selectedItem.itemId)}
                >
                  {TRASH_DISCARD_BUTTON}
                </button>
              </div>
            </div>
          ) : null}

          {activeView === 'pick' && selectedItem && !isReadOnly ? (
            <div className="trash-pick" data-testid="trash-pick">
              <p className="hint">{TRASH_PICK_CHAPTER_HINT}</p>
              {writableTargets.length === 0 ? (
                <p className="hint trash-empty" data-testid="trash-no-chapter">
                  {TRASH_NO_CHAPTER_AVAILABLE}
                </p>
              ) : (
                <div className="menu-list trash-pick-list">
                  {writableTargets.map((target) => {
                    const label = target.parentChapterTitle
                      ? trashSceneTargetLabel(target.parentChapterTitle, target.chapterTitle)
                      : target.chapterTitle;
                    return (
                      <button
                        key={target.node.id}
                        type="button"
                        className="menu-item trash-pick-item"
                        data-testid={`trash-pick-target-${target.node.id}`}
                        onClick={() => {
                          if (isComposing()) {
                            showSheetStatus(TRASH_COMPOSING_TOAST);
                            return;
                          }
                          const plan = appendToChapterEndPlan(
                            target.node.content ?? '',
                            selectedItem.content,
                            'end',
                          );
                          if (onPutBack(selectedItem, target.node.id, plan, true) === false) {
                            showSheetStatus(TRASH_COMPOSING_TOAST);
                          }
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {confirmItem ? (
        <div
          className="sheet-backdrop trash-confirm-backdrop"
          role="presentation"
          data-testid="trash-discard-backdrop"
          onClick={(event) => {
            event.stopPropagation();
            setConfirmDiscardId(null);
          }}
        >
          <div
            className="dialog trash-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="trash-discard-title"
            data-testid="trash-discard-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="trash-discard-title">{TRASH_DISCARD_CONFIRM_TITLE}</h3>
            <p className="hint">{TRASH_DISCARD_CONFIRM_HINT}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                data-testid="trash-discard-cancel"
                onClick={() => setConfirmDiscardId(null)}
              >
                {TRASH_DISCARD_CANCEL}
              </button>
              <button
                type="button"
                className="button danger"
                data-testid="trash-discard-confirm"
                onClick={handleConfirmDiscard}
              >
                {TRASH_DISCARD_CONFIRM_OK}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
