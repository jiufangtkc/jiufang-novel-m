import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  HALF_WIDTH_CONVERT,
  HALF_WIDTH_SKIP,
  HALF_WIDTH_UNDO,
  halfWidthBubbleAria,
  halfWidthDone,
  halfWidthDoneAria,
  halfWidthNoticeLong,
  halfWidthNoticeLongAria,
  halfWidthNoticeShort,
  halfWidthNoticeShortAria,
  halfWidthNoticeShortExpandAria,
} from '../copy/halfWidthCopy';
import {
  applyHalfWidthMarks,
  convertHalfWidthInChapter,
  findHalfWidthMarks,
  markAtCaret,
  type HalfWidthMark,
} from '../domain/halfWidthPunct';
import { createHalfWidthScanner, type HalfWidthScanner } from '../editor/halfWidthScanner';
import './halfWidth.css';
import {
  isHalfWidthSkipped,
  noteHalfWidthBook,
  skipHalfWidthForChapter,
} from '../state/halfWidthReminder';

/**
 * WO-76 乙段：正文半形標點提醒。
 *
 * - 停筆 3 秒、而且沒有在組字才檢查；compositionend 之後重新計時。
 * - 檢查只更新底線與數量，不動游標、不改正文、不搶鍵盤。
 * - 底線畫在正文上方一層透明疊層，字型、字級、行高、字距、內距、寬度與捲動都照抄正文。
 * - 改成全形、復原都走 useWritingSurface 的 replaceText → 既有 commit-text。
 */

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** 疊層要照抄正文的樣式，換行與位置才會一樣。 */
const MIRROR_FIELDS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontFeatureSettings',
  'fontKerning',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textIndent',
  'textTransform',
  'textRendering',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
  'lineBreak',
  'tabSize',
  'direction',
] as const;

interface HalfWidthResult {
  count: number;
  before: string;
  beforeCaret: number;
  after: string;
}

export interface BubbleState {
  mark: HalfWidthMark;
  top: number;
  left: number;
}

export interface HalfWidthController {
  /** 這一章目前有幾處（只在檢查後更新）。 */
  count: number;
  /** 最後一次輸入之後還沒停筆檢查。 */
  typing: boolean;
  skipped: boolean;
  result: HalfWidthResult | null;
  bubble: BubbleState | null;
  overlayRef: RefObject<HTMLDivElement | null>;
  convertAll: () => void;
  convertOne: (mark: HalfWidthMark) => void;
  skip: () => void;
  undo: () => void;
}

