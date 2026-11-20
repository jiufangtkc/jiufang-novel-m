import {
  useEffect,
  useLayoutEffect,
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
  TIMELINE_EMPTY_HINT,
  TIMELINE_STORY_HINT,
  TIMELINE_UNASSIGNED_LABEL,
  TREE_DONE,
  TREE_MOVE_DOWN,
  TREE_MOVE_UP,
  timelineDragHandleAria,
  timelineMovedLiveAnnouncement,
  timelineSelectedDockLabel,
} from '../copy/userFacing';
import { cardVisualStyles } from '../domain/cards';
import {
  type TimelineDropTarget,
  type TimelineEventItem,
} from '../domain/timeline';
import { reduceDrag, type DragDrop, type DragState } from '../screens/dragSession';

const TAP_SLOP_PX = 6;
const EDGE_SCROLL_PX = 56;
const EDGE_SCROLL_STEP = 16;

export interface TimelineStoryViewProps {
  events: readonly TimelineEventItem[];
  selectedCardId?: string | null;
  selectedMoveId: string | null;
  onSelectMoveId: (id: string | null) => void;
  onSelectEvent: (cardId: string) => void;
  onMoveByDrop: (dragId: string, drop: TimelineDropTarget) => boolean;
  onMoveByDelta: (cardId: string, delta: -1 | 1) => boolean;
}

