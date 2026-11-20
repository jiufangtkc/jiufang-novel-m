import { EyeOffIcon, UndoArrowIcon } from './Icons';
import {
  displayCardTitle,
  TIMELINE_BADGE_FLASHBACK,
  TIMELINE_BADGE_UNREVEALED,
  TIMELINE_EMPTY_HINT,
  TIMELINE_LEGEND_FLASHBACK,
  TIMELINE_LEGEND_UNREVEALED,
  TIMELINE_READING_HINT,
  TIMELINE_UNASSIGNED_LABEL,
  timelineStoryOrderPhone,
  timelineUnassignedSectionCount,
} from '../copy/userFacing';
import { cardVisualStyles } from '../domain/cards';
import type { TimelineChapterSection, TimelineEventItem } from '../domain/timeline';

export interface TimelineReadingViewProps {
  chapterSections: readonly TimelineChapterSection[];
  unassignedEvents: readonly TimelineEventItem[];
  selectedCardId?: string | null;
  onSelectEvent: (cardId: string) => void;
}

/** 時間線「章節順序」檢視：依目錄章節分段與故事順序顯示（唯讀不可調整順序，點卡開事件卡）。 */
export function TimelineReadingView({
  chapterSections,
  unassignedEvents,
  selectedCardId = null,
  onSelectEvent,
}: TimelineReadingViewProps) {
  const isEmpty = chapterSections.length === 0 && unassignedEvents.length === 0;

  const renderReadingCard = (item: TimelineEventItem, kind: 'chapter' | 'unassigned') => {
    const visual = cardVisualStyles(item.color);
    const isOpened = selectedCardId === item.id;
    const isFlashback = kind === 'chapter' && item.isFlashback;
    const storyTimeText = item.storyTime.trim();
    const titleText = displayCardTitle(item.title);

    return (
      <li
        key={item.id}
        className="timeline-reading-item"
        data-event-id={item.id}
        data-testid={`timeline-reading-event-${item.id}`}
      >
        <button
          type="button"
          className={[
            'timeline-reading-card',
            kind === 'unassigned' ? 'is-unassigned' : '',
            isFlashback ? 'is-flashback' : '',
            isOpened ? 'is-opened' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelectEvent(item.id)}
          aria-current={isOpened ? 'true' : undefined}
          data-testid={`timeline-reading-card-btn-${item.id}`}
        >
          {visual && (
            <span
              className="timeline-card-colorbar"
              style={{ backgroundColor: visual.displayColor }}
              aria-hidden="true"
            />
          )}
          <span className="timeline-reading-card-body">
            <span className="timeline-reading-row1">
              {storyTimeText !== '' && (
                <span
                  className="timeline-card-when timeline-reading-when"
                  data-testid={`timeline-reading-when-${item.id}`}
                >
                  {storyTimeText}
                </span>
              )}
              <span
                className="timeline-reading-order"
                data-testid={`timeline-reading-order-${item.id}`}
              >
                {timelineStoryOrderPhone(item.storyPosition)}
              </span>
            </span>
            <span className="timeline-reading-row2">
              <span className="timeline-reading-title">{titleText}</span>
              {isFlashback && (
                <span
                  className="timeline-chip is-flashback"
                  data-testid={`timeline-reading-flashback-chip-${item.id}`}
                >
                  <UndoArrowIcon size={13} />
                  <span>{TIMELINE_BADGE_FLASHBACK}</span>
                </span>
              )}
              {kind === 'unassigned' && (
                <span
                  className="timeline-chip is-unassigned"
                  data-testid={`timeline-reading-unrevealed-chip-${item.id}`}
                >
                  <EyeOffIcon size={13} />
                  <span>{TIMELINE_BADGE_UNREVEALED}</span>
                </span>
              )}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="timeline-reading-view" data-testid="timeline-reading-view">
      <p className="timeline-hint" data-testid="timeline-reading-hint">
        {TIMELINE_READING_HINT}
      </p>

      <div className="timeline-reading-legend" data-testid="timeline-reading-legend">
        <span className="timeline-reading-legend-item">
          <span className="timeline-chip is-flashback">
            <UndoArrowIcon size={13} />
            <span>{TIMELINE_BADGE_FLASHBACK}</span>
          </span>
          <span>{TIMELINE_LEGEND_FLASHBACK}</span>
        </span>
        <span className="timeline-reading-legend-item">
          <span className="timeline-chip is-unassigned">
            <EyeOffIcon size={13} />
            <span>{TIMELINE_BADGE_UNREVEALED}</span>
          </span>
          <span>{TIMELINE_LEGEND_UNREVEALED}</span>
        </span>
      </div>

      <div className="timeline-scroll-pane" data-testid="timeline-reading-scroll">
        {isEmpty ? (
          <div className="timeline-empty" data-testid="timeline-empty-hint">
            <p>{TIMELINE_EMPTY_HINT}</p>
          </div>
        ) : (
          <div className="timeline-reading-sections" data-testid="timeline-reading-sections">
            {chapterSections.map((section) => (
              <section
                key={section.chapter.id}
                className="timeline-reading-section"
                data-testid={`timeline-reading-section-${section.chapter.id}`}
              >
                <h2
                  className="timeline-reading-section-header"
                  data-testid={`timeline-reading-chapter-header-${section.chapter.id}`}
                >
                  <span className="timeline-reading-chapter-lead">
                    {section.chapter.headerLead}
                  </span>
                  {section.chapter.headerSub !== '' && (
                    <span className="timeline-reading-chapter-sub">
                      {section.chapter.headerSub}
                    </span>
                  )}
                </h2>
                <ul className="timeline-reading-list">
                  {section.events.map((item) => renderReadingCard(item, 'chapter'))}
                </ul>
              </section>
            ))}

            {unassignedEvents.length > 0 && (
              <section
                className="timeline-reading-section"
                data-testid="timeline-reading-unassigned-section"
              >
                <h2
                  className="timeline-reading-section-header"
                  data-testid="timeline-reading-unassigned-header"
                >
                  <span className="timeline-reading-chapter-lead">
                    {TIMELINE_UNASSIGNED_LABEL}
                  </span>
                  <span className="timeline-reading-chapter-sub">
                    {timelineUnassignedSectionCount(unassignedEvents.length)}
                  </span>
                </h2>
                <ul className="timeline-reading-list">
                  {unassignedEvents.map((item) => renderReadingCard(item, 'unassigned'))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
