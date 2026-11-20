import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  BookOutlineIcon,
  EyeOffIcon,
  GripDotsIcon,
  UndoArrowIcon,
} from './Icons';
import {
  displayCardTitle,
  TIMELINE_BADGE_FLASHBACK,
  TIMELINE_BADGE_UNREVEALED,
  TIMELINE_DUAL_BOTTOM_DESC,
  TIMELINE_DUAL_BOTTOM_TITLE,
  TIMELINE_DUAL_LEGEND_CROSSING,
  TIMELINE_DUAL_LEGEND_FLASHBACK,
  TIMELINE_DUAL_LEGEND_NORMAL,
  TIMELINE_DUAL_LEGEND_UNASSIGNED,
  TIMELINE_DUAL_TIP_INTRO,
  TIMELINE_DUAL_TOP_DESC,
  TIMELINE_DUAL_TOP_TITLE,
  TIMELINE_EMPTY_HINT,
  TIMELINE_OPEN_CARD,
  TIMELINE_READER_NOT_YET,
  TIMELINE_UNASSIGNED_LABEL,
  TREE_DONE,
  TREE_MOVE_DOWN,
  TREE_MOVE_UP,
  timelineDragHandleAria,
  timelineDualTipDetail,
  timelineMovedLiveAnnouncement,
  timelineReadingOrderWide,
  timelineSelectedDockLabel,
  timelineStoryOrderWide,
} from '../copy/userFacing';
import { cardVisualStyles } from '../domain/cards';
import {
  computeDualAxisLines,
  type DualAxisLine,
  type DualAxisLinePair,
  type DualAxisRect,
  type TimelineDropTarget,
  type TimelineDualBottomGroup,
  type TimelineEventItem,
} from '../domain/timeline';
import { useLayout } from '../layout';
import { reduceDrag, type DragDrop, type DragState } from '../screens/dragSession';

const TAP_SLOP_PX = 6;
const EDGE_SCROLL_PX = 56;
const EDGE_SCROLL_STEP = 18;
const FALLBACK_CARD_WIDTH = 168;
const FALLBACK_CARD_GAP = 16;
const FALLBACK_STAGE_PAD_X = 28;
const FALLBACK_TOP_CARD_TOP = 52;
const FALLBACK_TOP_CARD_BOTTOM = 184;
const FALLBACK_BOTTOM_LABEL_TOP = 384;
const FALLBACK_BOTTOM_CARD_TOP = 424;
const FALLBACK_BOTTOM_CARD_BOTTOM = 556;
/** 對齊 timelineScreen.css 的 .timeline-dual-tip max-width */
export const DUAL_TIP_MAX_WIDTH = 420;

export interface DualTipOffsetParams {
  cardLeft: number;
  stageLeft: number;
  stageWidth: number;
  scrollLeft: number;
  viewportWidth: number;
}

/**
 * 計算雙軸對照提示泡泡的水平位移（相對於舞台左內距後緣），
 * 夾限於目前捲動可視範圍與舞台寬度之間，確保「開啟卡片」按鈕完整露出。
 */
export function computeDualTipOffsetLeft({
  cardLeft,
  stageLeft,
  stageWidth,
  scrollLeft,
  viewportWidth,
}: DualTipOffsetParams): number {
  const rawLeft = cardLeft - stageLeft - FALLBACK_STAGE_PAD_X;
  const stageMaxLeft = Math.max(0, stageWidth - FALLBACK_STAGE_PAD_X * 2 - DUAL_TIP_MAX_WIDTH);
  const hasViewport = viewportWidth > 0;
  const maxLeft = hasViewport
    ? Math.min(
        stageMaxLeft,
        Math.max(
          0,
          scrollLeft + viewportWidth - FALLBACK_STAGE_PAD_X * 2 - DUAL_TIP_MAX_WIDTH,
        ),
      )
    : stageMaxLeft;
  const minLeft = hasViewport
    ? Math.min(maxLeft, Math.max(0, scrollLeft - FALLBACK_STAGE_PAD_X))
    : 0;
  return Math.max(minLeft, Math.min(maxLeft, Math.round(rawLeft)));
}

interface MeasuredGeometry {
  stageBox: Pick<DualAxisRect, 'left' | 'top'>;
  bottomLabelTop: number;
  rectsById: Map<string, { topBox: DualAxisRect; bottomBox: DualAxisRect }>;
  stageWidth: number;
  stageHeight: number;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5;
}

function approxRectEqual(a: DualAxisRect, b: DualAxisRect): boolean {
  return (
    approxEqual(a.left, b.left) &&
    approxEqual(a.top, b.top) &&
    approxEqual(a.width, b.width) &&
    approxEqual(a.bottom, b.bottom)
  );
}

