import { useEffect, useRef, useState } from 'react';
import {
  QUICK_IDEA_CANCEL,
  QUICK_IDEA_CONTENT_LABEL,
  QUICK_IDEA_EMPTY_HINT,
  QUICK_IDEA_SAVE,
  QUICK_IDEA_SAVE_FAILED,
  QUICK_IDEA_SHEET_TITLE,
  QUICK_IDEA_TITLE_LABEL,
  quickIdeaSheetHint,
} from '../copy/quickIdeaCopy';
import { isQuickIdeaBlank } from '../domain/quickIdea';
import type { LayoutMode } from '../layout';
import './quickIdea.css';

export interface QuickIdeaSheetProps {
  open: boolean;
  bookTitle: string;
  layoutMode: LayoutMode;
  onClose: () => void;
  /** 回傳 true 代表已存好（呼叫端負責關閉與提示）；false 代表沒存成。 */
  onSave: (input: { title: string; content: string }) => boolean;
}

/**
 * WO-144：記靈感的底部記入畫面（沿用 .sheet 樣式與主題變數）。
 * 空白不存、只在按「存起來」時才呼叫 onSave；取消／點背景／Esc 都只關閉，不寫任何東西。
 */
export function QuickIdeaSheet({ open, bookTitle, layoutMode, onClose, onSave }: QuickIdeaSheetProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      contentRef.current?.focus({ preventScroll: true });
    } else {
      setTitle('');
      setContent('');
      setMessage(null);
    }
  }, [open]);

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

  const handleSave = () => {
    if (isQuickIdeaBlank(title, content)) {
      setMessage(QUICK_IDEA_EMPTY_HINT);
      return;
    }
    const ok = onSave({ title, content });
    if (!ok) setMessage(QUICK_IDEA_SAVE_FAILED);
  };

  return (
    <div
      className="sheet-backdrop quick-idea-backdrop"
      role="presentation"
      data-testid="quick-idea-backdrop"
      onClick={onClose}
    >
      <div
        className="sheet quick-idea-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-idea-title"
        data-testid="quick-idea-sheet"
        data-layout={layoutMode}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="quick-idea-title">{QUICK_IDEA_SHEET_TITLE}</h2>
        <label className="quick-idea-field">
          <span>{QUICK_IDEA_TITLE_LABEL}</span>
          <input
            type="text"
            value={title}
            data-testid="quick-idea-title-input"
            onChange={(event) => {
              setTitle(event.target.value);
              setMessage(null);
            }}
          />
        </label>
        <label className="quick-idea-field">
          <span>{QUICK_IDEA_CONTENT_LABEL}</span>
          <textarea
            ref={contentRef}
            rows={4}
            value={content}
            data-testid="quick-idea-content-input"
            onChange={(event) => {
              setContent(event.target.value);
              setMessage(null);
            }}
          />
        </label>
        <p className="quick-idea-hint" data-testid="quick-idea-hint">
          {quickIdeaSheetHint(bookTitle)}
        </p>
        {message ? (
          <p className="quick-idea-message" role="alert" data-testid="quick-idea-message">
            {message}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            data-testid="quick-idea-cancel"
            onClick={onClose}
          >
            {QUICK_IDEA_CANCEL}
          </button>
          <button
            type="button"
            className="button primary"
            data-testid="quick-idea-save"
            onClick={handleSave}
          >
            {QUICK_IDEA_SAVE}
          </button>
        </div>
      </div>
    </div>
  );
}
