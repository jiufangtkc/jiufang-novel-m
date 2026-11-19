import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { decideEnterKey } from '../editor/enterGuard';
import {
  IMPORT_BACK_BUTTON,
  IMPORT_CANCEL_BUTTON,
  IMPORT_CONFIRM_BUTTON,
  IMPORT_DIALOG_TITLE,
  IMPORT_EXAMPLE_HINT,
  IMPORT_EXAMPLE_LABEL,
  IMPORT_NO_SPLIT_BUTTON,
  IMPORT_PREVIEW_BUTTON,
  IMPORT_PREVIEW_LIST_ARIA,
  IMPORT_PREVIEW_NOT_FOUND,
  IMPORT_PREVIEW_ONE_CHAPTER_HINT,
  IMPORT_TEXT_WORKING,
  importPreviewFound,
} from '../copy/userFacing';
import type { TextImportPreview } from '../state/sampleStore';

/** 預覽最多列出幾筆章名（含第一章）。 */
export const IMPORT_PREVIEW_MAX_TITLES = 5;

export type ImportDialogStep = 'example' | 'preview';

/** 預覽畫面的內容（純資料，方便測試）。 */
export function importPreviewLines(preview: TextImportPreview): {
  found: boolean;
  summary: string | null;
  notFound: string | null;
  oneChapterHint: string | null;
  titles: string[];
} {
  if (preview.hits > 0) {
    return {
      found: true,
      summary: importPreviewFound(preview.chapters.length, preview.chapters[0]?.title ?? ''),
      notFound: null,
      oneChapterHint: null,
      // 摘要已含第一章，下面列第 2 至第 5 章。
      titles: preview.chapters.slice(1, IMPORT_PREVIEW_MAX_TITLES).map((chapter) => chapter.title),
    };
  }
  return {
    found: false,
    summary: null,
    notFound: preview.usedExample ? IMPORT_PREVIEW_NOT_FOUND : null,
    oneChapterHint: IMPORT_PREVIEW_ONE_CHAPTER_HINT,
    titles: [],
  };
}

/** 視窗內可聚焦的控制項（停用的不算）。 */
export const IMPORT_DIALOG_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab 在視窗內繞圈：回傳要改聚焦的索引；不用攔就回 null。 */
/** 視窗開啟且尚未寫入時，Escape 取消；不依賴焦點在表單內。 */
export function shouldCloseImportOnEscape(key: string, locked: boolean): boolean {
  return key === 'Escape' && !locked;
}

export function importDialogTabTarget(count: number, activeIndex: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (activeIndex < 0) return shift ? count - 1 : 0;
  if (shift && activeIndex === 0) return count - 1;
  if (!shift && activeIndex === count - 1) return 0;
  return null;
}

/** 例子欄的 Enter 是否要擋下（選字中、或選字剛結束的那次 Enter 不送出預覽）。沿用 decideEnterKey。 */
export function shouldHoldImportEnter(input: {
  key: string;
  isComposing: boolean;
  keyCode: number;
  timeStamp: number;
  lastCompositionEndTimeStamp: number | null;
  composingFlag: boolean;
}): boolean {
  return input.key === 'Enter' && decideEnterKey(input).suppressActions;
}

/**
 * WO-126：匯入視窗。手機用 Sheet、寬版置中對話框（沿用 RenameBookDialog 的做法與樣式）。
 * 第一步填章名例子（可留白），第二步看預覽後再決定要不要依預覽建稿。
 */
