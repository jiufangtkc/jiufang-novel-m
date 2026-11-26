import {
  keepBodyFocusOnPointerDown,
  refocusBodyIfLost,
  snapshotForCardsClose,
} from '../editor/bodyFocusGuard';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFocusEscape } from './useFocusEscape';
import { DailyProgressBar } from '../components/DailyProgressBar';
import { FormatLayer, FormatMoreButton, FormatNotice, useFormatTools, type FormatExtraMenuItem } from '../components/FormatTools';
import '../components/formatTools.css';
import { TrashCornerNotice } from '../components/TrashCornerNotice';
import { TrashSelectionNotice } from '../components/TrashSelectionNotice';
import { TrashSheet } from '../components/TrashSheet';
import '../components/trashSheet.css';
import { BackIcon, CardsIcon, FocusIcon, ListTreeIcon } from '../components/Icons';
import { runReminderSave, StaleSaveReminder, useStaleSaveTick } from '../components/StaleSaveReminder';
import { SaveHeaderStatus } from '../components/SaveHeaderStatus';
import { StatusBadge } from '../components/StatusBadge';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import type { BookSearchController } from '../components/BookSearchPanelState';
import { SearchIcon, SearchThumbNav, useEditorSearch } from '../components/BookSearchPanelParts';
import '../components/BookSearchPanel.css';
import { DictButton, DictOfflineNotice } from '../components/DictButton';
import { dictPlacement } from '../dictionary/dictPlacement';
import { useDictNotice } from '../dictionary/useDictNotice';
import { useDictSelection } from '../dictionary/useDictSelection';
import { BOOK_SEARCH_OPEN_ARIA } from '../copy/bookSearchCopy';
import {
  FOCUS_MODE_LANDSCAPE_ENTER_ARIA,
  FOCUS_MODE_THUMB_ENTER_LABEL,
} from '../copy/focusModeCopy';
import {
  EDITOR_PLACEHOLDER,
  FLOATING_CHAPTER_TREE_ARIA,
  FLOATING_VIEW_CARDS_ARIA,
  FOCUS_MODE_ENTER_BUTTON,
  FOCUS_MODE_EXIT_BUTTON,
  BACK_TO_CHAPTER_TREE_ARIA,
  OPEN_CHAPTER_TREE_ARIA,
  todayWordsLabel,
  TREE_DRAWER_BUTTON,
  TREE_NEXT_CHAPTER,
  TREE_PREV_CHAPTER,
  VIEW_CARDS_BUTTON,
} from '../copy/userFacing';
import { bookArchive } from '../db/chapterArchive';
import { generateUuidV4 } from '../db/extensionMeta';
import type { ChapterNode } from '../data/demo';
import { canPickLocalFiles } from '../db/browserDisk';
import { lastExternalFileSaveMs, resolveHeaderSaveDisplay } from '../domain/autoSave';
import { isBuiltinSampleBook } from '../domain/builtinSampleBook';
import { neighborChapterId } from '../domain/chapterOps';
import { sessionVersions, VERSION_INTERVAL_MS, withVersion } from '../domain/chapterVersions';
import { latestSaveTimestamp } from '../domain/saveClock';
import { hasBodyText, staleSaveDays } from '../domain/staleSaveReminder';
import {
  appendToChapterEndPlan,
  computePutBackPlan,
  createTrashItem,
  extractTrashAnchor,
  insertTrashItemWithLimit,
  isTrashOriginalNodeAlive,
  nextTrashSortOrder,
  type TrashItem,
  type TrashPutBackPlan,
} from '../domain/trash';
import { countWords } from '../domain/wordCount';
import type { TrashCapturePayload } from '../editor/trashCapture';
import {
  TRASH_CORNER_ADDED,
  TRASH_MENU_MOVE_SELECTION,
  TRASH_MENU_OPEN,
  TRASH_MOVE_COMPOSING_TOAST,
  TRASH_MOVE_READONLY_TOAST,
  TRASH_PUT_BACK_END_TOAST,
  TRASH_PUT_BACK_ORIGINAL_TOAST,
  trashBlockedMessage,
  trashCornerAddedWithEvict,
  trashMenuBadge,
  trashPutBackPickedToast,
} from '../copy/trashCopy';
import {
  captureCaretSnapshot,
  COMPOSITION_TIMEOUT_MS,
  handleCardsPointerDown,
  restoreCaretSnapshot,
  shouldCancelPendingOpen,
  type WritingCaretSnapshot,
} from '../domain/writingCards';
import { writingPlaceLabel } from '../copy/writingCardEditCopy';
import { measureCaret, restorePanelRoom, revealCaret, revealCaretAbovePanel } from '../editor/caret';
import {
  flushCardEdit,
  getCardEditSnapshot,
  registerBodyPrepare,
  subscribeCardEdit,
} from '../state/writingCardEditSession';
import { focusWritingBody } from '../editor/focusWriting';
import { flushLiveDraftNow } from '../editor/liveDraft';
import { useWritingKeyboard } from '../editor/useWritingKeyboard';
import { useWritingSurface } from '../editor/useWritingSurface';
import {
  applyBodyFontCaretAnchor,
  bodyFontCaretNeedsScroll,
  rememberBodyFontCaret,
} from '../layout/bodyFontScale';
import {
  CompositionActionQueue,
  handleEditorLayoutChange,
  INITIAL_LANDSCAPE_EXIT_STATE,
  LANDSCAPE_EXIT_TIMEOUT_MS,
  landscapeExitReducer,
  useLayout,
} from '../layout';
import { useHalfWidthReminder as useHalfWidthSetting } from '../state/halfWidthReminder';
import { getProjectTrash, getProjectTrashRead, isProjectTrashReadOnly, useProject, useSample } from '../state/sampleStore';
import { caretToRestore, nearIdsOf, readWritePlace, saveWritePlace, scrollTopToRestore } from '../state/navMemory';
import { editorSaveStatus, unifiedFocusSaveLabel } from './editorSaveStatus';
import {
  HalfWidthBadge,
  HalfWidthBubble,
  HalfWidthOverlay,
  HalfWidthStrip,
  useHalfWidthReminder,
} from './HalfWidthReminder';
import './focusMode.css';

