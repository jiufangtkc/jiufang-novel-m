import { useEffect, useRef, useState } from 'react';
import {
  DUPLICATE_CANCEL,
  REPLACE_CONFIRM,
  REPLACE_CONFIRM_CANCEL,
  SAME_BOOK_BODY,
  SAME_BOOK_DIFFERS_NOTE,
  SAME_BOOK_OPEN_EXISTING,
  SAME_BOOK_REPLACE,
  SAME_TITLE_KEEP_SEPARATE,
  SAME_TITLE_OPEN_EXISTING,
  replaceConfirmBody,
  replaceConfirmTitle,
  sameBookTitle,
  sameTitleBody,
  sameTitleTitle,
} from '../copy/duplicateOpenCopy';
import type { DuplicateChoice, DuplicateOpenInfo } from '../domain/duplicateOpen';

/**
 * WO-143：開檔時發現這個裝置上已經有同一本（或同名的一本）。版面與操作仿 RemoveFromDeviceDialog。
 * 按鈕以外的地方（Esc、點背景）等同選「cancel」，放棄這次開檔。取代前若原本那份有還沒存回檔案的改動，第二步再確認一次。
 * 這個元件只回報選擇，不碰任何資料。
 */
export function DuplicateOpenDialog(props: {
  info: DuplicateOpenInfo;
  onChoose: (choice: DuplicateChoice) => void;
}) {
  const { info, onChoose } = props;
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 視窗出現（以及換到第二步確認）時把焦點移進視窗，鍵盤與讀屏才不會停在後面的頁面。
  useEffect(() => {
    dialogRef.current?.focus();
  }, [confirmingReplace]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onChoose('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);

  const sameBook = info.kind === 'same-book';
  return (
    <div className="sheet-backdrop duplicate-open-backdrop" role="presentation" onClick={() => onChoose('cancel')}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-open-title"
        aria-describedby="duplicate-open-body"
        data-testid="duplicate-open-dialog"
        data-kind={info.kind}
        data-step={confirmingReplace ? 'confirm-replace' : 'choose'}
        onClick={(event) => event.stopPropagation()}
      >
        {confirmingReplace ? (
          <>
            <h2 id="duplicate-open-title">{replaceConfirmTitle(info.title)}</h2>
            <p id="duplicate-open-body">{replaceConfirmBody(info.title)}</p>
            <div className="dialog-actions delete-actions">
              <button
                type="button"
                className="button danger"
                data-testid="duplicate-open-replace-confirm"
                onClick={() => onChoose('replace')}
              >
                {REPLACE_CONFIRM}
              </button>
              <button
                type="button"
                className="button secondary"
                data-testid="duplicate-open-replace-cancel"
                onClick={() => onChoose('cancel')}
              >
                {REPLACE_CONFIRM_CANCEL}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="duplicate-open-title">{sameBook ? sameBookTitle(info.title) : sameTitleTitle(info.title)}</h2>
            <p id="duplicate-open-body">{sameBook ? SAME_BOOK_BODY : sameTitleBody(info.title)}</p>
            {sameBook && info.contentDiffers ? (
              <p className="hint" data-testid="duplicate-open-differs">
                {SAME_BOOK_DIFFERS_NOTE}
              </p>
            ) : null}
            <div className="dialog-actions delete-actions">
              <button
                type="button"
                className="button primary"
                data-testid="duplicate-open-existing"
                onClick={() => onChoose('open-existing')}
              >
                {sameBook ? SAME_BOOK_OPEN_EXISTING : SAME_TITLE_OPEN_EXISTING}
              </button>
              {sameBook ? (
                <button
                  type="button"
                  className="button secondary"
                  data-testid="duplicate-open-replace"
                  onClick={() => (info.hasUnsavedChanges ? setConfirmingReplace(true) : onChoose('replace'))}
                >
                  {SAME_BOOK_REPLACE}
                </button>
              ) : (
                <button
                  type="button"
                  className="button secondary"
                  data-testid="duplicate-open-keep-separate"
                  onClick={() => onChoose('keep-separate')}
                >
                  {SAME_TITLE_KEEP_SEPARATE}
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                data-testid="duplicate-open-cancel"
                onClick={() => onChoose('cancel')}
              >
                {DUPLICATE_CANCEL}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