export function TimelineStoryView({
  events,
  selectedCardId = null,
  selectedMoveId,
  onSelectMoveId,
  onSelectEvent,
  onMoveByDrop,
  onMoveByDelta,
}: TimelineStoryViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DragDrop | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const eventsRef = useRef(events);
  eventsRef.current = events;
  const moveByDropRef = useRef(onMoveByDrop);
  moveByDropRef.current = onMoveByDrop;
  const selectedMoveIdRef = useRef(selectedMoveId);
  selectedMoveIdRef.current = selectedMoveId;

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
    const currentIndex = events.findIndex((e) => e.id === item.id);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= events.length) return;
    const moved = onMoveByDelta(item.id, delta);
    if (moved) {
      announcePositionAfterMove(item.id, item.title, nextIndex + 1, events.length, focusTarget);
    }
  };

  useLayoutEffect(() => {
    const id = pendingScrollIdRef.current;
    if (!id || !scrollRef.current) return;
    const rows = scrollRef.current.querySelectorAll<HTMLElement>('[data-event-id]');
    const row = Array.from(rows).find((el) => el.dataset.eventId === id);
    row?.scrollIntoView({ block: 'nearest' });
    const pendingFocus = pendingFocusRef.current;
    if (pendingFocus && pendingFocus.id === id) {
      const selector =
        pendingFocus.target === 'handle' ? '.timeline-drag-handle' : '.timeline-card-body-btn';
      row?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
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
      if (event.clientY < rect.top + EDGE_SCROLL_PX) {
        pane.scrollTop -= EDGE_SCROLL_STEP;
      } else if (event.clientY > rect.bottom - EDGE_SCROLL_PX) {
        pane.scrollTop += EDGE_SCROLL_STEP;
      }

      const rows = [...pane.querySelectorAll<HTMLElement>('[data-event-id]')];
      const hit = rows.find((row) => {
        const box = row.getBoundingClientRect();
        return event.clientY >= box.top && event.clientY <= box.bottom;
      });
      if (!hit?.dataset.eventId) return;

      const box = hit.getBoundingClientRect();
      const step = reduceDrag(dragSessionRef.current, {
        type: 'hover',
        drop: { id: hit.dataset.eventId, after: event.clientY > box.top + box.height / 2 },
      });
      dragSessionRef.current = step.state;
      setDrop(step.state.drop);
    };

    const finishPointer = (type: 'pointerup' | 'pointercancel' | 'lostpointercapture', pointerId?: number) => {
      const press = pressRef.current;
      if (!press) return;
      if (pointerId !== undefined && pointerId !== press.pointerId) return;

      const wasMoved = press.moved;
      pressRef.current = null;

      if (!wasMoved) {
        // 未移動的短按直接交由原生 onClick 處理，不在 pointerup 提前切換或設抑制旗標
        return;
      }

      // 只在真的移動過（包含拉動後又放回原位）後抑制緊接的一次 click，避免意外跳出排序列
      if (type === 'pointerup') {
        suppressNextClickRef.current = true;
      }

      const step = reduceDrag(dragSessionRef.current, { type });
      dragSessionRef.current = step.state;
      setDraggingId(step.state.dragId);
      setDrop(step.state.drop);

      if (!step.move) return;
      const currentEvents = eventsRef.current;
      const movedEvent = currentEvents.find((e) => e.id === step.move!.dragId);
      const didMove = moveByDropRef.current(step.move.dragId, step.move.drop);
      if (didMove && movedEvent) {
        // 計算落點後在新順序中的 1-based 位置
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

  const handleCardKeyDown = (item: TimelineEventItem, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      triggerDeltaMove(item, -1, 'card');
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      triggerDeltaMove(item, 1, 'card');
    }
  };

  const handleDragHandleKeyDown = (item: TimelineEventItem, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      suppressNextClickRef.current = false;
    } else if ((event.altKey && event.key === 'ArrowUp') || event.key === 'ArrowUp') {
      event.preventDefault();
      triggerDeltaMove(item, -1, 'handle');
    } else if ((event.altKey && event.key === 'ArrowDown') || event.key === 'ArrowDown') {
      event.preventDefault();
      triggerDeltaMove(item, 1, 'handle');
    } else if (event.key === 'Escape' && selectedMoveIdRef.current) {
      event.preventDefault();
      onSelectMoveId(null);
    }
  };

  const handleDragHandlePointerDown = (item: TimelineEventItem, event: ReactPointerEvent<HTMLButtonElement>) => {
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

  const selectedMoveIndex = selectedMoveId ? events.findIndex((e) => e.id === selectedMoveId) : -1;
  const selectedMoveEvent = selectedMoveIndex >= 0 ? events[selectedMoveIndex]! : null;

  return (
    <div className="timeline-story-view" data-testid="timeline-story-view">
      <p className="timeline-hint" data-testid="timeline-story-hint">
        {TIMELINE_STORY_HINT}
      </p>

      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="timeline-live-region"
      >
        {liveAnnouncement}
      </div>

      <div className="timeline-scroll-pane" ref={scrollRef} data-testid="timeline-story-scroll">
        {events.length === 0 ? (
          <div className="timeline-empty" data-testid="timeline-empty-hint">
            <p>{TIMELINE_EMPTY_HINT}</p>
          </div>
        ) : (
          <ul className="timeline-story-list" data-testid="timeline-story-list">
            {events.map((item) => {
              const visual = cardVisualStyles(item.color);
              const isDragging = draggingId === item.id;
              const dropClass =
                drop?.id === item.id ? (drop.after ? 'drop-after' : 'drop-before') : '';
              const isSelectedForMove = selectedMoveId === item.id;
              const isOpened = selectedCardId === item.id;
              const isFlashback = item.isFlashback;
              const storyTimeText = item.storyTime.trim();
              const titleText = displayCardTitle(item.title);

              return (
                <li
                  key={item.id}
                  className={[
                    'timeline-story-item',
                    isDragging ? 'is-dragging' : '',
                    dropClass,
                    isSelectedForMove ? 'is-move-selected' : '',
                    isOpened ? 'is-opened' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-event-id={item.id}
                  data-testid={`timeline-event-${item.id}`}
                >
                  <span
                    className={`timeline-dot${item.isUnassigned ? ' is-hollow' : ''}`}
                    aria-hidden="true"
                  />
                  <div className="timeline-story-card">
                    <button
                      type="button"
                      className="timeline-card-body-btn"
                      onClick={() => onSelectEvent(item.id)}
                      onKeyDown={(e) => handleCardKeyDown(item, e)}
                      aria-current={isOpened ? 'true' : undefined}
                      data-testid={`timeline-card-btn-${item.id}`}
                    >
                      {visual && (
                        <span
                          className="timeline-card-colorbar"
                          style={{ backgroundColor: visual.displayColor }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="timeline-card-content">
                        {storyTimeText !== '' && (
                          <span className="timeline-card-when" data-testid={`timeline-when-${item.id}`}>
                            {storyTimeText}
                          </span>
                        )}
                        <span className="timeline-card-title">{titleText}</span>
                        <span className="timeline-card-meta">
                          {item.chapter ? (
                            <span
                              className="timeline-chip is-chapter"
                              title={item.chapter.pickerLabel}
                              data-testid={`timeline-chapter-chip-${item.id}`}
                            >
                              <BookOutlineIcon size={13} />
                              <span>{item.chapter.chipLabel}</span>
                            </span>
                          ) : (
                            <span
                              className="timeline-chip is-unassigned"
                              data-testid={`timeline-unassigned-chip-${item.id}`}
                            >
                              <EyeOffIcon size={13} />
                              <span>{TIMELINE_UNASSIGNED_LABEL}</span>
                            </span>
                          )}
                          {isFlashback && (
                            <span
                              className="timeline-chip is-flashback"
                              data-testid={`timeline-flashback-chip-${item.id}`}
                            >
                              <UndoArrowIcon size={13} />
                              <span>{TIMELINE_BADGE_FLASHBACK}</span>
                            </span>
                          )}
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="timeline-drag-handle"
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
                      data-testid={`timeline-handle-${item.id}`}
                    >
                      <GripDotsIcon size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
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
              disabled={selectedMoveIndex < 0 || selectedMoveIndex >= events.length - 1}
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
    </div>
  );
}
