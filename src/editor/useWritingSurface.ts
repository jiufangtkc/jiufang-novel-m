import { useEffect, useRef, useState } from 'react';
import { clipForBook, rememberBookClip } from './bookClip';
import { decidePaste } from './clipboardPolicy';
import { EDITOR_COPIED_TOAST, EDITOR_CUT_TOAST, EDITOR_PASTE_BLOCKED_TOAST } from '../copy/userFacing';
import { setLiveFlusher, setLiveReader } from './liveDraft';
import { revealCaret } from './caret';
import { decideEnterKey, IME_ENTER_WINDOW_MS, removeSpuriousLineBreak } from './enterGuard';
import { createIdleGate, IDLE_MS } from './idleGate';
import { classifyTextDelta, type TextChangeSource, type TextDelta } from '../domain/writingLog';
import { textForBoundChapter } from './chapterSurface';
import { createTrashCaptureTracker, type TrashCapturePayload } from './trashCapture';
import { insertSymbolInto, type InsertSymbolResult } from './symbolInsert';
import { createWrapTracker } from './symbolWrap';

export interface CommitTextOptions {
  countForToday?: boolean;
  excludedWordDelta?: number;
}

interface WritingSurfaceOptions {
  bookId: string;
  chapterId: string;
  openingText: string;
  onCommit: (text: string, options?: CommitTextOptions) => void;
  onLarge: (delta: TextDelta) => void;
  onDuration: (seconds: number) => void;
  onToast: (message: string) => void;
  onUserEdit?: () => void;
  onTrashCapture?: (payload: TrashCapturePayload) => string | null;
  onTrashUndo?: (itemId: string) => void;
}

