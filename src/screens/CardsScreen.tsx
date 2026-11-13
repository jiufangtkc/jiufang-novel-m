import React, { useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon, ChevronIcon, CloseIcon } from '../components/Icons';
import { CardEditor } from '../components/CardEditor';
import { CategoryManager } from '../components/CategoryManager';
import { DeletedCardsList } from '../components/DeletedCardsList';
import './cardsScreen.css';
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
  categoryRowAria,
  CLOSE_CARDS_ARIA,
  displayCardTitle,
  MANUSCRIPT_NOT_FOUND,
  SAMPLE_CARDS_NOTICE,
  TREE_UNDO_HINT,
} from '../copy/userFacing';
import {
  CONFIRM_DELETE_BUTTON,
  DELETED_CARDS_TITLE,
  DELETE_CARD_BUTTON,
  deleteCardQuestion,
  deleteSubcardsImpact,
  deletedCardsListHint,
  deletedCardToastTitle,
  EDIT_CARD_CANCEL,
  EDIT_CARD_MORE,
  getDeviceName,
  KEEP_CARD_BUTTON,
  ORGANIZE_CATEGORIES_BUTTON,
  restoredCardToast,
  savedCardToast,
  UNDO_BUTTON,
  undoCountdownText,
} from '../copy/cardEditCopy';
import { DEMO_PROJECTS, type ChapterNode, findNode } from '../data/demo';
import {
  DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
  DEMO_CARDS,
  type DemoCard,
} from '../data/demoCards';
import {
  buildCardTree,
  cardVisualStyles,
  cardsViewReducer,
  countCardsInCategory,
  flattenVisibleCards,
  shouldResetForProject,
  type VisibleCardRow,
} from '../domain/cards';
import {
  addCustomCategory,
  deleteCustomCategory,
  moveCategoryInOrder,
  renameCustomCategory,
  resolveVisibleCategories,
  type ResolvedCategoryItem,
} from '../domain/cardCategories';
import { deletedFromCard, type DeletedCardRecord } from '../domain/cardArchive';
import { type FileCard } from '../db/projectFile';
import { bookArchive } from '../db/chapterArchive';
import { useLayout } from '../layout';
import { getProjectCards, getProjectCategorySettings, useProject, useSample } from '../state/sampleStore';
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
  initialEditorMode?: 'preview' | 'edit';
  initialPickingColor?: boolean;
  initialShowCardMenu?: boolean;
  initialConfirmDeleteCardId?: string | null;
  initialShowDeletedCards?: boolean;
  initialDeletedCards?: readonly DeletedCardRecord[];
  initialDeletedCardIds?: readonly string[];
  initialUndoRecord?: DeletedCardRecord | null;
  initialIsOrganizingCategories?: boolean;
}

