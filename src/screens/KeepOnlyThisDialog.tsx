import { useEffect, useRef } from 'react';
import {
  KEEP_ONE_CANCEL,
  KEEP_ONE_CONFIRM,
  KEEP_ONE_UNSAVED_NOTE,
  keepOneBody,
  keepOneTitle,
} from '../copy/duplicateOpenCopy';

/**
 * WO-143：「留下這一份，刪掉同一本的其他份」的確認視窗。版面仿 RemoveFromDeviceDialog。
 * 開視窗不改任何資料，只有按「刪掉其他份」才會呼叫 onConfirm。
 */
export function KeepOnlyThisDialog(props: {
  bookTitle: string;
  otherCount: number;
  hasUnsaved: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // 視窗出現時把焦點移進視窗。
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  return (
    <div className="sheet-backdrop duplicate-open-backdrop" role="presentation" onClick={props.onCancel}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keep-only-this-title"
        aria-describedby="keep-only-this-body"
        data-testid="keep-only-this-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="keep-only-this-title">{keepOneTitle(props.bookTitle)}</h2>
        <p id="keep-only-this-body">
          {props.hasUnsaved ? `${keepOneBody(props.otherCount)}${KEEP_ONE_UNSAVED_NOTE}` : keepOneBody(props.otherCount)}
        </p>
        <div className="dialog-actions delete-actions">
          <button
            type="button"
            className="button danger"
            data-testid="keep-only-this-confirm"
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {KEEP_ONE_CONFIRM}
          </button>
          <button
            type="button"
            className="button secondary"
            data-testid="keep-only-this-cancel"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            {KEEP_ONE_CANCEL}
          </button>
        </div>
      </div>
    </div>
  );
}
