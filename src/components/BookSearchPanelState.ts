/**
 * WO-63 全書搜尋的狀態與動作。放在寫作頁（WriteScreen）裡，換章時不會不見；
 * 離開寫作頁（換分頁）或離開搜尋時一起清掉，復原紀錄也一起清掉。
 *
 * 正文寫回一律走既有路徑：打開中的那一章經正文框整段換字後由 useWritingSurface 送 commit-text；
 * 其他章直接送 commit-text。字數與寫作紀錄照既有算法更新。不碰卡片、不改存檔流程。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { findNode, updateNode, type ChapterNode, type DemoProject } from '../data/demo';
import type { SearchHit } from '../domain/bookSearch';
import { useLayout } from '../layout';
import { getProjectCards, useSample } from '../state/sampleStore';
import {
  chapterCount,
  exampleCardTitle,
  groupHits,
  indexOfRef,
  marksFromRecord,
  nextAfterReplace,
  nodeOrder,
  planReplaceAll,
  planReplaceOne,
  planUndo,
  refOf,
  searchBody,
  shiftMarks,
  withLiveText,
  type BodyCommit,
  type HitGroup,
  type HitRef,
  type ReplacedMark,
  type ReplaceRecord,
  type SearchScope,
} from './BookSearchPanelModel';

/** 打開中那一章的正文框，給搜尋用。由 EditorPane 掛上。 */
export interface EditorBridge {
  chapterId: string;
  isComposing(): boolean;
  readText(): string;
  /** 整段換掉這一章正文並寫回（組字中回傳 false，不換）。 */
  replaceBody(next: string): boolean;
  /** 組字中：不 blur、不動焦點，請瀏覽器把未選的組字照現狀送出。 */
  commitComposition(): void;
  /** 組字送出後才做；逾時就取消。 */
  afterComposition(run: () => void, cancel: () => void): void;
}

export type SearchSide = 'page' | 'right' | 'left';

export interface DoneNotice {
  kind: 'replaced' | 'undone';
  total: number;
  chapters: number;
  token: number;
}

export interface ThumbNav {
  index: number;
  total: number;
  chapterTitle: string;
  canPrev: boolean;
  canNext: boolean;
}

export interface BookSearchController {
  side: SearchSide;
  open: boolean;
  view: 'results' | 'editor';
  input: string;
  query: string;
  replacement: string;
  scope: SearchScope;
  hasChapter: boolean;
  replaceOpen: boolean;
  hits: SearchHit[];
  groups: HitGroup[];
  chapters: number;
  current: HitRef | null;
  currentIndex: number;
  focusToken: number;
  record: ReplaceRecord | null;
  marks: ReplacedMark[];
  done: DoneNotice | null;
  confirmOpen: boolean;
  confirmExample: string | null;
  thumb: ThumbNav | null;
  listScroll: MutableRefObject<number>;
  bridgeRef: MutableRefObject<EditorBridge | null>;
  openSearch: () => void;
  closeSearch: () => void;
  setInput: (value: string, composing: boolean) => void;
  commitInput: (value: string) => void;
  setReplacement: (value: string) => void;
  setScope: (scope: SearchScope) => void;
  toggleReplace: () => void;
  jumpTo: (ref: HitRef) => void;
  step: (delta: -1 | 1) => void;
  backToResults: () => void;
  replaceOneAt: (ref: HitRef) => void;
  requestReplaceAll: () => void;
  cancelReplaceAll: () => void;
  confirmReplaceAll: () => void;
  undo: () => void;
  /** 跳正文的按鈕按下時呼叫：正文正在組字，就先等組字送出再跳。 */
  guardDown: (event: { preventDefault(): void }, run: () => void) => void;
  guardClick: (run: () => void) => void;
}

function sideOf(mode: string): SearchSide {
  if (mode === 'phone-portrait') return 'page';
  if (mode === 'wide') return 'left';
  return 'right';
}

function applyToNodes(nodes: ChapterNode[], commits: readonly BodyCommit[]): ChapterNode[] {
  let next = nodes;
  for (const commit of commits) next = updateNode(next, commit.nodeId, (item) => ({ ...item, content: commit.text }));
  return next;
}