function isSameGeometry(prev: MeasuredGeometry | null, next: MeasuredGeometry): boolean {
  if (!prev) return false;
  if (prev.rectsById.size !== next.rectsById.size) return false;
  if (
    !approxEqual(prev.stageBox.left, next.stageBox.left) ||
    !approxEqual(prev.stageBox.top, next.stageBox.top) ||
    !approxEqual(prev.bottomLabelTop, next.bottomLabelTop) ||
    !approxEqual(prev.stageWidth, next.stageWidth) ||
    !approxEqual(prev.stageHeight, next.stageHeight)
  ) {
    return false;
  }
  for (const [id, nextBoxes] of next.rectsById) {
    const prevBoxes = prev.rectsById.get(id);
    if (!prevBoxes) return false;
    if (
      !approxRectEqual(prevBoxes.topBox, nextBoxes.topBox) ||
      !approxRectEqual(prevBoxes.bottomBox, nextBoxes.bottomBox)
    ) {
      return false;
    }
  }
  return true;
}

function buildFallbackLines(
  storyEvents: readonly TimelineEventItem[],
  dualBottomEvents: readonly TimelineEventItem[],
  selectedId: string | null,
): DualAxisLine[] {
  if (storyEvents.length === 0) return [];
  const bottomIndexById = new Map<string, number>();
  dualBottomEvents.forEach((item, idx) => {
    bottomIndexById.set(item.id, idx);
  });

  const pairs: DualAxisLinePair[] = storyEvents.map((item, topIdx) => {
    const botIdx = bottomIndexById.get(item.id) ?? topIdx;
    return {
      id: item.id,
      topBox: {
        left: FALLBACK_STAGE_PAD_X + topIdx * (FALLBACK_CARD_WIDTH + FALLBACK_CARD_GAP),
        top: FALLBACK_TOP_CARD_TOP,
        width: FALLBACK_CARD_WIDTH,
        bottom: FALLBACK_TOP_CARD_BOTTOM,
      },
      bottomBox: {
        left: FALLBACK_STAGE_PAD_X + botIdx * (FALLBACK_CARD_WIDTH + FALLBACK_CARD_GAP),
        top: FALLBACK_BOTTOM_CARD_TOP,
        width: FALLBACK_CARD_WIDTH,
        bottom: FALLBACK_BOTTOM_CARD_BOTTOM,
      },
      isFlashback: item.isFlashback,
      isUnassigned: item.isUnassigned,
    };
  });

  return computeDualAxisLines({ left: 0, top: 0 }, FALLBACK_BOTTOM_LABEL_TOP, pairs, selectedId);
}

export interface TimelineDualAxisViewProps {
  storyEvents: readonly TimelineEventItem[];
  dualBottomEvents: readonly TimelineEventItem[];
  dualBottomGroups: readonly TimelineDualBottomGroup[];
  selectedCardId?: string | null;
  initialSelectedEventId?: string | null;
  selectedMoveId: string | null;
  onSelectMoveId: (id: string | null) => void;
  onOpenCard: (cardId: string) => void;
  onMoveByDrop: (dragId: string, drop: TimelineDropTarget) => boolean;
  onMoveByDelta: (cardId: string, delta: -1 | 1) => boolean;
}

/**
 * 電腦寬版／平板橫放（layoutMode === 'wide'）專用「雙軸對照」畫面：
 * - 上排：故事真實順序（可水平拖曳、支援鍵盤 Alt+←/→ 與把手上 ←/→、底部上移／下移排序列與 aria-live 播報）
 * - 中間：SVG 三次貝茲曲線連線（順敘、倒敘 --flashback、未連章虛線，選取時加粗 3.5 置頂）
 * - 下排：讀者讀到的順序（跨欄章標頭，最後為還沒寫進任何章）
 * - 點擊任一卡上下同步亮起，下方提示泡泡顯示摘要與 ≥44px「開啟卡片」按鈕；雙擊卡片亦可直接開啟
 */
