import React, { useState } from 'react';
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
} from '../copy/userFacing';
import {
  DEFAULT_CARD_COLOR,
  formatCardColorForSave,
} from '../domain/cardColors';
import { cardVisualStyles } from '../domain/cards';
import type { LayoutMode } from '../layout/layoutMode';
import { DictButton, DictOfflineNotice } from './DictButton';
import { useDictNotice } from '../dictionary/useDictNotice';
import { useDictSelection } from '../dictionary/useDictSelection';
import { CardColorPicker } from './CardColorPicker';
import { CardMarkdownView } from './CardMarkdownView';
import './cardEditor.css';

export type CardEditorDestination = 'preview' | 'editor' | 'text' | 'cards' | string;

export interface CardEditorCard {
  id: string;
  title: string;
  content: string;
  color?: string | null;
  category?: string;
  parent_id?: string | null;
}

export interface CardEditorSavePayload {
  title: string;
  content: string;
  color: string;
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
}: CardEditorProps) {
  const [internalMode, setInternalMode] = useState<'preview' | 'edit'>(initialMode);
  const currentMode = controlledMode ?? internalMode;

  // WO-65：一打開就是編輯中、而且有暫存時，接著用暫存的字；預覽一律顯示卡片已存的內容
  const seed = currentMode === 'edit' && initialDraft ? initialDraft : null;
  const [title, setTitleState] = useState(seed ? seed.title : card.title);
  const [content, setContentState] = useState(seed ? seed.content : card.content);
  const [color, setColorState] = useState(seed ? seed.color || DEFAULT_CARD_COLOR : card.color || DEFAULT_CARD_COLOR);
  const latest = React.useRef({ title, content, color });
  latest.current = { title, content, color };
  const onDraftChangeRef = React.useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const emitDraft = (patch: Partial<{ title: string; content: string; color: string }>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    onDraftChangeRef.current?.({
      title: next.title,
      content: next.content,
      color: formatCardColorForSave(next.color),
    });
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
    draftRef.current = () => ({ title, content, color: formatCardColorForSave(color) });
  }

  const prevCardIdRef = React.useRef(card.id);
  React.useEffect(() => {
    if (prevCardIdRef.current !== card.id) {
      prevCardIdRef.current = card.id;
      setTitleState(card.title);
      setContentState(card.content);
      setColorState(card.color || DEFAULT_CARD_COLOR);
      if (!controlledMode) {
        setInternalMode(initialMode);
      }
    }
  }, [card.id, card.title, card.content, card.color, controlledMode, initialMode]);

  const switchMode = (nextMode: 'preview' | 'edit') => {
    if (!controlledMode) {
      setInternalMode(nextMode);
    }
    onModeChange?.(nextMode);
  };

  const handleStartEdit = () => {
    switchMode('edit');
  };

  const handleCancel = () => {
    // 復原為原始卡片內容（取消／未改不產生變更）；這是明確放棄，不再暫存
    setTitleState(card.title);
    setContentState(card.content);
    setColorState(card.color || DEFAULT_CARD_COLOR);
    setIsPickingColor(false);
    onCancel?.();
    switchMode('preview');
  };

  const handleDone = async () => {
    const formattedColor = formatCardColorForSave(color);
    await onSave({
      title,
      content,
      color: formattedColor,
    });
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
              <h2 className="card-detail-heading">{displayCardTitle(title)}</h2>
            </div>

            <div className="card-editor-preview-content card-detail-content" data-testid="card-editor-preview-content">
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