export function EditorPane({
  projectId,
  chapter,
  search,
}: {
  projectId: string;
  chapter: ChapterNode;
  /** WO-63：全書搜尋（由寫作頁提供；沒有時不顯示入口） */
  search?: BookSearchController;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const focusWriting = Boolean((location.state as { focusWriting?: boolean } | null)?.focusWriting);
  const didFocusBody = useRef(false);
  const sample = useSample();
  const { actions, state, isGlowing } = sample;
  const autoSaveStatusOf = sample.autoSaveStatusOf;
  const lastSaveWasAutoOf = sample.lastSaveWasAutoOf;
  const project = useProject(projectId);
  const [focused, setFocused] = useState(false);
  const keyboard = useWritingKeyboard(focused);
  const keyboardOpen = keyboard.compact;
  const onUserEditRef = useRef<(() => void) | null>(null);
  const onTrashCaptureRef = useRef<((payload: TrashCapturePayload) => string | null) | null>(null);
  const onTrashUndoRef = useRef<((itemId: string) => void) | null>(null);
  const { ref, replaceText } = useWritingSurface({
    bookId: projectId,
    chapterId: chapter.id,
    openingText: chapter.content ?? '',
    onCommit: (text, options) => actions.commitText(projectId, chapter.id, text, options),
    onLarge: actions.noteLarge,
    onDuration: actions.addDuration,
    onToast: (message) => actions.toast(message),
    onUserEdit: () => onUserEditRef.current?.(),
    onTrashCapture: (payload) => onTrashCaptureRef.current?.(payload) ?? null,
    onTrashUndo: (itemId) => onTrashUndoRef.current?.(itemId),
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
  // WO-98：空稿子（全書沒有任何正文）沒有東西可存，不提醒；範例書沒有起算時間，也不提醒。
  useStaleSaveTick();
  const staleDays =
    project && hasBodyText(project.nodes)
      ? staleSaveDays({
          lastProjectSaveMs: meta.lastProjectSaveMs,
          lastExportMs: meta.lastExportMs,
          startedMs: state.startedById[projectId],
          nowMs: Date.now(),
        })
      : null;
  const saveFromReminder = () => void runReminderSave(canPickLocalFiles(), actions);
  const isSample = isBuiltinSampleBook(project);
  const autoSaveStatus = autoSaveStatusOf ? autoSaveStatusOf(projectId) : 'unsupported';
  const stashFailed = sample.stashFailedOf ? sample.stashFailedOf(projectId) : false;
  const lastFileSaveMs = lastExternalFileSaveMs(meta);
  const headerKind = resolveHeaderSaveDisplay({
    isSample,
    autoSaveStatus,
    staleDays,
    lastFileSaveMs,
    stashFailed,
  });
  const headerHasSubRow = headerKind !== 'none';
  const showFooterSaveStatus = headerKind === 'none';
  const focusBottomSaveText = unifiedFocusSaveLabel({
    headerKind,
    isSample,
    staleDays,
    lastFileSaveMs,
    autoSaveActive: autoSaveStatus === 'active',
    lastSaveWasAuto: lastSaveWasAutoOf ? lastSaveWasAutoOf(projectId) : false,
    lastLocalSaveMs: latestSaveTimestamp(meta),
  });
  const titleRef = useRef(chapter.title);
  titleRef.current = chapter.title;
  const rememberRef = useRef(actions.rememberPlace);
  rememberRef.current = actions.rememberPlace;
  const prevId = project ? neighborChapterId(project.nodes, chapter.id, -1) : null;
  const nextId = project ? neighborChapterId(project.nodes, chapter.id, 1) : null;

  const [isCardsOpen, setIsCardsOpen] = useState(false);
  // WO-65：記住這一章的游標、選取、捲動與離開前鍵盤狀態（每本書各一份，存在這個裝置）
  const nodesRef = useRef(project?.nodes ?? []);
  nodesRef.current = project?.nodes ?? [];
  /** 最近一次按下（手指或滑鼠）當下正文是否在打字；切頁造成失焦之前就記下 */
  const typingAtPointerRef = useRef(false);
  const writePlaceReadyRef = useRef(false);
  /**
   * 放回捲動後短暫維持：版面、字型載入或既有的「游標露出」可能把捲動推走，
   * 使用者還沒動手前再放回一次；這段期間也不把被推走的位置記下來。
   */
  const settleScrollRef = useRef<{ top: number; until: number } | null>(null);
  /**
   * 使用者自己捲到的位置與當時的正文框寬度。目錄抽屜讓位等版面變化會讓正文換行、捲動跟著變，
   * 那不是使用者捲的，不覆蓋這個位置；使用者在新寬度下自己捲動或打字才更新。
   */
  const userScrollRef = useRef<{ top: number; width: number; max: number } | null>(null);
  const userActiveAtRef = useRef(0);
  const saveWritePlaceNow = (keyboard?: boolean) => {
    const el = ref.current;
    if (!el || !writePlaceReadyRef.current) return;
    const settle = settleScrollRef.current && Date.now() < settleScrollRef.current.until ? settleScrollRef.current : null;
    const width = el.clientWidth;
    const userMoved = Date.now() - userActiveAtRef.current < 1000;
    if (!settle && (userMoved || !userScrollRef.current || userScrollRef.current.width === width)) {
      userScrollRef.current = { top: Math.round(el.scrollTop), width, max: Math.max(0, el.scrollHeight - el.clientHeight) };
    }
    const scroll = userScrollRef.current ?? { top: Math.round(el.scrollTop), width, max: 0 };
    saveWritePlace(projectId, {
      chapterId: chapter.id,
      chapterOpen: true,
      selectionStart: el.selectionStart ?? 0,
      selectionEnd: el.selectionEnd ?? 0,
      scrollTop: settle ? settle.top : scroll.top,
      scrollWidth: scroll.width,
      scrollMax: scroll.max,
      keyboard: keyboard ?? (typeof document !== 'undefined' && document.activeElement === el),
      nearIds: nearIdsOf(nodesRef.current, chapter.id),
    });
  };
  const saveWritePlaceRef = useRef(saveWritePlaceNow);
  saveWritePlaceRef.current = saveWritePlaceNow;
  const {
    mode: layoutMode,
    sidePanels,
    openPanel,
    closePanel,
    togglePanel,
    focusMode,
    enterFocusMode,
    exitFocusMode,
    bodyFontScale,
    pointer,
  } = useLayout();
  const [halfWidthOn] = useHalfWidthSetting();
  // WO-105：查字典（只觀察選取；位置只看現有版面判斷）
  const dict = useDictSelection('body', ref);
  const dictNotice = useDictNotice();
  const dictWhere = dictPlacement({
    layoutMode,
    focusMode,
    landscapeTyping: keyboard.landscape,
  });
  const dictVisible = dict.visible;
  const dictTopbarClass = dictVisible && dictWhere === 'topbar' ? ' has-dict-button' : '';
  const hideDictNotice = dictNotice.hide;
  useEffect(() => {
    // 選取改變（或不再可查）時，沒網路提示可以消失
    hideDictNotice();
  }, [dict.word, dictVisible, hideDictNotice]);
  const halfWidth = useHalfWidthReminder({
    textareaRef: ref,
    bookId: projectId,
    chapterId: chapter.id,
    enabled: halfWidthOn,
    focusMode,
    bodyFontScale,
    layoutMode,
    replaceText,
  });
  const bodyFontScaleRef = useRef(bodyFontScale);
  bodyFontScaleRef.current = bodyFontScale;
  const prevLayoutModeRef = useRef(layoutMode);
  const prevFocusModeRef = useRef(focusMode);
  const compositionQueue = useRef(new CompositionActionQueue()).current;
  const caretSnapshotRef = useRef<WritingCaretSnapshot | null>(null);
  const capturedSnapshotRef = useRef<WritingCaretSnapshot | null>(null);
  const isComposingRef = useRef(false);
  const pendingOpenAfterCompositionRef = useRef(false);
  const pendingTimerRef = useRef<number | null>(null);
  // WO-63：搜尋接上正文框（讀最新正文、整段換字、等組字送出、跳到那一處與反白）
  const searchHooks = useEditorSearch({
    search,
    chapterId: chapter.id,
    textareaRef: ref,
    isComposingRef,
    replaceText,
  });

  // WO-138：刪稿暫存區狀態、自動收集／撤回、手動送入與角落提示
  const trashRead = getProjectTrashRead(state, projectId);
  const trashItems = getProjectTrash(state, projectId);
  const trashReadOnly = isProjectTrashReadOnly(state, projectId);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashNotice, setTrashNotice] = useState<{
    itemId: string | null;
    message: string;
    token: number;
  } | null>(null);
  const menuSelectionRef = useRef<{
    start: number;
    end: number;
    valueSnapshot: string;
  } | null>(null);
  const [menuSelection, setMenuSelection] = useState<{
    start: number;
    end: number;
    valueSnapshot: string;
  } | null>(null);
  const [selectionWordCount, setSelectionWordCount] = useState<number | null>(null);
  const syncSelectionWordCount = () => {
    const el = ref.current;
    if (!el || isComposingRef.current || document.activeElement !== el) {
      setSelectionWordCount(null);
      return;
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    if (end <= start) {
      setSelectionWordCount(null);
      return;
    }
    setSelectionWordCount(countWords(el.value.slice(start, end)));
  };
  const syncSelectionRef = useRef(syncSelectionWordCount);
  syncSelectionRef.current = syncSelectionWordCount;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => syncSelectionRef.current();
    const clear = () => setSelectionWordCount(null);
    const onSelectionChange = () => {
      if (document.activeElement === el) sync();
    };
    const events: Array<[string, () => void]> = [
      ['select', sync],
      ['pointerup', sync],
      ['keyup', sync],
      ['input', sync],
      ['focus', sync],
      ['blur', clear],
      ['compositionstart', clear],
      ['compositionend', sync],
    ];
    for (const [name, handler] of events) el.addEventListener(name, handler);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      for (const [name, handler] of events) el.removeEventListener(name, handler);
      document.removeEventListener('selectionchange', onSelectionChange);
      setSelectionWordCount(null);
    };
  }, [ref, chapter.id]);

  useEffect(() => {
    syncSelectionRef.current();
  }, [chapter.content, trashOpen, focusMode]);

  const showSelectionNotice = !focusMode && !trashOpen && selectionWordCount !== null;

  useEffect(() => {
    if (!trashNotice) return;
    const timer = window.setTimeout(() => {
      setTrashNotice((prev) => (prev && prev.token === trashNotice.token ? null : prev));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [trashNotice]);

  useEffect(() => {
    if (focusMode) {
      setTrashOpen(false);
    }
  }, [focusMode]);

  const captureMenuSelection = (event?: React.PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    if (event && event.type === 'pointerdown') {
      keepBodyFocusOnPointerDown(el, event);
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const snapshot = { start, end, valueSnapshot: el.value };
    menuSelectionRef.current = snapshot;
    setMenuSelection(snapshot);
  };

  const hasMenuSelection = Boolean(
    menuSelection &&
      menuSelection.end > menuSelection.start &&
      countWords(menuSelection.valueSnapshot.slice(menuSelection.start, menuSelection.end)) > 0,
  );

  onTrashCaptureRef.current = (payload) => {
    if (isProjectTrashReadOnly(state, projectId)) return null;
    const itemId = generateUuidV4();
    const deletedAtMs = payload.capturedAtMs;
    const sortOrder = nextTrashSortOrder(trashItems, deletedAtMs);
    const item: TrashItem = createTrashItem({
      itemId,
      chapterId: chapter.id,
      chapterTitleSnapshot: chapter.title,
      content: payload.deletedText,
      wordCount: payload.wordCount,
      beforeAnchor: payload.beforeAnchor,
      afterAnchor: payload.afterAnchor,
      charOffset: payload.charOffset,
      deletedAtMs,
      sortOrder,
    });
    const result = actions.addTrashItem(projectId, item, { immediate: false });
    if (result.kind === 'blocked-full') {
      setTrashNotice({
        itemId: null,
        message: trashBlockedMessage(result.reason),
        token: Date.now(),
      });
      return null;
    }
    setTrashNotice({
      itemId,
      message:
        result.evictedCount > 0 ? trashCornerAddedWithEvict(result.evictedCount) : TRASH_CORNER_ADDED,
      token: Date.now(),
    });
    return itemId;
  };

  onTrashUndoRef.current = (itemId) => {
    actions.removeTrashItem(projectId, itemId, { immediate: false });
    setTrashNotice((prev) => (prev && prev.itemId === itemId ? null : prev));
  };

  const handleMoveSelectionToTrash = () => {
    if (isComposingRef.current) {
      actions.toast(TRASH_MOVE_COMPOSING_TOAST);
      return;
    }
    if (trashReadOnly) {
      actions.toast(TRASH_MOVE_READONLY_TOAST);
      return;
    }
    const snap = menuSelectionRef.current ?? menuSelection;
    const el = ref.current;
    if (!snap || !el || el.value !== snap.valueSnapshot || snap.end <= snap.start) return;
    const anchor = extractTrashAnchor(snap.valueSnapshot, snap.start, snap.end);
    if (anchor.wordCount <= 0) return;

    const nowMs = Date.now();
    const item = createTrashItem({
      itemId: generateUuidV4(),
      chapterId: chapter.id,
      chapterTitleSnapshot: chapter.title,
      content: anchor.deletedText,
      wordCount: anchor.wordCount,
      beforeAnchor: anchor.beforeAnchor,
      afterAnchor: anchor.afterAnchor,
      charOffset: anchor.charOffset,
      deletedAtMs: nowMs,
      sortOrder: nextTrashSortOrder(trashItems, nowMs),
    });

    const preview = insertTrashItemWithLimit(trashItems, item);
    if (preview.kind === 'blocked-full') {
      setTrashNotice({
        itemId: null,
        message: trashBlockedMessage(preview.reason),
        token: Date.now(),
      });
      return;
    }

    const nextBody =
      snap.valueSnapshot.slice(0, snap.start) + snap.valueSnapshot.slice(snap.end);
    if (!replaceText(nextBody, snap.start, { countForToday: false })) {
      actions.toast(TRASH_MOVE_COMPOSING_TOAST);
      return;
    }

    const result = actions.addTrashItem(projectId, item, { immediate: true });
    if (result.kind === 'added') {
      setTrashNotice({
        itemId: item.itemId,
        message:
          result.evictedCount > 0 ? trashCornerAddedWithEvict(result.evictedCount) : TRASH_CORNER_ADDED,
        token: Date.now(),
      });
    }
  };

  const handlePutBackFromTrash = (
    item: TrashItem,
    targetNodeId: string,
    _initialPlan: TrashPutBackPlan,
    isPicked: boolean,
  ): boolean => {
    if (isComposingRef.current) {
      return false;
    }
    if (targetNodeId === chapter.id) {
      const el = ref.current;
      const liveBody = el?.value ?? chapter.content ?? '';
      const plan = isPicked
        ? appendToChapterEndPlan(liveBody, item.content, 'end')
        : computePutBackPlan(liveBody, item);
      if (!replaceText(plan.nextBody, plan.insertEnd, { countForToday: false })) {
        return false;
      }
      actions.removeTrashItem(projectId, item.itemId, { immediate: true });
      if (el) {
        el.setSelectionRange(plan.insertStart, plan.insertStart);
        try {
          const box = measureCaret(el);
          if (box) {
            el.scrollTop = Math.max(0, box.top - el.clientHeight * 0.35);
          }
        } catch {
          // 沒有版面計算的環境略過
        }
        el.setSelectionRange(plan.insertEnd, plan.insertEnd);
      }
      setTrashOpen(false);
      actions.toast(
        isPicked
          ? trashPutBackPickedToast(chapter.title)
          : plan.placement === 'original'
            ? TRASH_PUT_BACK_ORIGINAL_TOAST
            : TRASH_PUT_BACK_END_TOAST,
      );
      return true;
    }

    const targetNode = project ? isTrashOriginalNodeAlive(project.nodes, targetNodeId) : null;
    if (!targetNode) return false;
    const plan = isPicked
      ? appendToChapterEndPlan(targetNode.content ?? '', item.content, 'end')
      : computePutBackPlan(targetNode.content ?? '', item);
    const toastMessage = isPicked
      ? trashPutBackPickedToast(targetNode.title)
      : plan.placement === 'original'
        ? TRASH_PUT_BACK_ORIGINAL_TOAST
        : TRASH_PUT_BACK_END_TOAST;
    actions.putBackTrashItem(projectId, item.itemId, targetNodeId, plan.nextBody);
    setTrashOpen(false);
    navigate(`/p/${projectId}/write/${targetNodeId}`, {
      state: {
        trashJumpOffset: plan.insertStart,
        trashJumpEnd: plan.insertEnd,
        trashToast: toastMessage,
      },
    });
    return true;
  };

  const extraMenuItems: FormatExtraMenuItem[] = [
    {
      id: 'trash-open',
      label: TRASH_MENU_OPEN,
      badge: trashItems.length > 0 ? trashMenuBadge(trashItems.length) : undefined,
      onSelect: () => setTrashOpen(true),
    },
    ...(hasMenuSelection
      ? [
          {
            id: 'trash-move-selection',
            label: TRASH_MENU_MOVE_SELECTION,
            onSelect: handleMoveSelectionToTrash,
          },
        ]
      : []),
  ];

  // WO-122：排版小工具（頁首／橫拿「⋯」→ 排版）。專注模式不露出，進入專注時關掉殘留視窗。
  const formatTools = useFormatTools({
    projectId,
    chapterId: chapter.id,
    textareaRef: ref,
    isComposingRef,
    replaceText,
    focusMode,
    onAfterApplyOrUndo: () => halfWidth.rescan(),
    getMenuItemCount: () => {
      const snap = menuSelectionRef.current;
      const hasSel = Boolean(
        snap &&
          snap.end > snap.start &&
          countWords(snap.valueSnapshot.slice(snap.start, snap.end)) > 0,
      );
      return 2 + (hasSel ? 1 : 0);
    },
  });
  onUserEditRef.current = () => {
    if (formatTools.hasSnapshot) formatTools.dismissNotice();
  };

  const [landscapeExitState, setLandscapeExitState] = useState(INITIAL_LANDSCAPE_EXIT_STATE);
  const landscapeExitTimerRef = useRef<number | null>(null);

  const clearLandscapeExitTimer = () => {
    if (landscapeExitTimerRef.current !== null) {
      window.clearTimeout(landscapeExitTimerRef.current);
      landscapeExitTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!focusMode) {
      clearLandscapeExitTimer();
      setLandscapeExitState(INITIAL_LANDSCAPE_EXIT_STATE);
    }
  }, [focusMode, layoutMode]);

  useEffect(() => {
    return () => {
      clearLandscapeExitTimer();
    };
  }, []);

  // WO-82：進出專注鈕按下時正文若有焦點，就擋掉按鈕搶焦點；切換完成後再保險叫回
  // 只認這次按下後一秒內的切換，避免按了又移開、之後別的原因切換時誤把焦點拉回正文
  const bodyHadFocusRef = useRef(0);
  const handleFocusSwitchPointerDown = (e: React.PointerEvent) => {
    bodyHadFocusRef.current = keepBodyFocusOnPointerDown(ref.current, e) ? Date.now() : 0;
  };

  const handleExitClick = () => {
    if (layoutMode === 'phone-landscape') {
      const result = landscapeExitReducer(landscapeExitState, { type: 'click' });
      setLandscapeExitState(result.nextState);
      if (result.shouldExit) {
        clearLandscapeExitTimer();
        exitFocusMode();
      } else {
        clearLandscapeExitTimer();
        landscapeExitTimerRef.current = window.setTimeout(() => {
          setLandscapeExitState((prev) => landscapeExitReducer(prev, { type: 'collapse' }).nextState);
        }, LANDSCAPE_EXIT_TIMEOUT_MS);
      }
    } else {
      exitFocusMode();
    }
  };

  // WO-119：電腦專注模式按 Esc 離開（沿用既有 exitFocusMode，判斷見 focusEscape.ts）
  useFocusEscape({ layoutMode, pointer, focusMode, exitFocusMode, isComposingRef });

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
    // WO-82：僅查看卡片時焦點與鍵盤留在正文，不讓按鈕搶走
    keepBodyFocusOnPointerDown(ref.current, e);
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
    revealCaretWhenPanelReady();
  };

  // WO-88：面板有上滑動畫（約 0.25s）。不能只靠第一幀量測：
  // 第一幀與動畫途中面板位置偏低、遮擋高度會估小。
  // 這裡在第一幀、animationend／getAnimations().finished、約 300ms 保底各量一次；
  // revealCaretAbovePanel 只會往需要的方向補捲（已可見就不動），所以最後一次（最終幾何）為準。
  const revealCaretWhenPanelReady = () => {
    let tries = 0;
    const timers: number[] = [];
    const findPanel = () =>
      document.querySelector<HTMLElement>('[data-testid="writing-cards-drawer"]');
    const apply = (panel: HTMLElement) => {
      const el = ref.current;
      if (!el || !panel.isConnected || panel.dataset.cardEditing === 'true') return;
      try {
        revealCaretAbovePanel(el, panel);
      } catch {
        // 沒有版面計算的環境略過
      }
    };
    const run = () => {
      const panel = findPanel();
      if (!panel) {
        if (tries++ < 5) requestAnimationFrame(run);
        return;
      }
      if (panel.dataset.cardEditing === 'true') return;
      const again = () => apply(panel);
      again();
      panel.addEventListener('animationend', again, { once: true });
      if (typeof panel.getAnimations === 'function') {
        const animations = panel.getAnimations();
        if (animations.length > 0) {
          Promise.all(animations.map((a) => a.finished)).then(again, again);
        }
      }
      timers.push(window.setTimeout(again, 300));
    };
    requestAnimationFrame(run);
  };

  // WO-64：編輯卡片時正文唯讀；開始前先收好組字、記住位置，結束後（完成／取消）游標與鍵盤回正文
  const cardEdit = useSyncExternalStore(subscribeCardEdit, getCardEditSnapshot, getCardEditSnapshot);
  const chapterTitleRef = useRef(chapter.title);
  chapterTitleRef.current = chapter.title;
  useEffect(() => {
    registerBodyPrepare(() => {
      const el = ref.current;
      if (!el) return null;
      const snapshot = captureCaretSnapshot(el, true);
      const caret = el.selectionStart ?? 0;
      caretSnapshotRef.current = snapshot;
      // 失焦會讓還沒送出的注音先送出，之後正文才轉成唯讀
      if (document.activeElement === el) el.blur();
      try {
        revealCaret(el);
      } catch {
        // 沒有版面計算的環境略過
      }
      return writingPlaceLabel(chapterTitleRef.current, el.value, caret);
    });
    return () => registerBodyPrepare(null);
  }, [ref]);
  const seenEndSeq = useRef(cardEdit.endSeq);
  useEffect(() => {
    if (seenEndSeq.current === cardEdit.endSeq) return;
    seenEndSeq.current = cardEdit.endSeq;
    if (cardEdit.endKind === 'body') return;
    // 點正文是落在使用者剛點的位置，不用舊快照蓋掉；其他結束方式回到記住的位置
    restoreCaretSnapshot(ref.current, caretSnapshotRef.current);
    caretSnapshotRef.current = null;
  }, [cardEdit.endSeq, cardEdit.endKind, ref]);

  const closeCards = () => {
    flushCardEdit('close');
    clearPendingComposition();
    setIsCardsOpen(false);
    closePanel('right');
    restorePanelRoom(ref.current);
    // WO-82：焦點取開啟時的記錄，位置以現在為準（僅查看時使用者可能繼續打字）
    restoreCaretSnapshot(ref.current, snapshotForCardsClose(ref.current, caretSnapshotRef.current));
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

  // WO-65：從別的分頁回來時面板原本就開著：卡片若有暫存只顯示提示，游標與鍵盤先回正文
  const panelOpenAtEntry = useRef(sidePanels.right);
  useEffect(() => {
    if (!sidePanels.right) panelOpenAtEntry.current = false;
  }, [sidePanels.right]);

  useEffect(() => {
    if (sidePanels.right && !isCardsOpen) {
      setIsCardsOpen(true);
    } else if (!sidePanels.right && isCardsOpen) {
      setIsCardsOpen(false);
    }
  }, [sidePanels.right, isCardsOpen]);

  const placedCursor = useRef<string | null>(null);
  const pendingTrashToastRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !project) return;
    const jumpState = location.state as {
      trashJumpOffset?: number;
      trashJumpEnd?: number;
      trashToast?: string;
    } | null;
    if (placedCursor.current !== chapter.id) {
      placedCursor.current = chapter.id;
      if (typeof jumpState?.trashJumpOffset === 'number') {
        const jumpStart = Math.max(0, Math.min(jumpState.trashJumpOffset, el.value.length));
        const jumpEnd =
          typeof jumpState.trashJumpEnd === 'number'
            ? Math.max(jumpStart, Math.min(jumpState.trashJumpEnd, el.value.length))
            : jumpStart;
        el.setSelectionRange(jumpStart, jumpStart);
        let top = 0;
        try {
          const box = measureCaret(el);
          if (box) top = Math.max(0, box.top - el.clientHeight * 0.35);
        } catch {
          // 沒有版面計算的環境略過
        }
        el.scrollTop = top;
        el.setSelectionRange(jumpEnd, jumpEnd);
        userScrollRef.current = {
          top,
          width: el.clientWidth,
          max: Math.max(0, el.scrollHeight - el.clientHeight),
        };
        settleScrollRef.current = { top, until: Date.now() + 1500 };
        if (typeof jumpState.trashToast === 'string' && jumpState.trashToast) {
          pendingTrashToastRef.current = jumpState.trashToast;
        }
        navigate(location.pathname, { replace: true, state: null });
      } else {
        // WO-65：先用這個裝置記住的位置（同一章才用）；離開前在打字就叫回鍵盤，收著就只放好游標
        const memo = caretToRestore(readWritePlace(projectId), chapter.id, el.value.length);
        if (memo) {
          if (memo.keyboard) {
            try {
              el.focus({ preventScroll: true });
            } catch {
              el.focus();
            }
          }
          el.setSelectionRange(memo.selectionStart, memo.selectionEnd);
          const top = scrollTopToRestore(memo, el.clientWidth, el.scrollHeight - el.clientHeight);
          el.scrollTop = top;
          userScrollRef.current = { top, width: el.clientWidth, max: Math.max(0, el.scrollHeight - el.clientHeight) };
          settleScrollRef.current = { top, until: Date.now() + 1500 };
          const reapply = () => {
            const settle = settleScrollRef.current;
            if (!settle || Date.now() > settle.until || !ref.current) return;
            ref.current.scrollTop = settle.top;
          };
          window.requestAnimationFrame(() => window.requestAnimationFrame(reapply));
          void document.fonts?.ready.then(() => window.requestAnimationFrame(reapply)).catch(() => undefined);
        } else if (project.lastOpenedNodeId === chapter.id) {
          const cursor = Math.max(0, Math.min(project.lastCursor ?? 0, el.value.length));
          el.setSelectionRange(cursor, cursor);
        }
      }
      writePlaceReadyRef.current = true;
      saveWritePlaceRef.current();
    }
    // 字級變了才把游標那一行捲回原來的高度。平常打字不進這裡。
    // 組字中先排隊，不改選取、不改文字。
    if (!bodyFontCaretNeedsScroll(bodyFontScale, el.selectionStart ?? 0)) return;
    handleEditorLayoutChange({
      textarea: el,
      isComposing: isComposingRef.current,
      queue: compositionQueue,
      revealFn: (node) => {
        applyBodyFontCaretAnchor(node, bodyFontScaleRef.current);
      },
    });
  }, [chapter.id, project, bodyFontScale, ref]);

  // WO-138：跨章放回的說明提示待 Workspace 依 pathname 清空舊 toast 後再顯示
  useEffect(() => {
    const message = pendingTrashToastRef.current;
    if (!message) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      pendingTrashToastRef.current = null;
      actions.toast(message);
    });
    return () => {
      cancelled = true;
    };
  }, [chapter.id, actions]);

  useLayoutEffect(() => {
    const textarea = ref.current;
    return () => {
      if (textarea) rememberBodyFontCaret(textarea, bodyFontScaleRef.current);
    };
  }, [ref]);

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

  // WO-65：游標移動、捲動、關掉頁面、切走（卸載）都記下寫作位置。
  // 鍵盤狀態以「按下當下」為準：按分頁時正文會先失焦，不能因此記成鍵盤收著。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointerDown = () => {
      typingAtPointerRef.current = document.activeElement === el;
      settleScrollRef.current = null;
    };
    const stopSettle = () => {
      settleScrollRef.current = null;
      userActiveAtRef.current = Date.now();
    };
    el.addEventListener('wheel', stopSettle, { passive: true });
    el.addEventListener('touchstart', stopSettle, { passive: true });
    el.addEventListener('touchmove', stopSettle, { passive: true });
    el.addEventListener('keydown', stopSettle);
    el.addEventListener('input', stopSettle);
    el.addEventListener('pointerdown', stopSettle);
    const onSelection = () => {
      if (document.activeElement === el) saveWritePlaceRef.current(true);
    };
    const onPageHide = () => saveWritePlaceRef.current();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('wheel', stopSettle);
      el.removeEventListener('touchstart', stopSettle);
      el.removeEventListener('touchmove', stopSettle);
      el.removeEventListener('keydown', stopSettle);
      el.removeEventListener('input', stopSettle);
      el.removeEventListener('pointerdown', stopSettle);
      document.removeEventListener('selectionchange', onSelection);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (!el) return;
      const typing = document.activeElement === el || typingAtPointerRef.current;
      saveWritePlaceRef.current(typing);
    };
  }, [ref]);

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

  useLayoutEffect(() => {
    if (prevFocusModeRef.current !== focusMode) {
      prevFocusModeRef.current = focusMode;
      // WO-82：按下當下正文有焦點、切換後卻不在正文，立即叫回（不動選取範圍）
      refocusBodyIfLost(ref.current, Date.now() - bodyHadFocusRef.current < 1000 && bodyHadFocusRef.current > 0);
      bodyHadFocusRef.current = 0;
      handleEditorLayoutChange({
        textarea: ref.current,
        isComposing: isComposingRef.current,
        queue: compositionQueue,
        revealFn: revealCaret,
      });
    }
  }, [focusMode, ref]);

  useEffect(() => {
    if (!focusWriting || didFocusBody.current) return;
    if (focusWritingBody(ref.current)) didFocusBody.current = true;
  }, [focusWriting, chapter.id, ref]);

  function go(id: string | null) {
    if (!id) return;
    flushLiveDraftNow();
    const el = ref.current;
    const text = el?.value ?? chapter.content ?? '';
    const cursor = el?.selectionStart ?? 0;
    actions.commitText(projectId, chapter.id, text);
    actions.rememberPlace(projectId, chapter.id, cursor);
    navigate(`/p/${projectId}/write/${id}`);
  }

  // WO-76 乙段：提示條與頁首提示。專注模式一律只留底線；打字中或鍵盤開著只留底線（寬版除外）。
  const halfWidthNotice =
    halfWidthOn && !focusMode && (halfWidth.result !== null || (halfWidth.count > 0 && !halfWidth.skipped));
  const halfWidthQuiet = halfWidth.typing || keyboardOpen;
  const showHalfWidthStrip = halfWidthNotice && layoutMode === 'phone-portrait' && !halfWidthQuiet;
  const showHalfWidthBadge =
    halfWidthNotice &&
    (layoutMode === 'wide' ||
      ((layoutMode === 'phone-landscape' || layoutMode === 'medium') &&
        !keyboard.landscape &&
        !halfWidthQuiet &&
        !(focused && pointer === 'touch')));

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
      data-trash-open={trashOpen ? 'true' : undefined}
      data-yield={isYieldLeft ? 'left' : isYieldRight ? 'right' : 'none'}
      data-yielding={isYieldLeft ? 'left' : isYieldRight ? 'right' : undefined}
    >
      <HalfWidthOverlay controller={halfWidth} />
      {searchHooks.overlay}
      <button
        type="button"
        className={['focus-exit-button', landscapeExitState.expanded ? 'is-expanded' : '']
          .filter(Boolean)
          .join(' ')}
        aria-label={FOCUS_MODE_EXIT_BUTTON}
        onPointerDown={handleFocusSwitchPointerDown}
        onClick={handleExitClick}
        data-testid="exit-focus-mode"
      >
        {FOCUS_MODE_EXIT_BUTTON}
      </button>
      <header className={staleDays != null || headerHasSubRow ? `topbar has-save-reminder${dictTopbarClass}` : `topbar${dictTopbarClass}`}
      >
        <button
          type="button"
          className="icon-button back-button"
          aria-label={BACK_TO_CHAPTER_TREE_ARIA}
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
        {showHalfWidthBadge && layoutMode !== 'wide' && (
          <HalfWidthBadge controller={halfWidth} expandable={layoutMode === 'medium'} />
        )}
        <div className="topbar-stats" data-testid="topbar-stats">
          {/* WO-117：今天字數與暫存狀態只由底下進度條區（一般）或 .focus-bottom-status（專注／橫拿打字）提供，頁首不再產生。 */}
          {showHalfWidthBadge && layoutMode === 'wide' && (
            <HalfWidthBadge controller={halfWidth} expandable />
          )}
        </div>
        {dictVisible && dictWhere === 'topbar' ? (
          <DictButton
            word={dict.word}
            placement="topbar"
            onPointerDown={dict.onPointerDown}
            onPress={dict.onPress}
            onBlur={dict.onButtonBlur}
            onOffline={dictNotice.show}
            testId="dict-button"
          />
        ) : null}
        {search ? (
          <button
            type="button"
            className="search-open-button"
            aria-label={BOOK_SEARCH_OPEN_ARIA}
            aria-expanded={search.open && (search.side !== 'page' || search.view === 'results')}
            onClick={search.openSearch}
            data-testid="search-open-topbar"
          >
            <SearchIcon size={20} />
          </button>
        ) : null}
        <button
          type="button"
          className="focus-enter-button"
          aria-label={FOCUS_MODE_ENTER_BUTTON}
          onPointerDown={handleFocusSwitchPointerDown}
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
        {!focusMode ? (
          <FormatMoreButton
            tools={formatTools}
            className="format-more-button"
            testId="format-more-topbar"
            onPointerDown={captureMenuSelection}
          />
        ) : null}
        {headerKind === 'stale' && staleDays != null ? (
          <StaleSaveReminder days={staleDays} onSave={saveFromReminder} />
        ) : (
          <SaveHeaderStatus
            kind={headerKind}
            canPickFiles={canPickLocalFiles()}
            lastFileSaveMs={lastFileSaveMs}
            autoSaveActive={autoSaveStatus === 'active'}
            lastSaveWasAuto={lastSaveWasAutoOf ? lastSaveWasAutoOf(projectId) : false}
            onResumeAutoSave={() => void actions.resumeAutoSave?.()}
            onSave={saveFromReminder}
            onSaveAs={() => void actions.saveProjectAs()}
          />
        )}
      </header>
      {dictVisible && dictWhere === 'floating' ? (
        <DictButton
          word={dict.word}
          placement="floating"
          onPointerDown={dict.onPointerDown}
          onPress={dict.onPress}
          onBlur={dict.onButtonBlur}
          onOffline={dictNotice.show}
          testId="dict-button"
        />
      ) : null}
      <DictOfflineNotice visible={dictNotice.visible} placement={dictWhere} />
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
      {search ? (
        <button
          type="button"
          className="landscape-search-trigger"
          aria-label={BOOK_SEARCH_OPEN_ARIA}
          onClick={search.openSearch}
          data-testid="search-open-landscape"
        >
          <SearchIcon size={20} />
          <span>{BOOK_SEARCH_OPEN_ARIA}</span>
        </button>
      ) : null}
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
      <button
        type="button"
        className="landscape-focus-trigger"
        aria-label={FOCUS_MODE_LANDSCAPE_ENTER_ARIA}
        onPointerDown={handleFocusSwitchPointerDown}
        onClick={enterFocusMode}
        data-testid="toggle-focus-landscape"
      >
        <FocusIcon size={18} />
        <span className="floating-button-label">{FOCUS_MODE_LANDSCAPE_ENTER_ARIA}</span>
      </button>
      {!focusMode ? (
        <FormatMoreButton
          tools={formatTools}
          className="format-more-floating"
          testId="format-more-landscape"
          onPointerDown={captureMenuSelection}
        />
      ) : null}
      <FormatLayer tools={formatTools} extraMenuItems={extraMenuItems} />
      {!focusMode ? <FormatNotice tools={formatTools} /> : null}
      {!focusMode && (trashNotice || showSelectionNotice) ? (
        <div className="trash-corner-stack">
          {trashNotice ? (
            <TrashCornerNotice
              message={trashNotice.message}
              onOpen={() => {
                setTrashNotice(null);
                setTrashOpen(true);
              }}
              onDismiss={() => setTrashNotice(null)}
            />
          ) : null}
          {showSelectionNotice ? (
            <TrashSelectionNotice wordCount={selectionWordCount} />
          ) : null}
        </div>
      ) : null}
      <TrashSheet
        open={trashOpen && !focusMode}
        items={trashItems}
        trashRead={trashRead}
        nodes={project?.nodes ?? []}
        layoutMode={layoutMode}
        isComposing={() => isComposingRef.current}
        onClose={() => setTrashOpen(false)}
        onUpdateReason={(itemId, reason) => actions.updateTrashReason(projectId, itemId, reason)}
        onPutBack={handlePutBackFromTrash}
        onDiscard={(item) => actions.removeTrashItem(projectId, item.itemId, { immediate: true })}
        onUndoDiscard={(item) => actions.restoreDeletedTrashItem(projectId, item, { immediate: true })}
      />
      <textarea
        ref={ref}
        className={[
          'editor-input',
          searchHooks.marking ? 'is-search-marking' : '',
          cardEdit.editing ? 'is-card-editing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
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
        readOnly={cardEdit.editing}
        onPointerDown={() => {
          // 編輯卡片時點正文：先存卡片、結束編輯，再落在剛點的位置
          if (cardEdit.editing) {
            caretSnapshotRef.current = null;
            flushCardEdit('body');
          }
        }}
        onFocus={() => {
          setFocused(true);
          saveWritePlaceNow(true);
        }}
        onScroll={() => saveWritePlaceNow()}
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
          // 失焦當下不改記住的鍵盤狀態（切頁也會失焦）；真正離開時以按下當下為準
          saveWritePlaceNow(typingAtPointerRef.current);
        }}
      />
      <HalfWidthBubble controller={halfWidth} />
      <footer className="editor-status" data-testid="status-bar">
        <DailyProgressBar words={todayWords} goal={goal} met={isGlowing} compact={keyboardOpen} />
        <div className="status-row">
          <span className="status-cluster">
            <span data-testid="chapter-word-count">
              本章字數：
              {countWords(chapter.content ?? '')}
            </span>
            {chapter.progress && <StatusBadge code={chapter.progress} />}
          </span>
          {showFooterSaveStatus
            ? (saveStatus.openFiles ? (
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
              ))
            : null}
        </div>
        <div className="chapter-jump" data-testid="chapter-jump">
          <button type="button" data-testid="chapter-prev" disabled={!prevId} onClick={() => go(prevId)}>
            {TREE_PREV_CHAPTER}
          </button>
          <button type="button" data-testid="chapter-next" disabled={!nextId} onClick={() => go(nextId)}>
            {TREE_NEXT_CHAPTER}
          </button>
        </div>
        {showHalfWidthStrip && (
          <HalfWidthStrip controller={halfWidth} preferShort={bodyFontScale >= 175} />
        )}
        {search?.thumb ? <SearchThumbNav search={search} /> : null}
        <div className="thumb-bar" data-testid="thumb-bar" hidden={Boolean(search?.thumb)}>
          <button
            type="button"
            className="thumb-button thumb-tree-button"
            aria-label={
              layoutMode === 'phone-portrait' ? BACK_TO_CHAPTER_TREE_ARIA : OPEN_CHAPTER_TREE_ARIA
            }
            onClick={() =>
              layoutMode === 'phone-portrait'
                ? navigate(`/p/${projectId}/write`)
                : togglePanel('left')
            }
            data-testid="thumb-tree-button"
          >
            <ListTreeIcon size={18} />
            <span>{TREE_DRAWER_BUTTON}</span>
          </button>
          <button
            type="button"
            className="thumb-button thumb-cards-button"
            aria-label={VIEW_CARDS_BUTTON}
            onPointerDown={handleButtonPointerDown}
            onClick={toggleCards}
            data-testid="thumb-cards-button"
          >
            <CardsIcon size={18} />
            <span>{VIEW_CARDS_BUTTON}</span>
          </button>
          <button
            type="button"
            className="thumb-button thumb-focus-button"
            aria-label={FOCUS_MODE_THUMB_ENTER_LABEL}
            onPointerDown={handleFocusSwitchPointerDown}
        onClick={enterFocusMode}
            data-testid="thumb-focus-button"
          >
            <FocusIcon size={18} />
            <span>{FOCUS_MODE_THUMB_ENTER_LABEL}</span>
          </button>
        </div>
      </footer>
      {/* WO-117：恆產生；一般模式 display:none（移出無障礙樹），專注與橫拿打字才顯示，由 CSS 決定 */}
      <div className="focus-bottom-status" data-testid="focus-bottom-status">
        <span>{todayWordsLabel(todayWords, goal)}</span>
        <span className="focus-status-sep">·</span>
        <span>{focusBottomSaveText}</span>
      </div>
      {isCardsOpen && !focusMode && layoutMode !== 'wide' && (
        <WritingCardsDrawer
          key={projectId}
          projectId={projectId}
          resumeEditing={!panelOpenAtEntry.current}
          onClose={closeCards}
          onSaved={(message) => {
            // 手機直拿完成後面板會收起，提示改由全頁提示顯示
            if (layoutMode === 'phone-portrait') actions.toast(message);
          }}
          onOpenInDataset={() => {
            flushCardEdit('close');
            navigate(`/p/${projectId}/cards`);
          }}
        />
      )}
    </div>
  );
}
