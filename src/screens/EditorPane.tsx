import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DailyProgressBar } from '../components/DailyProgressBar';
import { BackIcon, CardsIcon, FocusIcon, ListTreeIcon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import {
  EDITOR_PLACEHOLDER,
  FLOATING_CHAPTER_TREE_ARIA,
  FLOATING_VIEW_CARDS_ARIA,
  FOCUS_MODE_ENTER_BUTTON,
  FOCUS_MODE_EXIT_BUTTON,
  OPEN_CHAPTER_TREE_ARIA,
  todayWordsLabel,
  TREE_DRAWER_BUTTON,
  TREE_NEXT_CHAPTER,
  TREE_PREV_CHAPTER,
  VIEW_CARDS_BUTTON,
} from '../copy/userFacing';
import { bookArchive } from '../db/chapterArchive';
import type { ChapterNode } from '../data/demo';
import { canPickLocalFiles } from '../db/browserDisk';
import { neighborChapterId } from '../domain/chapterOps';
import { sessionVersions, VERSION_INTERVAL_MS, withVersion } from '../domain/chapterVersions';
import { countManuscriptWords } from '../domain/manuscriptWords';
import { latestSaveTimestamp } from '../domain/saveClock';
import { countWords } from '../domain/wordCount';
import {
  captureCaretSnapshot,
  COMPOSITION_TIMEOUT_MS,
  handleCardsPointerDown,
  restoreCaretSnapshot,
  shouldCancelPendingOpen,
  type WritingCaretSnapshot,
} from '../domain/writingCards';
import { revealCaret } from '../editor/caret';
import { focusWritingBody } from '../editor/focusWriting';
import { useWritingKeyboard } from '../editor/useWritingKeyboard';
import { useWritingSurface } from '../editor/useWritingSurface';
import { CompositionActionQueue, handleEditorLayoutChange, useLayout } from '../layout';
import { useProject, useSample } from '../state/sampleStore';
import { editorSaveStatus } from './editorSaveStatus';

export function EditorPane({ projectId, chapter }: { projectId: string; chapter: ChapterNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const focusWriting = Boolean((location.state as { focusWriting?: boolean } | null)?.focusWriting);
  const didFocusBody = useRef(false);
  const { actions, state, isGlowing } = useSample();
  const project = useProject(projectId);
  const [focused, setFocused] = useState(false);
  const keyboard = useWritingKeyboard(focused);
  const keyboardOpen = keyboard.compact;
  const { ref } = useWritingSurface({
    bookId: projectId,
    chapterId: chapter.id,
    openingText: chapter.content ?? '',
    onCommit: (text) => actions.commitText(projectId, chapter.id, text),
    onLarge: actions.noteLarge,
    onDuration: actions.addDuration,
    onToast: (message) => actions.toast(message),
  });
  const goal = state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal;
  const todayWords = state.schedule.open?.wordCount ?? 0;
  const meta = state.saveMeta[projectId] ?? {
    lastAutoSaveMs: null,
    lastManualSaveMs: null,
    lastExportMs: null,
    lastProjectSaveMs: null,
  };
  const saveStatus = editorSaveStatus({
    directWriteback: canPickLocalFiles(),
    lastSaveMs: latestSaveTimestamp(meta),
    lastExportMs: meta.lastExportMs,
    now: new Date(),
  });
  const titleRef = useRef(chapter.title);
  titleRef.current = chapter.title;
  const rememberRef = useRef(actions.rememberPlace);
  rememberRef.current = actions.rememberPlace;
  const prevId = project ? neighborChapterId(project.nodes, chapter.id, -1) : null;
  const nextId = project ? neighborChapterId(project.nodes, chapter.id, 1) : null;

  const [isCardsOpen, setIsCardsOpen] = useState(false);
  const {
    mode: layoutMode,
    sidePanels,
    openPanel,
    closePanel,
    togglePanel,
    focusMode,
    enterFocusMode,
    exitFocusMode,
  } = useLayout();
  const prevLayoutModeRef = useRef(layoutMode);
  const compositionQueue = useRef(new CompositionActionQueue()).current;
  const caretSnapshotRef = useRef<WritingCaretSnapshot | null>(null);
  const capturedSnapshotRef = useRef<WritingCaretSnapshot | null>(null);
  const isComposingRef = useRef(false);
  const pendingOpenAfterCompositionRef = useRef(false);
  const pendingTimerRef = useRef<number | null>(null);

  const clearPendingComposition = () => {
    pendingOpenAfterCompositionRef.current = false;
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  };

  const setPendingComposition = () => {
    clearPendingComposition();
    pendingOpenAfterCompositionRef.current = true;
    pendingTimerRef.current = window.setTimeout(() => {
      clearPendingComposition();
    }, COMPOSITION_TIMEOUT_MS);
  };

  useEffect(() => {
    return () => {
      clearPendingComposition();
    };
  }, [chapter.id]);

  const handleButtonPointerDown = (e: React.PointerEvent) => {
    const isTextareaActive = Boolean(
      ref.current && (document.activeElement === ref.current || focused),
    );
    const result = handleCardsPointerDown(isComposingRef.current);
    if (result.preventDefault) {
      e.preventDefault();
      setPendingComposition();
      capturedSnapshotRef.current = captureCaretSnapshot(ref.current, true);
    } else {
      capturedSnapshotRef.current = captureCaretSnapshot(ref.current, isTextareaActive);
    }
  };

  const openCards = () => {
    if (pendingOpenAfterCompositionRef.current) return;
    const snapshot =
      capturedSnapshotRef.current ?? captureCaretSnapshot(ref.current, focused);
    capturedSnapshotRef.current = null;
    caretSnapshotRef.current = snapshot;
    setIsCardsOpen(true);
    openPanel('right');
  };

  const closeCards = () => {
    clearPendingComposition();
    setIsCardsOpen(false);
    closePanel('right');
    restoreCaretSnapshot(ref.current, caretSnapshotRef.current);
    caretSnapshotRef.current = null;
    capturedSnapshotRef.current = null;
  };

  const toggleCards = () => {
    if (isCardsOpen || sidePanels.right) {
      closeCards();
    } else {
      openCards();
    }
  };

  useEffect(() => {
    if (sidePanels.right && !isCardsOpen) {
      setIsCardsOpen(true);
    } else if (!sidePanels.right && isCardsOpen) {
      setIsCardsOpen(false);
    }
  }, [sidePanels.right, isCardsOpen]);

  const placedCursor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (placedCursor.current === chapter.id) return;
    const el = ref.current;
    if (!el || !project) return;
    placedCursor.current = chapter.id;
    if (project.lastOpenedNodeId !== chapter.id) return;
    const cursor = Math.max(0, Math.min(project.lastCursor ?? 0, el.value.length));
    el.setSelectionRange(cursor, cursor);
  }, [chapter.id, project, ref]);

  useEffect(() => {
    const textarea = ref.current;
    const nodeId = chapter.id;
    let baseline = textarea?.value ?? '';
    let lastKept = baseline;
    let baselineStored = false;
    const keep = () => {
      const content = textarea?.value ?? '';
      const taken = sessionVersions({
        baseline,
        lastKept,
        content,
        baselineStored,
        node: { id: nodeId, title: titleRef.current },
        savedAt: Date.now(),
      });
      lastKept = taken.lastKept;
      baselineStored = taken.baselineStored;
      if (taken.versions.length === 0) return;
      void bookArchive.update(projectId, (archive) => {
        let next = archive;
        for (const version of taken.versions) next = withVersion(next, version);
        return next;
      });
    };
    const timer = window.setInterval(keep, VERSION_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      keep();
    };
  }, [chapter.id, projectId, ref]);

  useEffect(() => {
    const savePlace = () => {
      const el = ref.current;
      if (!el) return;
      rememberRef.current(projectId, chapter.id, el.selectionStart ?? 0);
    };
    window.addEventListener('pagehide', savePlace);
    return () => {
      window.removeEventListener('pagehide', savePlace);
      savePlace();
    };
  }, [chapter.id, projectId, ref]);

  useLayoutEffect(() => {
    if ((keyboardOpen || keyboard.landscape) && ref.current) revealCaret(ref.current);
  }, [keyboardOpen, keyboard.landscape, ref]);

  useLayoutEffect(() => {
    if (prevLayoutModeRef.current !== layoutMode) {
      prevLayoutModeRef.current = layoutMode;
      handleEditorLayoutChange({
        textarea: ref.current,
        isComposing: isComposingRef.current,
        queue: compositionQueue,
        revealFn: revealCaret,
      });
    }
  }, [layoutMode, ref]);

  useEffect(() => {
    if (!focusWriting || didFocusBody.current) return;
    if (focusWritingBody(ref.current)) didFocusBody.current = true;
  }, [focusWriting, chapter.id, ref]);

  function go(id: string | null) {
    if (!id) return;
    const el = ref.current;
    const text = el?.value ?? chapter.content ?? '';
    const cursor = el?.selectionStart ?? 0;
    actions.commitText(projectId, chapter.id, text);
    actions.rememberPlace(projectId, chapter.id, cursor);
    navigate(`/p/${projectId}/write/${id}`);
  }

  const isYieldLeft =
    (layoutMode === 'phone-landscape' || layoutMode === 'medium') && sidePanels.left;
  const isYieldRight =
    (layoutMode === 'phone-landscape' || layoutMode === 'medium') &&
    (sidePanels.right || isCardsOpen);

  return (
    <div
      className={[
        keyboardOpen ? 'editor is-keyboard' : 'editor',
        focusMode ? 'is-focus-mode' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="editor"
      data-yield={isYieldLeft ? 'left' : isYieldRight ? 'right' : 'none'}
      data-yielding={isYieldLeft ? 'left' : isYieldRight ? 'right' : undefined}
    >
      <button
        type="button"
        className="focus-exit-button"
        aria-label={FOCUS_MODE_EXIT_BUTTON}
        onClick={exitFocusMode}
        data-testid="exit-focus-mode"
      >
        {FOCUS_MODE_EXIT_BUTTON}
      </button>
      <header className="topbar">
        <button
          type="button"
          className="icon-button back-button"
          aria-label="返回目錄"
          onClick={() => navigate(`/p/${projectId}/write`)}
          data-testid="back-button"
        >
          <BackIcon />
        </button>
        <button
          type="button"
          className="icon-button topbar-tree-button"
          aria-label={OPEN_CHAPTER_TREE_ARIA}
          onClick={() => togglePanel('left')}
          data-testid="toggle-tree-topbar"
        >
          <ListTreeIcon size={20} />
          <span className="tree-toggle-label">{TREE_DRAWER_BUTTON}</span>
        </button>
        <h1>{chapter.title}</h1>
        <div className="topbar-stats" data-testid="topbar-stats">
          <span className="topbar-words" data-testid="topbar-words">
            {todayWordsLabel(todayWords, goal)}
          </span>
          <span className="topbar-save" data-testid="topbar-save">
            {saveStatus.label}
          </span>
        </div>
        <button
          type="button"
          className="focus-enter-button"
          aria-label={FOCUS_MODE_ENTER_BUTTON}
          onClick={enterFocusMode}
          data-testid="enter-focus-mode"
        >
          <FocusIcon size={18} />
          <span className="focus-enter-label">{FOCUS_MODE_ENTER_BUTTON}</span>
        </button>
        <button
          type="button"
          className="view-cards-button"
          aria-label={VIEW_CARDS_BUTTON}
          onPointerDown={handleButtonPointerDown}
          onClick={toggleCards}
          data-testid="toggle-cards-topbar"
        >
          <CardsIcon size={20} />
          <span className="view-cards-label">{VIEW_CARDS_BUTTON}</span>
        </button>
      </header>
      <button
        type="button"
        className="floating-tree-trigger"
        aria-label={FLOATING_CHAPTER_TREE_ARIA}
        onClick={() => togglePanel('left')}
        data-testid="toggle-tree-floating"
      >
        <ListTreeIcon size={20} />
        <span className="floating-button-label">{FLOATING_CHAPTER_TREE_ARIA}</span>
      </button>
      <button
        type="button"
        className="landscape-cards-trigger"
        aria-label={FLOATING_VIEW_CARDS_ARIA}
        onPointerDown={handleButtonPointerDown}
        onClick={toggleCards}
        data-testid="toggle-cards-landscape"
      >
        <CardsIcon size={18} />
        <span>{VIEW_CARDS_BUTTON}</span>
      </button>
      <textarea
        ref={ref}
        className="editor-input"
        data-testid="writing-input"
        defaultValue={chapter.content ?? ''}
        name="jiufang-manuscript"
        inputMode="text"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        placeholder={EDITOR_PLACEHOLDER}
        aria-label="正文"
        enterKeyHint="enter"
        onFocus={() => setFocused(true)}
        onCompositionStart={() => {
          isComposingRef.current = true;
          compositionQueue.startComposition();
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          compositionQueue.endComposition();
          if (pendingOpenAfterCompositionRef.current) {
            clearPendingComposition();
            const snapshot =
              capturedSnapshotRef.current ?? captureCaretSnapshot(ref.current, true);
            capturedSnapshotRef.current = null;
            caretSnapshotRef.current = snapshot;
            setIsCardsOpen(true);
          }
        }}
        onBlur={() => {
          setFocused(false);
          if (shouldCancelPendingOpen('blur')) {
            clearPendingComposition();
          }
          const el = ref.current;
          if (el) actions.rememberPlace(projectId, chapter.id, el.selectionStart ?? 0);
        }}
      />
      <footer className="editor-status" data-testid="status-bar">
        <DailyProgressBar words={todayWords} goal={goal} met={isGlowing} compact={keyboardOpen} />
        <div className="status-row">
          <span className="status-cluster">
            <span data-testid="chapter-word-count">
              本章字數：
              {project?.origin === 'file'
                ? countManuscriptWords(chapter.content ?? '')
                : countWords(chapter.content ?? '')}
            </span>
            {chapter.progress && <StatusBadge code={chapter.progress} />}
          </span>
          {saveStatus.openFiles ? (
            <button
              type="button"
              className="save-status"
              data-testid="save-status"
              onClick={() => navigate(`/p/${projectId}/files`)}
            >
              {saveStatus.label}
            </button>
          ) : (
            <span className="save-status" data-testid="save-status">
              {saveStatus.label}
            </span>
          )}
        </div>
        <div className="chapter-jump" data-testid="chapter-jump">
          <button type="button" data-testid="chapter-prev" disabled={!prevId} onClick={() => go(prevId)}>
            {TREE_PREV_CHAPTER}
          </button>
          <button type="button" data-testid="chapter-next" disabled={!nextId} onClick={() => go(nextId)}>
            {TREE_NEXT_CHAPTER}
          </button>
        </div>
      </footer>
      <div className="focus-bottom-status" data-testid="focus-bottom-status">
        <span>{todayWordsLabel(todayWords, goal)}</span>
        <span className="focus-status-sep">·</span>
        <span>{saveStatus.label}</span>
      </div>
      {isCardsOpen && layoutMode !== 'wide' && (
        <WritingCardsDrawer
          projectId={projectId}
          isDesktopFile={project?.origin === 'file'}
          onClose={closeCards}
        />
      )}
    </div>
  );
}
