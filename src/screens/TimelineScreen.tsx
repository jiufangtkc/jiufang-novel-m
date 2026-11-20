import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CardEditor } from '../components/CardEditor';
import { BackIcon, PlusIcon } from '../components/Icons';
import { ManuscriptNotFound } from '../components/ManuscriptNotFound';
import { TimelineDualAxisView } from '../components/TimelineDualAxisView';
import { TimelineReadingView } from '../components/TimelineReadingView';
import { TimelineStoryView } from '../components/TimelineStoryView';
import {
  ADD_SUBCARD_BUTTON,
  CONFIRM_DELETE_BUTTON,
  DELETE_CARD_BUTTON,
  EDIT_CARD_CANCEL,
  EDIT_CARD_MORE,
  KEEP_CARD_BUTTON,
  UNDO_BUTTON,
  deleteCardQuestion,
  deleteSubcardsImpact,
  deletedCardToastTitle,
  deletedCardsListHint,
  getDeviceName,
  restoredCardToast,
  savedCardToast,
  undoCountdownText,
  undoToastSpoken,
} from '../copy/cardEditCopy';
import {
  TIMELINE_ADD_EVENT,
  TIMELINE_BACK_ARIA,
  TIMELINE_BACK_TO_TIMELINE_ARIA,
  TIMELINE_HEADING,
  TIMELINE_TAB_DUAL,
  TIMELINE_TAB_READING,
  TIMELINE_TAB_STORY,
  TREE_UNDO_HINT,
  displayCardTitle,
  timelineBookCrumb,
} from '../copy/userFacing';
import { DEMO_CARDS } from '../data/demoCards';
import { bookArchive } from '../db/chapterArchive';
import { deletedFromCard, type DeletedCardRecord } from '../domain/cardArchive';
import { isBuiltinSampleBook } from '../domain/builtinSampleBook';
import { CATEGORY_TIMELINE } from '../domain/cardCategories';
import { DEFAULT_CARD_COLOR, formatCardColorForSave } from '../domain/cardColors';
import { addSubCard } from '../domain/cardOps';
import {
  buildTimelineModel,
  moveTimelineCardByDelta,
  moveTimelineCardByDrop,
  sortTimelineStoryCards,
  type TimelineDropTarget,
} from '../domain/timeline';
import { useLayout } from '../layout';
import { clearCardDraft, getCardDraft, patchCardsPlace, saveCardDraft } from '../state/navMemory';
import { getProjectCards, useProject, useSample } from '../state/sampleStore';
import './cardsScreen.css';
import './timelineScreen.css';

export type TimelineViewMode = 'story' | 'reading' | 'dual';

export interface TimelineScreenProps {
  initialViewMode?: TimelineViewMode;
  initialCardId?: string | null;
  initialEditorMode?: 'preview' | 'edit';
  initialShowCardMenu?: boolean;
  initialConfirmDeleteCardId?: string | null;
  initialUndoRecord?: DeletedCardRecord | null;
  initialSelectedMoveId?: string | null;
  initialDualSelectedId?: string | null;
}

export function TimelineScreen(props: TimelineScreenProps = {}) {
  const { projectId = '' } = useParams();
  return <TimelineScreenBody key={projectId} {...props} />;
}