export function ImportTextDialog({
  placement,
  step,
  example,
  preview,
  working,
  onExampleChange,
  onPreview,
  onBack,
  onConfirm,
  onNoSplit,
  onClose,
}: {
  placement: 'sheet' | 'center';
  step: ImportDialogStep;
  example: string;
  preview: TextImportPreview | null;
  /** preview：計算預覽中（可取消）；write：寫入中（鎖定）。 */
  working: 'preview' | 'write' | null;
  onExampleChange: (value: string) => void;
  onPreview: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onNoSplit: () => void;
  onClose: () => void;
}) {
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const locked = working === 'write';

  // 步驟切換後讓鍵盤焦點跟著走。
  useEffect(() => {
    if (step === 'example') inputRef.current?.focus();
    else headingRef.current?.focus();
  }, [step]);

  // 分批預覽時例子欄與主要按鈕會被停用，焦點改放「取消」，寫入前都能用 Escape 取消。
  useEffect(() => {
    if (working === 'preview') cancelRef.current?.focus();
  }, [working]);

  // Escape 掛在 document：點過章名等一般文字、焦點跑到頁面時仍可取消；寫入期間不關。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (locked) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (shouldCloseImportOnEscape(event.key, locked)) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [locked]);

  // 點到視窗內非按鈕、非輸入欄的文字後，把焦點補回視窗內可操作的控制項，Tab 才不會跑丟。
  function restoreFocusIfLost(target: HTMLElement) {
    const form = formRef.current;
    if (!form || target.closest('button, input, a, select, textarea')) return;
    if (form.contains(document.activeElement) && document.activeElement !== form) return;
    for (const ref of [headingRef, inputRef, cancelRef]) {
      ref.current?.focus();
      if (document.activeElement === ref.current) return;
    }
  }

  // Tab 只在視窗內繞，不跑到後面的首頁。
  function trapTab(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Tab' || !formRef.current) return;
    const items = Array.from(formRef.current.querySelectorAll<HTMLElement>(IMPORT_DIALOG_FOCUSABLE));
    const target = importDialogTabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    if (target !== null) {
      event.preventDefault();
      items[target].focus();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (composingRef.current || working !== null) return;
    if (step === 'example') onPreview();
    else onConfirm();
  }

  const lines = step === 'preview' && preview ? importPreviewLines(preview) : null;

  return (
    <div
      className="sheet-backdrop import-text-backdrop"
      role="presentation"
      onClick={() => {
        if (!locked) onClose();
      }}
    >
      <form
        ref={formRef}
        className={placement === 'sheet' ? 'sheet import-text-sheet' : 'dialog import-text-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-text-title"
        aria-busy={working !== null ? 'true' : undefined}
        data-testid="import-text-dialog"
        onClick={(event) => {
          event.stopPropagation();
          restoreFocusIfLost(event.target as HTMLElement);
        }}
        onSubmit={submit}
        onKeyDown={trapTab}
      >
        <h2 id="import-text-title">{IMPORT_DIALOG_TITLE}</h2>
        {step === 'example' ? (
          <>
            <label className="import-text-label" htmlFor="import-text-example">
              {IMPORT_EXAMPLE_LABEL}
            </label>
            <input
              ref={inputRef}
              id="import-text-example"
              className="rename-book-input import-text-example"
              data-testid="import-text-example"
              type="text"
              value={example}
              aria-describedby="import-text-example-hint"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={working !== null}
              onChange={(event) => onExampleChange(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                lastCompositionEndRef.current = event.timeStamp;
              }}
              onKeyDown={(event) => {
                // 中文輸入法選字時、與選字剛結束的那次 Enter 只完成選字，不送出（沿用 decideEnterKey）。
                if (
                  shouldHoldImportEnter({
                    key: event.key,
                    isComposing: event.nativeEvent.isComposing,
                    keyCode: event.keyCode,
                    timeStamp: event.timeStamp,
                    lastCompositionEndTimeStamp: lastCompositionEndRef.current,
                    composingFlag: composingRef.current,
                  })
                ) {
                  event.preventDefault();
                }
              }}
            />
            <p className="hint" id="import-text-example-hint">
              {IMPORT_EXAMPLE_HINT}
            </p>
          </>
        ) : lines ? (
          <div className="import-text-preview" data-testid="import-text-preview">
            <p className="import-text-summary" tabIndex={-1} ref={headingRef} data-testid="import-text-summary">
              {lines.summary ?? lines.notFound ?? lines.oneChapterHint}
            </p>
            {lines.titles.length > 0 ? (
              <ul className="import-text-titles" aria-label={IMPORT_PREVIEW_LIST_ARIA} data-testid="import-text-titles">
                {lines.titles.map((title, index) => (
                  <li key={index}>{title}</li>
                ))}
              </ul>
            ) : null}
            {lines.notFound !== null ? (
              <p className="hint" data-testid="import-text-one-chapter">
                {lines.oneChapterHint}
              </p>
            ) : null}
          </div>
        ) : null}
        {working !== null ? (
          <p className="hint" role="status" data-testid="import-text-dialog-working">
            {IMPORT_TEXT_WORKING}
          </p>
        ) : null}
        <div className="import-text-actions">
          {step === 'example' ? (
            <button type="submit" className="button primary" data-testid="import-text-preview-button" disabled={working !== null}>
              {IMPORT_PREVIEW_BUTTON}
            </button>
          ) : (
            <>
              <button type="submit" className="button primary" data-testid="import-text-confirm" disabled={locked}>
                {IMPORT_CONFIRM_BUTTON}
              </button>
              <button type="button" className="button secondary" data-testid="import-text-back" disabled={locked} onClick={onBack}>
                {IMPORT_BACK_BUTTON}
              </button>
            </>
          )}
          {step === 'preview' ? (
            <button type="button" className="button secondary" data-testid="import-text-no-split" disabled={locked} onClick={onNoSplit}>
              {IMPORT_NO_SPLIT_BUTTON}
            </button>
          ) : null}
          <button ref={cancelRef} type="button" className="button secondary" data-testid="import-text-cancel" disabled={locked} onClick={onClose}>
            {IMPORT_CANCEL_BUTTON}
          </button>
        </div>
      </form>
    </div>
  );
}
