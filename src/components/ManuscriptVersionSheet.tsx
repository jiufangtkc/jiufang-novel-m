import { useEffect, useMemo, useState } from 'react';
import {
  VERSION_AUTO_SAVE_FAIL_TOAST,
  VERSION_BACK_LABEL,
  VERSION_CANCEL_LABEL,
  VERSION_CLOSE_ARIA,
  VERSION_CLOSE_LABEL,
  VERSION_COMPARE_BUTTON,
  VERSION_COMPARE_TITLE,
  VERSION_CORRUPT_HINT,
  VERSION_DISCARDED_BAR,
  VERSION_DISCARD_BUTTON,
  VERSION_DISCARD_CONFIRM_HINT,
  VERSION_DISCARD_CONFIRM_TITLE,
  VERSION_DISCARD_UNDONE_HINT,
  VERSION_DUPLICATE_HINT,
  VERSION_EDIT_NOTE_LABEL,
  VERSION_EDIT_NOTE_SAVE,
  VERSION_EDIT_NOTE_SAVED_HINT,
  VERSION_EMPTY_HINT,
  VERSION_EVICTED_HINT,
  VERSION_FULL_LOCKED_HINT,
  VERSION_NEWER_REVISION_HINT,
  VERSION_NOTE_HINT,
  VERSION_NOTE_PLACEHOLDER,
  VERSION_OVER_LIMIT_HINT,
  VERSION_PREVIEW_BUTTON,
  VERSION_PREVIEW_CONTENT_ARIA,
  VERSION_PREVIEW_READONLY_HINT,
  VERSION_READONLY_TOAST,
  VERSION_RESTORE_BLOCKED_FULL_HINT,
  VERSION_RESTORE_BUTTON,
  VERSION_RESTORE_COMPOSING_TOAST,
  VERSION_RESTORE_CONFIRM_BODY,
  VERSION_RESTORE_CONFIRM_TITLE,
  VERSION_RESTORE_NO_TARGET_TOAST,
  VERSION_RESTORE_STALE_TOAST,
  VERSION_SAVED_TOAST,
  VERSION_SAVE_BUTTON,
  VERSION_SAVE_COMPOSING_TOAST,
  VERSION_SAVE_STASH_FAIL_HINT,
  VERSION_SHEET_TITLE,
  VERSION_UNDO_BUTTON,
  versionCompareButtonAria,
  versionUsageSummary,
  versionWordsLabel,
} from '../copy/manuscriptVersionCopy';
import type { ChapterVersionRead } from '../db/chapterVersionMeta';
import type { VersionRestoreOutcome } from '../editor/versionRestoreFlow';
import { formatCalendarDateFromDate } from '../domain/formatCalendarDate';
import {
  sortManuscriptVersions,
  summarizeChapterVersions,
  type ManuscriptVersion,
} from '../domain/manuscriptVersions';
import { formatClockTime } from '../domain/saveClock';
import { compareChapterVersions } from '../domain/versionCompare';
import type { LayoutMode } from '../layout';
import { VersionCompareView, resolveOpenCompareAttempt } from './VersionCompareView';

const UNDO_BAR_DURATION_MS = 10_000;
const SHEET_STATUS_DURATION_MS = 3_500;

type SheetView = 'list' | 'preview' | 'compare';

export type SaveVersionActionResult =
  | { kind: 'saved'; noticeCode: 'saved' | 'saved-evicted-oldest'; persisted?: boolean }
  | { kind: 'duplicate'; persisted?: boolean }
  | { kind: 'blocked-full' }
  | { kind: 'composing' }
  | { kind: 'read-only' };

export type UpdateVersionNoteActionResult =
  | { kind: 'updated' }
  | { kind: 'read-only' }
  | { kind: 'not-found' };

export type DiscardVersionActionResult =
  | { kind: 'discarded' }
  | { kind: 'read-only' }
  | { kind: 'not-found' };

export type UndoDiscardVersionActionResult =
  | { kind: 'restored' }
  | { kind: 'already-exists' }
  | { kind: 'blocked-full' }
  | { kind: 'read-only' };

export interface ManuscriptVersionSheetProps {
  open: boolean;
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  versions: readonly ManuscriptVersion[];
  versionRead: ChapterVersionRead;
  layoutMode: LayoutMode;
  isComposing: () => boolean;
  getCurrentContent?: () => string;
  onClose: () => void;
  onSaveVersion: (note: string) => Promise<SaveVersionActionResult>;
  onUpdateNote: (versionId: string, note: string) => Promise<UpdateVersionNoteActionResult>;
  onDiscard: (version: ManuscriptVersion) => Promise<DiscardVersionActionResult>;
  onUndoDiscard: (version: ManuscriptVersion) => Promise<UndoDiscardVersionActionResult>;
  onRestoreVersion: (version: ManuscriptVersion) => Promise<VersionRestoreOutcome>;
}

