import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  WHATS_NEW_CONFIRM,
  WHATS_NEW_EMPTY_CURRENT,
  WHATS_NEW_PREVIOUS_TOGGLE,
  WHATS_NEW_TITLE,
  whatsNewVersionLabel,
} from '../copy/userFacing';
import {
  RELEASE_NOTES,
  findReleaseNote,
  previousReleaseNotes,
  type ReleaseNote,
} from '../data/whatsNew';
import './whatsNewDialog.css';

const DIALOG_FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Tab 在改版說明視窗內繞圈：回傳要改聚焦的索引；不需攔截就回 null。 */
export function whatsNewDialogTabTarget(
  count: number,
  activeIndex: number,
  shift: boolean,
): number | null {
  if (count === 0) return null;
  if (activeIndex < 0) return shift ? count - 1 : 0;
  if (shift && activeIndex === 0) return count - 1;
  if (!shift && activeIndex === count - 1) return 0;
  return null;
}

export interface WhatsNewDialogProps {
  version: string;
  onClose: () => void;
  /** 關閉後要還原焦點的元素；未傳入時還原掛載前的焦點元素。 */
  returnFocusTo?: HTMLElement | null;
  /** 測試用：覆寫改版內容資料清單。 */
  notes?: readonly ReleaseNote[];
  /** 測試用：指定歷版清單初始展開狀態。 */
  initialExpanded?: boolean;
}

/**
 * WO-129：改版說明視窗元件。
 * - 上方獨立捲動內容區＋下方固定確認主按鈕，四種版面與三套主題一致。
 * - 開啟時焦點移入標題，Tab 在視窗內繞圈，按 Esc 或點遮罩關閉，卸載時還原原焦點。
 */
export function WhatsNewDialog({
  version,
  onClose,
  returnFocusTo,
  notes = RELEASE_NOTES,
  initialExpanded = false,
}: WhatsNewDialogProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const currentNote = findReleaseNote(version, notes);
  const history = previousReleaseNotes(version, notes);

  // 掛載時記錄原本焦點並把焦點移到視窗標題；關閉卸載時還原焦點。
  useEffect(() => {
    const previousFocus =
      returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    titleRef.current?.focus();
    return () => {
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  // Escape 監聽掛在 document：就算點到條列文字使焦點離開按鈕，按 Esc 仍能關閉。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE));
    const active = document.activeElement as HTMLElement | null;
    const target = whatsNewDialogTabTarget(
      items.length,
      active ? items.indexOf(active) : -1,
      event.shiftKey,
    );
    if (target !== null) {
      event.preventDefault();
      items[target]!.focus();
    }
  };

  return (
    <div
      className="whats-new-backdrop"
      role="presentation"
      data-testid="whats-new-backdrop"
      onClick={onClose}
    >
      <div
        className="whats-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        data-testid="whats-new-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="whats-new-body" data-testid="whats-new-body">
          <h2 id="whats-new-title" ref={titleRef} tabIndex={-1}>
            {WHATS_NEW_TITLE}
          </h2>
          <p className="whats-new-version" data-testid="whats-new-version">
            {whatsNewVersionLabel(version)}
          </p>
          {currentNote ? (
            <ul className="whats-new-list" data-testid="whats-new-list">
              {currentNote.items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="whats-new-empty" data-testid="whats-new-empty">
              {WHATS_NEW_EMPTY_CURRENT}
            </p>
          )}
          {history.length > 0 ? (
            <div className="whats-new-history-wrap">
              <button
                type="button"
                className="whats-new-history-toggle"
                aria-expanded={expanded}
                aria-controls="whats-new-history"
                data-testid="whats-new-history-toggle"
                onClick={() => setExpanded((prev) => !prev)}
              >
                <span className="whats-new-history-arrow" aria-hidden="true">
                  {expanded ? '▾' : '▸'}
                </span>
                <span>{WHATS_NEW_PREVIOUS_TOGGLE}</span>
              </button>
              {expanded ? (
                <div id="whats-new-history" className="whats-new-history" data-testid="whats-new-history">
                  {history.map((note) => (
                    <section key={note.version} className="whats-new-history-entry">
                      <h3>{whatsNewVersionLabel(note.version)}</h3>
                      <ul className="whats-new-list">
                        {note.items.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="whats-new-actions">
          <button
            type="button"
            className="button primary whats-new-confirm"
            data-testid="whats-new-confirm"
            onClick={onClose}
          >
            {WHATS_NEW_CONFIRM}
          </button>
        </div>
      </div>
    </div>
  );
}