export function CardsScreen(props: CardsScreenProps = {}) {
  const {
    initialCategoryId = null,
    initialCardId = null,
    initialCollapsedIds,
    initialEditorMode = 'preview',
    initialPickingColor = false,
    initialShowCardMenu = false,
    initialConfirmDeleteCardId = null,
    initialShowDeletedCards = false,
    initialDeletedCards = [],
    initialDeletedCardIds = [],
    initialUndoRecord = null,
    initialIsOrganizingCategories = false,
  } = props;
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const { state: sampleState, actions } = useSample();
  const { mode: layoutMode, pointer: pointerMode } = useLayout();

  const [editorMode, setEditorMode] = useState<'preview' | 'edit'>(initialEditorMode);
  const [pickingColor, setPickingColor] = useState(initialPickingColor);
  const [savedNotice, setSavedNotice] = useState<string | undefined>(undefined);

  // WO-61 整理分類狀態
  const [isOrganizingCategories, setIsOrganizingCategories] = useState(
    initialIsOrganizingCategories,
  );

  // WO-61 刪除、更多動作選單、最近刪除與 10 秒復原狀態
  const [showCardMenu, setShowCardMenu] = useState(initialShowCardMenu);
  const [confirmDeleteCardId, setConfirmDeleteCardId] = useState<string | null>(
    initialConfirmDeleteCardId,
  );
  const [showDeletedCards, setShowDeletedCards] = useState(initialShowDeletedCards);
  const [deletedCards, setDeletedCards] = useState<readonly DeletedCardRecord[]>(
    initialDeletedCards,
  );
  const [deletedIds, setDeletedIds] = useState<Set<string>>(
    () => new Set(initialDeletedCardIds),
  );
  const [undoState, setUndoState] = useState<{
    record: DeletedCardRecord;
    title: string;
    token: number;
    remainingSeconds: number;
  } | null>(() => {
    if (initialUndoRecord) {
      const subCount = Math.max(0, (initialUndoRecord.cards?.length ?? 1) - 1);
      return {
        record: initialUndoRecord,
        title: deletedCardToastTitle(initialUndoRecord.title, subCount),
        token: Date.now(),
        remainingSeconds: 10,
      };
    }
    return null;
  });

  const [state, dispatch] = useReducer(cardsViewReducer, {
    selectedCategoryId: initialCategoryId,
    selectedCardId: initialCardId,
    collapsedIds: new Set(initialCollapsedIds ?? []),
  });

  const { selectedCategoryId, selectedCardId, collapsedIds } = state;
  const prevProjectIdRef = useRef(projectId);

  // 訂閱 IndexedDB 歸檔庫之最近刪除紀錄
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    bookArchive.read(projectId).then((archive) => {
      if (active && archive.deletedCards) {
        setDeletedCards((prev) => (prev.length > 0 ? prev : (archive.deletedCards ?? [])));
      }
    });
    const unsubscribe = bookArchive.subscribe((bookId, archive) => {
      if (active && bookId === projectId && archive.deletedCards) {
        setDeletedCards(archive.deletedCards);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [projectId]);

  // 10 秒倒數計時復原
  useEffect(() => {
    if (!undoState) return;
    const timeout = window.setTimeout(() => {
      setUndoState(null);
    }, 10000);
    const interval = window.setInterval(() => {
      setUndoState((prev) => {
        if (!prev) return null;
        if (prev.remainingSeconds <= 1) return null;
        return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
      });
    }, 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [undoState?.token]);

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

  const isDesktopFile = project.origin === 'file';
  const isBuiltinDemoProject = DEMO_PROJECTS.some(
    (demo) => demo.id === project.id || demo.id === projectId,
  );
  const rawProjectCards = isDesktopFile
    ? (project.cards ?? (projectId ? getProjectCards(sampleState, projectId) : []))
    : isBuiltinDemoProject
      ? (() => {
          // 範例卡片只在內建範例書使用
          const base = project.cards && project.cards.length > 0 ? project.cards : DEMO_CARDS;
          const idSet = new Set(base.map((c) => c.id));
          const extra = DEMO_CARDS.filter((c) => !idSet.has(c.id));
          return extra.length > 0 ? [...base, ...extra] : base;
        })()
      : (project.cards ?? (projectId ? getProjectCards(sampleState, projectId) : []));
  const cards = rawProjectCards.filter((c) => !deletedIds.has(c.id));

  const categorySettings = (() => {
    if (project?.origin === 'file' && !project.categoryOrderRaw && !project.categoriesMetaRaw) {
      const fromStore = projectId ? getProjectCategorySettings(sampleState, projectId) : null;
      if (fromStore && (fromStore.categoryOrder || fromStore.categoriesMeta !== '{}')) {
        return fromStore;
      }
      return {
        categoryOrder: DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
        expandedCategories: null,
        categoriesMeta: '{}',
      };
    }
    if (project) {
      return {
        categoryOrder:
          project.categoryOrderRaw !== undefined
            ? project.categoryOrderRaw
            : (projectId ? getProjectCategorySettings(sampleState, projectId).categoryOrder : DEFAULT_PROJECT_CATEGORY_ORDER_RAW),
        expandedCategories:
          project.expandedCategoriesRaw !== undefined
            ? project.expandedCategoriesRaw
            : (projectId ? getProjectCategorySettings(sampleState, projectId).expandedCategories : null),
        categoriesMeta:
          project.categoriesMetaRaw !== undefined
            ? project.categoriesMetaRaw
            : (projectId ? getProjectCategorySettings(sampleState, projectId).categoriesMeta : '{}'),
      };
    }
    return projectId
      ? getProjectCategorySettings(sampleState, projectId)
      : {
          categoryOrder: DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
          expandedCategories: null,
          categoriesMeta: '{}',
        };
  })();

  const categories: readonly ResolvedCategoryItem[] = resolveVisibleCategories({
    categoryOrder: categorySettings.categoryOrder,
    categoriesMeta: categorySettings.categoriesMeta,
    cards,
  });
  const currentCategory = selectedCategoryId
    ? categories.find((c) => c.id === selectedCategoryId) ?? null
    : null;
  const currentCard = selectedCardId
    ? cards.find((c) => c.id === selectedCardId) ?? null
    : null;

  const toggleCollapse = (cardId: string) => {
    dispatch({ type: 'TOGGLE_COLLAPSE', cardId });
  };

  const handleSelectCard = (cardId: string) => {
    setEditorMode('preview');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
    setShowDeletedCards(false);
    setIsOrganizingCategories(false);
    dispatch({ type: 'SELECT_CARD', cardId });
  };

  const handleSelectCategory = (categoryId: string) => {
    setEditorMode('preview');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
    setShowDeletedCards(false);
    setIsOrganizingCategories(false);
    dispatch({ type: 'SELECT_CATEGORY', categoryId });
  };

  const handleBackToCards = () => {
    setEditorMode('preview');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
    dispatch({ type: 'BACK_TO_CARDS' });
  };

  const handleBackToCategories = () => {
    setEditorMode('preview');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
    setShowDeletedCards(false);
    setIsOrganizingCategories(false);
    dispatch({ type: 'BACK_TO_CATEGORIES' });
  };

  const handleOpenDeletedCards = () => {
    setShowDeletedCards(true);
    setIsOrganizingCategories(false);
    setEditorMode('preview');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
  };

  const handleMoveCategoryUp = (code: string) => {
    if (!projectId) return;
    const result = moveCategoryInOrder({
      code,
      direction: 'up',
      categoryOrder: categorySettings.categoryOrder,
      categoriesMeta: categorySettings.categoriesMeta,
      cards,
    });
    if (result.moved) {
      actions.setCardCategories(projectId, {
        categoryOrder: result.nextCategoryOrder,
      });
    }
  };

  const handleMoveCategoryDown = (code: string) => {
    if (!projectId) return;
    const result = moveCategoryInOrder({
      code,
      direction: 'down',
      categoryOrder: categorySettings.categoryOrder,
      categoriesMeta: categorySettings.categoriesMeta,
      cards,
    });
    if (result.moved) {
      actions.setCardCategories(projectId, {
        categoryOrder: result.nextCategoryOrder,
      });
    }
  };

  const handleRenameCategory = (code: string, newName: string) => {
    if (!projectId) return;
    const result = renameCustomCategory({
      code,
      newName,
      categoriesMeta: categorySettings.categoriesMeta,
    });
    if (result.renamed) {
      actions.setCardCategories(projectId, {
        categoriesMeta: result.nextCategoriesMeta,
      });
    }
  };

  const handleDeleteCategory = (code: string) => {
    if (!projectId) return;
    const result = deleteCustomCategory({
      code,
      categoryOrder: categorySettings.categoryOrder,
      categoriesMeta: categorySettings.categoriesMeta,
      cards,
      expandedCategories: categorySettings.expandedCategories,
    });
    if (result.deleted) {
      actions.setCardCategories(projectId, {
        categoryOrder: result.nextCategoryOrder,
        categoriesMeta: result.nextCategoriesMeta,
        ...(result.nextExpandedCategories !== undefined
          ? { expandedCategories: result.nextExpandedCategories }
          : {}),
      });
      if (selectedCategoryId === code) {
        dispatch({ type: 'BACK_TO_CATEGORIES' });
      }
    }
  };

  const handleAddCategory = (name: string) => {
    if (!projectId) return;
    const result = addCustomCategory({
      name,
      categoryOrder: categorySettings.categoryOrder,
      categoriesMeta: categorySettings.categoriesMeta,
    });
    if (result.added) {
      actions.setCardCategories(projectId, {
        categoryOrder: result.nextCategoryOrder,
        categoriesMeta: result.nextCategoriesMeta,
      });
    }
  };

  // 刪除確認卡片資訊與子卡片（只在目前稿子的 cards 裡找）
  const targetConfirmCard = confirmDeleteCardId
    ? (cards.find((c) => c.id === confirmDeleteCardId) ?? null)
    : null;
  const confirmRecord = targetConfirmCard
    ? deletedFromCard(rawProjectCards, targetConfirmCard.id)
    : null;
  const confirmSubcards = confirmRecord
    ? confirmRecord.cards.filter((c) => c.id !== targetConfirmCard!.id)
    : [];

  const handleConfirmDelete = async (cardId: string) => {
    const cardToDelete = cards.find((c) => c.id === cardId) ?? targetConfirmCard;
    if (!cardToDelete) return;

    const record =
      confirmRecord ??
      deletedFromCard(rawProjectCards, cardId, Date.now(), `del-card-${Date.now()}-${cardId}`);
    const subCount = confirmSubcards.length;

    const idsToRemove = record ? record.cards.map((c) => c.id) : [cardId];
    setDeletedIds((prev) => {
      const next = new Set(prev);
      for (const id of idsToRemove) next.add(id);
      return next;
    });

    if (record) {
      setDeletedCards((prev) => [record, ...prev.filter((r) => r.id !== record.id)].slice(0, 10));
      setUndoState({
        record,
        title: deletedCardToastTitle(cardToDelete.title, subCount),
        token: Date.now(),
        remainingSeconds: 10,
      });
    }

    setConfirmDeleteCardId(null);
    setShowCardMenu(false);
    dispatch({ type: 'BACK_TO_CARDS' });

    if (projectId) {
      try {
        await actions.deleteCard(projectId, cardId);
      } catch {
        // ignore
      }
    }
  };

  const handleUndo = async () => {
    if (!undoState?.record) return;
    const record = undoState.record;

    const restoredIds = [record.rootCardId, ...(record.cards ?? []).map((c) => c.id)];
    setDeletedIds((prev) => {
      const next = new Set(prev);
      for (const id of restoredIds) next.delete(id);
      return next;
    });

    setDeletedCards((prev) => prev.filter((r) => r.id !== record.id));

    const categoryName =
      categories.find((c) => c.id === record.category)?.name ?? '未知分類';
    actions.toast(restoredCardToast(record.title, categoryName));

    setUndoState(null);
    dispatch({ type: 'SELECT_CARD', cardId: record.rootCardId });

    if (projectId) {
      try {
        await actions.restoreDeletedCard(projectId, record);
      } catch {
        // ignore
      }
    }
  };

  const handleRestoreFromList = async (record: DeletedCardRecord) => {
    const restoredIds = [record.rootCardId, ...(record.cards ?? []).map((c) => c.id)];
    setDeletedIds((prev) => {
      const next = new Set(prev);
      for (const id of restoredIds) next.delete(id);
      return next;
    });

    setDeletedCards((prev) => prev.filter((r) => r.id !== record.id));

    const categoryName =
      categories.find((c) => c.id === record.category)?.name ?? '未知分類';
    actions.toast(restoredCardToast(record.title, categoryName));

    if (projectId) {
      try {
        await actions.restoreDeletedCard(projectId, record);
      } catch {
        // ignore
      }
    }
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

  // 輔助渲染：分類清單（含最下方「最近刪除」入口與「整理分類」按鈕）
  const renderCategoryList = (selectedId: string | null) => (
    <div className="category-list-container" data-testid="category-list-container">
      <ul className="category-list" data-testid="category-list">
        {categories.map((cat) => {
          const count = countCardsInCategory(cards, cat.id);
          const isActive = !showDeletedCards && !isOrganizingCategories && selectedId === cat.id;
          return (
            <li key={cat.id}>
              <button
                type="button"
                className={isActive ? 'category-card is-active' : 'category-card'}
                onClick={() => {
                  setShowDeletedCards(false);
                  setIsOrganizingCategories(false);
                  handleSelectCategory(cat.id);
                }}
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
      <div className="category-list-bottom-section" data-testid="category-list-bottom-section">
        <button
          type="button"
          className={`category-card deleted-cards-entry${showDeletedCards ? ' is-active' : ''}`}
          onClick={handleOpenDeletedCards}
          aria-label={DELETED_CARDS_TITLE}
          aria-current={showDeletedCards ? 'true' : undefined}
          data-testid="recent-deleted-entry-btn"
        >
          <span className="category-name">
            <span className="deleted-entry-icon" aria-hidden="true">🗑</span>
            {DELETED_CARDS_TITLE}
          </span>
          {deletedCards.length > 0 && (
            <span className="category-count">{deletedCards.length}</span>
          )}
        </button>
      </div>
      <div className="cards-categories-footer" data-testid="cards-categories-footer">
        <button
          type="button"
          className="cards-organize-btn"
          onClick={() => {
            setIsOrganizingCategories(true);
            setShowDeletedCards(false);
          }}
          data-testid="organize-categories-btn"
        >
          <span>{ORGANIZE_CATEGORIES_BUTTON}</span>
        </button>
      </div>
    </div>
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
              onClick={() => handleSelectCard(row.card.id)}
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

  // 輔助渲染：卡片內容（整合 CardEditor、挑色、⋯選單與刪除）
  const renderCardDetail = (card: DemoCard | { id: string; title: string; content: string; color: string; parent_id: string | null; sort_order: number; category: string }) => {
    const cardSubcards = cards
      .filter((c) => c.parent_id === card.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));

    return (
      <CardEditor
        key={card.id}
        card={card}
        initialMode={initialEditorMode}
        initialPickingColor={pickingColor}
        mode={editorMode}
        onModeChange={(nextMode) => {
          setEditorMode(nextMode);
          if (nextMode === 'preview') {
            setPickingColor(false);
          }
        }}
        layoutMode={layoutMode}
        savedNotice={savedNotice}
        subcards={cardSubcards}
        onSelectSubcard={(subId) => handleSelectCard(subId)}
        onMoreActions={() => setShowCardMenu(true)}
        onDelete={() => setConfirmDeleteCardId(card.id)}
        onSave={(patch) => {
          if (projectId) {
            actions.updateCard(projectId, card.id, patch);
            setSavedNotice(savedCardToast(patch.title));
          }
        }}
        onDone={() => {
          setEditorMode('preview');
          setPickingColor(false);
        }}
        onCancel={() => {
          setEditorMode('preview');
          setPickingColor(false);
        }}
      />
    );
  };

  // 更多動作彈出面板（⋯選單）
  const renderCardActionSheet = () => {
    if (!showCardMenu || !currentCard) return null;
    return (
      <div
        className="card-action-sheet-backdrop"
        role="presentation"
        onClick={() => setShowCardMenu(false)}
        data-testid="card-action-sheet-backdrop"
      >
        <div
          className="card-action-sheet"
          role="dialog"
          aria-modal="true"
          data-testid="card-action-sheet"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="card-action-sheet-title">{EDIT_CARD_MORE}</h3>
          <button
            type="button"
            className="card-action-sheet-item card-action-sheet-delete"
            onClick={() => {
              setShowCardMenu(false);
              setConfirmDeleteCardId(currentCard.id);
            }}
            data-testid="card-menu-delete-btn"
          >
            <span>{DELETE_CARD_BUTTON}</span>
          </button>
          <button
            type="button"
            className="card-action-sheet-item card-action-sheet-cancel"
            onClick={() => setShowCardMenu(false)}
            data-testid="card-menu-cancel-btn"
          >
            {EDIT_CARD_CANCEL}
          </button>
        </div>
      </div>
    );
  };

  // 刪除確認對話框
  const renderDeleteConfirmDialog = () => {
    if (!confirmDeleteCardId || !targetConfirmCard) return null;
    return (
      <div
        className="card-delete-dialog-backdrop"
        role="presentation"
        onClick={() => setConfirmDeleteCardId(null)}
        data-testid="card-delete-dialog-backdrop"
      >
        <div
          className="card-delete-dialog-card dialog"
          role="dialog"
          aria-modal="true"
          data-testid="card-delete-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="card-delete-dialog-title">
            {deleteCardQuestion(targetConfirmCard.title)}
          </h2>
          {confirmSubcards.length > 0 && (
            <div className="card-delete-subcard-section" data-testid="card-delete-subcards-section">
              <p className="card-delete-subcard-alert" data-testid="delete-subcards-impact">
                {deleteSubcardsImpact(confirmSubcards.length)}
              </p>
              <ul className="card-delete-subcard-list" data-testid="delete-subcard-list">
                {confirmSubcards.map((sub) => (
                  <li key={sub.id}>{displayCardTitle(sub.title)}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="card-delete-dialog-hint">{TREE_UNDO_HINT}</p>
          <p className="card-delete-dialog-hint">
            {deletedCardsListHint(getDeviceName(layoutMode, pointerMode))}
          </p>
          <div className="card-delete-dialog-actions delete-actions">
            <button
              type="button"
              className="card-delete-dialog-btn card-delete-dialog-cancel button secondary keep"
              onClick={() => setConfirmDeleteCardId(null)}
              data-testid="cancel-delete-card-btn"
            >
              {KEEP_CARD_BUTTON}
            </button>
            <button
              type="button"
              className="card-delete-dialog-btn card-delete-dialog-confirm button danger"
              onClick={() => handleConfirmDelete(targetConfirmCard.id)}
              data-testid="confirm-delete-card-btn"
            >
              {CONFIRM_DELETE_BUTTON}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 10 秒復原 Toast
  const renderUndoToast = () => {
    if (!undoState) return null;
    return (
      <div className="card-undo-toast" data-testid="card-undo-toast" role="alert">
        <div className="card-undo-toast-info">
          <span className="card-undo-toast-title" data-testid="card-undo-toast-title">
            {undoState.title}
          </span>
          <span className="card-undo-toast-sub" data-testid="card-undo-toast-sub">
            {undoCountdownText(undoState.remainingSeconds)}
          </span>
        </div>
        <button
          type="button"
          className="card-undo-btn"
          onClick={handleUndo}
          data-testid="card-undo-btn"
        >
          <span>↺</span>
          <span>{UNDO_BUTTON}</span>
        </button>
      </div>
    );
  };

  /* =========================================================================
     版面 ④ 寬版（wide，≥1024）：三層並排（分類｜卡片清單｜卡片內容）
     ========================================================================= */
  if (layoutMode === 'wide') {
    const listCards = currentCategory
      ? flattenVisibleCards(buildCardTree(cards, currentCategory.id), collapsedIds)
      : [];

    return (
      <div className="page cards-page cards-wide-view" data-testid="cards-screen" data-layout="wide">
        {/* 第 1 欄：分類清單 */}
        <section
          className={`cards-col cards-col-categories${isOrganizingCategories ? ' is-organizing' : ''}`}
          data-testid="cards-col-categories"
        >
          {isOrganizingCategories ? (
            <CategoryManager
              categories={categories}
              cards={cards as FileCard[]}
              onMoveUp={handleMoveCategoryUp}
              onMoveDown={handleMoveCategoryDown}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
              onAddCategory={handleAddCategory}
              onDone={() => setIsOrganizingCategories(false)}
              layoutMode="wide"
            />
          ) : (
            <>
              <header className="topbar">
                <h2>{CARDS_COLUMN_CATEGORIES}</h2>
              </header>
              {isDesktopFile && (
                <div className="cards-file-notice" data-testid="cards-file-notice">
                  {SAMPLE_CARDS_NOTICE}
                </div>
              )}
              <div className="scroll-pane">{renderCategoryList(selectedCategoryId)}</div>
            </>
          )}
        </section>

        {/* 第 2 欄：卡片清單或最近刪除清單 */}
        <section className="cards-col cards-col-list" data-testid="cards-col-list">
          {showDeletedCards ? (
            <DeletedCardsList
              deletedCards={deletedCards}
              categories={categories}
              onRestore={handleRestoreFromList}
              onBack={() => setShowDeletedCards(false)}
              device={getDeviceName('wide', pointerMode)}
              layoutMode="wide"
            />
          ) : (
            <>
              <header className="topbar">
                <h2>{currentCategory ? currentCategory.name : CARDS_COLUMN_CARDS}</h2>
                {currentCategory && (
                  <span className="cards-count-label">
                    {cardsCountLabel(countCardsInCategory(cards, currentCategory.id))}
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
            </>
          )}
        </section>

        {/* 第 3 欄：卡片內容（內容區限寬約 720） */}
        <section className="cards-col cards-col-detail" data-testid="cards-col-detail">
          <header className="topbar">
            <h2>{CARDS_COLUMN_CONTENT}</h2>
          </header>
          <div className="scroll-pane card-detail-pane">
            {!showDeletedCards && currentCard ? (
              renderCardDetail(currentCard)
            ) : (
              <div className="cards-empty-state">
                <p className="empty-note">{CARDS_EMPTY_CARD_HINT}</p>
              </div>
            )}
          </div>
        </section>

        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  /* =========================================================================
     版面 ③ 中等（medium，600–1023）：兩欄並排（左欄分類、右欄卡片清單/內容）
     ========================================================================= */
  if (layoutMode === 'medium') {
    const listCards = currentCategory
      ? flattenVisibleCards(buildCardTree(cards, currentCategory.id), collapsedIds)
      : [];

    return (
      <div className="page cards-page cards-medium-view" data-testid="cards-screen" data-layout="medium">
        {/* 左欄：分類清單 */}
        <section
          className={`cards-col cards-col-categories${isOrganizingCategories ? ' is-organizing' : ''}`}
          data-testid="cards-col-categories"
        >
          {isOrganizingCategories ? (
            <CategoryManager
              categories={categories}
              cards={cards as FileCard[]}
              onMoveUp={handleMoveCategoryUp}
              onMoveDown={handleMoveCategoryDown}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
              onAddCategory={handleAddCategory}
              onDone={() => setIsOrganizingCategories(false)}
              layoutMode="medium"
            />
          ) : (
            <>
              <header className="topbar">
                <h1>{CARDS_HEADING}</h1>
              </header>
              {isDesktopFile && (
                <div className="cards-file-notice" data-testid="cards-file-notice">
                  {SAMPLE_CARDS_NOTICE}
                </div>
              )}
              <div className="scroll-pane">{renderCategoryList(selectedCategoryId)}</div>
            </>
          )}
        </section>

        {/* 右欄：卡片內容、卡片清單或最近刪除 */}
        <section className="cards-col cards-col-main" data-testid="cards-col-main">
          {showDeletedCards ? (
            <DeletedCardsList
              deletedCards={deletedCards}
              categories={categories}
              onRestore={handleRestoreFromList}
              onBack={() => setShowDeletedCards(false)}
              device={getDeviceName('medium', pointerMode)}
              layoutMode="medium"
            />
          ) : currentCard ? (
            <>
              <header className="topbar">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={BACK_TO_CARDS_ARIA}
                  onClick={handleBackToCards}
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
                  {cardsCountLabel(countCardsInCategory(cards, currentCategory.id))}
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

        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  /* =========================================================================
     版面 ② 手機橫拿（phone-landscape）：左側抽屜（讓位），正文讓位
     ========================================================================= */
  if (layoutMode === 'phone-landscape') {
    const listCards = currentCategory
      ? flattenVisibleCards(buildCardTree(cards, currentCategory.id), collapsedIds)
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
        <aside
          className={`cards-drawer-pane${editorMode === 'edit' || showDeletedCards || isOrganizingCategories ? ' is-full-width' : ''}`}
          data-testid="cards-drawer"
        >
          {isOrganizingCategories ? (
            <CategoryManager
              categories={categories}
              cards={cards as FileCard[]}
              onMoveUp={handleMoveCategoryUp}
              onMoveDown={handleMoveCategoryDown}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
              onAddCategory={handleAddCategory}
              onDone={() => setIsOrganizingCategories(false)}
              layoutMode="phone-landscape"
            />
          ) : showDeletedCards ? (
            <DeletedCardsList
              deletedCards={deletedCards}
              categories={categories}
              onRestore={handleRestoreFromList}
              onBack={() => setShowDeletedCards(false)}
              device={getDeviceName('phone-landscape', pointerMode)}
              layoutMode="phone-landscape"
            />
          ) : currentCard ? (
            <>
              <header className="topbar writing-cards-header">
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

        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  /* =========================================================================
     版面 ① 手機直拿（phone-portrait）：整頁兩層（照現行架構）
     ========================================================================= */
  // 整理分類頁
  if (isOrganizingCategories) {
    return (
      <div className="page cards-page" data-testid="cards-screen" data-layout="phone-portrait">
        <CategoryManager
          categories={categories}
          cards={cards as FileCard[]}
          onMoveUp={handleMoveCategoryUp}
          onMoveDown={handleMoveCategoryDown}
          onRename={handleRenameCategory}
          onDelete={handleDeleteCategory}
          onAddCategory={handleAddCategory}
          onDone={() => setIsOrganizingCategories(false)}
          layoutMode="phone-portrait"
        />
        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  // 最近刪除頁
  if (showDeletedCards) {
    return (
      <div className="page cards-page" data-testid="cards-screen" data-layout="phone-portrait">
        <DeletedCardsList
          deletedCards={deletedCards}
          categories={categories}
          onRestore={handleRestoreFromList}
          onBack={() => setShowDeletedCards(false)}
          device={getDeviceName('phone-portrait', pointerMode)}
          layoutMode="phone-portrait"
        />
        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  // 第三層：卡片內容檢視（先看排版、編輯、⋯選單、刪除確認）
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
            onClick={handleBackToCards}
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

        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  // 第二層：分類下的卡片清單
  if (currentCategory) {
    const cardTree = buildCardTree(cards, currentCategory.id);
    const rows = flattenVisibleCards(cardTree, collapsedIds);

    return (
      <div className="page cards-page" data-testid="cards-screen" data-layout="phone-portrait">
        <header className="topbar">
          <button
            type="button"
            className="icon-button"
            aria-label={BACK_TO_CATEGORIES_ARIA}
            onClick={handleBackToCategories}
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

        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  // 第一層：分類清單（含最下方「最近刪除」入口）
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

      {renderCardActionSheet()}
      {renderDeleteConfirmDialog()}
      {renderUndoToast()}
    </div>
  );
}