export function useHalfWidthReminder({
  textareaRef,
  bookId,
  chapterId,
  enabled,
  focusMode,
  bodyFontScale,
  layoutMode,
  replaceText,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  bookId: string;
  chapterId: string;
  enabled: boolean;
  focusMode: boolean;
  bodyFontScale: number;
  layoutMode: string;
  replaceText: (next: string, caret: number) => boolean;
}): HalfWidthController {
  const overlayRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HalfWidthMark[]>([]);
  const spansRef = useRef<HTMLSpanElement[]>([]);
  const scannerRef = useRef<HalfWidthScanner | null>(null);
  const [count, setCount] = useState(0);
  const [typing, setTyping] = useState(false);
  const [result, setResult] = useState<HalfWidthResult | null>(null);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [skipTick, setSkipTick] = useState(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  const replaceRef = useRef(replaceText);
  replaceRef.current = replaceText;

  noteHalfWidthBook(bookId);
  const skipped = isHalfWidthSkipped(bookId, chapterId);
  void skipTick;
  const skippedRef = useRef(skipped);
  skippedRef.current = skipped;

  const composing = () => Boolean(scannerRef.current?.composing);

  /** 把疊層放到正文正上方，照抄樣式，畫出底線。不碰正文。 */
  const paint = useCallback(() => {
    const overlay = overlayRef.current;
    const textarea = textareaRef.current;
    if (!overlay || !textarea) return;
    const marks = enabledRef.current ? marksRef.current : [];
    spansRef.current = [];
    if (marks.length === 0 || textarea.clientWidth <= 0) {
      overlay.replaceChildren();
      overlay.style.display = 'none';
      return;
    }
    const style = getComputedStyle(textarea);
    for (const field of MIRROR_FIELDS) {
      (overlay.style as unknown as Record<string, string>)[field] = style[field];
    }
    overlay.style.display = 'block';
    const parent = (overlay.offsetParent as HTMLElement | null) ?? document.body;
    const parentRect = parent.getBoundingClientRect();
    const rect = textarea.getBoundingClientRect();
    overlay.style.left = `${rect.left - parentRect.left - parent.clientLeft + parent.scrollLeft + textarea.clientLeft}px`;
    overlay.style.top = `${rect.top - parentRect.top - parent.clientTop + parent.scrollTop + textarea.clientTop}px`;
    overlay.style.width = `${textarea.clientWidth}px`;
    overlay.style.height = `${textarea.clientHeight}px`;
    const text = textarea.value;
    const nodes: Node[] = [];
    let last = 0;
    for (const mark of marks) {
      if (mark.start < last || mark.end > text.length) continue;
      if (mark.start > last) nodes.push(document.createTextNode(text.slice(last, mark.start)));
      const span = document.createElement('span');
      span.className = 'half-width-mark';
      span.textContent = text.slice(mark.start, mark.end);
      spansRef.current.push(span);
      nodes.push(span);
      last = mark.end;
    }
    // 結尾補一個零寬字，正文最後是換行時，疊層也能捲到同一個高度。
    nodes.push(document.createTextNode(`${text.slice(last)}\u200b`));
    overlay.replaceChildren(...nodes);
    overlay.scrollTop = textarea.scrollTop;
  }, [textareaRef]);

  const placeBubble = useCallback(() => {
    const textarea = textareaRef.current;
    const scanner = scannerRef.current;
    if (!textarea || !scanner || !enabledRef.current || skippedRef.current || focusModeRef.current || scanner.composing) {
      setBubble(null);
      return;
    }
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    if (start !== end || scanner.text !== textarea.value) {
      setBubble(null);
      return;
    }
    const mark = markAtCaret(marksRef.current, start);
    const index = mark ? marksRef.current.indexOf(mark) : -1;
    const span = index >= 0 ? spansRef.current[index] : undefined;
    const overlay = overlayRef.current;
    if (!mark || !span || !overlay) {
      setBubble(null);
      return;
    }
    const parent = (overlay.offsetParent as HTMLElement | null) ?? document.body;
    const parentRect = parent.getBoundingClientRect();
    const box = textarea.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || spanRect.height;
    // 泡泡放在游標那一行上方；上方放不下才放到下一行下面，都不蓋住游標那一行。
    const lineTop = spanRect.top + spanRect.height / 2 - lineHeight / 2;
    const bubbleHeight = 44;
    let top = lineTop - bubbleHeight - 4;
    if (top < box.top) top = lineTop + lineHeight + 4;
    const left = Math.min(Math.max(spanRect.left - 24, box.left + 4), box.right - 120);
    setBubble({
      mark,
      top: top - parentRect.top + parent.scrollTop,
      left: left - parentRect.left + parent.scrollLeft,
    });
  }, [textareaRef]);

  // 換章：先清掉舊章的結果，再檢查新章。延後的計時一併取消，不把上一章結果套到新章。
  // 用 useEffect：排在 useWritingSurface 換好正文之後才讀。
  useEffect(() => {
    const textarea = textareaRef.current;
    marksRef.current = [];
    setResult(null);
    setBubble(null);
    setTyping(false);
    if (!textarea) return undefined;
    const scanner = createHalfWidthScanner({
      read: () => textarea.value,
      onScan: (marks) => {
        marksRef.current = marks;
        setCount(marks.length);
        setTyping(false);
        paint();
      },
      onShift: (marks) => {
        // 還沒停筆：只把舊底線跟著平移，不重新檢查。
        marksRef.current = marks;
        setTyping(true);
        setBubble(null);
        setResult(null);
        paint();
      },
    });
    scannerRef.current = scanner;
    scanner.start();

    const onInput = () => scanner.input();
    const onCompositionStart = () => {
      scanner.compositionStart();
      setBubble(null);
    };
    const onCompositionEnd = () => scanner.compositionEnd();
    const onScroll = () => {
      const overlay = overlayRef.current;
      if (overlay) overlay.scrollTop = textarea.scrollTop;
      setBubble(null);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (NAV_KEYS.has(event.key) && !event.isComposing) placeBubble();
    };
    const onClick = () => placeBubble();
    const onBlur = () => {
      setBubble(null);
      // 收起鍵盤：已經選完字就不等 3 秒，直接檢查。
      scanner.blur();
    };

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('compositionstart', onCompositionStart);
    textarea.addEventListener('compositionend', onCompositionEnd);
    textarea.addEventListener('scroll', onScroll);
    textarea.addEventListener('keyup', onKeyUp);
    textarea.addEventListener('click', onClick);
    textarea.addEventListener('blur', onBlur);
    return () => {
      scanner.cancel();
      if (scannerRef.current === scanner) scannerRef.current = null;
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('compositionstart', onCompositionStart);
      textarea.removeEventListener('compositionend', onCompositionEnd);
      textarea.removeEventListener('scroll', onScroll);
      textarea.removeEventListener('keyup', onKeyUp);
      textarea.removeEventListener('click', onClick);
      textarea.removeEventListener('blur', onBlur);
    };
  }, [chapterId, textareaRef, paint, placeBubble]);

  const scan = () => scannerRef.current?.rescan();

  // 字級、版面、專注模式、開關改了，或正文框大小改了，就重畫一次底線位置。
  useLayoutEffect(() => {
    paint();
    setBubble(null);
  }, [paint, enabled, focusMode, bodyFontScale, layoutMode]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return undefined;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint());
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
    observer?.observe(textarea);
    window.addEventListener('resize', later);
    document.addEventListener('transitionend', later);
    void document.fonts?.ready.then(later);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', later);
      document.removeEventListener('transitionend', later);
    };
  }, [paint, textareaRef]);

  const convertAll = () => {
    const textarea = textareaRef.current;
    if (!textarea || composing()) return;
    const before = textarea.value;
    const beforeCaret = textarea.selectionStart ?? 0;
    const converted = convertHalfWidthInChapter(before, beforeCaret);
    if (converted.count === 0) {
      scan();
      return;
    }
    if (!replaceRef.current(converted.text, converted.caret)) return;
    scan();
    setBubble(null);
    setResult({ count: converted.count, before, beforeCaret, after: converted.text });
  };

  const convertOne = (mark: HalfWidthMark) => {
    const textarea = textareaRef.current;
    if (!textarea || composing()) return;
    const text = textarea.value;
    // 正文和檢查時不一樣了，就重新檢查一次，不換錯位置。
    const fresh = findHalfWidthMarks(text).find((item) => item.start === mark.start && item.end === mark.end);
    if (!fresh) {
      scan();
      setBubble(null);
      return;
    }
    const caret = textarea.selectionStart ?? 0;
    const converted = applyHalfWidthMarks(text, [fresh], caret);
    if (!replaceRef.current(converted.text, converted.caret)) return;
    scan();
    setBubble(null);
  };

  const undo = () => {
    const textarea = textareaRef.current;
    if (!textarea || !result || composing()) return;
    if (textarea.value === result.after) {
      if (!replaceRef.current(result.before, result.beforeCaret)) return;
    }
    setResult(null);
    scan();
  };

  const skip = () => {
    skipHalfWidthForChapter(bookId, chapterId);
    skippedRef.current = true;
    setResult(null);
    setBubble(null);
    setSkipTick((value) => value + 1);
  };

  return { count, typing, skipped, result, bubble, overlayRef, convertAll, convertOne, skip, undo };
}

