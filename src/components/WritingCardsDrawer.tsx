import React, { useReducer } from 'react';
import { BackIcon, ChevronIcon, CloseIcon } from './Icons';
import { CardMarkdownView } from './CardMarkdownView';
import {
  BACK_TO_CARDS_ARIA,
  BACK_TO_CATEGORIES_ARIA,
  cardCollapseAria,
  cardDetailAria,
  cardExpandAria,
  CARDS_HEADING,
  CARDS_READONLY_BADGE,
  cardsSubcardsCountLabel,
  categoryRowAria,
  CLOSE_CARDS_ARIA,
  displayCardTitle,
  SAMPLE_CARDS_NOTICE,
} from '../copy/userFacing';
import { DEMO_CARD_CATEGORIES, DEMO_CARDS } from '../data/demoCards';
import {
  buildCardTree,
  cardsViewReducer,
  cardVisualStyles,
  countCardsInCategory,
  filterVisibleCategories,
  flattenVisibleCards,
} from '../domain/cards';
import {
  getStoredWritingCardsView,
  saveStoredWritingCardsView,
} from '../domain/writingCards';

export interface WritingCardsDrawerProps {
  projectId: string;
  isDesktopFile?: boolean;
  initialCategoryId?: string | null;
  initialCardId?: string | null;
  initialCollapsedIds?: Iterable<string>;
  onClose: () => void;
}

/**
 * 寫作時看卡片面板（WO-50）
 * - 標題寫「資料集」
 * - 只能看、不能改：絕不出現編輯、新增、刪除、排序、改色等按鈕，亦無變灰按鈕
 * - AI 對話紀錄分類完全隱藏
 * - 預設開啟「角色」分類，記住同一稿件上次閱讀位置
 * - 支援多層：分類清單（第 1 層）→ 卡片清單（第 2 層）→ 卡片排版內容（第 3 層，以 CardMarkdownView 渲染）
 */
export const WritingCardsDrawer: React.FC<WritingCardsDrawerProps> = ({
  projectId,
  isDesktopFile = false,
  initialCategoryId,
  initialCardId,
  initialCollapsedIds,
  onClose,
}) => {
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

  const categories = filterVisibleCategories(DEMO_CARD_CATEGORIES);
  const currentCategory = selectedCategoryId
    ? categories.find((c) => c.id === selectedCategoryId) ?? null
    : null;
  const currentCard = selectedCardId
    ? DEMO_CARDS.find((c) => c.id === selectedCardId) ?? null
    : null;

  // 第 3 層：卡片排版內容預覽（只能看，使用 CardMarkdownView）
  if (currentCard) {
    const visual = cardVisualStyles(currentCard.color);
    const categoryName =
      currentCategory?.name ??
      categories.find((c) => c.id === currentCard.category)?.name ??
      CARDS_HEADING;
    const subcards = DEMO_CARDS.filter((c) => c.parent_id === currentCard.id).sort(
      (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
    );

    return (
      <>
        <div
          className="writing-cards-overlay"
          data-testid="writing-cards-overlay"
          onClick={onClose}
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
              aria-label={BACK_TO_CARDS_ARIA}
              onClick={handleBackToCards}
            >
              <BackIcon />
            </button>
            <h2 className="writing-cards-title">
              <span className="writing-cards-badge">{CARDS_HEADING}</span>
              <span className="writing-cards-sep">·</span>
              <span>{categoryName}</span>
            </h2>
            <span className="cards-readonly-badge">{CARDS_READONLY_BADGE}</span>
            <button
              type="button"
              className="icon-button writing-cards-close"
              aria-label={CLOSE_CARDS_ARIA}
              onClick={onClose}
              data-testid="close-cards-drawer"
            >
              <CloseIcon />
            </button>
          </header>

          {isDesktopFile && (
            <div className="cards-file-notice" data-testid="cards-file-notice">
              {SAMPLE_CARDS_NOTICE}
            </div>
          )}

          <div className="writing-cards-scroll card-detail-pane">
            <article className="card-detail-article">
              <div className="card-detail-title-row">
                {visual && (
                  <span
                    className="card-color-dot"
                    style={{ backgroundColor: visual.dotColor }}
                    aria-hidden="true"
                  />
                )}
                <h3 className="card-detail-heading">{displayCardTitle(currentCard.title)}</h3>
              </div>
              <div className="card-detail-content" data-testid="card-preview-content">
                <CardMarkdownView content={currentCard.content} />
              </div>
              {subcards.length > 0 && (
                <div className="cards-subcards-section" data-testid="cards-subcards-section">
                  <div className="cards-subcards-heading">
                    {cardsSubcardsCountLabel(subcards.length)}
                  </div>
                  <ul className="cards-subcards-list">
                    {subcards.map((subcard) => {
                      const subVisual = cardVisualStyles(subcard.color);
                      return (
                        <li key={subcard.id} className="cards-subcard-item">
                          <button
                            type="button"
                            className="cards-subcard-button"
                            onClick={() => handleSelectCard(subcard.id)}
                            aria-label={cardDetailAria(subcard.title)}
                            style={subVisual ? { borderLeft: subVisual.borderLeft } : undefined}
                          >
                            <span className="cards-subcard-title">
                              {displayCardTitle(subcard.title)}
                            </span>
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
            </article>
          </div>
        </aside>
      </>
    );
  }

  // 第 2 層：分類下的卡片清單
  if (currentCategory) {
    const cardTree = buildCardTree(DEMO_CARDS, currentCategory.id);
    const rows = flattenVisibleCards(cardTree, collapsedIds);

    return (
      <>
        <div
          className="writing-cards-overlay"
          data-testid="writing-cards-overlay"
          onClick={onClose}
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
            <span className="cards-readonly-badge">{CARDS_READONLY_BADGE}</span>
            <button
              type="button"
              className="icon-button writing-cards-close"
              aria-label={CLOSE_CARDS_ARIA}
              onClick={onClose}
              data-testid="close-cards-drawer"
            >
              <CloseIcon />
            </button>
          </header>

          {isDesktopFile && (
            <div className="cards-file-notice" data-testid="cards-file-notice">
              {SAMPLE_CARDS_NOTICE}
            </div>
          )}

          <div className="writing-cards-scroll">
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
        onClick={onClose}
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
          <span className="cards-readonly-badge">{CARDS_READONLY_BADGE}</span>
          <button
            type="button"
            className="icon-button writing-cards-close"
            aria-label={CLOSE_CARDS_ARIA}
            onClick={onClose}
            data-testid="close-cards-drawer"
          >
            <CloseIcon />
          </button>
        </header>

        {isDesktopFile && (
          <div className="cards-file-notice" data-testid="cards-file-notice">
            {SAMPLE_CARDS_NOTICE}
          </div>
        )}

        <div className="writing-cards-scroll">
          <ul className="category-list" data-testid="category-list">
            {categories.map((cat) => {
              const count = countCardsInCategory(DEMO_CARDS, cat.id);
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