function TimelineScreenBody(props: TimelineScreenProps) {
  const fromProps =
    props.initialViewMode !== undefined ||
    props.initialCardId !== undefined ||
    props.initialEditorMode !== undefined ||
    props.initialShowCardMenu !== undefined ||
    props.initialConfirmDeleteCardId !== undefined ||
    props.initialUndoRecord !== undefined ||
    props.initialSelectedMoveId !== undefined ||
    props.initialDualSelectedId !== undefined;

  const {
    initialViewMode = 'story',
    initialCardId = null,
    initialEditorMode = 'preview',
    initialShowCardMenu = false,
    initialConfirmDeleteCardId = null,
    initialUndoRecord = null,
    initialSelectedMoveId = null,
    initialDualSelectedId,
  } = props;

  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const { state: sampleState, actions } = useSample();
  const { mode: layoutMode, pointer: pointerMode } = useLayout();

  const [viewMode, setViewMode] = useState<TimelineViewMode>(initialViewMode);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(initialCardId);
  const hasDraft = (cardId: string | null) =>
    Boolean(cardId && !fromProps && getCardDraft(projectId, cardId));
  const [editorMode, setEditorMode] = useState<'preview' | 'edit'>(() =>
    fromProps ? initialEditorMode : hasDraft(initialCardId) ? 'edit' : 'preview',
  );
  const [pickingColor, setPickingColor] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | undefined>(undefined);
  const [selectedMoveId, setSelectedMoveId] = useState<string | null>(initialSelectedMoveId);

  const [showCardMenu, setShowCardMenu] = useState(initialShowCardMenu);
  const [confirmDeleteCardId, setConfirmDeleteCardId] = useState<string | null>(
    initialConfirmDeleteCardId,
  );
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
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

  // 離開 wide 版面時，自動從雙軸對照退回故事順序
  useEffect(() => {
    if (viewMode === 'dual' && layoutMode !== 'wide') {
      setViewMode('story');
    }
  }, [layoutMode, viewMode]);

  // 10 秒復原倒數
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

  // 預載最近刪除（供刪卡後同步）
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    bookArchive.read(projectId).catch(() => {});
    const unsubscribe = bookArchive.subscribe(() => {
      if (!active) return;
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [projectId]);

  if (!project) {
    return (
      <div className="page timeline-page" data-testid="timeline-screen">
        <ManuscriptNotFound />
      </div>
    );
  }

  const isDesktopFile = project.origin === 'file';
  const isSampleNotice = isBuiltinSampleBook(project);
  const rawProjectCards = isDesktopFile
    ? (project.cards ?? (projectId ? getProjectCards(sampleState, projectId) : []))
    : isSampleNotice
      ? (() => {
          const base = project.cards && project.cards.length > 0 ? project.cards : DEMO_CARDS;
          const idSet = new Set(base.map((c) => c.id));
          const extra = DEMO_CARDS.filter((c) => !idSet.has(c.id));
          return extra.length > 0 ? [...base, ...extra] : base;
        })()
      : (project.cards ?? (projectId ? getProjectCards(sampleState, projectId) : []));
  const cards = rawProjectCards.filter((c) => !deletedIds.has(c.id));

  const model = buildTimelineModel(cards, project.nodes);
  const activeViewMode: TimelineViewMode =
    viewMode === 'dual' && layoutMode !== 'wide' ? 'story' : viewMode;
  const currentCard = selectedCardId ? (cards.find((c) => c.id === selectedCardId) ?? null) : null;

  const handleBackToCards = () => {
    if (projectId) {
      patchCardsPlace(projectId, {
        categoryId: CATEGORY_TIMELINE,
        cardId: null,
      });
    }
    navigate(`/p/${projectId}/cards`);
  };

  const handleOpenCard = (cardId: string) => {
    setSelectedCardId(cardId);
    setEditorMode(hasDraft(cardId) ? 'edit' : 'preview');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
  };

  const handleCloseCard = () => {
    setSelectedCardId(null);
    setEditorMode('preview');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
  };

  const handleAddEvent = () => {
    if (!projectId) return;
    const created = actions.addTimelineEvent(projectId);
    if (!created) return;
    if (!fromProps) {
      // 與 WritingCardsDrawer 一致：建立後立即進編輯時先寫入初始草稿，切走再回來仍保留編輯狀態
      saveCardDraft(projectId, created.id, {
        title: created.title,
        content: created.content,
        color: formatCardColorForSave(created.color || DEFAULT_CARD_COLOR),
        storyTime: created.storyTime ?? '',
        chapterId: created.chapterId ?? null,
      });
    }
    setSelectedMoveId(null);
    setSelectedCardId(created.id);
    setEditorMode('edit');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
  };

  const handleAddSubCard = (parentId: string) => {
    if (!projectId) return;
    const parent = rawProjectCards.find((c) => c.id === parentId);
    if (!parent) return;
    const nextCards = addSubCard(rawProjectCards, parentId);
    const newCard = nextCards[nextCards.length - 1];
    if (!newCard) return;
    actions.setCards(projectId, nextCards);
    setSelectedCardId(newCard.id);
    setEditorMode('edit');
    setPickingColor(false);
    setSavedNotice(undefined);
    setShowCardMenu(false);
  };

  const handleMoveByDrop = (dragId: string, drop: TimelineDropTarget): boolean => {
    if (!projectId) return false;
    const beforeIds = model.storyEvents.map((e) => e.id);
    const previewMoved = sortTimelineStoryCards(moveTimelineCardByDrop(cards, dragId, drop)).map(
      (c) => c.id,
    );
    const changed =
      previewMoved.length === beforeIds.length &&
      previewMoved.some((id, idx) => id !== beforeIds[idx]);
    if (!changed) return false;
    actions.moveTimelineEvent(projectId, dragId, { drop });
    return true;
  };

  const handleMoveByDelta = (cardId: string, delta: -1 | 1): boolean => {
    if (!projectId) return false;
    const beforeIds = model.storyEvents.map((e) => e.id);
    const previewMoved = sortTimelineStoryCards(moveTimelineCardByDelta(cards, cardId, delta)).map(
      (c) => c.id,
    );
    const changed =
      previewMoved.length === beforeIds.length &&
      previewMoved.some((id, idx) => id !== beforeIds[idx]);
    if (!changed) return false;
    actions.moveTimelineEvent(projectId, cardId, { delta });
    return true;
  };

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
      setUndoState({
        record,
        title: deletedCardToastTitle(cardToDelete.title, subCount),
        token: Date.now(),
        remainingSeconds: 10,
      });
    }

    setConfirmDeleteCardId(null);
    setShowCardMenu(false);
    setSelectedCardId(null);
    setEditorMode('preview');
    if (selectedMoveId && idsToRemove.includes(selectedMoveId)) {
      setSelectedMoveId(null);
    }

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

    actions.toast(restoredCardToast(record.title, TIMELINE_HEADING));
    setUndoState(null);
    setSelectedCardId(record.rootCardId);
    setEditorMode('preview');

    if (projectId) {
      try {
        await actions.restoreDeletedCard(projectId, record);
      } catch {
        // ignore
      }
    }
  };

  const renderCardDetail = (card: (typeof cards)[number]) => {
    const cardSubcards = cards
      .filter((c) => c.parent_id === card.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
    const draft = fromProps ? null : getCardDraft(projectId, card.id);
    const isTopLevelTimeline = card.category === CATEGORY_TIMELINE && !card.parent_id;

    return (
      <CardEditor
        key={`${card.id}:${editorMode}`}
        card={card}
        initialMode={initialEditorMode}
        initialPickingColor={pickingColor}
        mode={editorMode}
        initialDraft={draft}
        chapters={model.chapters}
        onJumpToChapter={(chapterId, draftPayload) => {
          if (!projectId) return;
          if (editorMode === 'edit' && !fromProps) {
            saveCardDraft(projectId, card.id, draftPayload);
          }
          navigate(`/p/${projectId}/write/${chapterId}`);
        }}
        onDraftChange={
          fromProps ? undefined : (next) => saveCardDraft(projectId, card.id, next)
        }
        onModeChange={(nextMode) => {
          if (nextMode === 'edit' && !fromProps && !draft) {
            saveCardDraft(projectId, card.id, {
              title: card.title,
              content: card.content,
              color: formatCardColorForSave(card.color || DEFAULT_CARD_COLOR),
              ...(isTopLevelTimeline
                ? {
                    storyTime: card.storyTime ?? '',
                    chapterId: card.chapterId ?? null,
                  }
                : {}),
            });
          }
          setEditorMode(nextMode);
          if (nextMode === 'preview') {
            setPickingColor(false);
          }
        }}
        layoutMode={layoutMode}
        savedNotice={savedNotice}
        subcards={cardSubcards}
        onSelectSubcard={(subId) => handleOpenCard(subId)}
        onMoreActions={() => setShowCardMenu(true)}
        onDelete={() => setConfirmDeleteCardId(card.id)}
        onSave={(patch) => {
          if (projectId) {
            actions.updateCard(projectId, card.id, patch);
            setSavedNotice(savedCardToast(patch.title));
            if (!fromProps) clearCardDraft(projectId, card.id);
          }
        }}
        onDone={() => {
          setEditorMode('preview');
          setPickingColor(false);
        }}
        onCancel={() => {
          if (!fromProps) clearCardDraft(projectId, card.id);
          setEditorMode('preview');
          setPickingColor(false);
        }}
      />
    );
  };

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
            className="card-action-sheet-item"
            onClick={() => handleAddSubCard(currentCard.id)}
            data-testid="card-menu-add-subcard-btn"
          >
            <span>{ADD_SUBCARD_BUTTON}</span>
          </button>
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

  const renderUndoToast = () => {
    if (!undoState) return null;
    return (
      <div className="card-undo-toast" data-testid="card-undo-toast">
        <p className="card-undo-spoken" role="status" data-testid="card-undo-toast-spoken">
          {undoToastSpoken(undoState.title)}
        </p>
        <div className="card-undo-toast-info" aria-hidden="true">
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
          aria-label={UNDO_BUTTON}
          data-testid="card-undo-btn"
        >
          <span aria-hidden="true">↺</span>
          <span>{UNDO_BUTTON}</span>
        </button>
      </div>
    );
  };

  // 非寬版點開事件卡時，整頁切進事件卡預覽／編輯，點返回回時間線
  if (currentCard && layoutMode !== 'wide') {
    return (
      <div
        className="page timeline-page timeline-detail-fullpage"
        data-testid="timeline-screen"
        data-layout={layoutMode}
      >
        <header className="topbar timeline-topbar">
          <button
            type="button"
            className="icon-button"
            aria-label={TIMELINE_BACK_TO_TIMELINE_ARIA}
            onClick={handleCloseCard}
            data-testid="timeline-detail-back-btn"
          >
            <BackIcon />
          </button>
          <h1 className="timeline-heading">
            {TIMELINE_HEADING}{' '}
            <span className="timeline-book-crumb">{timelineBookCrumb(project.title)}</span>
          </h1>
        </header>
        <div className="scroll-pane card-detail-pane">{renderCardDetail(currentCard)}</div>
        {renderCardActionSheet()}
        {renderDeleteConfirmDialog()}
        {renderUndoToast()}
      </div>
    );
  }

  const modeSwitch = (
    <div
      className="timeline-seg"
      role="tablist"
      aria-label={TIMELINE_HEADING}
      data-testid="timeline-mode-switch"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeViewMode === 'story'}
        className={activeViewMode === 'story' ? 'is-active' : undefined}
        onClick={() => setViewMode('story')}
        data-testid="timeline-tab-story"
      >
        {TIMELINE_TAB_STORY}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeViewMode === 'reading'}
        className={activeViewMode === 'reading' ? 'is-active' : undefined}
        onClick={() => {
          setViewMode('reading');
          setSelectedMoveId(null);
        }}
        data-testid="timeline-tab-reading"
      >
        {TIMELINE_TAB_READING}
      </button>
      {layoutMode === 'wide' && (
        <button
          type="button"
          role="tab"
          aria-selected={activeViewMode === 'dual'}
          className={activeViewMode === 'dual' ? 'is-active' : undefined}
          onClick={() => {
            setViewMode('dual');
            setSelectedMoveId(null);
          }}
          data-testid="timeline-tab-dual"
        >
          {TIMELINE_TAB_DUAL}
        </button>
      )}
    </div>
  );

  return (
    <div
      className="page timeline-page"
      data-testid="timeline-screen"
      data-layout={layoutMode}
    >
      <div className="timeline-main-col">
        <header className="topbar timeline-topbar">
          <button
            type="button"
            className="icon-button timeline-back-btn"
            aria-label={TIMELINE_BACK_ARIA}
            onClick={handleBackToCards}
            data-testid="timeline-back-btn"
          >
            <BackIcon />
          </button>
          <h1 className="timeline-heading">
            {TIMELINE_HEADING}{' '}
            <span className="timeline-book-crumb">{timelineBookCrumb(project.title)}</span>
          </h1>
          {layoutMode === 'wide' && modeSwitch}
          <button
            type="button"
            className="timeline-add-btn"
            onClick={handleAddEvent}
            data-testid="timeline-add-event-btn"
          >
            <PlusIcon size={18} />
            <span>{TIMELINE_ADD_EVENT}</span>
          </button>
        </header>

        {layoutMode !== 'wide' && modeSwitch}

        {activeViewMode === 'story' && (
          <TimelineStoryView
            events={model.storyEvents}
            selectedCardId={selectedCardId}
            selectedMoveId={selectedMoveId}
            onSelectMoveId={setSelectedMoveId}
            onSelectEvent={handleOpenCard}
            onMoveByDrop={handleMoveByDrop}
            onMoveByDelta={handleMoveByDelta}
          />
        )}

        {activeViewMode === 'reading' && (
          <TimelineReadingView
            chapterSections={model.chapterSections}
            unassignedEvents={model.unassignedEvents}
            selectedCardId={selectedCardId}
            onSelectEvent={handleOpenCard}
          />
        )}

        {activeViewMode === 'dual' && layoutMode === 'wide' && (
          <TimelineDualAxisView
            storyEvents={model.storyEvents}
            dualBottomEvents={model.dualBottomEvents}
            dualBottomGroups={model.dualBottomGroups}
            selectedCardId={selectedCardId}
            initialSelectedEventId={initialDualSelectedId}
            selectedMoveId={selectedMoveId}
            onSelectMoveId={setSelectedMoveId}
            onOpenCard={handleOpenCard}
            onMoveByDrop={handleMoveByDrop}
            onMoveByDelta={handleMoveByDelta}
          />
        )}
      </div>

      {currentCard && layoutMode === 'wide' && (
        <aside className="timeline-detail-aside" data-testid="timeline-detail-aside">
          <header className="topbar timeline-topbar">
            <button
              type="button"
              className="icon-button"
              aria-label={TIMELINE_BACK_TO_TIMELINE_ARIA}
              onClick={handleCloseCard}
              data-testid="timeline-detail-back-btn"
            >
              <BackIcon />
            </button>
            <h2 className="timeline-detail-heading">{displayCardTitle(currentCard.title)}</h2>
          </header>
          <div className="scroll-pane card-detail-pane">{renderCardDetail(currentCard)}</div>
        </aside>
      )}

      {renderCardActionSheet()}
      {renderDeleteConfirmDialog()}
      {renderUndoToast()}
    </div>
  );
}
