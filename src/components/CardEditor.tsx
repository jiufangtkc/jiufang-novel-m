import React, { useId, useState } from 'react';
import {
  CARD_COLOR_LABEL,
  CARD_CONTENT_LABEL,
  CARD_CONTENT_PLACEHOLDER,
  CARD_TITLE_LABEL,
  CARD_TITLE_PLACEHOLDER,
  EDIT_CARD_BUTTON,
  EDIT_CARD_CANCEL,
  EDIT_CARD_DONE,
  EDIT_CARD_HEADING,
  EDIT_CARD_MORE,
} from '../copy/cardEditCopy';
import {
  cardsSubcardsCountLabel,
  cardDetailAria,
  displayCardTitle,
  EVENT_CHAPTER_LABEL,
  EVENT_CHAPTER_NONE_NOTE,
  EVENT_STORY_TIME_EMPTY,
  EVENT_STORY_TIME_HELP,
  EVENT_STORY_TIME_LABEL,
  EVENT_STORY_TIME_PLACEHOLDER,
  TIMELINE_UNASSIGNED_LABEL,
} from '../copy/userFacing';
import { CATEGORY_TIMELINE } from '../domain/cardCategories';
import {
  DEFAULT_CARD_COLOR,
  formatCardColorForSave,
} from '../domain/cardColors';
import { cardVisualStyles } from '../domain/cards';
import type { TimelineChapterItem } from '../domain/timeline';
import { clearBookClip } from '../editor/bookClip';
import type { LayoutMode } from '../layout/layoutMode';
import { DictButton, DictOfflineNotice } from './DictButton';
import { useDictNotice } from '../dictionary/useDictNotice';
import { useDictSelection } from '../dictionary/useDictSelection';
import { CardColorPicker } from './CardColorPicker';
import { CardMarkdownView } from './CardMarkdownView';
import { BookOutlineIcon, EyeOffIcon } from './Icons';
import './cardEditor.css';

export type CardEditorDestination = 'preview' | 'editor' | 'text' | 'cards' | string;

export interface CardEditorCard {
  id: string;
  title: string;
  content: string;
  color?: string | null;
  category?: string;
  parent_id?: string | null;
  storyTime?: string;
  timelineOrder?: number | null;
  chapterId?: string | null;
}

export interface CardEditorSavePayload {
  title: string;
  content: string;
  color: string;
  storyTime?: string;
  chapterId?: string | null;
}

/**
 * 依卡片是否為時間軸最上層卡組裝儲存／草稿負載：
 * - 非時間軸卡與子卡只保留 title、content、color，不主動寫入時間線欄位
 * - 時間軸頂層卡帶出 storyTime 與經目錄驗證後的 chapterId（無效或未選章一律為 null）
 */
export function buildCardEditorPayload(params: {
  card: Pick<CardEditorCard, 'category' | 'parent_id'>;
  title: string;
  content: string;
  color: string;
  storyTime?: string;
  chapterId?: string | null;
  chapters?: readonly TimelineChapterItem[];
}): CardEditorSavePayload {
  const payload: CardEditorSavePayload = {
    title: params.title,
    content: params.content,
    color: formatCardColorForSave(params.color),
  };
  const isTopLevelTimeline = params.card.category === CATEGORY_TIMELINE && !params.card.parent_id;
  if (isTopLevelTimeline) {
    const validChapterIds = new Set((params.chapters ?? []).map((ch) => ch.id));
    payload.storyTime = params.storyTime ?? '';
    payload.chapterId =
      params.chapterId && validChapterIds.has(params.chapterId) ? params.chapterId : null;
  }
  return payload;
}

