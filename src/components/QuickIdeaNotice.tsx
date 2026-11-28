import {
  QUICK_IDEA_NOTICE_ACTION,
  QUICK_IDEA_NOTICE_CLOSE_ARIA,
  QUICK_IDEA_NOTICE_CLOSE_LABEL,
  QUICK_IDEA_SAVED_NOTICE,
} from '../copy/quickIdeaCopy';
import './quickIdea.css';

export interface QuickIdeaNoticeProps {
  onView: () => void;
  onDismiss: () => void;
}

/** WO-144：存好後寫作頁的非打斷提示，「去看看」進到那張靈感卡。外觀位置沿用刪稿暫存的角落提示。 */
export function QuickIdeaNotice({ onView, onDismiss }: QuickIdeaNoticeProps) {
  return (
    <div
      className="trash-corner-notice quick-idea-notice"
      role="status"
      aria-live="polite"
      data-testid="quick-idea-notice"
    >
      <span className="trash-corner-text">{QUICK_IDEA_SAVED_NOTICE}</span>
      <button
        type="button"
        className="trash-corner-main quick-idea-notice-view"
        style={{ flex: '0 0 auto' }}
        data-testid="quick-idea-notice-view"
        onClick={onView}
      >
        <span className="trash-corner-view">{QUICK_IDEA_NOTICE_ACTION}</span>
      </button>
      <button
        type="button"
        className="trash-corner-close"
        aria-label={QUICK_IDEA_NOTICE_CLOSE_ARIA}
        data-testid="quick-idea-notice-close"
        onClick={onDismiss}
      >
        {QUICK_IDEA_NOTICE_CLOSE_LABEL}
      </button>
    </div>
  );
}
