import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { PencilIcon } from '../components/Icons';
import {
  ASK_SAVE_AS_TITLE,
  ASK_SAVE_LATER,
  ASK_SAVE_NOW,
  BOOK_RENAME_TITLE,
  BOOK_SAVE_HINT_EXPORT,
  BOOK_SAVE_HINT_RESAVE,
  BOOK_TITLE_BLANK_HINT,
  BOOK_TITLE_HOVER_HINT,
  BOOK_TITLE_LABEL,
  BOOK_TITLE_LIMIT_HINT,
  BOOK_TITLE_PLACEHOLDER,
  TREE_CANCEL,
  TREE_SAVE_NAME,
  askSaveAsBody,
  askSaveAsFilename,
  bookTitleAria,
  bookTitleCount,
} from '../copy/userFacing';
import {
  BOOK_TITLE_COUNT_FROM,
  BOOK_TITLE_MAX,
  clipBookTitle,
  commitBookTitleEdit,
  countBookTitle,
  type TitleEditVia,
} from '../domain/bookTitle';
import { exportDbFilename } from '../domain/exportFilename';
import { canPickLocalFiles } from '../db/browserDisk';
import { decideEnterKey } from '../editor/enterGuard';
import type { DemoProject } from '../data/demo';
import { useSample } from '../state/sampleStore';

function useImeGuard() {
  const composing = useRef(false);
  const lastEnd = useRef<number | null>(null);
  return {
    composing,
    bind: {
      onCompositionStart: () => {
        composing.current = true;
      },
      onCompositionEnd: (event: { timeStamp: number }) => {
        composing.current = false;
        lastEnd.current = event.timeStamp;
      },
    },
    shouldHoldEnter(event: KeyboardEvent<HTMLInputElement>): boolean {
      const decision = decideEnterKey({
        key: event.key,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
        timeStamp: event.timeStamp,
        lastCompositionEndTimeStamp: lastEnd.current,
        composingFlag: composing.current,
      });
      return event.key === 'Enter' && decision.suppressActions;
    },
  };
}

function BookTitleField({
  initial,
  composingRef,
  onValue,
}: {
  initial: string;
  composingRef: { current: boolean };
  onValue: (value: string) => void;
}) {
  const ime = useImeGuard();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [truncated, setTruncated] = useState(false);
  const length = countBookTitle(value);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function publish(next: string, warn: boolean) {
    setValue(next);
    setTruncated(warn);
    onValue(next);
  }

  return (
    <>
      <input
        ref={ref}
        className="rename-book-input"
        data-testid="rename-book-input"
        value={value}
        placeholder={BOOK_TITLE_PLACEHOLDER}
        aria-label={BOOK_TITLE_PLACEHOLDER}
        enterKeyHint="done"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onCompositionStart={() => {
          ime.bind.onCompositionStart();
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          ime.bind.onCompositionEnd(event);
          composingRef.current = false;
          const clipped = clipBookTitle(event.currentTarget.value);
          publish(clipped.text, clipped.truncated);
        }}
        onBeforeInput={(event) => {
          if (ime.composing.current) return;
          const native = event.nativeEvent;
          if (!(native instanceof InputEvent) || !native.data) return;
          if (native.inputType === 'insertFromPaste') return;
          const input = event.currentTarget;
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? start;
          const next = input.value.slice(0, start) + native.data + input.value.slice(end);
          if (countBookTitle(next) > BOOK_TITLE_MAX) event.preventDefault();
        }}
        onPaste={(event) => {
          event.preventDefault();
          const input = event.currentTarget;
          const pasted = event.clipboardData.getData('text');
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? start;
          const next = input.value.slice(0, start) + pasted + input.value.slice(end);
          const clipped = clipBookTitle(next);
          publish(clipped.text, clipped.truncated);
        }}
        onChange={(event) => {
          if (ime.composing.current) {
            publish(event.target.value, false);
            return;
          }
          const clipped = clipBookTitle(event.target.value);
          publish(clipped.text, false);
        }}
        onKeyDown={(event) => {
          if (ime.shouldHoldEnter(event) && !event.nativeEvent.isComposing && !ime.composing.current) {
            event.preventDefault();
          }
        }}
      />
      {length >= BOOK_TITLE_COUNT_FROM ? (
        <p className="rename-count" data-testid="rename-book-count">{bookTitleCount(length)}</p>
      ) : null}
      {truncated ? <p className="rename-warn" data-testid="rename-book-limit">{BOOK_TITLE_LIMIT_HINT}</p> : null}
      {value.trim() === '' ? <p className="hint">{BOOK_TITLE_BLANK_HINT}</p> : null}
    </>
  );
}