export interface CardEditorProps {
  /** 卡片資料（必傳） */
  card: CardEditorCard;
  /** 存檔回呼（必傳） */
  onSave: (patch: CardEditorSavePayload) => void | Promise<void>;
  /** 完成回呼（必傳，接收完成後目標位置） */
  onDone: (destination?: CardEditorDestination) => void;
  /** 完成後去哪回呼（專案負責人指定：可重用 props） */
  onCompleteDestination?: (destination: CardEditorDestination) => void;
  /** 預設/指定完成後去哪（例如手機直拿看卡片預設 'text'，其他為 'preview'） */
  defaultDestination?: CardEditorDestination;
  /** 取消編輯回呼 */
  onCancel?: () => void;
  /** 初始模式：'preview' 先看排版 或 'edit' 編輯（預設 'preview'） */
  initialMode?: 'preview' | 'edit';
  /** 目前模式（受控模式可選） */
  mode?: 'preview' | 'edit';
  /** 模式變更回呼 */
  onModeChange?: (mode: 'preview' | 'edit') => void;
  /** 版面模式（預設 'phone-portrait'） */
  layoutMode?: LayoutMode;
  /** 儲存成功提示文字 */
  savedNotice?: string;
  /** 子卡片清單（預覽時呈現） */
  subcards?: readonly CardEditorCard[];
  /** 點選子卡片回呼 */
  onSelectSubcard?: (subcardId: string) => void;
  /** 點選更多動作（例如⋯選單）回呼 */
  onMoreActions?: () => void;
  /** 刪除卡片回呼 */
  onDelete?: () => void;
  /** 初始是否開啟選色面板（供靜態渲染與測試使用） */
  initialPickingColor?: boolean;
  /** WO-64：讓外層在「點正文、往下滑收起」時取得目前草稿（WO-65 起只暫存，不寫回卡片） */
  draftRef?: React.MutableRefObject<(() => CardEditorSavePayload) | null>;
  /** WO-65：以編輯模式打開時，接著用上次還沒按「完成」的標題、內容、顏色 */
  initialDraft?: CardEditorSavePayload | null;
  /** WO-65：標題、內容、顏色每次改動都立刻交給外層暫存（不是正式存卡片） */
  onDraftChange?: (draft: CardEditorSavePayload) => void;
  /** WO-128：目錄中的章節清單（僅時間軸頂層卡使用） */
  chapters?: readonly TimelineChapterItem[];
  /** WO-128：初始是否展開「出現在哪一章」單選清單（供靜態渲染與測試使用） */
  initialChapterPickerOpen?: boolean;
  /** WO-128：點擊「跳到{章短名}」回呼（編輯中已先同步草稿） */
  onJumpToChapter?: (chapterId: string, draft: CardEditorSavePayload) => void;
}