export function TimelineDualAxisView({
  storyEvents,
  dualBottomEvents,
  dualBottomGroups,
  selectedCardId = null,
  initialSelectedEventId,
  selectedMoveId,
  onSelectMoveId,
  onOpenCard,
  onMoveByDrop,
  onMoveByDelta,
}: TimelineDualAxisViewProps) {
  const { mode: layoutMode, bodyFontScale } = useLayout();

  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bottomLabelRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const topCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const bottomCardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const dragSessionRef = useRef<DragState>({ dragId: null, drop: null });
  const pressRef = useRef<{
    id: string;
    x: number;
    y: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const pendingScrollIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<{ id: string; target: 'card' | 'handle' } | null>(null);
  const pendingTipScrollRef = useRef(false);

  const defaultSelectedId = useMemo(
    () => storyEvents.find((e) => e.isFlashback)?.id ?? storyEvents[0]?.id ?? null,
    [storyEvents],
  );

  const [selectedEventId, setSelectedEventId] = useState<string | null>(() =>
    initialSelectedEventId !== undefined ? initialSelectedEventId : defaultSelectedId,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DragDrop | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [measuredGeo, setMeasuredGeo] = useState<MeasuredGeometry | null>(null);
  const [scrollViewport, setScrollViewport] = useState<{
    scrollLeft: number;
    viewportWidth: number;
  }>({ scrollLeft: 0, viewportWidth: 0 });

  // 當右側開啟卡片詳情時，同步將雙軸選取高亮對準該張卡
  useEffect(() => {
    if (selectedCardId && storyEvents.some((e) => e.id === selectedCardId)) {
      setSelectedEventId(selectedCardId);
    }
  }, [selectedCardId, storyEvents]);

  const activeSelectedId = useMemo(() => {
    if (selectedEventId === null) return null;
    if (storyEvents.some((e) => e.id === selectedEventId)) return selectedEventId;
    return defaultSelectedId;
  }, [selectedEventId, storyEvents, defaultSelectedId]);

  const selectedEvent = useMemo(
    () => (activeSelectedId ? (storyEvents.find((e) => e.id === activeSelectedId) ?? null) : null),
    [activeSelectedId, storyEvents],
  );

  const storyEventsRef = useRef(storyEvents);
  storyEventsRef.current = storyEvents;
  const moveByDropRef = useRef(onMoveByDrop);
  moveByDropRef.current = onMoveByDrop;
  const selectedMoveIdRef = useRef(selectedMoveId);
  selectedMoveIdRef.current = selectedMoveId;

  const setTopCardRef = (id: string, el: HTMLElement | null) => {
    if (el) {
      topCardRefs.current.set(id, el);
    } else {
      topCardRefs.current.delete(id);
    }
  };

  const setBottomCardRef = (id: string, el: HTMLElement | null) => {
    if (el) {
      bottomCardRefs.current.set(id, el);
    } else {
      bottomCardRefs.current.delete(id);
    }
  };

  const syncScrollViewport = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const nextLeft = Math.round(scrollEl.scrollLeft);
    const nextWidth = Math.round(scrollEl.clientWidth);
    setScrollViewport((prev) =>
      prev.scrollLeft === nextLeft && prev.viewportWidth === nextWidth
        ? prev
        : { scrollLeft: nextLeft, viewportWidth: nextWidth },
    );
  }, []);

  const measureGeometry = useCallback(() => {
    syncScrollViewport();
    const stageEl = stageRef.current;
    const bottomLabelEl = bottomLabelRef.current;
    const currentStory = storyEventsRef.current;
    if (!stageEl || !bottomLabelEl || currentStory.length === 0) {
      setMeasuredGeo((prev) => (prev === null ? null : null));
      return;
    }

    const stageRect = stageEl.getBoundingClientRect();
    const bottomLabelRect = bottomLabelEl.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    const rectsById = new Map<string, { topBox: DualAxisRect; bottomBox: DualAxisRect }>();
    for (const item of currentStory) {
      const topEl = topCardRefs.current.get(item.id);
      const botEl = bottomCardRefs.current.get(item.id);
      if (!topEl || !botEl) return;
      const topRect = topEl.getBoundingClientRect();
      const botRect = botEl.getBoundingClientRect();
      if (topRect.width <= 0 || botRect.width <= 0) return;
      rectsById.set(item.id, {
        topBox: {
          left: topRect.left,
          top: topRect.top,
          width: topRect.width,
          bottom: topRect.bottom,
        },
        bottomBox: {
          left: botRect.left,
          top: botRect.top,
          width: botRect.width,
          bottom: botRect.bottom,
        },
      });
    }

    const nextGeo: MeasuredGeometry = {
      stageBox: { left: stageRect.left, top: stageRect.top },
      bottomLabelTop: bottomLabelRect.top,
      rectsById,
      stageWidth: Math.max(stageEl.scrollWidth, Math.round(stageRect.width)),
      stageHeight: Math.max(stageEl.scrollHeight, Math.round(stageRect.height)),
    };

    setMeasuredGeo((prev) => (isSameGeometry(prev, nextGeo) ? prev : nextGeo));
  }, [syncScrollViewport]);

  const geometryDepsKey = useMemo(() => {
    const storySig = storyEvents
      .map(
        (e) =>
          `${e.id}:${e.storyPosition}:${e.chapter?.id ?? ''}:${e.chapter?.headerLead ?? ''}:${e.chapter?.headerSub ?? ''}:${e.storyTime}:${e.title}`,
      )
      .join('|');
    const bottomSig = dualBottomEvents.map((e) => e.id).join(',');
    return `${storySig}__${bottomSig}__${layoutMode}__${bodyFontScale}__${selectedCardId ?? ''}__${selectedMoveId ?? ''}`;
  }, [storyEvents, dualBottomEvents, layoutMode, bodyFontScale, selectedCardId, selectedMoveId]);

  useLayoutEffect(() => {
    measureGeometry();
  }, [geometryDepsKey, measureGeometry]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let active = true;
    let rafId: number | null = null;
    let scrollRafId: number | null = null;

    const scheduleMeasure = () => {
      if (!active || rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (!active) return;
        measureGeometry();
      });
    };

    const scheduleScrollSync = () => {
      if (!active || scrollRafId !== null) return;
      scrollRafId = window.requestAnimationFrame(() => {
        scrollRafId = null;
        if (!active) return;
        syncScrollViewport();
      });
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        scheduleMeasure();
      });
      if (scrollRef.current) observer.observe(scrollRef.current);
      if (stageRef.current) observer.observe(stageRef.current);
      if (bottomLabelRef.current) observer.observe(bottomLabelRef.current);
    }

    const scrollEl = scrollRef.current;
    scrollEl?.addEventListener('scroll', scheduleScrollSync, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          if (active) scheduleMeasure();
        })
        .catch(() => {});
    }

    scheduleMeasure();

    return () => {
      active = false;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (scrollRafId !== null) {
        window.cancelAnimationFrame(scrollRafId);
      }
      observer?.disconnect();
      scrollEl?.removeEventListener('scroll', scheduleScrollSync);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [geometryDepsKey, measureGeometry, syncScrollViewport]);

  const lines = useMemo<DualAxisLine[]>(() => {
    if (storyEvents.length === 0) return [];
    if (measuredGeo && storyEvents.every((e) => measuredGeo.rectsById.has(e.id))) {
      const pairs: DualAxisLinePair[] = storyEvents.map((item) => {
        const boxes = measuredGeo.rectsById.get(item.id)!;
        return {
          id: item.id,
          topBox: boxes.topBox,
          bottomBox: boxes.bottomBox,
          isFlashback: item.isFlashback,
          isUnassigned: item.isUnassigned,
        };
      });
      return computeDualAxisLines(
        measuredGeo.stageBox,
        measuredGeo.bottomLabelTop,
        pairs,
        activeSelectedId,
      );
    }
    return buildFallbackLines(storyEvents, dualBottomEvents, activeSelectedId);
  }, [storyEvents, dualBottomEvents, measuredGeo, activeSelectedId]);

  const tipOffsetLeft = useMemo<number | null>(() => {
    if (!activeSelectedId || !measuredGeo) return null;
    const boxes = measuredGeo.rectsById.get(activeSelectedId);
    if (!boxes) return null;
    return computeDualTipOffsetLeft({
      cardLeft: boxes.bottomBox.left,
      stageLeft: measuredGeo.stageBox.left,
      stageWidth: measuredGeo.stageWidth,
      scrollLeft: scrollViewport.scrollLeft,
      viewportWidth: scrollViewport.viewportWidth,
    });
  }, [activeSelectedId, measuredGeo, scrollViewport]);

  const handleSelectEvent = (cardId: string) => {
    if (cardId === activeSelectedId) {
      tipRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      return;
    }
    pendingTipScrollRef.current = true;
    setSelectedEventId(cardId);
  };

  const announcePositionAfterMove = (
    cardId: string,
    movedTitle: string,
    nextPos: number,
    total: number,
    focusTarget?: 'card' | 'handle',
  ) => {
    setLiveAnnouncement(timelineMovedLiveAnnouncement(displayCardTitle(movedTitle), nextPos, total));
    pendingScrollIdRef.current = cardId;
    pendingFocusRef.current = focusTarget ? { id: cardId, target: focusTarget } : null;
  };

  const triggerDeltaMove = (
    item: TimelineEventItem,
    delta: -1 | 1,
    focusTarget?: 'card' | 'handle',
  ) => {
    const currentIndex = storyEvents.findIndex((e) => e.id === item.id);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= storyEvents.length) return;
    const moved = onMoveByDelta(item.id, delta);
    if (moved) {
      announcePositionAfterMove(item.id, item.title, nextIndex + 1, storyEvents.length, focusTarget);
    }
  };

  useLayoutEffect(() => {
    if (pendingTipScrollRef.current) {
      pendingTipScrollRef.current = false;
      tipRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
    const id = pendingScrollIdRef.current;
    if (!id || !scrollRef.current) return;
    const cardEl = topCardRefs.current.get(id);
    cardEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const pendingFocus = pendingFocusRef.current;
    if (pendingFocus && pendingFocus.id === id) {
      const selector =
        pendingFocus.target === 'handle'
          ? '.timeline-dual-drag-handle'
          : '.timeline-dual-card-btn';
      cardEl?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
    }
    pendingScrollIdRef.current = null;
    pendingFocusRef.current = null;
  });

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press || event.pointerId !== press.pointerId) return;

      if (!press.moved) {
        const dx = event.clientX - press.x;
        const dy = event.clientY - press.y;
        if (dx * dx + dy * dy < TAP_SLOP_PX * TAP_SLOP_PX) return;
        press.moved = true;
        const started = reduceDrag({ dragId: null, drop: null }, { type: 'start', id: press.id });
        dragSessionRef.current = started.state;
        setDraggingId(started.state.dragId);
        setDrop(started.state.drop);
      }

      const pane = scrollRef.current;
      if (!pane) return;
      const rect = pane.getBoundingClientRect();
      if (event.clientX < rect.left + EDGE_SCROLL_PX) {
        pane.scrollLeft -= EDGE_SCROLL_STEP;
      } else if (event.clientX > rect.right - EDGE_SCROLL_PX) {
        pane.scrollLeft += EDGE_SCROLL_STEP;
      }

      const topCards = [...pane.querySelectorAll<HTMLElement>('[data-dual-top-id]')];
      if (topCards.length === 0) return;

      let hit = topCards.find((el) => {
        const box = el.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right;
      });
      if (!hit) {
        let bestDist = Number.POSITIVE_INFINITY;
        for (const el of topCards) {
          const box = el.getBoundingClientRect();
          const cx = box.left + box.width / 2;
          const dist = Math.abs(event.clientX - cx);
          if (dist < bestDist) {
            bestDist = dist;
            hit = el;
          }
        }
      }
      const hitId = hit?.dataset.dualTopId;
      if (!hitId || !hit) return;

      const box = hit.getBoundingClientRect();
      const step = reduceDrag(dragSessionRef.current, {
        type: 'hover',
        drop: { id: hitId, after: event.clientX > box.left + box.width / 2 },
      });
      dragSessionRef.current = step.state;
      setDrop(step.state.drop);
    };

    const finishPointer = (
      type: 'pointerup' | 'pointercancel' | 'lostpointercapture',
      pointerId?: number,
    ) => {
      const press = pressRef.current;
      if (!press) return;
      if (pointerId !== undefined && pointerId !== press.pointerId) return;

      const wasMoved = press.moved;
      pressRef.current = null;

      if (!wasMoved) {
        // 未移動的短按直接交由原生 onClick 處理，不在 pointerup 提前切換或設抑制旗標
        return;
      }

      if (type === 'pointerup') {
        suppressNextClickRef.current = true;
      }

      const step = reduceDrag(dragSessionRef.current, { type });
      dragSessionRef.current = step.state;
      setDraggingId(step.state.dragId);
      setDrop(step.state.drop);

      if (!step.move) return;
      const currentEvents = storyEventsRef.current;
      const movedEvent = currentEvents.find((e) => e.id === step.move!.dragId);
      const didMove = moveByDropRef.current(step.move.dragId, step.move.drop);
      if (didMove && movedEvent) {
        const ids = currentEvents.map((e) => e.id).filter((id) => id !== step.move!.dragId);
        const targetPos = ids.indexOf(step.move.drop.id);
        if (targetPos >= 0) {
          const insertPos = step.move.drop.after ? targetPos + 1 : targetPos;
          announcePositionAfterMove(
            movedEvent.id,
            movedEvent.title,
            insertPos + 1,
            currentEvents.length,
          );
        }
      }
    };

    const onUp = (e: PointerEvent) => finishPointer('pointerup', e.pointerId);
    const onCancel = (e: PointerEvent) => finishPointer('pointercancel', e.pointerId);
    const onLost = (e: Event) =>
      finishPointer('lostpointercapture', e instanceof PointerEvent ? e.pointerId : undefined);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onLost, true);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onLost, true);
    };
  }, []);

  const handleTopCardKeyDown = (
    item: TimelineEventItem,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) {
      event.preventDefault();
      triggerDeltaMove(item, -1, 'card');
    } else if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
      event.preventDefault();
      triggerDeltaMove(item, 1, 'card');
    }
  };

  const handleDragHandleKeyDown = (
    item: TimelineEventItem,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      suppressNextClickRef.current = false;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      triggerDeltaMove(item, -1, 'handle');
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      triggerDeltaMove(item, 1, 'handle');
    } else if (event.key === 'Escape' && selectedMoveIdRef.current) {
      event.preventDefault();
      onSelectMoveId(null);
    }
  };

  const handleDragHandlePointerDown = (
    item: TimelineEventItem,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextClickRef.current = false;
    pressRef.current = {
      id: item.id,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      moved: false,
    };
  };

  const selectedMoveIndex = selectedMoveId
    ? storyEvents.findIndex((e) => e.id === selectedMoveId)
    : -1;
  const selectedMoveEvent = selectedMoveIndex >= 0 ? storyEvents[selectedMoveIndex]! : null;
  const columnCount = Math.max(1, storyEvents.length);
  const gridTemplateColumns = `repeat(${columnCount}, minmax(168px, 1fr))`;
  const minStageWidthPx =
    storyEvents.length > 0
      ? storyEvents.length * FALLBACK_CARD_WIDTH +
        Math.max(0, storyEvents.length - 1) * FALLBACK_CARD_GAP +
        FALLBACK_STAGE_PAD_X * 2
      : 0;

  return (
    <div className="timeline-dual-view" data-testid="timeline-dual-view">
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="timeline-live-region"
      >
        {liveAnnouncement}
      </div>

      <div
        className="timeline-dual-scroll"
        ref={scrollRef}
        data-testid="timeline-dual-scroll"
      >
        {storyEvents.length === 0 ? (
          <div className="timeline-empty" data-testid="timeline-empty-hint">
            <p>{TIMELINE_EMPTY_HINT}</p>
          </div>
        ) : (
          <div
            className="timeline-dual-stage"
            ref={stageRef}
            style={{ minWidth: `${minStageWidthPx}px` }}
            data-testid="timeline-dual-stage"
          >
            <svg
              className="timeline-dual-lines"
              aria-hidden="true"
              width={measuredGeo?.stageWidth}
              height={measuredGeo?.stageHeight}
              data-testid="timeline-dual-svg"
            >
              {lines.map((line) => (
                <g
                  key={line.id}
                  className={[
                    'timeline-dual-line-group',
                    `is-${line.kind}`,
                    line.isSelected ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-testid={`timeline-dual-line-group-${line.id}`}
                >
                  <path
                    d={line.pathD}
                    fill="none"
                    stroke={line.stroke}
                    strokeWidth={line.strokeWidth}
                    strokeDasharray={line.strokeDasharray}
                    opacity={line.opacity}
                    data-line-kind={line.kind}
                    data-selected={line.isSelected ? 'true' : 'false'}
                    data-testid={`timeline-dual-path-${line.id}`}
                  />
                  <circle
                    cx={line.x2}
                    cy={line.y2}
                    r={4}
                    fill={line.stroke}
                    opacity={line.opacity}
                    data-testid={`timeline-dual-dot-${line.id}`}
                  />
                </g>
              ))}
            </svg>

            {/* 上排：故事真實順序 */}
            <div className="timeline-dual-row-label" data-testid="timeline-dual-top-header">
              <span className="timeline-dual-row-title">{TIMELINE_DUAL_TOP_TITLE}</span>
              <small className="timeline-dual-row-desc">{TIMELINE_DUAL_TOP_DESC}</small>
            </div>

            <div
              className="timeline-dual-row timeline-dual-top-row"
              style={{ gridTemplateColumns }}
              data-testid="timeline-dual-top-row"
            >
              {storyEvents.map((item) => {
                const visual = cardVisualStyles(item.color);
                const isSelected = activeSelectedId === item.id;
                const isOpened = selectedCardId === item.id;
                const isSelectedForMove = selectedMoveId === item.id;
                const isDragging = draggingId === item.id;
                const dropClass =
                  drop?.id === item.id ? (drop.after ? 'drop-after' : 'drop-before') : '';
                const storyTimeText = item.storyTime.trim();
                const titleText = displayCardTitle(item.title);

                return (
                  <div
                    key={item.id}
                    ref={(el) => setTopCardRef(item.id, el)}
                    className={[
                      'timeline-dual-card',
                      'timeline-dual-top-card',
                      item.isFlashback ? 'is-flashback' : '',
                      item.isUnassigned ? 'is-unassigned' : '',
                      isSelected ? 'is-selected' : '',
                      isOpened ? 'is-opened' : '',
                      isSelectedForMove ? 'is-move-selected' : '',
                      isDragging ? 'is-dragging' : '',
                      dropClass,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    data-dual-top-id={item.id}
                    data-event-id={item.id}
                    data-testid={`timeline-dual-top-card-${item.id}`}
                  >
                    <button
                      type="button"
                      className="timeline-dual-card-btn is-top"
                      onClick={() => handleSelectEvent(item.id)}
                      onDoubleClick={() => {
                        handleSelectEvent(item.id);
                        onOpenCard(item.id);
                      }}
                      onKeyDown={(e) => handleTopCardKeyDown(item, e)}
                      aria-pressed={isSelected}
                      aria-current={isOpened ? 'true' : undefined}
                      data-testid={`timeline-dual-top-btn-${item.id}`}
                    >
                      {visual && (
                        <span
                          className="timeline-dual-colorbar"
                          style={{ backgroundColor: visual.displayColor }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="timeline-dual-card-top">
                        <span
                          className="timeline-dual-order"
                          data-testid={`timeline-dual-top-order-${item.id}`}
                        >
                          {timelineStoryOrderWide(item.storyPosition)}
                        </span>
                      </span>
                      {storyTimeText !== '' && (
                        <span
                          className="timeline-card-when timeline-dual-when"
                          data-testid={`timeline-dual-top-when-${item.id}`}
                        >
                          {storyTimeText}
                        </span>
                      )}
                      <span className="timeline-dual-title">{titleText}</span>
                      <span className="timeline-dual-meta">
                        {item.chapter ? (
                          <span
                            className="timeline-chip is-chapter"
                            title={item.chapter.pickerLabel}
                            data-testid={`timeline-dual-top-chapter-chip-${item.id}`}
                          >
                            <BookOutlineIcon size={13} />
                            <span>{item.chapter.chipLabel}</span>
                          </span>
                        ) : (
                          <span
                            className="timeline-chip is-unassigned"
                            data-testid={`timeline-dual-top-unassigned-chip-${item.id}`}
                          >
                            <EyeOffIcon size={13} />
                            <span>{TIMELINE_UNASSIGNED_LABEL}</span>
                          </span>
                        )}
                        {item.isFlashback && (
                          <span
                            className="timeline-chip is-flashback"
                            data-testid={`timeline-dual-top-flashback-chip-${item.id}`}
                          >
                            <UndoArrowIcon size={13} />
                            <span>{TIMELINE_BADGE_FLASHBACK}</span>
                          </span>
                        )}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="timeline-drag-handle timeline-dual-drag-handle"
                      aria-label={timelineDragHandleAria(titleText)}
                      aria-pressed={isSelectedForMove}
                      onPointerDown={(e) => handleDragHandlePointerDown(item, e)}
                      onClick={() => {
                        if (suppressNextClickRef.current) {
                          suppressNextClickRef.current = false;
                          return;
                        }
                        onSelectMoveId(isSelectedForMove ? null : item.id);
                      }}
                      onKeyDown={(e) => handleDragHandleKeyDown(item, e)}
                      data-testid={`timeline-dual-handle-${item.id}`}
                    >
                      <GripDotsIcon size={18} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 中間 SVG 連線交叉視野區 */}
            <div className="timeline-dual-gap" aria-hidden="true" />

            {/* 下排：讀者讀到的順序 */}
            <div
              className="timeline-dual-row-label"
              ref={bottomLabelRef}
              data-testid="timeline-dual-bottom-header"
            >
              <span className="timeline-dual-row-title">{TIMELINE_DUAL_BOTTOM_TITLE}</span>
              <small className="timeline-dual-row-desc">{TIMELINE_DUAL_BOTTOM_DESC}</small>
            </div>

            <div
              className="timeline-dual-chapter-row"
              style={{ gridTemplateColumns }}
              data-testid="timeline-dual-chapter-row"
            >
              {dualBottomGroups.map((group) =>
                group.kind === 'chapter' ? (
                  <div
                    key={group.chapter.id}
                    className="timeline-dual-chapter-header"
                    style={{ gridColumn: `span ${group.span}` }}
                    data-testid={`timeline-dual-chapter-group-${group.chapter.id}`}
                  >
                    <b className="timeline-dual-chapter-lead">{group.chapter.headerLead}</b>
                    {group.chapter.headerSub !== '' && (
                      <span className="timeline-dual-chapter-sub">{group.chapter.headerSub}</span>
                    )}
                  </div>
                ) : (
                  <div
                    key="__unassigned__"
                    className="timeline-dual-chapter-header is-unassigned"
                    style={{ gridColumn: `span ${group.span}` }}
                    data-testid="timeline-dual-chapter-group-unassigned"
                  >
                    <b className="timeline-dual-chapter-lead">{TIMELINE_UNASSIGNED_LABEL}</b>
                  </div>
                ),
              )}
            </div>

            <div
              className="timeline-dual-row timeline-dual-bottom-row"
              style={{ gridTemplateColumns }}
              data-testid="timeline-dual-bottom-row"
            >
              {dualBottomEvents.map((item) => {
                const visual = cardVisualStyles(item.color);
                const isSelected = activeSelectedId === item.id;
                const isOpened = selectedCardId === item.id;
                const storyTimeText = item.storyTime.trim();
                const titleText = displayCardTitle(item.title);

                return (
                  <div
                    key={item.id}
                    ref={(el) => setBottomCardRef(item.id, el)}
                    className={[
                      'timeline-dual-card',
                      'timeline-dual-bottom-card',
                      item.isFlashback ? 'is-flashback' : '',
                      item.isUnassigned ? 'is-unassigned' : '',
                      isSelected ? 'is-selected' : '',
                      isOpened ? 'is-opened' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    data-dual-bottom-id={item.id}
                    data-testid={`timeline-dual-bottom-card-${item.id}`}
                  >
                    <button
                      type="button"
                      className="timeline-dual-card-btn is-bottom"
                      onClick={() => handleSelectEvent(item.id)}
                      onDoubleClick={() => {
                        handleSelectEvent(item.id);
                        onOpenCard(item.id);
                      }}
                      aria-pressed={isSelected}
                      aria-current={isOpened ? 'true' : undefined}
                      data-testid={`timeline-dual-bottom-btn-${item.id}`}
                    >
                      {visual && (
                        <span
                          className="timeline-dual-colorbar"
                          style={{ backgroundColor: visual.displayColor }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="timeline-dual-card-top">
                        <span
                          className="timeline-dual-order"
                          data-testid={`timeline-dual-bottom-order-${item.id}`}
                        >
                          {item.readingPosition !== null
                            ? timelineReadingOrderWide(item.readingPosition)
                            : TIMELINE_READER_NOT_YET}
                        </span>
                      </span>
                      {storyTimeText !== '' && (
                        <span
                          className="timeline-card-when timeline-dual-when"
                          data-testid={`timeline-dual-bottom-when-${item.id}`}
                        >
                          {storyTimeText}
                        </span>
                      )}
                      <span className="timeline-dual-title">{titleText}</span>
                      <span className="timeline-dual-meta">
                        <span
                          className="timeline-dual-story-ord"
                          data-testid={`timeline-dual-bottom-story-order-${item.id}`}
                        >
                          {timelineStoryOrderWide(item.storyPosition)}
                        </span>
                        {item.isFlashback && (
                          <span
                            className="timeline-chip is-flashback"
                            data-testid={`timeline-dual-bottom-flashback-chip-${item.id}`}
                          >
                            <UndoArrowIcon size={13} />
                            <span>{TIMELINE_BADGE_FLASHBACK}</span>
                          </span>
                        )}
                        {item.isUnassigned && (
                          <span
                            className="timeline-chip is-unassigned"
                            data-testid={`timeline-dual-bottom-unrevealed-chip-${item.id}`}
                          >
                            <EyeOffIcon size={13} />
                            <span>{TIMELINE_BADGE_UNREVEALED}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 下方提示泡泡 */}
            <div className="timeline-dual-tip-row">
              <div
                ref={tipRef}
                className="timeline-dual-tip"
                style={tipOffsetLeft !== null ? { marginLeft: `${tipOffsetLeft}px` } : undefined}
                data-testid="timeline-dual-tip"
              >
                <div className="timeline-dual-tip-text">
                  <p className="timeline-dual-tip-intro">{TIMELINE_DUAL_TIP_INTRO}</p>
                  {selectedEvent && (
                    <p
                      className="timeline-dual-tip-detail"
                      data-testid="timeline-dual-tip-detail"
                    >
                      {timelineDualTipDetail(
                        displayCardTitle(selectedEvent.title),
                        selectedEvent.storyPosition,
                        selectedEvent.chapter?.chipLabel ?? null,
                      )}
                    </p>
                  )}
                </div>
                {selectedEvent && (
                  <button
                    type="button"
                    className="timeline-dual-open-btn"
                    onClick={() => onOpenCard(selectedEvent.id)}
                    data-testid="timeline-dual-open-card-btn"
                  >
                    {TIMELINE_OPEN_CARD}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedMoveEvent && (
        <div className="timeline-organize-dock" data-testid="timeline-organize-dock">
          <p className="timeline-organize-label" data-testid="timeline-organize-label">
            {timelineSelectedDockLabel(displayCardTitle(selectedMoveEvent.title))}
          </p>
          <div className="timeline-organize-actions">
            <button
              type="button"
              disabled={selectedMoveIndex <= 0}
              onClick={() => triggerDeltaMove(selectedMoveEvent, -1)}
              data-testid="timeline-move-up-btn"
            >
              {TREE_MOVE_UP}
            </button>
            <button
              type="button"
              disabled={selectedMoveIndex < 0 || selectedMoveIndex >= storyEvents.length - 1}
              onClick={() => triggerDeltaMove(selectedMoveEvent, 1)}
              data-testid="timeline-move-down-btn"
            >
              {TREE_MOVE_DOWN}
            </button>
            <button
              type="button"
              className="is-done"
              onClick={() => onSelectMoveId(null)}
              data-testid="timeline-move-done-btn"
            >
              {TREE_DONE}
            </button>
          </div>
        </div>
      )}

      {/* 頁尾圖例列 */}
      <footer className="timeline-dual-footer" data-testid="timeline-dual-footer">
        <span className="timeline-dual-legend-item">
          <span className="timeline-dual-swatch is-normal" aria-hidden="true" />
          <span>{TIMELINE_DUAL_LEGEND_NORMAL}</span>
        </span>
        <span className="timeline-dual-legend-item">
          <span className="timeline-dual-swatch is-flashback" aria-hidden="true" />
          <span>{TIMELINE_DUAL_LEGEND_FLASHBACK}</span>
        </span>
        <span className="timeline-dual-legend-item">
          <span className="timeline-dual-swatch is-unassigned" aria-hidden="true" />
          <span>{TIMELINE_DUAL_LEGEND_UNASSIGNED}</span>
        </span>
        <span className="timeline-dual-legend-crossing">{TIMELINE_DUAL_LEGEND_CROSSING}</span>
      </footer>
    </div>
  );
}