function formatVersionTime(savedAtMs: number): string {
  const date = new Date(savedAtMs);
  return `${formatCalendarDateFromDate(date)} ${formatClockTime(date)}`;
}

export function resolveSaveVersionFeedback(res: SaveVersionActionResult): {
  message: string;
  clearDraft: boolean;
} {
  if (res.kind === 'saved') {
    if (res.persisted === false) {
      return { message: VERSION_SAVE_STASH_FAIL_HINT, clearDraft: false };
    }
    return {
      message:
        res.noticeCode === 'saved-evicted-oldest' ? VERSION_EVICTED_HINT : VERSION_SAVED_TOAST,
      clearDraft: true,
    };
  }
  if (res.kind === 'duplicate') {
    if (res.persisted === false) {
      return { message: VERSION_SAVE_STASH_FAIL_HINT, clearDraft: false };
    }
    if (res.persisted === true) {
      return { message: VERSION_SAVED_TOAST, clearDraft: true };
    }
    return { message: VERSION_DUPLICATE_HINT, clearDraft: false };
  }
  if (res.kind === 'blocked-full') {
    return { message: VERSION_FULL_LOCKED_HINT, clearDraft: false };
  }
  if (res.kind === 'composing') {
    return { message: VERSION_SAVE_COMPOSING_TOAST, clearDraft: false };
  }
  return { message: VERSION_READONLY_TOAST, clearDraft: false };
}

export function restoreOutcomeHint(
  outcome: Exclude<VersionRestoreOutcome, { status: 'restored' }>,
): string {
  switch (outcome.status) {
    case 'composing':
      return VERSION_RESTORE_COMPOSING_TOAST;
    case 'auto-save-failed':
      return outcome.reason === 'blocked-full'
        ? VERSION_RESTORE_BLOCKED_FULL_HINT
        : VERSION_AUTO_SAVE_FAIL_TOAST;
    case 'read-only':
      return VERSION_READONLY_TOAST;
    case 'stale':
      return VERSION_RESTORE_STALE_TOAST;
    case 'no-target':
      return VERSION_RESTORE_NO_TARGET_TOAST;
  }
}

/**
 * WO-140 第 5 段：稿子版本底部清單（存成版本、備註、唯讀預覽、補／改備註、丟掉確認與 10 秒復原、「用這一版」確認與四態唯讀保護）。
 */
