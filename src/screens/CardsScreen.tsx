import React, { useEffect, useReducer, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon, ChevronIcon, CloseIcon } from '../components/Icons';
import {
  BACK_TO_CARDS_ARIA,
  BACK_TO_CATEGORIES_ARIA,
  cardCollapseAria,
  cardDetailAria,
  cardExpandAria,
  CARDS_COLUMN_CARDS,
  CARDS_COLUMN_CATEGORIES,
  CARDS_COLUMN_CONTENT,
  CARDS_EMPTY_CARD_HINT,
  CARDS_EMPTY_CATEGORY_HINT,
  CARDS_HEADING,
  cardsCountLabel,
  CARDS_PREVIEW_EMPTY_HINT,
  cardsSubcardsCountLabel,
  categoryRowAria,
  CLOSE_CARDS_ARIA,
  displayCardTitle,
  MANUSCRIPT_NOT_FOUND,
  SAMPLE_CARDS_NOTICE,
} from '../copy/userFacing';
import { type ChapterNode, findNode } from '../data/demo';
import { DEMO_CARD_CATEGORIES, DEMO_CARDS, type DemoCard } from '../data/demoCards';
import {
  buildCardTree,
  cardVisualStyles,
  cardsViewReducer,
  countCardsInCategory,
  filterVisibleCategories,
  flattenVisibleCards,
  shouldResetForProject,
  type VisibleCardRow,
} from '../domain/cards';
import { useLayout } from '../layout';
import { useProject } from '../state/sampleStore';
import { loadTreePlace } from './treeScroll';

function findFirstContentNode(nodes: readonly ChapterNode[]): ChapterNode | null {
  for (const node of nodes) {
    if (node.type !== 'folder' && node.content && node.content.trim()) {
      return node;
    }
    if (node.children) {
      const found = findFirstContentNode(node.children);
      if (found) return found;
    }
  }
  return null;
}

export interface CardsScreenProps {
  initialCategoryId?: string | null;
  initialCardId?: string | null;
  initialCollapsedIds?: Iterable<string>;
}

