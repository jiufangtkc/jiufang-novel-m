import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  SAVE_REMINDER_BODY_CHANGED,
  SAVE_REMINDER_BODY_UNSAVED,
  SAVE_REMINDER_LATER,
  SAVE_REMINDER_SAVE_NOW,
  SAVE_REMINDER_TITLE,
} from '../copy/userFacing';
import type { SaveReminderReason } from '../domain/saveReminder';
import './saveReminder.css';

const DIALOG_FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Tab 在存檔提醒視窗內繞圈：回傳要改聚焦的索引；不需攔截就回 null。 */
export function saveReminderDialogTabTarget(
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

export interface SaveReminderDialogProps {
  reason: SaveReminderReason;
  onSaveNow: () => void;
  onLater: () => void;
  returnFocusTo?: HTMLElement | null;
}

/**
 * WO-130：溫和存檔提醒對話框。
 * - 開啟時焦點移入標題，Tab 在視窗內繞圈，按 Esc（非組字中）或點遮罩視同「晚點再說」，卸載時還原原焦點。
 */
export function SaveReminderDialog({
  reason,
  onSaveNow,
  onLater,
  returnFocusTo,
}: SaveReminderDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        onLaterRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE));
    const active = document.activeElement as HTMLElement | null;
    const target = saveReminderDialogTabTarget(
      items.length,
      active ? items.indexOf(active) : -1,
      event.shiftKey,
    );
    if (target !== null) {
      event.preventDefault();
      items[target]!.focus();
    }
  };

  const message = reason === 'unsaved' ? SAVE_REMINDER_BODY_UNSAVED : SAVE_REMINDER_BODY_CHANGED;

  return (
    <div
      className="save-reminder-backdrop"
      role="presentation"
      data-testid="save-reminder-backdrop"
      onClick={onLater}
    >
      <div
        className="save-reminder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-reminder-title"
        data-testid="save-reminder-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="save-reminder-body">
          <h2 id="save-reminder-title" ref={titleRef} tabIndex={-1}>
            {SAVE_REMINDER_TITLE}
          </h2>
          <p className="save-reminder-message" data-testid="save-reminder-message">
            {message}
          </p>
        </div>
        <div className="save-reminder-actions">
          <button
            type="button"
            className="button primary save-reminder-save"
            data-testid="save-reminder-save-now"
            onClick={onSaveNow}
          >
            {SAVE_REMINDER_SAVE_NOW}
          </button>
          <button
            type="button"
            className="button secondary save-reminder-later"
            data-testid="save-reminder-later"
            onClick={onLater}
          >
            {SAVE_REMINDER_LATER}
          </button>
        </div>
      </div>
    </div>
  );
}