export function ManuscriptVersionSheet({
  open,
  projectId,
  chapterId,
  chapterTitle,
  versions,
  versionRead,
  layoutMode,
  isComposing,
  getCurrentContent,
  onClose,
  onSaveVersion,
  onUpdateNote,
  onDiscard,
  onUndoDiscard,
  onRestoreVersion,
}: ManuscriptVersionSheetProps) {
  const [view, setView] = useState<SheetView>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareTargetText, setCompareTargetText] = useState('');
  const [expandedBlockIds, setExpandedBlockIds] = useState<ReadonlySet<string>>(() => new Set());
  const [saveNoteDraft, setSaveNoteDraft] = useState('');
  const [editNoteDraft, setEditNoteDraft] = useState('');
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<{ version: ManuscriptVersion; token: number } | null>(
    null,
  );
  const [sheetStatus, setSheetStatus] = useState<{ message: string; token: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setView('list');
      setSelectedId(null);
      setCompareTargetText('');
      setExpandedBlockIds(new Set());
      setSaveNoteDraft('');
      setEditNoteDraft('');
      setConfirmDiscardId(null);
      setConfirmRestoreId(null);
      setUndoState(null);
      setSheetStatus(null);
      setBusy(false);
    }
  }, [open, projectId, chapterId]);

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
      if (confirmRestoreId) {
        setConfirmRestoreId(null);
      } else if (confirmDiscardId) {
        setConfirmDiscardId(null);
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, layoutMode, confirmDiscardId, confirmRestoreId, onClose]);

  const isReadOnly =
    versionRead.kind === 'newer-revision' || versionRead.kind === 'corrupt';
  const sortedVersions = sortManuscriptVersions(versions);
  const selectedVersion = selectedId
    ? sortedVersions.find((item) => item.version_id === selectedId) ?? null
    : null;
  const activeView: SheetView = selectedVersion ? view : 'list';
  const compareResult = useMemo(() => {
    if (!open || activeView !== 'compare' || !selectedVersion) return null;
    return compareChapterVersions(selectedVersion.content, compareTargetText);
  }, [open, activeView, selectedVersion, compareTargetText]);

  if (!open) return null;

  const confirmDiscardVersion = confirmDiscardId
    ? sortedVersions.find((item) => item.version_id === confirmDiscardId) ?? null
    : null;
  const confirmRestoreVersion = confirmRestoreId
    ? sortedVersions.find((item) => item.version_id === confirmRestoreId) ?? null
    : null;
  const summary = summarizeChapterVersions(sortedVersions, chapterId);

  const openPreview = (version: ManuscriptVersion) => {
    setSelectedId(version.version_id);
    setEditNoteDraft(version.note);
    setView('preview');
  };

  const openCompare = (version: ManuscriptVersion) => {
    const attempt = resolveOpenCompareAttempt(isComposing);
    if (!attempt.allowed) {
      showSheetStatus(attempt.message);
      return;
    }
    setSelectedId(version.version_id);
    setCompareTargetText(getCurrentContent ? getCurrentContent() : '');
    setExpandedBlockIds(new Set());
    setView('compare');
  };

  const handleExpandCompareBlock = (blockId: string) => {
    setExpandedBlockIds((prev) => {
      if (prev.has(blockId)) return prev;
      const next = new Set(prev);
      next.add(blockId);
      return next;
    });
  };

  const handleBack = () => {
    setSelectedId(null);
    setExpandedBlockIds(new Set());
    setView('list');
  };

  const handleSave = async () => {
    if (busy || isReadOnly) return;
    if (isComposing()) {
      showSheetStatus(VERSION_SAVE_COMPOSING_TOAST);
      return;
    }
    setBusy(true);
    try {
      const res = await onSaveVersion(saveNoteDraft.trim());
      const feedback = resolveSaveVersionFeedback(res);
      if (feedback.clearDraft) {
        setSaveNoteDraft('');
      }
      showSheetStatus(feedback.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateNote = async () => {
    if (busy || !selectedVersion || isReadOnly) return;
    const trimmed = editNoteDraft.trim();
    setBusy(true);
    try {
      const res = await onUpdateNote(selectedVersion.version_id, trimmed);
      if (res.kind === 'updated') {
        setEditNoteDraft(trimmed);
        showSheetStatus(VERSION_EDIT_NOTE_SAVED_HINT);
      } else if (res.kind === 'read-only') {
        showSheetStatus(VERSION_READONLY_TOAST);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDiscard = async () => {
    if (busy || !confirmDiscardVersion) return;
    const target = confirmDiscardVersion;
    setBusy(true);
    try {
      const res = await onDiscard(target);
      setConfirmDiscardId(null);
      if (res.kind === 'discarded') {
        setUndoState({ version: target, token: Date.now() });
        setSelectedId(null);
        setView('list');
      } else if (res.kind === 'read-only') {
        showSheetStatus(VERSION_READONLY_TOAST);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUndoDiscard = async () => {
    if (busy || !undoState) return;
    const target = undoState.version;
    setUndoState(null);
    setBusy(true);
    try {
      const res = await onUndoDiscard(target);
      if (res.kind === 'restored' || res.kind === 'already-exists') {
        showSheetStatus(VERSION_DISCARD_UNDONE_HINT);
      } else if (res.kind === 'blocked-full') {
        showSheetStatus(VERSION_FULL_LOCKED_HINT);
      } else {
        showSheetStatus(VERSION_READONLY_TOAST);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (busy || !confirmRestoreVersion) return;
    const target = confirmRestoreVersion;
    if (isComposing()) {
      setConfirmRestoreId(null);
      showSheetStatus(VERSION_RESTORE_COMPOSING_TOAST);
      return;
    }
    setBusy(true);
    try {
      const outcome = await onRestoreVersion(target);
      setConfirmRestoreId(null);
      if (outcome.status !== 'restored') {
        showSheetStatus(restoreOutcomeHint(outcome));
      }
    } finally {
      setBusy(false);
    }
  };

  const headerTitle =
    activeView === 'compare'
      ? VERSION_COMPARE_TITLE
      : activeView === 'preview' && selectedVersion
        ? selectedVersion.chapter_title_snapshot.trim() ||
          chapterTitle.trim() ||
          VERSION_SHEET_TITLE
        : VERSION_SHEET_TITLE;

  return (
    <div
      className="sheet-backdrop version-sheet-backdrop"
      role="presentation"
      data-testid="version-sheet-backdrop"
      onClick={onClose}
    >
      <div
        className={activeView === 'compare' ? 'sheet version-sheet is-compare' : 'sheet version-sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-sheet-title"
        data-testid="version-sheet"
        data-layout={layoutMode}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="version-sheet-header">
          {activeView === 'preview' || activeView === 'compare' ? (
            <button
              type="button"
              className="version-header-btn"
              data-testid="version-back"
              onClick={handleBack}
            >
              {VERSION_BACK_LABEL}
            </button>
          ) : null}
          <h2 id="version-sheet-title" className="version-sheet-title">
            {headerTitle}
          </h2>
          <button
            type="button"
            className="version-header-btn"
            aria-label={VERSION_CLOSE_ARIA}
            data-testid="version-close"
            onClick={onClose}
          >
            {VERSION_CLOSE_LABEL}
          </button>
        </header>

        {sheetStatus ? (
          <div
            className="version-sheet-status"
            role="status"
            aria-live="polite"
            data-testid="version-sheet-status"
          >
            {sheetStatus.message}
          </div>
        ) : null}

        <div className="version-sheet-body">
          {versionRead.kind === 'newer-revision' ? (
            <p className="version-status-banner is-warning" data-testid="version-newer-revision-hint">
              {VERSION_NEWER_REVISION_HINT}
            </p>
          ) : null}
          {versionRead.kind === 'corrupt' ? (
            <p className="version-status-banner is-danger" data-testid="version-corrupt-hint">
              {VERSION_CORRUPT_HINT}
            </p>
          ) : null}

          {activeView === 'list' && !isReadOnly ? (
            <>
              <div className="version-save-box" data-testid="version-save-box">
                <div className="version-save-row">
                  <input
                    type="text"
                    className="version-note-input"
                    value={saveNoteDraft}
                    placeholder={VERSION_NOTE_PLACEHOLDER}
                    aria-label={VERSION_EDIT_NOTE_LABEL}
                    data-testid="version-note-input"
                    onChange={(event) => setSaveNoteDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button primary version-save-btn"
                    data-testid="version-save-btn"
                    disabled={busy}
                    onClick={() => void handleSave()}
                  >
                    {VERSION_SAVE_BUTTON}
                  </button>
                </div>
                <p className="hint version-note-hint">{VERSION_NOTE_HINT}</p>
              </div>

              {undoState ? (
                <div
                  className="undo-bar version-undo-bar"
                  data-testid="version-undo-bar"
                  key={undoState.token}
                >
                  <span>{VERSION_DISCARDED_BAR}</span>
                  <button
                    type="button"
                    data-testid="version-discard-undo-btn"
                    disabled={busy}
                    onClick={() => void handleUndoDiscard()}
                  >
                    {VERSION_UNDO_BUTTON}
                  </button>
                  <span className="undo-meter" />
                </div>
              ) : null}

              {sortedVersions.length > 0 ? (
                <div className="version-usage-box">
                  <p className="version-usage-summary" data-testid="version-usage-summary">
                    {versionUsageSummary(sortedVersions.length)}
                  </p>
                  {summary.isOverLimit ? (
                    <p
                      className="version-limit-hint is-locked"
                      data-testid="version-over-limit-hint"
                    >
                      {VERSION_OVER_LIMIT_HINT}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {sortedVersions.length === 0 ? (
                <p className="hint version-empty" data-testid="version-empty">
                  {VERSION_EMPTY_HINT}
                </p>
              ) : (
                <ul className="version-sheet-list" data-testid="version-list">
                  {sortedVersions.map((version) => {
                    const trimmedNote = version.note.trim();
                    return (
                      <li key={version.version_id} className="version-sheet-list-item">
                        <button
                          type="button"
                          className="version-item-btn"
                          data-testid={`version-item-${version.version_id}`}
                          onClick={() => openPreview(version)}
                        >
                          <div className="version-item-main">
                            <div className="version-item-meta">
                              <span className="version-item-time">
                                {formatVersionTime(version.saved_at_ms)}
                              </span>
                              <span className="version-item-words">
                                {versionWordsLabel(version.word_count)}
                              </span>
                            </div>
                            {trimmedNote !== '' ? (
                              <span
                                className="version-item-note"
                                data-testid={`version-item-note-${version.version_id}`}
                              >
                                {trimmedNote}
                              </span>
                            ) : null}
                          </div>
                          <span className="version-item-preview-label">
                            {VERSION_PREVIEW_BUTTON}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="version-item-compare-btn"
                          data-testid={`version-compare-btn-${version.version_id}`}
                          aria-label={versionCompareButtonAria(formatVersionTime(version.saved_at_ms))}
                          disabled={busy}
                          onClick={() => openCompare(version)}
                        >
                          {VERSION_COMPARE_BUTTON}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : null}

          {activeView === 'preview' && selectedVersion && !isReadOnly ? (
            <div className="version-detail" data-testid="version-preview-pane">
              <div className="version-detail-meta">
                <span>{formatVersionTime(selectedVersion.saved_at_ms)}</span>
                <span>·</span>
                <span>{versionWordsLabel(selectedVersion.word_count)}</span>
              </div>

              <p className="hint version-preview-hint" data-testid="version-preview-hint">
                {VERSION_PREVIEW_READONLY_HINT}
              </p>

              <textarea
                className="version-preview version-preview-content"
                readOnly
                value={selectedVersion.content}
                aria-label={VERSION_PREVIEW_CONTENT_ARIA}
                data-testid="version-preview-content"
              />

              <div className="version-note-edit-box">
                <label htmlFor="version-edit-note-input" className="version-note-label">
                  {VERSION_EDIT_NOTE_LABEL}
                </label>
                <div className="version-note-edit-row">
                  <input
                    id="version-edit-note-input"
                    type="text"
                    className="version-note-input"
                    value={editNoteDraft}
                    placeholder={VERSION_NOTE_PLACEHOLDER}
                    data-testid="version-edit-note-input"
                    onChange={(event) => setEditNoteDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button secondary version-note-save-btn"
                    data-testid="version-edit-note-save"
                    disabled={busy}
                    onClick={() => void handleUpdateNote()}
                  >
                    {VERSION_EDIT_NOTE_SAVE}
                  </button>
                </div>
              </div>

              <div className="dialog-actions version-detail-actions">
                <button
                  type="button"
                  className="button primary"
                  data-testid="version-restore-btn"
                  disabled={busy}
                  onClick={() => setConfirmRestoreId(selectedVersion.version_id)}
                >
                  {VERSION_RESTORE_BUTTON}
                </button>
                <button
                  type="button"
                  className="button danger"
                  data-testid="version-discard-btn"
                  disabled={busy}
                  onClick={() => setConfirmDiscardId(selectedVersion.version_id)}
                >
                  {VERSION_DISCARD_BUTTON}
                </button>
              </div>
            </div>
          ) : null}

          {activeView === 'compare' && selectedVersion && !isReadOnly && compareResult ? (
            <VersionCompareView
              version={selectedVersion}
              versionTimeLabel={formatVersionTime(selectedVersion.saved_at_ms)}
              diff={compareResult}
              expandedBlockIds={expandedBlockIds}
              onExpandBlock={handleExpandCompareBlock}
            />
          ) : null}
        </div>
      </div>

      {confirmDiscardVersion ? (
        <div
          className="sheet-backdrop version-confirm-backdrop"
          role="presentation"
          data-testid="version-discard-backdrop"
          onClick={(event) => {
            event.stopPropagation();
            if (!busy) setConfirmDiscardId(null);
          }}
        >
          <div
            className="dialog version-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="version-discard-title"
            data-testid="version-discard-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="version-discard-title">{VERSION_DISCARD_CONFIRM_TITLE}</h3>
            <p className="hint">{VERSION_DISCARD_CONFIRM_HINT}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                data-testid="version-discard-cancel"
                disabled={busy}
                onClick={() => setConfirmDiscardId(null)}
              >
                {VERSION_CANCEL_LABEL}
              </button>
              <button
                type="button"
                className="button danger"
                data-testid="version-discard-confirm"
                disabled={busy}
                onClick={() => void handleConfirmDiscard()}
              >
                {VERSION_DISCARD_BUTTON}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmRestoreVersion ? (
        <div
          className="sheet-backdrop version-confirm-backdrop"
          role="presentation"
          data-testid="version-restore-backdrop"
          onClick={(event) => {
            event.stopPropagation();
            if (!busy) setConfirmRestoreId(null);
          }}
        >
          <div
            className="dialog version-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="version-restore-title"
            data-testid="version-restore-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="version-restore-title">{VERSION_RESTORE_CONFIRM_TITLE}</h3>
            <p className="hint">{VERSION_RESTORE_CONFIRM_BODY}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                data-testid="version-restore-cancel"
                disabled={busy}
                onClick={() => setConfirmRestoreId(null)}
              >
                {VERSION_CANCEL_LABEL}
              </button>
              <button
                type="button"
                className="button primary"
                data-testid="version-restore-confirm"
                disabled={busy}
                onClick={() => void handleConfirmRestore()}
              >
                {VERSION_RESTORE_BUTTON}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