export function CardsScreen(props: CardsScreenProps = {}) {
  const {
    initialCategoryId = null,
    initialCardId = null,
    initialCollapsedIds,
  } = props;
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const { mode: layoutMode } = useLayout();

  const [state, dispatch] = useReducer(cardsViewReducer, {
    selectedCategoryId: initialCategoryId,
    selectedCardId: initialCardId,
    collapsedIds: new Set(initialCollapsedIds ?? []),
  });

  const { selectedCategoryId, selectedCardId, collapsedIds } = state;
  const prevProjectIdRef = useRef(projectId);

  useEffect(() => {
    if (shouldResetForProject(prevProjectIdRef.current, projectId)) {
      prevProjectIdRef.current = projectId;
      dispatch({ type: 'RESET_FOR_PROJECT', projectId });
    }
  }, [projectId]);

  if (!project) {
    return (
      <div className="page" data-testid="cards-screen">
        <p className="empty-note">{MANUSCRIPT_NOT_FOUND}</p>
      </div>
    );
  }

  const categories = filterVisibleCategories(DEMO_CARD_CATEGORIES);
  const currentCategory = selectedCategoryId
    ? categories.find((c) => c.id === selectedCategoryId) ?? null
    : null;
  const currentCard = selectedCardId
    ? DEMO_CARDS.find((c) => c.id === selectedCardId) ?? null
    : null;

  const isDesktopFile = project.origin === 'file';

  const toggleCollapse = (cardId: string) => {
    dispatch({ type: 'TOGGLE_COLLAPSE', cardId });
  };

  const previewNode: ChapterNode | null = (() => {
    if (!project) return null;
    const treePlaceNodeId =
      typeof window !== 'undefined' && window.sessionStorage
        ? loadTreePlace(window.sessionStorage, project.id)?.nodeId
        : null;
    if (treePlaceNodeId) {
      const node = findNode(project.nodes, treePlaceNodeId);
      if (node && node.type !== 'folder' && node.content?.trim()) {
        return node;
      }
    }
    if (project.lastOpenedNodeId) {
      const node = findNode(project.nodes, project.lastOpenedNodeId);
      if (node && node.type !== 'folder' && node.content?.trim()) {
        return node;
      }
    }
    return findFirstContentNode(project.nodes);
  })();

  // 輔助渲染：分類清單
  const renderCategoryList = (selectedId: string | null) => (
    <ul className="category-list" data-testid="category-list">
      {categories.map((cat) => {
        const count = countCardsInCategory(DEMO_CARDS, cat.id);
        const isActive = selectedId === cat.id;
        return (
          <li key={cat.id}>
            <button
              type="button"
              className={isActive ? 'category-card is-active' : 'category-card'}
              onClick={() => dispatch({ type: 'SELECT_CATEGORY', categoryId: cat.id })}
              aria-label={categoryRowAria(cat.name, count)}
              aria-current={isActive ? 'true' : undefined}
              data-testid={`category-row-${cat.id}`}
            >
              <span className="category-name">{cat.name}</span>
              <span className="category-count">{count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  // 輔助渲染：卡片清單
  const renderCardList = (rows: readonly VisibleCardRow[], selectedId: string | null) => (
    <ul className="card-list" data-testid="category-card-list">
      {rows.map((row) => {
        const visual = cardVisualStyles(row.card.color);
        const indentPx = Math.min(row.level, 2) * 16;
        const summary = row.card.content.trim();
        const isSelected = selectedId === row.card.id;

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
            className={isSelected ? 'card-item is-active' : 'card-item'}
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
              onClick={() => dispatch({ type: 'SELECT_CARD', cardId: row.card.id })}
              aria-label={cardDetailAria(row.card.title)}
              aria-current={isSelected ? 'true' : undefined}
              data-testid={`card-select-${row.card.id}`}
            >
              <span className="card-item-title">{displayCardTitle(row.card.title)}</span>
              {summary && <span className="card-item-summary">{summary}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  // 輔助渲染：卡片內容
  const renderCardDetail = (card: DemoCard) => {
    const visual = cardVisualStyles(card.color);
    const cardSubcards = DEMO_CARDS.filter((c) => c.parent_id === card.id).sort(
      (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
    );

    return (
      <article className="card-detail-article">
        <div className="card-detail-title-row">
          {visual && (
            <span
              className="card-color-dot"
              style={{ backgroundColor: visual.dotColor }}
              aria-hidden="true"
            />
          )}
          <h2 className="card-detail-heading">{displayCardTitle(card.title)}</h2>
        </div>
        <div className="card-detail-content" data-testid="card-raw-content">
          {card.content}
        </div>
        {cardSubcards.length > 0 && (
          <div className="cards-subcards-section" data-testid="cards-subcards-section">
            <div className="cards-subcards-heading">
              {cardsSubcardsCountLabel(cardSubcards.length)}
            </div>
            <ul className="cards-subcards-list">
              {cardSubcards.map((sub) => {
                const subVisual = cardVisualStyles(sub.color);
                return (
                  <li key={sub.id} className="cards-subcard-item">
                    <button
                      type="button"
                      className="cards-subcard-button"
                      onClick={() => dispatch({ type: 'SELECT_CARD', cardId: sub.id })}
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
      </article>
    );
  };

  /* =========================================================================
     版面 ④ 寬版（wide，≥1024）：三層並排（分類｜卡片清單｜卡片內容）
     ========================================================================= */
  if (layoutMode === 'wide') {
    const listCards = currentCategory
      ? flattenVisibleCards(buildCardTree(DEMO_CARDS, currentCategory.id), collapsedIds)
      : [];

    return (
      <div className="page cards-page cards-wide-view" data-testid="cards-screen" data-layout="wide">
        {/* 第 1 欄：分類清單 */}
        <section className="cards-col cards-col-categories" data-testid="cards-col-categories">
          <header className="topbar">
            <h2>{CARDS_COLUMN_CATEGORIES}</h2>
          </header>
          {isDesktopFile && (
            <div className="cards-file-notice" data-testid="cards-file-notice">
              {SAMPLE_CARDS_NOTICE}
            </div>
          )}
          <div className="scroll-pane">{renderCategoryList(selectedCategoryId)}</div>
        </section>

        {/* 第 2 欄：卡片清單 */}
        <section className="cards-col cards-col-list" data-testid="cards-col-list">
          <header className="topbar">
            <h2>{currentCategory ? currentCategory.name : CARDS_COLUMN_CARDS}</h2>
            {currentCategory && (
              <span className="cards-count-label">
                {cardsCountLabel(countCardsInCategory(DEMO_CARDS, currentCategory.id))}
              </span>
            )}
          </header>
          <div className="scroll-pane">
            {currentCategory ? (
              renderCardList(listCards, selectedCardId)
            ) : (
              <div className="cards-empty-state">
                <p className="empty-note">{CARDS_EMPTY_CATEGORY_HINT}</p>
              </div>
            )}
          </div>
        </section>

        {/* 第 3 欄：卡片內容（內容區限寬約 720） */}
        <section className="cards-col cards-col-detail" data-testid="cards-col-detail">
          <header className="topbar">
            <h2>{CARDS_COLUMN_CONTENT}</h2>
          </header>
          <div className="scroll-pane card-detail-pane">
            {currentCard ? (
              renderCardDetail(currentCard)
            ) : (
              <div className="cards-empty-state">
                <p className="empty-note">{CARDS_EMPTY_CARD_HINT}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  /* =========================================================================
     版面 ③ 中等（medium，600–1023）：兩欄並排（左欄分類、右欄卡片清單/內容）
     ========================================================================= */
  if (layoutMode === 'medium') {
    const listCards = currentCategory
      ? flattenVisibleCards(buildCardTree(DEMO_CARDS, currentCategory.id), collapsedIds)
      : [];

    return (
      <div className="page cards-page cards-medium-view" data-testid="cards-screen" data-layout="medium">
        {/* 左欄：分類清單 */}
        <section className="cards-col cards-col-categories" data-testid="cards-col-categories">
          <header className="topbar">
            <h1>{CARDS_HEADING}</h1>
          </header>
          {isDesktopFile && (
            <div className="cards-file-notice" data-testid="cards-file-notice">
              {SAMPLE_CARDS_NOTICE}
            </div>
          )}
          <div className="scroll-pane">{renderCategoryList(selectedCategoryId)}</div>
        </section>

        {/* 右欄：卡片內容或卡片清單 */}
        <section className="cards-col cards-col-main" data-testid="cards-col-main">
          {currentCard ? (
            <>
              <header className="topbar">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={BACK_TO_CARDS_ARIA}
                  onClick={() => dispatch({ type: 'BACK_TO_CARDS' })}
                >
                  <BackIcon />
                </button>
                <h2>{currentCategory?.name ?? CARDS_HEADING}</h2>
              </header>
              <div className="scroll-pane card-detail-pane">{renderCardDetail(currentCard)}</div>
            </>
          ) : currentCategory ? (
            <>
              <header className="topbar">
                <h2>{currentCategory.name}</h2>
                <span className="cards-count-label">
                  {cardsCountLabel(countCardsInCategory(DEMO_CARDS, currentCategory.id))}
                </span>
              </header>
              <div className="scroll-pane">{renderCardList(listCards, selectedCardId)}</div>
            </>
          ) : (
            <>
              <header className="topbar">
                <h2>{CARDS_COLUMN_CARDS}</h2>
              </header>
              <div className="scroll-pane cards-empty-state">
                <p className="empty-note">{CARDS_EMPTY_CATEGORY_HINT}</p>
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  /* =========================================================================
     版面 ② 手機橫拿（phone-landscape）：左側抽屜（讓位），正文讓位
     ========================================================================= */
  if (layoutMode === 'phone-landscape') {
    const listCards = currentCategory
      ? flattenVisibleCards(buildCardTree(DEMO_CARDS, currentCategory.id), collapsedIds)
      : [];

    const handleCloseDrawer = () => {
      navigate(projectId ? `/p/${projectId}/write` : '/');
    };

    return (
      <div
        className="page cards-page cards-landscape-view"
        data-testid="cards-screen"
        data-layout="phone-landscape"
      >
        <aside className="cards-drawer-pane" data-testid="cards-drawer">
          {currentCard ? (
            <>
              <header className="topbar writing-cards-header">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={BACK_TO_CARDS_ARIA}
                  onClick={() => dispatch({ type: 'BACK_TO_CARDS' })}
                >
                  <BackIcon />
                </button>
                <h2 className="writing-cards-title">
                  <span className="writing-cards-badge">{CARDS_HEADING}</span>
                  <span className="writing-cards-sep">·</span>
                  <span>{currentCategory?.name ?? CARDS_HEADING}</span>
                </h2>
                <button
                  type="button"
                  className="icon-button writing-cards-close"
                  aria-label={CLOSE_CARDS_ARIA}
                  onClick={handleCloseDrawer}
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
              <div className="scroll-pane card-detail-pane">{renderCardDetail(currentCard)}</div>
            </>
          ) : currentCategory ? (
            <>
              <header className="topbar writing-cards-header">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={BACK_TO_CATEGORIES_ARIA}
                  onClick={() => dispatch({ type: 'BACK_TO_CATEGORIES' })}
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
                  onClick={handleCloseDrawer}
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
              <div className="scroll-pane">{renderCardList(listCards, selectedCardId)}</div>
            </>
          ) : (
            <>
              <header className="topbar writing-cards-header">
                <div className="writing-cards-header-spacer" />
                <h2 className="writing-cards-title">{CARDS_HEADING}</h2>
                <button
                  type="button"
                  className="icon-button writing-cards-close"
                  aria-label={CLOSE_CARDS_ARIA}
                  onClick={handleCloseDrawer}
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
              <div className="scroll-pane">{renderCategoryList(selectedCategoryId)}</div>
            </>
          )}
        </aside>

        {/* 右側正文讓位區域（顯示本書真實內容，只能看不能改） */}
        <div className="cards-landscape-yield" data-testid="cards-landscape-yield">
          <div className="cards-manuscript-preview">
            {previewNode ? (
              <>
                <p className="hint cards-preview-heading" data-testid="cards-preview-heading">
                  {previewNode.title}
                </p>
                <div className="cards-preview-lead" data-testid="cards-preview-lead">
                  {previewNode.content}
                </div>
              </>
            ) : (
              <p className="hint cards-preview-empty" data-testid="cards-preview-empty">
                {CARDS_PREVIEW_EMPTY_HINT}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* =========================================================================
     版面 ① 手機直拿（phone-portrait）：整頁兩層（照現行架構）
     ========================================================================= */
  // 第三層：卡片內容檢視（純文字、保留換行、只能看）
  if (currentCard) {
    const categoryName =
      currentCategory?.name ??
      categories.find((c) => c.id === currentCard.category)?.name ??
      CARDS_HEADING;

    return (
      <div className="page cards-page" data-testid="cards-screen" data-layout="phone-portrait">
        <header className="topbar">
          <button
            type="button"
            className="icon-button"
            aria-label={BACK_TO_CARDS_ARIA}
            onClick={() => dispatch({ type: 'BACK_TO_CARDS' })}
          >
            <BackIcon />
          </button>
          <h1>{categoryName}</h1>
        </header>

        {isDesktopFile && (
          <div className="cards-file-notice" data-testid="cards-file-notice">
            {SAMPLE_CARDS_NOTICE}
          </div>
        )}

        <div className="scroll-pane card-detail-pane">{renderCardDetail(currentCard)}</div>
      </div>
    );
  }

  // 第二層：分類下的卡片清單
  if (currentCategory) {
    const cardTree = buildCardTree(DEMO_CARDS, currentCategory.id);
    const rows = flattenVisibleCards(cardTree, collapsedIds);

    return (
      <div className="page cards-page" data-testid="cards-screen" data-layout="phone-portrait">
        <header className="topbar">
          <button
            type="button"
            className="icon-button"
            aria-label={BACK_TO_CATEGORIES_ARIA}
            onClick={() => dispatch({ type: 'BACK_TO_CATEGORIES' })}
          >
            <BackIcon />
          </button>
          <h1>{currentCategory.name}</h1>
        </header>

        {isDesktopFile && (
          <div className="cards-file-notice" data-testid="cards-file-notice">
            {SAMPLE_CARDS_NOTICE}
          </div>
        )}

        <div className="scroll-pane">{renderCardList(rows, selectedCardId)}</div>
      </div>
    );
  }

  // 第一層：分類清單
  return (
    <div className="page cards-page" data-testid="cards-screen" data-layout="phone-portrait">
      <header className="topbar">
        <h1>{CARDS_HEADING}</h1>
      </header>

      {isDesktopFile && (
        <div className="cards-file-notice" data-testid="cards-file-notice">
          {SAMPLE_CARDS_NOTICE}
        </div>
      )}

      <div className="scroll-pane">{renderCategoryList(selectedCategoryId)}</div>
    </div>
  );
}
