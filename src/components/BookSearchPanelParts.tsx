/**
 * WO-63 全書搜尋：寫作頁上的小零件。
 * - 圖示
 * - 正文反白疊層：目前這處深黃、其他處淡黃（疊在字的後面，不擋點擊、不動正文）
 * - 直拿拇指區暫時換成「第 N／M 處 ‹ › 回結果」
 * - useEditorSearch：把正文框接給搜尋（讀最新正文、整段換字、等組字送出），並處理跳到那一處
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  BACK_TO_RESULTS,
  BACK_TO_RESULTS_ARIA,
  NEXT_HIT_ARIA,
  PREV_HIT_ARIA,
  hitPositionLabel,
  hitWhereLabel,
} from '../copy/bookSearchCopy';
import { COMPOSITION_TIMEOUT_MS } from '../domain/writingCards';
import { measureCaret } from '../editor/caret';
import type { BookSearchController } from './BookSearchPanelState';
import { hitInText, hitsInText } from './BookSearchPanelModel';

function Stroke({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ size }: { size?: number }) {
  return (
    <Stroke size={size}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Stroke>
  );
}

export function SwapIcon({ size }: { size?: number }) {
  return (
    <Stroke size={size}>
      <path d="M4 8h14l-3-3" />
      <path d="M20 16H6l3 3" />
    </Stroke>
  );
}

export function UndoIcon({ size }: { size?: number }) {
  return (
    <Stroke size={size}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Stroke>
  );
}

export function CheckIcon({ size }: { size?: number }) {
  return (
    <Stroke size={size}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Stroke>
  );
}

export function CardsNoteIcon({ size }: { size?: number }) {
  return (
    <Stroke size={size}>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" />
    </Stroke>
  );
}

function ChevronSide({ dir, size = 22 }: { dir: 'left' | 'right'; size?: number }) {
  return <Stroke size={size}>{dir === 'left' ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}</Stroke>;
}

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

export interface EditorSearchHooks {
  /** 正文框要不要讓出背景（反白在字後面） */
  marking: boolean;
  overlay: ReactNode;
}

/**
 * 寫作頁接上搜尋。search 為 undefined（沒有搜尋功能的地方）時什麼都不做。
 * 不呼叫 blur()；跳到那一處只設定游標與捲動，不搶焦點、不開鍵盤。
 */