export function useBookSearch(project: DemoProject | null, chapterId: string | undefined): BookSearchController {
  const navigate = useNavigate();
  const { actions, state } = useSample();
  const { mode, sidePanels, openPanel, closePanel, focusMode } = useLayout();
  const side = sideOf(mode);
  const bridgeRef = useRef<EditorBridge | null>(null);
  const listScroll = useRef(0);
  const seq = useRef(0);
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'results' | 'editor'>('results');
  const [input, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScopeValue] = useState<SearchScope>('book');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [current, setCurrent] = useState<HitRef | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [record, setRecord] = useState<ReplaceRecord | null>(null);
  const [marks, setMarks] = useState<ReplacedMark[]>([]);
  const [done, setDone] = useState<DoneNotice | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const nodes = project?.nodes ?? [];
  const projectId = project?.id ?? '';
  const hits = useMemo(
    () => (open ? searchBody(nodes, query, scope, chapterId) : []),
    [open, nodes, query, scope, chapterId],
  );
  const groups = useMemo(() => groupHits(hits), [hits]);
  const chapters = useMemo(() => chapterCount(hits), [hits]);
  const currentIndex = indexOfRef(hits, current);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setView('results');
    setInputValue('');
    setQuery('');
    setReplacement('');
    setScopeValue('book');
    setReplaceOpen(false);
    setCurrent(null);
    setRecord(null);
    setMarks([]);
    setDone(null);
    setConfirmOpen(false);
    listScroll.current = 0;
    pending.current = false;
  }, []);

  // 離開搜尋的情況：開了看卡片或目錄（右側面板版面）、寬版收起左欄、進專注模式、直拿回到目錄頁。
  useEffect(() => {
    if (!open) return;
    if (focusMode) closeSearch();
    else if (side === 'right' && (sidePanels.left || sidePanels.right)) closeSearch();
    else if (side === 'left' && !sidePanels.left) closeSearch();
    else if (side === 'page' && view === 'editor' && !chapterId) closeSearch();
  }, [open, focusMode, side, sidePanels.left, sidePanels.right, view, chapterId, closeSearch]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(null), 10000);
    return () => window.clearTimeout(timer);
  }, [done]);

  const openSearch = () => {
    if (side === 'right') {
      if (sidePanels.left) closePanel('left');
      if (sidePanels.right) closePanel('right');
    } else if (side === 'left' && !sidePanels.left) {
      openPanel('left');
    }
    setOpen(true);
    setView('results');
  };

  const liveNodes = (): ChapterNode[] => {
    const bridge = bridgeRef.current;
    if (!bridge || !findNode(nodes, bridge.chapterId)) return nodes;
    return withLiveText(nodes, { chapterId: bridge.chapterId, text: bridge.readText() });
  };

  /** 寫回正文：打開中的那一章先換（組字中就整批不做），其他章走 commit-text。 */
  const applyCommits = (commits: readonly BodyCommit[]): boolean => {
    const bridge = bridgeRef.current;
    const own = bridge ? commits.find((commit) => commit.nodeId === bridge.chapterId) : undefined;
    if (bridge && own) {
      if (bridge.isComposing()) return false;
      if (!bridge.replaceBody(own.text)) return false;
    }
    for (const commit of commits) {
      if (commit === own) continue;
      actions.commitText(projectId, commit.nodeId, commit.text);
    }
    return true;
  };

  const resetForQuery = () => {
    setCurrent(null);
    setMarks([]);
  };

  const setInput = (value: string, composing: boolean) => {
    setInputValue(value);
    if (!composing && value !== query) {
      setQuery(value);
      resetForQuery();
    }
  };

  const commitInput = (value: string) => {
    setInputValue(value);
    if (value !== query) {
      setQuery(value);
      resetForQuery();
    }
  };

  const setScope = (next: SearchScope) => {
    if (next === scope) return;
    setScopeValue(next);
    resetForQuery();
  };

  const jumpTo = (ref: HitRef) => {
    setCurrent(ref);
    setFocusToken((value) => value + 1);
    if (side === 'page') setView('editor');
    if (ref.nodeId !== chapterId) navigate(`/p/${projectId}/write/${ref.nodeId}`);
  };

  const step = (delta: -1 | 1) => {
    const index = indexOfRef(hits, current);
    const next = index === -1 ? 0 : index + delta;
    const ref = refOf(hits, Math.max(0, Math.min(hits.length - 1, next)));
    if (ref) jumpTo(ref);
  };

  const replaceOneAt = (ref: HitRef) => {
    if (!query) return;
    const live = liveNodes();
    seq.current += 1;
    const plan = planReplaceOne(live, ref, query, replacement, seq.current);
    if (!plan || !applyCommits(plan.commits)) return;
    const spot = plan.record.entries[0]!.spots[0]!;
    const delta = replacement.length - spot.original.length;
    setMarks((prev) => [...shiftMarks(prev, ref.nodeId, spot.start, delta), ...marksFromRecord(plan.record)]);
    setRecord(plan.record);
    setDone(null);
    const after = applyToNodes(live, plan.commits);
    const hitsAfter = searchBody(after, query, scope, chapterId);
    setCurrent(nextAfterReplace(hitsAfter, nodeOrder(after), ref.nodeId, spot.start + spot.length));
  };

  const requestReplaceAll = () => {
    if (!query || hits.length === 0) return;
    setConfirmOpen(true);
  };

  const confirmReplaceAll = () => {
    setConfirmOpen(false);
    if (!query) return;
    seq.current += 1;
    const plan = planReplaceAll(liveNodes(), query, replacement, scope, chapterId, seq.current);
    if (!plan || !applyCommits(plan.commits)) return;
    setRecord(plan.record);
    setMarks(marksFromRecord(plan.record));
    setCurrent(null);
    setDone({ kind: 'replaced', total: plan.record.total, chapters: plan.record.chapters, token: plan.record.id });
  };

  const undo = () => {
    if (!record) return;
    const commits = planUndo(liveNodes(), record);
    if (!applyCommits(commits)) return;
    const id = record.id;
    setMarks((prev) => prev.filter((mark) => mark.recordId !== id));
    setRecord(null);
    setCurrent(null);
    setDone({ kind: 'undone', total: record.total, chapters: record.chapters, token: -id });
  };

  const guardDown = (event: { preventDefault(): void }, run: () => void) => {
    const bridge = bridgeRef.current;
    if (!bridge || !bridge.isComposing()) return;
    // 正文還在組字：不讓按鈕搶走焦點（不打斷組字）；先把組字送出，送出後立刻依最新正文跳過去，
    // 這一次按下就完成，之後同一次點擊的 click 不再重複跳。
    event.preventDefault();
    pending.current = true;
    window.setTimeout(() => {
      pending.current = false;
    }, 1000);
    bridge.afterComposition(run, () => {});
    bridge.commitComposition();
  };

  const guardClick = (run: () => void) => {
    if (pending.current) {
      pending.current = false;
      return;
    }
    run();
  };

  const currentHit = currentIndex >= 0 ? hits[currentIndex] : undefined;
  const thumb: ThumbNav | null =
    open && side === 'page' && view === 'editor' && currentHit
      ? {
          index: currentIndex + 1,
          total: hits.length,
          chapterTitle: currentHit.nodeTitle,
          canPrev: currentIndex > 0,
          canNext: currentIndex < hits.length - 1,
        }
      : null;

  const cards = project ? getProjectCards(state, project.id) : [];
  const confirmExample = confirmOpen ? exampleCardTitle(cards.length > 0 ? cards : (project?.cards ?? []), query) : null;

  return {
    side,
    open,
    view,
    input,
    query,
    replacement,
    scope,
    hasChapter: Boolean(chapterId),
    replaceOpen,
    hits,
    groups,
    chapters,
    current,
    currentIndex,
    focusToken,
    record,
    marks,
    done,
    confirmOpen,
    confirmExample,
    thumb,
    listScroll,
    bridgeRef,
    openSearch,
    closeSearch,
    setInput,
    commitInput,
    setReplacement,
    setScope,
    toggleReplace: () => setReplaceOpen((value) => !value),
    jumpTo,
    step,
    backToResults: () => setView('results'),
    replaceOneAt,
    requestReplaceAll,
    cancelReplaceAll: () => setConfirmOpen(false),
    confirmReplaceAll,
    undo,
    guardDown,
    guardClick,
  };
}
