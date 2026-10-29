import { useEffect, useRef, useState } from 'react';
import { clipForBook, rememberBookClip } from './bookClip';
import { createClipMarker, decidePaste } from './clipboardPolicy';
import { setLiveReader } from './liveDraft';
import { revealCaret } from './caret';
import { decideEnterKey, IME_ENTER_WINDOW_MS, removeSpuriousLineBreak } from './enterGuard';
import { createIdleGate, IDLE_MS } from './idleGate';
import { classifyTextDelta, type TextChangeSource, type TextDelta } from '../domain/writingLog';

interface WritingSurfaceOptions {
  bookId: string;
  chapterId: string;
  onCommit: (text: string) => void;
  onLarge: (delta: TextDelta) => void;
  onDuration: (seconds: number) => void;
  onToast: (message: string) => void;
}

export function useWritingSurface({
  bookId,
  chapterId,
  onCommit,
  onLarge,
  onDuration,
  onToast,
}: WritingSurfaceOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dirty, setDirty] = useState(false);
  const onCommitRef = useRef(onCommit);
  const onLargeRef = useRef(onLarge);
  const onDurationRef = useRef(onDuration);
  const onToastRef = useRef(onToast);
  onCommitRef.current = onCommit;
  onLargeRef.current = onLarge;
  onDurationRef.current = onDuration;
  onToastRef.current = onToast;

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
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
    setLiveReader(() => ({ projectId: bookId, chapterId, text: textarea.value }));
    let lastActivity = 0;
    let billedUntil = 0;
    const gate = createIdleGate(IDLE_MS);

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
      commit(textarea.value);
      if (!fromCleanup) setDirty(false);
    };

    const process = (nextSource?: TextChangeSource) => {
      if (composing.current) return;
      const next = textarea.value;
      if (next === latest.current) return;
      const delta = classifyTextDelta(latest.current, next, { source: nextSource ?? source.current });
      latest.current = next;
      source.current = 'type';
      mark();
      if (delta.largeInsert || delta.largeDelete) noteLarge(delta);
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
        toast('外面的文字不能貼進來');
        return;
      }
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      source.current = 'paste';
      textarea.setRangeText(decision.text, start, end, 'end');
      process('paste');
      textarea.focus();
      revealCaret(textarea);
      gate.schedule(() => flush());
    };

    const onCompositionStart = () => {
      composing.current = true;
      gate.setComposing(true);
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
      const marker = createClipMarker();
      rememberBookClip(bookId, { text, marker });
      event.clipboardData?.setData('text/plain', marker);
      toast('已複製，只能貼回這個編輯器');
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
      const marker = createClipMarker();
      rememberBookClip(bookId, { text, marker });
      event.clipboardData?.setData('text/plain', marker);
      textarea.setRangeText('', start, end, 'end');
      process('type');
      gate.schedule(() => flush());
      toast('已剪下，只能貼回這個編輯器');
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

  return { ref, dirty };
}