function useModalScrollLock(): void {
  useEffect(() => {
    document.documentElement.classList.add('book-title-modal');
    const block = (event: TouchEvent) => {
      const backdrop = document.querySelector('.book-title-modal-root');
      if (backdrop && event.target instanceof Node && backdrop.contains(event.target)) {
        event.preventDefault();
      }
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => {
      document.documentElement.classList.remove('book-title-modal');
      document.removeEventListener('touchmove', block);
    };
  }, []);
}

export function RenameBookDialog({
  placement,
  title,
  canWriteBack,
  onCommit,
}: {
  placement: 'sheet' | 'center';
  title: string;
  canWriteBack: boolean;
  onCommit: (raw: string, via: TitleEditVia) => void;
}) {
  const composingRef = useRef(false);
  const valueRef = useRef(title);
  useModalScrollLock();
  const hint = canWriteBack ? BOOK_SAVE_HINT_RESAVE : BOOK_SAVE_HINT_EXPORT;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (composingRef.current) return;
    onCommit(valueRef.current, 'confirm');
  }

  return (
    <div
      className="sheet-backdrop book-title-modal-root"
      role="presentation"
      onClick={() => onCommit(valueRef.current, 'outside')}
      onWheel={(event) => event.preventDefault()}
    >
      <form
        className={placement === 'sheet' ? 'sheet rename-book-sheet' : 'dialog rename-book-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-book-title"
        data-testid="rename-book-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCommit(valueRef.current, 'cancel');
          }
        }}
      >
        <h2 id="rename-book-title">{BOOK_RENAME_TITLE}</h2>
        <BookTitleField
          initial={title}
          composingRef={composingRef}
          onValue={(value) => { valueRef.current = value; }}
        />
        <p className="hint">{hint}</p>
        <div className="dialog-actions rename-actions">
          <button type="button" className="button secondary" data-testid="rename-book-cancel" onClick={() => onCommit(valueRef.current, 'cancel')}>
            {TREE_CANCEL}
          </button>
          <button type="submit" className="button primary" data-testid="rename-book-confirm">
            {TREE_SAVE_NAME}
          </button>
        </div>
      </form>
    </div>
  );
}

export function InlineBookTitle({
  title,
  onCommit,
}: {
  title: string;
  onCommit: (raw: string, via: TitleEditVia) => void;
}) {
  const composingRef = useRef(false);
  const valueRef = useRef(title);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const form = formRef.current;
      if (!form) return;
      if (event.target instanceof Node && form.contains(event.target)) return;
      onCommit(valueRef.current, 'outside');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onCommit]);

  return (
    <form
      ref={formRef}
      className="inline-book-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (composingRef.current) return;
        onCommit(valueRef.current, 'confirm');
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCommit(valueRef.current, 'cancel');
        }
      }}
    >
      <BookTitleField
        initial={title}
        composingRef={composingRef}
        onValue={(value) => { valueRef.current = value; }}
      />
    </form>
  );
}