export function useWritingSurface({
  bookId,
  chapterId,
  openingText,
  onCommit,
  onLarge,
  onDuration,
  onToast,
  onUserEdit,
  onTrashCapture,
  onTrashUndo,
}: WritingSurfaceOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dirty, setDirty] = useState(false);
  const onCommitRef = useRef(onCommit);
  const onLargeRef = useRef(onLarge);
  const onDurationRef = useRef(onDuration);
  const onToastRef = useRef(onToast);
  const onUserEditRef = useRef(onUserEdit);
  const onTrashCaptureRef = useRef(onTrashCapture);
  const onTrashUndoRef = useRef(onTrashUndo);
  onCommitRef.current = onCommit;
  onLargeRef.current = onLarge;
  onDurationRef.current = onDuration;
  onToastRef.current = onToast;
  onUserEditRef.current = onUserEdit;
  onTrashCaptureRef.current = onTrashCapture;
  onTrashUndoRef.current = onTrashUndo;
  const openingRef = useRef(openingText);
  openingRef.current = openingText;
  /**
   * WO-76 乙段：按「改成全形」或「復原」時整段換掉這一章正文。
   * 組字中不換（回傳 false）。換完立刻走既有 commit-text，字數照甲段算法更新。
   */
  const replaceRef = useRef<(next: string, caret: number, options?: { countForToday?: boolean }) => boolean>(() => false);
  /** WO-142：全形標點列插入符號（像打字一樣，不是整章替換）。 */
  const insertSymbolRef = useRef<(symbolId: string) => InsertSymbolResult>(() => 'unavailable');

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const boundText = textForBoundChapter({
      boundChapterId: textarea.dataset.boundChapter || null,
      screenText: textarea.value,
      nextChapterId: chapterId,
      storedText: openingRef.current,
    });
    if (textarea.value !== boundText) textarea.value = boundText;
    textarea.dataset.boundChapter = chapterId;
    const commit = onCommitRef.current;
    const noteLarge = onLargeRef.current;
    const addDuration = onDurationRef.current;
    const toast = onToastRef.current;
    const composing = { current: false };
    const lastEnd = { current: null as number | null };
    const spurious = { current: false };
    const source = { current: 'type' as TextChangeSource };
    const latest = { current: textarea.value };
    const lock = { current: false };
    const trashCapture = createTrashCaptureTracker();
    const wrapTracker = createWrapTracker();
    let pendingUncountedDelta = 0;
    const gate = createIdleGate(IDLE_MS);
    const consumePendingUncountedDelta = (cancelIdle = false) => {
      const excludedWordDelta = pendingUncountedDelta;
      pendingUncountedDelta = 0;
      if (cancelIdle && !composing.current) gate.cancel();
      return excludedWordDelta;
    };
    setLiveReader(
      () => ({ projectId: bookId, chapterId, text: textarea.value }),
      () => composing.current,
      () => pendingUncountedDelta,
      () => consumePendingUncountedDelta(true),
    );
    setLiveFlusher(() => {
      if (composing.current) return false;
      gate.cancel();
      flush();
      return true;
    });
    let lastActivity = 0;
    let billedUntil = 0;

    const bill = () => {
      if (!lastActivity) return;
      const now = Date.now();
      const end = Math.min(now, lastActivity + 60_000);
      const seconds = Math.max(0, Math.round((end - billedUntil) / 1000));
      billedUntil = now;
      if (seconds > 0) addDuration(seconds);
    };

    const mark = () => {
      const now = Date.now();
      if (!lastActivity) billedUntil = now;
      lastActivity = now;
    };

    const flush = (fromCleanup = false) => {
      if (composing.current) return;
      bill();
      const excludedWordDelta = consumePendingUncountedDelta(false);
      commit(
        textarea.value,
        excludedWordDelta !== 0 ? { excludedWordDelta } : undefined,
      );
      if (!fromCleanup) setDirty(false);
    };

    const flushUncounted = () => {
      bill();
      pendingUncountedDelta = 0;
      commit(textarea.value, { countForToday: false });
      setDirty(false);
    };

    const process = (nextSource?: TextChangeSource) => {
      if (composing.current) return;
      const next = textarea.value;
      if (next === latest.current) return;
      const effectiveSource = nextSource ?? source.current;
      const before = latest.current;
      // WO-142：包選取的成對符號（及其復原／重做）只算左右兩個符號，不當成大量貼上或刪除。
      const wrap = wrapTracker.resolve(before, next);
      const delta = wrap ? wrap.delta : classifyTextDelta(before, next, { source: effectiveSource });
      const prevAutoTrash = trashCapture.getLastAutoTrash();
      if (wrap) trashCapture.suppressNextCapture();
      const trashOutcome = trashCapture.handleEdit({
        chapterId,
        before,
        after: next,
        source: effectiveSource,
        nowMs: Date.now(),
      });
      if (wrap) trashCapture.releaseSuppress();
      latest.current = next;
      source.current = 'type';
      mark();
      if (delta.largeInsert || delta.largeDelete) noteLarge(delta);
      if (trashOutcome.kind === 'undo') {
        if (prevAutoTrash && prevAutoTrash.itemId === trashOutcome.itemId) {
          pendingUncountedDelta -= prevAutoTrash.deletionWordDelta;
        }
        onTrashUndoRef.current?.(trashOutcome.itemId);
      } else if (trashOutcome.kind === 'capture') {
        const capturedId = onTrashCaptureRef.current?.(trashOutcome.payload) ?? null;
        if (capturedId) {
          pendingUncountedDelta += trashOutcome.payload.deletionWordDelta;
          trashCapture.rememberAutoTrash(capturedId, chapterId, trashOutcome.payload);
        }
      }
      setDirty(true);
    };

    const fixSpurious = () => {
      if (!spurious.current || composing.current) return;
      spurious.current = false;
      const caret = textarea.selectionStart ?? textarea.value.length;
      const fixed = removeSpuriousLineBreak(textarea.value, caret);
      if (!fixed) return;
      textarea.value = fixed.value;
      textarea.setSelectionRange(fixed.caret, fixed.caret);
      process('type');
    };

    const applyPaste = (incoming: string | null) => {
      if (lock.current) return;
      lock.current = true;
      window.setTimeout(() => {
        lock.current = false;
      }, 0);
      const decision = decidePaste(incoming, clipForBook(bookId), composing.current);
      if (decision.action === 'ignore-composing') return;
      if (decision.action === 'block') {
        toast(EDITOR_PASTE_BLOCKED_TOAST);
        return;
      }
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      trashCapture.noteSelection(start, end, latest.current.length);
      source.current = 'paste';
      textarea.setRangeText(decision.text, start, end, 'end');
      onUserEditRef.current?.();
      process('paste');
      textarea.focus();
      revealCaret(textarea);
      gate.schedule(() => flush());
    };

    replaceRef.current = (next: string, caret: number, options?: { countForToday?: boolean }) => {
      if (composing.current) return false;
      if (options?.countForToday === false) {
        gate.cancel();
        flush();
      }
      const scrollTop = textarea.scrollTop;
      const hadFocus = document.activeElement === textarea;
      textarea.value = next;
      textarea.setSelectionRange(caret, caret);
      textarea.scrollTop = scrollTop;
      // 不算成「大量文字出現」：只是同一章的標點換成全形，前後字數由 commit-text 相減。
      trashCapture.clear();
      latest.current = next;
      source.current = 'type';
      mark();
      gate.cancel();
      if (options?.countForToday === false) {
        flushUncounted();
      } else {
        flush();
      }
      if (hadFocus) revealCaret(textarea);
      return true;
    };

    const onCompositionStart = () => {
      composing.current = true;
      trashCapture.noteSelection(
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
        latest.current.length,
      );
      gate.setComposing(true);
      onUserEditRef.current?.();
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      composing.current = false;
      lastEnd.current = event.timeStamp;
      gate.setComposing(false);
      queueMicrotask(() => {
        fixSpurious();
        process('composition');
        gate.schedule(() => flush());
        revealCaret(textarea);
      });
    };
    // WO-142：全形標點列插入（放在 onCompositionEnd 之後，避免落在既有守衛切的 replaceRef 區塊內）
    insertSymbolRef.current = (symbolId: string) =>
      insertSymbolInto(symbolId, {
        target: textarea,
        isComposing: () => composing.current,
        isFocused: () => document.activeElement === textarea,
        execInsert:
          typeof document !== 'undefined' && typeof document.execCommand === 'function'
            ? (text) => document.execCommand('insertText', false, text)
            : undefined,
        beginWrap: (record) => wrapTracker.begin(record),
        endWrap: () => wrapTracker.end(),
        onFallbackInput: ({ start, end }) => {
          // 後備路徑：沒有真的 beforeinput／input，手動做與 onInput 相同的事。
          trashCapture.noteSelection(start, end, latest.current.length);
          onUserEditRef.current?.();
          process('type');
          gate.schedule(() => flush());
          revealCaret(textarea);
        },
        onCaretMoved: () => revealCaret(textarea),
      });
    const onKeyDown = (event: KeyboardEvent) => {
      const decision = decideEnterKey({
        key: event.key,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
        timeStamp: event.timeStamp,
        lastCompositionEndTimeStamp: lastEnd.current,
        composingFlag: composing.current,
      });
      if (decision.blockNewline) event.preventDefault();
    };
    const onBeforeInput = (event: InputEvent) => {
      const near =
        lastEnd.current !== null &&
        Math.abs(event.timeStamp - lastEnd.current) <= IME_ENTER_WINDOW_MS;
      if (
        (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') &&
        (composing.current || event.isComposing || near)
      ) {
        if (event.cancelable) event.preventDefault();
        else spurious.current = true;
        return;
      }
      if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
        if (event.cancelable) event.preventDefault();
        const incoming = event.dataTransfer?.getData('text/plain') ?? event.data;
        applyPaste(incoming ?? null);
        return;
      }
      if (event.inputType === 'historyUndo') {
        trashCapture.noteHistoryUndo();
        return;
      }
      if (!composing.current && !event.isComposing) {
        trashCapture.noteSelection(
          textarea.selectionStart ?? 0,
          textarea.selectionEnd ?? 0,
          latest.current.length,
        );
      }
    };
    const selectedText = () => {
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      return textarea.value.slice(start, end);
    };
    const onCopy = (event: ClipboardEvent) => {
      const text = selectedText();
      if (!text) return;
      event.preventDefault();
      rememberBookClip(bookId, { text });
      event.clipboardData?.setData('text/plain', text);
      toast(EDITOR_COPIED_TOAST);
    };
    const onCut = (event: ClipboardEvent) => {
      if (composing.current) {
        event.preventDefault();
        return;
      }
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      const text = textarea.value.slice(start, end);
      if (!text) return;
      event.preventDefault();
      rememberBookClip(bookId, { text });
      event.clipboardData?.setData('text/plain', text);
      trashCapture.noteSelection(start, end, latest.current.length);
      textarea.setRangeText('', start, end, 'end');
      onUserEditRef.current?.();
      process('type');
      gate.schedule(() => flush());
      toast(EDITOR_CUT_TOAST);
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const incoming = event.clipboardData ? event.clipboardData.getData('text/plain') : null;
      applyPaste(incoming);
    };
    const onDragStart = (event: DragEvent) => event.preventDefault();
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      toast('不能把文字拖進編輯器');
    };
    const onInput = (event: Event) => {
      const input = event as InputEvent;
      if (composing.current || input.isComposing) return;
      if (input.inputType === 'insertCompositionText' || input.inputType === 'deleteCompositionText') return;
      if (input.inputType === 'historyUndo') {
        trashCapture.noteHistoryUndo();
      }
      onUserEditRef.current?.();
      process();
      gate.schedule(() => flush());
      revealCaret(textarea);
    };
    const onPlaceCaret = () => {
      if (!composing.current) revealCaret(textarea);
    };
    const onViewport = () => {
      if (!composing.current) revealCaret(textarea);
    };

    textarea.addEventListener('compositionstart', onCompositionStart);
    textarea.addEventListener('compositionend', onCompositionEnd);
    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('beforeinput', onBeforeInput);
    textarea.addEventListener('copy', onCopy);
    textarea.addEventListener('cut', onCut);
    textarea.addEventListener('paste', onPaste);
    textarea.addEventListener('dragstart', onDragStart);
    textarea.addEventListener('dragover', onDragOver);
    textarea.addEventListener('drop', onDrop);
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keyup', onPlaceCaret);
    textarea.addEventListener('click', onPlaceCaret);
    window.visualViewport?.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('scroll', onViewport);

    return () => {
      replaceRef.current = () => false;
      insertSymbolRef.current = () => 'unavailable';
      wrapTracker.clear();
      trashCapture.clear();
      setLiveFlusher(null);
      flush(true);
      gate.cancel();
      setLiveReader(null);
      textarea.removeEventListener('compositionstart', onCompositionStart);
      textarea.removeEventListener('compositionend', onCompositionEnd);
      textarea.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('beforeinput', onBeforeInput);
      textarea.removeEventListener('copy', onCopy);
      textarea.removeEventListener('cut', onCut);
      textarea.removeEventListener('paste', onPaste);
      textarea.removeEventListener('dragstart', onDragStart);
      textarea.removeEventListener('dragover', onDragOver);
      textarea.removeEventListener('drop', onDrop);
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('keyup', onPlaceCaret);
      textarea.removeEventListener('click', onPlaceCaret);
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('scroll', onViewport);
    };
  }, [bookId, chapterId]);

  const replaceText = (next: string, caret: number, options?: { countForToday?: boolean }) =>
    replaceRef.current(next, caret, options);
  const insertSymbol = (symbolId: string) => insertSymbolRef.current(symbolId);
  return { ref, dirty, replaceText, insertSymbol };
}