export function useEditorSearch({
  search,
  chapterId,
  textareaRef,
  isComposingRef,
  replaceText,
}: {
  search: BookSearchController | undefined;
  chapterId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isComposingRef: RefObject<boolean>;
  replaceText: (next: string, caret: number) => boolean;
}): EditorSearchHooks {
  const overlayRef = useRef<HTMLDivElement>(null);
  const replaceRef = useRef(replaceText);
  replaceRef.current = replaceText;
  const waiters = useRef<{ run: () => void; timer: number }[]>([]);
  const bridgeRef = search?.bridgeRef;

  // 掛上正文框
  useEffect(() => {
    if (!bridgeRef) return undefined;
    const textarea = textareaRef.current;
    const onEnd = () => {
      const list = waiters.current;
      waiters.current = [];
      // 等 useWritingSurface 收完這次組字（它在 microtask 處理）再做
      window.setTimeout(() => {
        for (const waiter of list) {
          window.clearTimeout(waiter.timer);
          waiter.run();
        }
      }, 0);
    };
    textarea?.addEventListener('compositionend', onEnd);
    bridgeRef.current = {
      chapterId,
      isComposing: () => Boolean(isComposingRef.current),
      readText: () => textareaRef.current?.value ?? '',
      replaceBody: (next) => {
        const el = textareaRef.current;
        if (!el) return false;
        const caret = Math.min(el.selectionStart ?? 0, next.length);
        return replaceRef.current(next, caret);
      },
      commitComposition: () => {
        const el = textareaRef.current;
        if (!el || document.activeElement !== el) return;
        // 不 blur、不移焦點：重設正文框的值，瀏覽器就會結束這次組字，組好（未選字）的字留在原位。
        // 結束時瀏覽器不會自己發 compositionend，所以補發一個，讓寫作頁照一般組字送出流程收尾。
        const text = el.value;
        const start = el.selectionStart ?? text.length;
        const end = el.selectionEnd ?? start;
        const scrollTop = el.scrollTop;
        el.value = `${text}\u200b`;
        el.value = text;
        el.setSelectionRange(start, end);
        el.scrollTop = scrollTop;
        el.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
      },
      afterComposition: (run, cancel) => {
        const timer = window.setTimeout(() => {
          waiters.current = waiters.current.filter((item) => item.timer !== timer);
          cancel();
        }, COMPOSITION_TIMEOUT_MS);
        waiters.current.push({ run, timer });
      },
    };
    return () => {
      textarea?.removeEventListener('compositionend', onEnd);
      for (const waiter of waiters.current) window.clearTimeout(waiter.timer);
      waiters.current = [];
      if (bridgeRef.current?.chapterId === chapterId) bridgeRef.current = null;
    };
  }, [bridgeRef, chapterId, textareaRef, isComposingRef]);

  const query = search?.open ? search.query : '';
  const activeOrdinal = search?.current && search.current.nodeId === chapterId ? search.current.ordinal : null;
  const marking = Boolean(search?.open && query.trim());

  const paintRef = useRef<() => void>(() => {});
  paintRef.current = () => {
    const overlay = overlayRef.current;
    const textarea = textareaRef.current;
    if (!overlay || !textarea) return;
    if (!marking || textarea.clientWidth <= 0) {
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
    hitsInText(text, query).forEach((hit, ordinal) => {
      if (hit.start > last) nodes.push(document.createTextNode(text.slice(last, hit.start)));
      const span = document.createElement('span');
      span.className = ordinal === activeOrdinal ? 'search-mark is-current' : 'search-mark';
      span.textContent = text.slice(hit.start, hit.end);
      nodes.push(span);
      last = hit.end;
    });
    nodes.push(document.createTextNode(`${text.slice(last)}​`));
    overlay.replaceChildren(...nodes);
    overlay.scrollTop = textarea.scrollTop;
  };

  useLayoutEffect(() => {
    paintRef.current();
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !marking) return undefined;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paintRef.current());
    };
    const onScroll = () => {
      const overlay = overlayRef.current;
      if (overlay) overlay.scrollTop = textarea.scrollTop;
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
    observer?.observe(textarea);
    textarea.addEventListener('input', later);
    textarea.addEventListener('compositionend', later);
    textarea.addEventListener('scroll', onScroll);
    window.addEventListener('resize', later);
    void document.fonts?.ready.then(later);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      textarea.removeEventListener('input', later);
      textarea.removeEventListener('compositionend', later);
      textarea.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', later);
    };
  }, [marking, textareaRef]);

  // 跳到那一處：用正文框裡最新的字重找第幾處，游標放在那處後面，捲到看得見。
  const appliedToken = useRef(-1);
  const focusToken = search?.focusToken ?? 0;
  useEffect(() => {
    if (!search?.open || activeOrdinal === null) return;
    if (appliedToken.current === focusToken) return;
    const textarea = textareaRef.current;
    if (!textarea || isComposingRef.current) return;
    appliedToken.current = focusToken;
    const hit = hitInText(textarea.value, search.query, activeOrdinal);
    if (!hit) return;
    textarea.setSelectionRange(hit.start, hit.start);
    const box = measureCaret(textarea);
    textarea.setSelectionRange(hit.end, hit.end);
    if (box) {
      textarea.scrollTop = Math.max(0, box.top - textarea.clientHeight * 0.35);
    }
    paintRef.current();
  }, [search?.open, search?.query, focusToken, activeOrdinal, textareaRef, isComposingRef]);

  const overlay = search ? (
    <div ref={overlayRef} className="search-mark-overlay" aria-hidden="true" data-testid="search-mark-overlay" />
  ) : null;
  return { marking, overlay };
}

/** 直拿：拇指區暫時換成「第 2／12 處 ‹ › 回結果」 */
export function SearchThumbNav({ search }: { search: BookSearchController }) {
  const thumb = search.thumb;
  if (!thumb) return null;
  const prev = () => search.step(-1);
  const next = () => search.step(1);
  return (
    <div className="search-thumb-nav" data-testid="search-thumb-nav">
      <div className="search-thumb-where">
        <span className="search-thumb-count" data-testid="search-thumb-count" aria-live="polite">
          {hitPositionLabel(thumb.index, thumb.total)}
        </span>
        <span className="search-thumb-sub">{hitWhereLabel(search.query, thumb.chapterTitle)}</span>
      </div>
      <button
        type="button"
        className="search-thumb-step"
        aria-label={PREV_HIT_ARIA}
        data-testid="search-prev"
        disabled={!thumb.canPrev}
        onPointerDown={(event) => search.guardDown(event, prev)}
        onClick={() => search.guardClick(prev)}
      >
        <ChevronSide dir="left" />
      </button>
      <button
        type="button"
        className="search-thumb-step"
        aria-label={NEXT_HIT_ARIA}
        data-testid="search-next"
        disabled={!thumb.canNext}
        onPointerDown={(event) => search.guardDown(event, next)}
        onClick={() => search.guardClick(next)}
      >
        <ChevronSide dir="right" />
      </button>
      <button
        type="button"
        className="search-thumb-back"
        aria-label={BACK_TO_RESULTS_ARIA}
        data-testid="search-back-to-results"
        onClick={search.backToResults}
      >
        {BACK_TO_RESULTS}
      </button>
    </div>
  );
}