/** 按下時不搶走正文的焦點，鍵盤不收起。 */
const keepFocus = (event: React.PointerEvent | React.MouseEvent) => event.preventDefault();

export function HalfWidthOverlay({ controller }: { controller: HalfWidthController }) {
  return <div ref={controller.overlayRef} className="half-width-overlay" aria-hidden="true" data-testid="half-width-overlay" />;
}

export function HalfWidthBubble({ controller }: { controller: HalfWidthController }) {
  const { bubble } = controller;
  if (!bubble || controller.skipped) return null;
  return (
    <button
      type="button"
      className="half-width-bubble"
      data-testid="half-width-bubble"
      style={{ top: bubble.top, left: bubble.left }}
      aria-label={halfWidthBubbleAria(bubble.mark.kind)}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={() => controller.convertOne(bubble.mark)}
    >
      {HALF_WIDTH_CONVERT}
    </button>
  );
}

function ResultLine({ controller, className }: { controller: HalfWidthController; className: string }) {
  const { result } = controller;
  if (!result) return null;
  return (
    <div className={className} data-testid="half-width-result" role="status">
      <span className="half-width-text">{halfWidthDone(result.count)}</span>
      <button
        type="button"
        className="half-width-action"
        data-testid="half-width-undo"
        aria-label={halfWidthDoneAria(result.count)}
        onClick={controller.undo}
      >
        {HALF_WIDTH_UNDO}
      </button>
    </div>
  );
}

