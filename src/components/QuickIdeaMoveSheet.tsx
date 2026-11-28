import { useEffect } from 'react';
import {
  QUICK_IDEA_MOVE_CANCEL,
  QUICK_IDEA_MOVE_HINT,
  QUICK_IDEA_MOVE_TITLE,
} from '../copy/quickIdeaCopy';
import './quickIdea.css';

export interface QuickIdeaMoveTarget {
  id: string;
  name: string;
}

export interface QuickIdeaMoveSheetProps {
  open: boolean;
  /** 可選的目標分類（呼叫端已排除目前分類與隱藏分類）。 */
  targets: readonly QuickIdeaMoveTarget[];
  onPick: (categoryId: string) => void;
  onClose: () => void;
}

/** WO-144：「改分類」底部選單。選完立即生效，沒有另外的確定鈕。 */
export function QuickIdeaMoveSheet({ open, targets, onPick, onClose }: QuickIdeaMoveSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop quick-idea-backdrop"
      role="presentation"
      data-testid="quick-idea-move-backdrop"
      onClick={onClose}
    >
      <div
        className="sheet quick-idea-sheet quick-idea-move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-idea-move-title"
        data-testid="quick-idea-move-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="quick-idea-move-title">{QUICK_IDEA_MOVE_TITLE}</h2>
        <p className="quick-idea-hint">{QUICK_IDEA_MOVE_HINT}</p>
        <div className="menu-list" role="menu">
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid={`quick-idea-move-to-${target.id}`}
              onClick={() => onPick(target.id)}
            >
              {target.name}
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            data-testid="quick-idea-move-cancel"
            onClick={onClose}
          >
            {QUICK_IDEA_MOVE_CANCEL}
          </button>
        </div>
      </div>
    </div>
  );
}
