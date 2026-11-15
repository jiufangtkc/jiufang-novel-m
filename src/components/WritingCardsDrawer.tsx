import React, { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { BackIcon, ChevronIcon, CloseIcon } from './Icons';
import {
  BACK_TO_CARDS_ARIA,
  BACK_TO_CATEGORIES_ARIA,
  cardCollapseAria,
  cardDetailAria,
  cardExpandAria,
  CARDS_HEADING,
  categoryRowAria,
  CARDS_EMPTY_IN_CATEGORY_HINT,
  CLOSE_CARDS_ARIA,
  displayCardTitle,
  SAMPLE_CARDS_NOTICE,
  WRITING_CARDS_EMPTY_BOOK_HINT,
} from '../copy/userFacing';
import {
  buildCardTree,
  cardsViewReducer,
  cardVisualStyles,
  countCardsInCategory,
  flattenVisibleCards,
} from '../domain/cards';
import { savedCardToast } from '../copy/cardEditCopy';
import {
  WRITING_CARD_MORE_CLOSE,
  WRITING_CARD_MORE_TITLE,
  WRITING_CARD_OPEN_IN_DATASET,
  writingPlaceSpoken,
} from '../copy/writingCardEditCopy';
import { useLayout } from '../layout/layoutContext';
import { useProject, useSample } from '../state/sampleStore';
import {
  endCardEdit,
  flushCardEdit,
  getCardEditSnapshot,
  registerCardEditFlush,
  startCardEdit,
  subscribeCardEdit,
} from '../state/writingCardEditSession';
import { CardEditor, type CardEditorSavePayload } from './CardEditor';
import './writingCardEdit.css';
import { readWritingCardsData } from './writingCardsData';
import {
  getStoredWritingCardsView,
  saveStoredWritingCardsView,
} from '../domain/writingCards';

export interface WritingCardsDrawerProps {
  projectId: string;
  initialCategoryId?: string | null;
  initialCardId?: string | null;
  initialCollapsedIds?: Iterable<string>;
  onClose: () => void;
  /** WO-64：卡片存好後的提示（手機直拿面板收起後仍要看得到，由外層顯示） */
  onSaved?: (message: string) => void;
  /** WO-64：「⋯」的動作；有給才出現「⋯」，按了會先存卡片再離開寫作頁 */
  onOpenInDataset?: () => void;
}

/**
 * 寫作時看卡片面板（WO-50）
 * - 標題寫「資料集」
 * - WO-64：卡片內容層可按「編輯」（重用 CardEditor 與 actions.updateCard）；不出現新增、刪除、排序等管理按鈕
 * - AI 對話紀錄分類完全隱藏
 * - 讀目前這份稿子的分類與卡片（與資料集同一份資料）；沒有卡片就顯示說明，不塞範例卡片（WO-74）
 * - 範例卡片提示只在內建範例書出現（WO-75）
 * - 記住同一稿件上次閱讀位置
 * - 支援多層：分類清單（第 1 層）→ 卡片清單（第 2 層）→ 卡片內容（第 3 層，CardEditor 預覽／編輯）
 */
export const WritingCardsDrawer: React.FC<WritingCardsDrawerProps> = ({
  projectId,
  initialCategoryId,
  initialCardId,
  initialCollapsedIds,
  onClose,
  onSaved,
  onOpenInDataset,
}) => {
  const { state: sampleState, actions } = useSample();
  const { mode: layoutMode } = useLayout();
  const edit = useSyncExternalStore(subscribeCardEdit, getCardEditSnapshot, getCardEditSnapshot);
  const draftRef = useRef<(() => CardEditorSavePayload) | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | undefined>(undefined);
  const [moreOpen, setMoreOpen] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const project = useProject(projectId);
  const { cards: bookCards, categories, isSample } = readWritingCardsData(
    sampleState,
    projectId,
    project,
  );
  const sessionStorage = typeof window !== 'undefined' ? window.sessionStorage : null;
  const stored = getStoredWritingCardsView(projectId, sessionStorage);

  const [state, dispatch] = useReducer(cardsViewReducer, {
    selectedCategoryId:
      initialCategoryId !== undefined ? initialCategoryId : stored.categoryId,
    selectedCardId:
      initialCardId !== undefined ? initialCardId : stored.cardId,
    collapsedIds: new Set(initialCollapsedIds ?? []),
  });

  const { selectedCategoryId, selectedCardId, collapsedIds } = state;

  // 切換分類或卡片時記錄進 storage，換稿件不沿用
  const handleSelectCategory = (categoryId: string) => {
    saveStoredWritingCardsView(projectId, { categoryId, cardId: null }, sessionStorage);
    dispatch({ type: 'SELECT_CATEGORY', categoryId });
  };

  const handleSelectCard = (cardId: string) => {
    saveStoredWritingCardsView(projectId, { categoryId: selectedCategoryId, cardId }, sessionStorage);
    dispatch({ type: 'SELECT_CARD', cardId });
  };

  const handleBackToCards = () => {
    saveStoredWritingCardsView(projectId, { categoryId: selectedCategoryId, cardId: null }, sessionStorage);
    dispatch({ type: 'BACK_TO_CARDS' });
  };

  const handleBackToCategories = () => {
    saveStoredWritingCardsView(projectId, { categoryId: null, cardId: null }, sessionStorage);
    dispatch({ type: 'BACK_TO_CATEGORIES' });
  };

  const toggleCollapse = (cardId: string) => {
    dispatch({ type: 'TOGGLE_COLLAPSE', cardId });
  };

  const currentCategory = selectedCategoryId
    ? categories.find((c) => c.id === selectedCategoryId) ?? null
    : null;
  const currentCard = selectedCardId
    ? bookCards.find((c) => c.id === selectedCardId) ?? null
    : null;

  const editing = edit.editing && currentCard !== null;
  const currentCardRef = useRef(currentCard);
  currentCardRef.current = currentCard;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // 存卡片只走既有的 actions.updateCard（與資料集同一個動作）
  const commitCard = (cardId: string, patch: CardEditorSavePayload) => {
    actions.updateCard(projectIdRef.current, cardId, patch);
    const message = savedCardToast(patch.title);
    setSavedNotice(message);
    onSavedRef.current?.(message);
  };
  const commitRef = useRef(commitCard);
  commitRef.current = commitCard;

  // 登記「先存卡片再結束編輯」的出口：點正文、往下滑、點背景、關閉、切走都走這裡
  useEffect(() => {
    registerCardEditFlush((kind) => {
      const card = currentCardRef.current;
      const draft = draftRef.current?.();
      if (card && draft) commitRef.current(card.id, draft);
      endCardEdit(kind);
    });
    return () => {
      // 面板被拿掉時若還在編輯，先存再結束，不讓草稿掉掉
      flushCardEdit('close');
      registerCardEditFlush(null);
    };
  }, []);

  // 編輯中面板高度跟著鍵盤上方的可視高度（手機直拿全高、橫拿與中等縮到鍵盤上方）
  useEffect(() => {
    if (!editing || layoutMode === 'wide' || typeof window === 'undefined') {
      setViewportHeight(null);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setViewportHeight(Math.round(vv.height));
    sync();
    vv.addEventListener('resize', sync);
    return () => vv.removeEventListener('resize', sync);
  }, [editing, layoutMode]);

  // 進入編輯後，把鍵盤交給卡片內容
  useEffect(() => {
    if (!editing) return;
    const area = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="writing-cards-drawer"] [data-testid="card-editor-content-textarea"]',
    );
    area?.focus();
  }, [editing]);

  const requestClose = () => {
    flushCardEdit('close');
    onClose();
  };

  const isPortrait = layoutMode === 'phone-portrait';
  const swipeHandlers = isPortrait
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          swipeStart.current = { x: e.clientX, y: e.clientY };
          // 滑鼠與觸控都要在手指移出把手後還收得到放開的事件
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // 沒有指標捕捉的環境略過
          }
        },
        onPointerUp: (e: React.PointerEvent) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (dy > 72 && Math.abs(dx) < dy) requestClose();
        },
        onPointerCancel: () => {
          swipeStart.current = null;
        },
      }
    : {};
  const drawerStyle: React.CSSProperties | undefined =
    editing && viewportHeight !== null
      ? { top: 0, bottom: 'auto', height: viewportHeight, maxHeight: viewportHeight }
      : undefined;

  // 第 3 層：卡片內容（預覽與編輯都用 CardEditor）
  if (currentCard) {
    const categoryName =
      currentCategory?.name ??
      categories.find((c) => c.id === currentCard.category)?.name ??
      CARDS_HEADING;
    const subcards = bookCards.filter((c) => c.parent_id === currentCard.id).sort(
      (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
    );

    const placeLabel = edit.placeLabel;
    return (
      <>
        <div
          className="writing-cards-overlay"
          data-testid="writing-cards-overlay"
          onClick={requestClose}
          aria-hidden="true"
        />
        <aside
          className="writing-cards-drawer"
          data-testid="writing-cards-drawer"
          data-card-editing={editing ? 'true' : undefined}
          aria-label={CARDS_HEADING}
          style={drawerStyle}
        >
          {editing ? (
            isPortrait &&
            placeLabel && (
              <div
                className="writing-card-place"
                data-testid="writing-card-place"
                role="note"
                aria-label={writingPlaceSpoken(placeLabel)}
                {...swipeHandlers}
              >
                <span aria-hidden="true">{placeLabel}</span>
              </div>
            )
          ) : (
            <header className="writing-cards-header" {...swipeHandlers}>
              <button
                type="button"
                className="icon-button"
                aria-label={BACK_TO_CARDS_ARIA}
                onClick={() => {
                  setSavedNotice(undefined);
                  handleBackToCards();
                }}
              >
                <BackIcon />
              </button>
              <h2 className="writing-cards-title">
                <span className="writing-cards-badge">{CARDS_HEADING}</span>
                <span className="writing-cards-sep">·</span>
                <span>{categoryName}</span>
              </h2>
              <button
                type="button"
                className="icon-button writing-cards-close"
                aria-label={CLOSE_CARDS_ARIA}
                onClick={requestClose}
                data-testid="close-cards-drawer"
              >
                <CloseIcon />
              </button>
            </header>
          )}

          {isSample && !editing && (
            <div className="cards-file-notice" data-testid="cards-file-notice">
              {SAMPLE_CARDS_NOTICE}
            </div>
          )}

          <div
            className="writing-cards-scroll card-detail-pane writing-card-editor-wrap"
            data-testid={editing ? undefined : 'card-preview-content'}
          >
            <CardEditor
              key={currentCard.id}
              card={currentCard}
              mode={editing ? 'edit' : 'preview'}
              onModeChange={(next) => {
                if (next === 'edit') {
                  setSavedNotice(undefined);
                  startCardEdit();
                } else {
                  endCardEdit('cancel');
                }
              }}
              layoutMode={layoutMode}
              savedNotice={savedNotice}
              subcards={subcards}
              onSelectSubcard={(subId) => {
                setSavedNotice(undefined);
                handleSelectCard(subId);
              }}
              onMoreActions={onOpenInDataset ? () => setMoreOpen(true) : undefined}
              draftRef={draftRef}
              onSave={(patch) => commitCard(currentCard.id, patch)}
              onDone={(destination) => {
                endCardEdit('done');
                if (destination === 'text') onClose();
              }}
              onCancel={() => endCardEdit('cancel')}
            />
          </div>

          {moreOpen && onOpenInDataset && (
            <div
              className="writing-card-more-backdrop"
              role="presentation"
              onClick={() => setMoreOpen(false)}
              data-testid="writing-card-more-backdrop"
            >
              <div
                className="writing-card-more-sheet"
                role="dialog"
                aria-modal="true"
                aria-label={WRITING_CARD_MORE_TITLE}
                data-testid="writing-card-more-sheet"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="writing-card-more-item"
                  data-testid="writing-card-more-open-dataset"
                  onClick={() => {
                    setMoreOpen(false);
                    flushCardEdit('close');
                    onOpenInDataset();
                  }}
                >
                  {WRITING_CARD_OPEN_IN_DATASET}
                </button>
                <button
                  type="button"
                  className="writing-card-more-item"
                  data-testid="writing-card-more-close"
                  onClick={() => setMoreOpen(false)}
                >
                  {WRITING_CARD_MORE_CLOSE}
                </button>
              </div>
            </div>
          )}
        </aside>
      </>
    );
  }

  // 第 2 層：分類下的卡片清單
  if (currentCategory) {
    const cardTree = buildCardTree(bookCards, currentCategory.id);
    const rows = flattenVisibleCards(cardTree, collapsedIds);

    return (
      <>
        <div
          className="writing-cards-overlay"
          data-testid="writing-cards-overlay"
          onClick={requestClose}
          aria-hidden="true"
        />
        <aside
          className="writing-cards-drawer"
          data-testid="writing-cards-drawer"
          aria-label={CARDS_HEADING}
        >
          <header className="writing-cards-header">
            <button
              type="button"
              className="icon-button"
              aria-label={BACK_TO_CATEGORIES_ARIA}
              onClick={handleBackToCategories}
            >
              <BackIcon />
            </button>
            <h2 className="writing-cards-title">
              <span className="writing-cards-badge">{CARDS_HEADING}</span>
              <span className="writing-cards-sep">·</span>
              <span>{currentCategory.name}</span>
            </h2>
            <button
              type="button"
              className="icon-button writing-cards-close"
              aria-label={CLOSE_CARDS_ARIA}
              onClick={requestClose}
              data-testid="close-cards-drawer"
            >
              <CloseIcon />
            </button>
          </header>

          {isSample && (
            <div className="cards-file-notice" data-testid="cards-file-notice">
              {SAMPLE_CARDS_NOTICE}
            </div>
          )}

          <div className="writing-cards-scroll">
            {rows.length === 0 && (
              <p className="empty-note" data-testid="category-cards-empty">
                {CARDS_EMPTY_IN_CATEGORY_HINT}
              </p>
            )}
            <ul className="card-list" data-testid="category-card-list">
              {rows.map((row) => {
                const visual = cardVisualStyles(row.card.color);
                const indentPx = Math.min(row.level, 2) * 16;
                const summary = row.card.content.trim();

                const inlineStyle: React.CSSProperties = {
                  marginLeft: `${indentPx}px`,
                  ...(visual
                    ? {
                        borderLeft: visual.borderLeft,
                        backgroundImage: visual.backgroundImage,
                        backgroundColor: visual.backgroundColor,
                      }
                    : {}),
                };

                return (
                  <li
                    key={row.card.id}
                    className="card-item"
                    style={inlineStyle}
                    data-testid={`card-row-${row.card.id}`}
                    data-level={row.level}
                  >
                    {row.hasChildren && (
                      <button
                        type="button"
                        className="card-chevron-button"
                        aria-label={
                          row.isExpanded
                            ? cardCollapseAria(row.card.title)
                            : cardExpandAria(row.card.title)
                        }
                        onClick={() => toggleCollapse(row.card.id)}
                        data-testid={`card-toggle-${row.card.id}`}
                      >
                        <ChevronIcon expanded={row.isExpanded} size={18} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="card-item-button"
                      onClick={() => handleSelectCard(row.card.id)}
                      aria-label={cardDetailAria(row.card.title)}
                      data-testid={`card-select-${row.card.id}`}
                    >
                      <span className="card-item-title">{displayCardTitle(row.card.title)}</span>
                      {summary && (
                        <span className="card-item-summary">{summary}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </>
    );
  }

  // 第 1 層：分類清單
  return (
    <>
      <div
        className="writing-cards-overlay"
        data-testid="writing-cards-overlay"
        onClick={requestClose}
        aria-hidden="true"
      />
      <aside
        className="writing-cards-drawer"
        data-testid="writing-cards-drawer"
        aria-label={CARDS_HEADING}
      >
        <header className="writing-cards-header">
          <div className="writing-cards-header-spacer" />
          <h2 className="writing-cards-title">{CARDS_HEADING}</h2>
          <button
            type="button"
            className="icon-button writing-cards-close"
            aria-label={CLOSE_CARDS_ARIA}
            onClick={requestClose}
            data-testid="close-cards-drawer"
          >
            <CloseIcon />
          </button>
        </header>

        {isSample && (
          <div className="cards-file-notice" data-testid="cards-file-notice">
            {SAMPLE_CARDS_NOTICE}
          </div>
        )}

        <div className="writing-cards-scroll">
          {bookCards.length === 0 && (
            <p className="empty-note" data-testid="writing-cards-empty">
              {WRITING_CARDS_EMPTY_BOOK_HINT}
            </p>
          )}
          <ul className="category-list" data-testid="category-list">
            {categories.map((cat) => {
              const count = countCardsInCategory(bookCards, cat.id);
              return (
                <li key={cat.id}>
                  <button
                    type="button"
                    className="category-card"
                    onClick={() => handleSelectCategory(cat.id)}
                    aria-label={categoryRowAria(cat.name, count)}
                    data-testid={`category-row-${cat.id}`}
                  >
                    <span className="category-name">{cat.name}</span>
                    <span className="category-count">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </>
  );
};