/** ① 手機直拿：拇指區正上方的淡色細條。甲案；字級大或放不下一行就改乙案。 */
export function HalfWidthStrip({
  controller,
  preferShort,
}: {
  controller: HalfWidthController;
  preferShort: boolean;
}) {
  const slotRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  const { count, result } = controller;

  useLayoutEffect(() => {
    const check = () => {
      const slot = slotRef.current;
      const measure = measureRef.current;
      if (!slot || !measure) return;
      setFits(measure.offsetWidth <= slot.clientWidth);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [count, result]);

  if (result) return <ResultLine controller={controller} className="half-width-strip" />;
  const short = preferShort || !fits;
  return (
    <div className="half-width-strip" data-testid="half-width-strip" data-variant={short ? 'short' : 'long'}>
      <span className="half-width-text" ref={slotRef}>
        {short ? halfWidthNoticeShort(count) : halfWidthNoticeLong(count)}
      </span>
      <span className="half-width-measure" ref={measureRef} aria-hidden="true">
        {halfWidthNoticeLong(count)}
      </span>
      <button
        type="button"
        className="half-width-action is-primary"
        data-testid="half-width-convert"
        aria-label={short ? halfWidthNoticeShortAria(count) : halfWidthNoticeLongAria(count)}
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={controller.convertAll}
      >
        {HALF_WIDTH_CONVERT}
      </button>
      <button
        type="button"
        className="half-width-action"
        data-testid="half-width-skip"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={controller.skip}
      >
        {HALF_WIDTH_SKIP}
      </button>
    </div>
  );
}

/**
 * ②③④ 頁首乙案。
 * 橫拿：點一下直接改成全形。中等與寬版：點一下展開甲案小卡。
 */
export function HalfWidthBadge({
  controller,
  expandable,
}: {
  controller: HalfWidthController;
  expandable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { count, result } = controller;
  useEffect(() => {
    if (count === 0 || controller.skipped) setOpen(false);
  }, [count, controller.skipped]);

  if (result) return <ResultLine controller={controller} className="half-width-badge-result" />;
  return (
    <span className="half-width-badge-wrap">
      <button
        type="button"
        className="half-width-badge"
        data-testid="half-width-badge"
        aria-label={expandable ? halfWidthNoticeShortExpandAria(count) : halfWidthNoticeShortAria(count)}
        aria-expanded={expandable ? open : undefined}
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => (expandable ? setOpen((value) => !value) : controller.convertAll())}
      >
        {halfWidthNoticeShort(count)}
      </button>
      {expandable && open && (
        <div className="half-width-card" data-testid="half-width-card">
          <p className="half-width-text">{halfWidthNoticeLong(count)}</p>
          <div className="half-width-card-actions">
            <button
              type="button"
              className="half-width-action is-primary"
              data-testid="half-width-convert"
              aria-label={halfWidthNoticeLongAria(count)}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => {
                setOpen(false);
                controller.convertAll();
              }}
            >
              {HALF_WIDTH_CONVERT}
            </button>
            <button
              type="button"
              className="half-width-action"
              data-testid="half-width-skip"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => {
                setOpen(false);
                controller.skip();
              }}
            >
              {HALF_WIDTH_SKIP}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