export function CardEditor({
  card,
  onSave,
  onDone,
  onCompleteDestination,
  defaultDestination,
  onCancel,
  initialMode = 'preview',
  mode: controlledMode,
  onModeChange,
  layoutMode = 'phone-portrait',
  savedNotice,
  subcards = [],
  onSelectSubcard,
  onMoreActions,
  onDelete,
  initialPickingColor = false,
  draftRef,
  initialDraft,
  onDraftChange,
  chapters = [],
  initialChapterPickerOpen = false,
  onJumpToChapter,
}: CardEditorProps) {
  const [internalMode, setInternalMode] = useState<'preview' | 'edit'>(initialMode);
  const currentMode = controlledMode ?? internalMode;

  const isTopLevelTimeline = card.category === CATEGORY_TIMELINE && !card.parent_id;
  const chapterMap = React.useMemo(
    () => new Map(chapters.map((ch) => [ch.id, ch])),
    [chapters],
  );
  const resolveChapter = (id: string | null | undefined): TimelineChapterItem | null =>
    id && chapterMap.has(id) ? chapterMap.get(id)! : null;

  // WO-65：一打開就是編輯中、而且有暫存時，接著用暫存的字；預覽一律顯示卡片已存的內容
  const seed = currentMode === 'edit' && initialDraft ? initialDraft : null;
  const [title, setTitleState] = useState(seed ? seed.title : card.title);
  const [content, setContentState] = useState(seed ? seed.content : card.content);
  const [color, setColorState] = useState(seed ? seed.color || DEFAULT_CARD_COLOR : card.color || DEFAULT_CARD_COLOR);
  const [storyTime, setStoryTimeState] = useState(
    seed && seed.storyTime !== undefined ? seed.storyTime : (card.storyTime ?? ''),
  );
  const [chapterId, setChapterIdState] = useState<string | null>(
    seed && seed.chapterId !== undefined ? seed.chapterId : (card.chapterId ?? null),
  );
  const [chapterPickerOpen, setChapterPickerOpen] = useState(initialChapterPickerOpen);

  const uid = useId();
  const storyTimeInputId = `${uid}-story-time`;
  const storyTimeHelpId = `${uid}-story-time-help`;
  const chapterLabelId = `${uid}-chapter-label`;
  const chapterTriggerTextId = `${uid}-chapter-trigger-text`;
  const chapterListId = `${uid}-chapter-list`;
  const chapterTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const chapterOptionsRef = React.useRef<HTMLDivElement | null>(null);

  const buildPayload = (next: {
    title: string;
    content: string;
    color: string;
    storyTime: string;
    chapterId: string | null;
  }): CardEditorSavePayload =>
    buildCardEditorPayload({
      card,
      title: next.title,
      content: next.content,
      color: next.color,
      storyTime: next.storyTime,
      chapterId: next.chapterId,
      chapters,
    });

  const latest = React.useRef({ title, content, color, storyTime, chapterId });
  latest.current = { title, content, color, storyTime, chapterId };
  const onDraftChangeRef = React.useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const emitDraft = (
    patch: Partial<{
      title: string;
      content: string;
      color: string;
      storyTime: string;
      chapterId: string | null;
    }>,
  ) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    onDraftChangeRef.current?.(buildPayload(next));
  };
  const setTitle = (value: string) => {
    setTitleState(value);
    emitDraft({ title: value });
  };
  const setContent = (value: string) => {
    setContentState(value);
    emitDraft({ content: value });
  };
  const setColor = (value: string) => {
    setColorState(value);
    emitDraft({ color: value });
  };
  const setStoryTime = (value: string) => {
    setStoryTimeState(value);
    emitDraft({ storyTime: value });
  };
  const setChapterId = (value: string | null) => {
    setChapterIdState(value);
    emitDraft({ chapterId: value });
  };
  const [isPickingColor, setIsPickingColor] = useState(initialPickingColor);

  // WO-106：查字典只觀察「內容」textarea 的選取；標題不判斷。textarea 只在編輯模式存在
  const contentRef = React.useRef<HTMLTextAreaElement | null>(null);
  const dict = useDictSelection('card', contentRef, undefined, currentMode);
  const dictNotice = useDictNotice();
  const hideDictNotice = dictNotice.hide;
  React.useEffect(() => {
    hideDictNotice();
  }, [dict.word, dict.visible, hideDictNotice]);

  if (draftRef) {
    draftRef.current = () => buildPayload(latest.current);
  }

  const prevCardIdRef = React.useRef(card.id);
  React.useEffect(() => {
    if (prevCardIdRef.current !== card.id) {
      prevCardIdRef.current = card.id;
      setTitleState(card.title);
      setContentState(card.content);
      setColorState(card.color || DEFAULT_CARD_COLOR);
      setStoryTimeState(card.storyTime ?? '');
      setChapterIdState(card.chapterId ?? null);
      setChapterPickerOpen(false);
      if (!controlledMode) {
        setInternalMode(initialMode);
      }
    }
  }, [
    card.id,
    card.title,
    card.content,
    card.color,
    card.storyTime,
    card.chapterId,
    controlledMode,
    initialMode,
  ]);

  const switchMode = (nextMode: 'preview' | 'edit') => {
    if (!controlledMode) {
      setInternalMode(nextMode);
    }
    onModeChange?.(nextMode);
  };

  const handleStartEdit = () => {
    if (!initialDraft) {
      setStoryTimeState(card.storyTime ?? '');
      setChapterIdState(card.chapterId ?? null);
    }
    setChapterPickerOpen(false);
    switchMode('edit');
  };

  const handleCancel = () => {
    // 復原為原始卡片內容（取消／未改不產生變更）；這是明確放棄，不再暫存
    setTitleState(card.title);
    setContentState(card.content);
    setColorState(card.color || DEFAULT_CARD_COLOR);
    setStoryTimeState(card.storyTime ?? '');
    setChapterIdState(card.chapterId ?? null);
    setChapterPickerOpen(false);
    setIsPickingColor(false);
    onCancel?.();
    switchMode('preview');
  };

  const handleDone = async () => {
    await onSave(buildPayload({ title, content, color, storyTime, chapterId }));
    const targetDest =
      defaultDestination ??
      (layoutMode === 'phone-portrait' ? 'text' : 'preview');
    onCompleteDestination?.(targetDest);
    onDone(targetDest);
    switchMode('preview');
  };

  const handleColorDone = (newColor: string) => {
    setColor(newColor);
    setIsPickingColor(false);
  };

  const handleSelectChapter = (nextChapterId: string | null) => {
    setChapterId(nextChapterId);
    setChapterPickerOpen(false);
    chapterTriggerRef.current?.focus();
  };

  const handleJumpToChapter = (targetChapterId: string) => {
    if (currentMode === 'edit') {
      const currentDraft = buildPayload(latest.current);
      onDraftChangeRef.current?.(currentDraft);
      onJumpToChapter?.(targetChapterId, currentDraft);
      return;
    }
    const previewDraft = buildPayload({
      title: card.title,
      content: card.content,
      color: card.color || DEFAULT_CARD_COLOR,
      storyTime: card.storyTime ?? '',
      chapterId: targetChapterId,
    });
    onJumpToChapter?.(targetChapterId, previewDraft);
  };

  const focusRadioOption = (index: number) => {
    const buttons = chapterOptionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    if (!buttons || buttons.length === 0) return;
    const clamped = ((index % buttons.length) + buttons.length) % buttons.length;
    buttons[clamped]?.focus();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !chapterPickerOpen) {
      e.preventDefault();
      setChapterPickerOpen(true);
      requestAnimationFrame(() => {
        const checked = chapterOptionsRef.current?.querySelector<HTMLButtonElement>(
          '[role="radio"][aria-checked="true"]',
        );
        if (checked) checked.focus();
        else focusRadioOption(0);
      });
    } else if (e.key === 'Escape' && chapterPickerOpen) {
      e.preventDefault();
      setChapterPickerOpen(false);
    }
  };

  const handleOptionsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      chapterOptionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusRadioOption(currentIndex >= 0 ? currentIndex + 1 : 0);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      focusRadioOption(currentIndex >= 0 ? currentIndex - 1 : buttons.length - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusRadioOption(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusRadioOption(buttons.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setChapterPickerOpen(false);
      chapterTriggerRef.current?.focus();
    }
  };

  const previewStoryTime = currentMode === 'preview' ? (card.storyTime ?? '') : storyTime;
  const previewChapter = resolveChapter(currentMode === 'preview' ? card.chapterId : chapterId);
  const selectedEditChapter = resolveChapter(chapterId);

  const renderTimelineEditFields = () => {
    if (!isTopLevelTimeline) return null;
    return (
      <>
        <div className="card-editor-field">
          <label htmlFor={storyTimeInputId} className="card-editor-label">
            {EVENT_STORY_TIME_LABEL}
          </label>
          <input
            id={storyTimeInputId}
            type="text"
            className="card-editor-input card-editor-story-time-input"
            value={storyTime}
            onChange={(e) => setStoryTime(e.target.value)}
            onCopy={clearBookClip}
            onCut={clearBookClip}
            placeholder={EVENT_STORY_TIME_PLACEHOLDER}
            aria-describedby={storyTimeHelpId}
            data-testid="card-editor-story-time-input"
          />
          <p id={storyTimeHelpId} className="card-editor-field-help" data-testid="card-editor-story-time-help">
            {EVENT_STORY_TIME_HELP}
          </p>
        </div>

        <div className="card-editor-field">
          <div className="card-editor-label-row">
            <span id={chapterLabelId} className="card-editor-label">
              {EVENT_CHAPTER_LABEL}
            </span>
            {selectedEditChapter && (
              <button
                type="button"
                className="card-editor-jump-link"
                onClick={() => handleJumpToChapter(selectedEditChapter.id)}
                title={selectedEditChapter.jumpLabel}
                data-testid="card-editor-jump-chapter-btn"
              >
                <BookOutlineIcon size={14} />
                <span>{selectedEditChapter.jumpLabel}</span>
              </button>
            )}
          </div>
          <div
            className={`card-editor-chapter-picker${chapterPickerOpen ? ' is-open' : ''}`}
            data-testid="card-editor-chapter-picker"
          >
            <button
              ref={chapterTriggerRef}
              type="button"
              className={`card-editor-chapter-trigger${selectedEditChapter ? '' : ' is-unassigned'}`}
              aria-labelledby={`${chapterLabelId} ${chapterTriggerTextId}`}
              aria-expanded={chapterPickerOpen}
              aria-controls={chapterListId}
              onClick={() => setChapterPickerOpen((open) => !open)}
              onKeyDown={handleTriggerKeyDown}
              data-testid="card-editor-chapter-trigger"
            >
              {selectedEditChapter ? <BookOutlineIcon size={18} /> : <EyeOffIcon size={18} />}
              <span id={chapterTriggerTextId} className="card-editor-chapter-trigger-text">
                {selectedEditChapter ? selectedEditChapter.pickerLabel : TIMELINE_UNASSIGNED_LABEL}
              </span>
              <svg
                className="card-editor-chapter-chevron"
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {chapterPickerOpen && (
              <div
                ref={chapterOptionsRef}
                id={chapterListId}
                role="radiogroup"
                aria-labelledby={chapterLabelId}
                className="card-editor-chapter-options"
                data-testid="card-editor-chapter-options"
                onKeyDown={handleOptionsKeyDown}
              >
                {chapters.map((ch) => {
                  const isSelected = selectedEditChapter?.id === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={`card-editor-chapter-option${isSelected ? ' is-selected' : ''}`}
                      onClick={() => handleSelectChapter(ch.id)}
                      data-testid={`card-editor-chapter-option-${ch.id}`}
                    >
                      <span className="card-editor-chapter-radio" aria-hidden="true" />
                      <span className="card-editor-chapter-option-label">{ch.pickerLabel}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedEditChapter === null}
                  className={`card-editor-chapter-option is-none${selectedEditChapter === null ? ' is-selected' : ''}`}
                  onClick={() => handleSelectChapter(null)}
                  data-testid="card-editor-chapter-option-none"
                >
                  <span className="card-editor-chapter-radio" aria-hidden="true" />
                  <span className="card-editor-chapter-option-label">{TIMELINE_UNASSIGNED_LABEL}</span>
                  <small className="card-editor-chapter-option-note">{EVENT_CHAPTER_NONE_NOTE}</small>
                </button>
              </div>
            )}
          </div>
        </div>
      </>
    );
  };

  const isLandscape = layoutMode === 'phone-landscape';
  const colorPickerBeside = isPickingColor && layoutMode === 'wide';

  const colorPickerWrapperClass =
    layoutMode === 'phone-portrait'
      ? 'card-color-picker-sheet'
      : layoutMode === 'wide'
        ? 'card-color-picker-aside'
        : 'card-color-picker-modal';

  return (
    <div
      className={`card-editor-pane card-detail-article card-editor-mode-${currentMode}${
        colorPickerBeside ? ' is-color-picker-beside' : ''
      }${isPickingColor ? ' is-picking-color' : ''}`}
      data-testid="card-editor-pane"
      data-layout={layoutMode}
      data-mode={currentMode}
    >
      <div className="card-editor-layout-host">
        <div
          className={`card-editor-layout-row${
            colorPickerBeside && isPickingColor ? ' is-wide-picker-beside' : ''
          }`}
        >
          <div className="card-editor-main">
      {currentMode === 'preview' ? (
        <>
          <header className="card-editor-header card-preview-header">
            <div className="card-preview-header-right">
              {savedNotice && (
                <span className="card-editor-saved-hint" data-testid="card-editor-saved-hint">
                  {savedNotice}
                </span>
              )}
              {layoutMode !== 'phone-portrait' && (
                <button
                  type="button"
                  className="card-editor-edit-btn"
                  onClick={handleStartEdit}
                  data-testid="card-editor-start-edit-btn"
                >
                  {EDIT_CARD_BUTTON}
                </button>
              )}
              {(onMoreActions || onDelete) && (
                <button
                  type="button"
                  className="card-editor-more-btn"
                  onClick={onMoreActions || onDelete}
                  aria-label={EDIT_CARD_MORE}
                  data-testid="card-editor-more-btn"
                >
                  ⋯
                </button>
              )}
            </div>
          </header>

          <div className="card-editor-body card-preview-body">
            <div className="card-detail-title-row">
              {cardVisualStyles(color) && (
                <span
                  className="card-color-dot"
                  style={{ backgroundColor: cardVisualStyles(color)!.dotColor }}
                  aria-hidden="true"
                />
              )}
              <h2 className="card-detail-heading" onCopy={clearBookClip} onCut={clearBookClip}>
                {displayCardTitle(title)}
              </h2>
            </div>

            {isTopLevelTimeline && (
              <div className="card-timeline-preview-fields" data-testid="card-timeline-preview-fields">
                <div className="card-timeline-preview-row">
                  <span className="card-editor-label">{EVENT_STORY_TIME_LABEL}</span>
                  <div
                    className={`card-timeline-preview-value${previewStoryTime.trim() ? '' : ' is-empty'}`}
                    data-testid="card-preview-story-time"
                    onCopy={clearBookClip}
                    onCut={clearBookClip}
                  >
                    {previewStoryTime.trim() || EVENT_STORY_TIME_EMPTY}
                  </div>
                </div>
                <div className="card-timeline-preview-row">
                  <div className="card-editor-label-row">
                    <span className="card-editor-label">{EVENT_CHAPTER_LABEL}</span>
                    {previewChapter && (
                      <button
                        type="button"
                        className="card-editor-jump-link"
                        onClick={() => handleJumpToChapter(previewChapter.id)}
                        title={previewChapter.jumpLabel}
                        data-testid="card-editor-jump-chapter-btn"
                      >
                        <BookOutlineIcon size={14} />
                        <span>{previewChapter.jumpLabel}</span>
                      </button>
                    )}
                  </div>
                  <div
                    className={`card-timeline-preview-chapter${previewChapter ? '' : ' is-unassigned'}`}
                    data-testid="card-preview-chapter"
                  >
                    {previewChapter ? (
                      <>
                        <BookOutlineIcon size={16} />
                        <span className="card-timeline-preview-chapter-name">{previewChapter.pickerLabel}</span>
                      </>
                    ) : (
                      <>
                        <EyeOffIcon size={16} />
                        <span className="card-timeline-preview-chapter-name">{TIMELINE_UNASSIGNED_LABEL}</span>
                        <small className="card-editor-chapter-option-note">{EVENT_CHAPTER_NONE_NOTE}</small>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div
              className="card-editor-preview-content card-detail-content"
              data-testid="card-editor-preview-content"
              onCopy={clearBookClip}
              onCut={clearBookClip}
            >
              <div data-testid="card-raw-content">
                <CardMarkdownView content={content} />
              </div>
            </div>

            {subcards.length > 0 && (
              <div className="cards-subcards-section" data-testid="cards-subcards-section">
                <div className="cards-subcards-heading">
                  {cardsSubcardsCountLabel(subcards.length)}
                </div>
                <ul className="cards-subcards-list">
                  {subcards.map((sub) => {
                    const subVisual = cardVisualStyles(sub.color);
                    return (
                      <li key={sub.id} className="cards-subcard-item">
                        <button
                          type="button"
                          className="cards-subcard-button"
                          onClick={() => onSelectSubcard?.(sub.id)}
                          aria-label={cardDetailAria(sub.title)}
                          style={subVisual ? { borderLeft: subVisual.borderLeft } : undefined}
                        >
                          <span className="cards-subcard-title">{displayCardTitle(sub.title)}</span>
                          <span className="cards-subcard-chevron" aria-hidden="true">
                            ›
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {layoutMode === 'phone-portrait' && (
            <footer className="card-editor-footer card-preview-footer">
              <div className="card-preview-thumb-bar">
                <button
                  type="button"
                  className="card-editor-thumb-edit-btn"
                  onClick={handleStartEdit}
                  data-testid="card-editor-start-edit-btn"
                >
                  {EDIT_CARD_BUTTON}
                </button>
                {(onMoreActions || onDelete) && (
                  <button
                    type="button"
                    className="card-editor-thumb-more-btn"
                    onClick={onMoreActions || onDelete}
                    aria-label={EDIT_CARD_MORE}
                    data-testid="card-editor-more-btn"
                  >
                    ⋯
                  </button>
                )}
              </div>
            </footer>
          )}
        </>
      ) : (
        <>
          <header className="card-editor-header">
            <h2 className="card-editor-title">{EDIT_CARD_HEADING}</h2>
            <div className="card-editor-header-end">
              {savedNotice && (
                <span className="card-editor-saved-hint" data-testid="card-editor-saved-hint">
                  {savedNotice}
                </span>
              )}
              {dict.visible && (
                <DictButton
                  word={dict.word}
                  placement="card"
                  onPointerDown={dict.onPointerDown}
                  onPress={dict.onPress}
                  onBlur={dict.onButtonBlur}
                  onOffline={dictNotice.show}
                  testId="card-dict-button"
                />
              )}
            </div>
            <DictOfflineNotice visible={dictNotice.visible} placement="card" testId="card-dict-offline-notice" />
          </header>

          <div className="card-editor-body">
            {isLandscape ? (
              <div className="card-editor-row-landscape">
                <div className="card-editor-field card-editor-field-title">
                  <label htmlFor="card-editor-title-input" className="card-editor-label">
                    {CARD_TITLE_LABEL}
                  </label>
                  <input
                    id="card-editor-title-input"
                    type="text"
                    className="card-editor-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onCopy={clearBookClip}
                    onCut={clearBookClip}
                    placeholder={CARD_TITLE_PLACEHOLDER}
                    data-testid="card-editor-title-input"
                  />
                </div>
                <div className="card-editor-field card-editor-field-color">
                  <label className="card-editor-label">{CARD_COLOR_LABEL}</label>
                  <button
                    type="button"
                    className="card-editor-color-btn"
                    onClick={() => setIsPickingColor(true)}
                    data-testid="card-editor-color-btn"
                  >
                    <span
                      className="card-color-indicator-dot"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span>{CARD_COLOR_LABEL}</span>
                    <span className="card-editor-color-hex">{color.toLowerCase()}</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="card-editor-field">
                  <label htmlFor="card-editor-title-input" className="card-editor-label">
                    {CARD_TITLE_LABEL}
                  </label>
                  <input
                    id="card-editor-title-input"
                    type="text"
                    className="card-editor-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onCopy={clearBookClip}
                    onCut={clearBookClip}
                    placeholder={CARD_TITLE_PLACEHOLDER}
                    data-testid="card-editor-title-input"
                  />
                </div>

                <div className="card-editor-field">
                  <label className="card-editor-label">{CARD_COLOR_LABEL}</label>
                  <button
                    type="button"
                    className="card-editor-color-btn"
                    onClick={() => setIsPickingColor(true)}
                    data-testid="card-editor-color-btn"
                  >
                    <span
                      className="card-color-indicator-dot"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span>{CARD_COLOR_LABEL}</span>
                    <span className="card-editor-color-hex">{color.toLowerCase()}</span>
                  </button>
                </div>
              </>
            )}

            {renderTimelineEditFields()}

            <div className="card-editor-field" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="card-editor-content-textarea" className="card-editor-label">
                {CARD_CONTENT_LABEL}
              </label>
              <textarea
                ref={contentRef}
                id="card-editor-content-textarea"
                className="card-editor-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onCopy={clearBookClip}
                onCut={clearBookClip}
                placeholder={CARD_CONTENT_PLACEHOLDER}
                data-testid="card-editor-content-textarea"
              />
            </div>
          </div>

          <footer className="card-editor-footer">
            {layoutMode === 'phone-portrait' ? (
              <div className="card-editor-thumb-bar">
                <button
                  type="button"
                  className="card-editor-cancel-btn"
                  onClick={handleCancel}
                  data-testid="card-editor-cancel-btn"
                >
                  {EDIT_CARD_CANCEL}
                </button>
                <button
                  type="button"
                  className="card-editor-done-btn"
                  onClick={handleDone}
                  data-testid="card-editor-done-btn"
                >
                  {EDIT_CARD_DONE}
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="card-editor-cancel-btn"
                  onClick={handleCancel}
                  data-testid="card-editor-cancel-btn"
                >
                  {EDIT_CARD_CANCEL}
                </button>
                <button
                  type="button"
                  className="card-editor-done-btn"
                  onClick={handleDone}
                  data-testid="card-editor-done-btn"
                >
                  {EDIT_CARD_DONE}
                </button>
              </>
            )}
          </footer>
        </>
      )}
          </div>

          {isPickingColor && colorPickerBeside && (
            <div
              className={colorPickerWrapperClass}
              data-testid="card-color-picker-wrapper"
            >
              <CardColorPicker
                currentColor={card.color || DEFAULT_CARD_COLOR}
                initialColor={color}
                onDone={handleColorDone}
                onCancel={() => setIsPickingColor(false)}
                layoutMode={layoutMode}
              />
            </div>
          )}
        </div>
      </div>

      {isPickingColor && !colorPickerBeside && (
        <div
          className={colorPickerWrapperClass}
          data-testid="card-color-picker-wrapper"
        >
          <CardColorPicker
            currentColor={card.color || DEFAULT_CARD_COLOR}
            initialColor={color}
            onDone={handleColorDone}
            onCancel={() => setIsPickingColor(false)}
            layoutMode={layoutMode}
          />
        </div>
      )}
    </div>
  );
}