export function AskSaveAsSheet({
  title,
  filename,
  onLater,
  onSave,
}: {
  title: string;
  filename: string;
  onLater: () => void;
  onSave: () => void;
}) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useModalScrollLock();
  useEffect(() => {
    saveRef.current?.focus();
  }, []);
  return (
    <div
      className="sheet-backdrop book-title-modal-root"
      role="presentation"
      onClick={onLater}
      onWheel={(event) => event.preventDefault()}
    >
      <div
        className="sheet ask-save-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-save-title"
        data-testid="ask-save-as"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onLater();
          }
        }}
      >
        <h2 id="ask-save-title">{ASK_SAVE_AS_TITLE}</h2>
        <p>{askSaveAsBody(title)}</p>
        <p className="hint" data-testid="ask-save-filename">{askSaveAsFilename(filename)}</p>
        <div className="dialog-actions ask-save-actions">
          <button type="button" className="button secondary" data-testid="ask-save-later" onClick={onLater}>
            {ASK_SAVE_LATER}
          </button>
          <button
            ref={saveRef}
            type="button"
            className="button primary"
            data-testid="ask-save-now"
            onClick={onSave}
          >
            {ASK_SAVE_NOW}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BookTitleButton({ title, onClick }: { title: string; onClick: () => void }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState(false);
  return (
    <button
      type="button"
      className="book-title-button"
      data-testid="book-title-button"
      aria-label={bookTitleAria(title)}
      onClick={onClick}
      onMouseEnter={() => {
        const el = textRef.current;
        setTip(Boolean(el && el.scrollWidth > el.clientWidth + 1));
      }}
      onMouseLeave={() => setTip(false)}
    >
      <span ref={textRef} className="book-title-text">{title}</span>
      <PencilIcon size={16} />
      {tip ? (
        <span className="book-title-tip" role="tooltip">
          {title}
          <small>{BOOK_TITLE_HOVER_HINT}</small>
        </span>
      ) : null}
    </button>
  );
}

export function BookTitleSettingRow({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="book-name-row"
      data-testid="settings-book-title"
      aria-label={bookTitleAria(title)}
      onClick={onClick}
    >
      <span className="label">{BOOK_TITLE_LABEL}</span>
      <span className="value">{title}</span>
      <span className="chevron" aria-hidden="true">›</span>
    </button>
  );
}

export function useBookRename(project: DemoProject | null) {
  const { actions } = useSample();
  const [mode, setMode] = useState<null | 'inline' | 'sheet' | 'center'>(null);
  const [prompt, setPrompt] = useState(false);
  const [exportName, setExportName] = useState('');
  const timer = useRef<number | null>(null);
  const canWriteBack = canPickLocalFiles();

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  function finish(raw: string, via: TitleEditVia) {
    if (!project) return;
    const surface = mode === 'inline' ? 'inline' : 'card';
    const openedAs = mode;
    const decision = commitBookTitleEdit({ surface, via, raw, previous: project.title });
    setMode(null);
    if (decision.action !== 'apply') return;
    const result = actions.renameBook(project.id, raw);
    if (!result.ok || result.unchanged || !result.askSaveAs) return;
    void actions.prepareShare(project.id, result.title);
    setExportName(exportDbFilename(result.title));
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPrompt(true), openedAs === 'sheet' ? 280 : 0);
  }

  function later() {
    if (project) actions.deferTitleSave(project.id);
    setPrompt(false);
  }

  async function saveNow() {
    if (!project) return;
    const outcome = await actions.saveProjectAs();
    setPrompt(false);
    const saved = outcome?.kind === 'handed-off' || outcome?.kind === 'saved-as';
    if (!saved) actions.deferTitleSave(project.id);
  }

  const dialogs = (
    <>
      {(mode === 'sheet' || mode === 'center') && project ? (
        <RenameBookDialog
          placement={mode}
          title={project.title}
          canWriteBack={canWriteBack}
          onCommit={finish}
        />
      ) : null}
      {prompt && project ? (
        <AskSaveAsSheet
          title={project.title}
          filename={exportName}
          onLater={later}
          onSave={() => void saveNow()}
        />
      ) : null}
    </>
  );

  return {
    inline: mode === 'inline',
    canWriteBack,
    open: (next: 'inline' | 'sheet' | 'center') => setMode(next),
    finish,
    dialogs,
  };
}
