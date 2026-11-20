import { timelineJumpToChapter } from '../copy/userFacing';
import type { FileCard } from '../db/projectFile';
import { CATEGORY_TIMELINE } from './cardCategories';
import { buildFileCardTree } from './cardOps';

/** 事件卡在時間線領域層讀取的三個可選欄位（對應 FileCard 與 DemoCard 正式欄位）。 */
export type TimelineCardFields = Pick<FileCard, 'storyTime' | 'timelineOrder' | 'chapterId'>;

/** 時間線純函式接受的卡片基本形狀（相容 FileCard、DemoCard 與含時間線欄位的物件）。 */
export type TimelineCardInput = Pick<
  FileCard,
  | 'id'
  | 'parent_id'
  | 'category'
  | 'title'
  | 'content'
  | 'color'
  | 'is_collapsed'
  | 'sort_order'
  | 'storyTime'
  | 'timelineOrder'
  | 'chapterId'
>;

/** 目錄樹節點輸入形狀（同時相容手機版 folder/file/scene 與電腦版 volume/chapter）。 */
export interface TimelineChapterNodeInput {
  id: string;
  type: string;
  title: string;
  expanded?: boolean;
  children?: readonly TimelineChapterNodeInput[];
}

export interface SplitChapterTitleResult {
  lead: string;
  sub: string;
}

export interface TimelineChapterItem {
  id: string;
  title: string;
  lead: string;
  sub: string;
  volumeTitle: string | null;
  volumeLead: string | null;
  /** 分段標頭粗體前綴：無卷時為 lead，有卷時為「第一卷・第三章」。 */
  headerLead: string;
  /** 分段標頭副標：即 sub。 */
  headerSub: string;
  /** 卡片內章節膠囊文字：無卷時為 lead，有卷時為「第一卷・第三章」。 */
  chipLabel: string;
  /** 事件卡「出現在哪一章」選擇器選項文字：無卷時為 title，有卷時為「第一卷・第三章　十年前的火」。 */
  pickerLabel: string;
  /** 事件卡跳章按鈕文字：無卷時為「跳到第三章」，有卷時為「跳到第一卷・第三章」。 */
  jumpLabel: string;
}

export interface TimelineEventItem<T extends TimelineCardInput = TimelineCardInput> {
  card: T;
  id: string;
  title: string;
  storyTime: string;
  color: string;
  /** 1-based 故事順序位置（1..M）。 */
  storyPosition: number;
  /** 1-based 讀者順序位置（1..K）；未連章或章不存在時為 null。 */
  readingPosition: number | null;
  /** 有效連到的章；未連章或章不存在時為 null。 */
  chapter: TimelineChapterItem | null;
  isFlashback: boolean;
  isUnassigned: boolean;
}

export interface TimelineChapterSection<T extends TimelineCardInput = TimelineCardInput> {
  chapter: TimelineChapterItem;
  events: TimelineEventItem<T>[];
}

export type TimelineDualBottomGroup<T extends TimelineCardInput = TimelineCardInput> =
  | {
      kind: 'chapter';
      chapter: TimelineChapterItem;
      events: TimelineEventItem<T>[];
      span: number;
    }
  | {
      kind: 'unassigned';
      chapter: null;
      events: TimelineEventItem<T>[];
      span: number;
    };

export interface TimelineModel<T extends TimelineCardInput = TimelineCardInput> {
  /** 依故事順序排列的所有頂層時間軸事件（長度 M）。 */
  storyEvents: TimelineEventItem<T>[];
  /** 依讀者（章節）順序排列的已連章事件（長度 K）。 */
  readingEvents: TimelineEventItem<T>[];
  /** 尚未寫進任何有效章的事件（依故事順序排列）。 */
  unassignedEvents: TimelineEventItem<T>[];
  /** 章節順序分段（僅含至少有 1 件事件的章，依目錄順序）。 */
  chapterSections: TimelineChapterSection<T>[];
  /** 雙軸對照下排事件列（先已連章 readingEvents，再接未連章 unassignedEvents）。 */
  dualBottomEvents: TimelineEventItem<T>[];
  /** 雙軸對照下排跨欄章標頭群組。 */
  dualBottomGroups: TimelineDualBottomGroup<T>[];
  /** 倒敘事件 id 集合。 */
  flashbackIds: Set<string>;
  /** 目錄所有可選章清單（含尚無事件的章）。 */
  chapters: TimelineChapterItem[];
  /** 章 id 查找表。 */
  chapterMap: Map<string, TimelineChapterItem>;
}

export interface TimelineDropTarget {
  id: string;
  after: boolean;
}

export interface DualAxisRect {
  left: number;
  top: number;
  width: number;
  bottom: number;
}

export interface DualAxisLinePair {
  id: string;
  topBox: DualAxisRect;
  bottomBox: DualAxisRect;
  isFlashback: boolean;
  isUnassigned: boolean;
}

export type DualAxisLineKind = 'normal' | 'flashback' | 'unassigned';

export interface DualAxisLine {
  id: string;
  kind: DualAxisLineKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 三次貝茲曲線 SVG path d 屬性。 */
  pathD: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string | undefined;
  opacity: number;
  isSelected: boolean;
}

function hasValidTimelineOrder(card: TimelineCardInput): boolean {
  return typeof card.timelineOrder === 'number' && Number.isFinite(card.timelineOrder);
}

function isVolumeNodeType(type: string): boolean {
  return type === 'folder' || type === 'volume';
}

function isChapterNodeType(type: string): boolean {
  return type === 'file' || type === 'chapter';
}

/**
 * 篩選「時間軸」分類的最上層卡片：
 * 沿用 buildFileCardTree 規則排除子卡片與其他分類，並對孤兒卡、循環參照安全提升為頂層。
 */
export function selectTopLevelTimelineCards<T extends TimelineCardInput>(cards: readonly T[]): T[] {
  return buildFileCardTree(cards, CATEGORY_TIMELINE).map((node) => node.card as T);
}

/** 比較兩張頂層時間軸卡的故事順序（不看故事時間文字）。 */
export function compareTimelineStoryCards(a: TimelineCardInput, b: TimelineCardInput): number {
  const hasA = hasValidTimelineOrder(a);
  const hasB = hasValidTimelineOrder(b);
  if (hasA !== hasB) return hasA ? -1 : 1;
  if (hasA && hasB && a.timelineOrder !== b.timelineOrder) {
    return a.timelineOrder! - b.timelineOrder!;
  }
  if (a.sort_order !== b.sort_order) {
    return a.sort_order - b.sort_order;
  }
  return a.id.localeCompare(b.id);
}

/** 篩選頂層時間軸卡並依故事順序排序（已排者依 timelineOrder，新卡／未排者放最後依 sort_order）。 */
export function sortTimelineStoryCards<T extends TimelineCardInput>(cards: readonly T[]): T[] {
  return selectTopLevelTimelineCards(cards).sort(compareTimelineStoryCards);
}

/**
 * 計算「+ 新增事件」應寫入的 timelineOrder：
 * 若已有事件具備 timelineOrder，回傳 max + 1；否則維持 null（落在最後且不主動寫附加表）。
 */
export function nextTimelineOrderForNewEvent(cards: readonly TimelineCardInput[]): number | null {
  const topCards = selectTopLevelTimelineCards(cards);
  let maxOrder: number | null = null;
  for (const card of topCards) {
    if (hasValidTimelineOrder(card)) {
      maxOrder = maxOrder === null ? card.timelineOrder! : Math.max(maxOrder, card.timelineOrder!);
    }
  }
  return maxOrder === null ? null : maxOrder + 1;
}

/**
 * 依指定頂層事件 id 順序重算所有頂層時間軸卡的 timelineOrder（0..M-1）：
 * 未被改變與非時間軸頂層卡一律保留原物件參照不動。
 */
export function reorderTimelineByOrderedIds<T extends TimelineCardInput>(
  cards: readonly T[],
  orderedTopIds: readonly string[],
): T[] {
  const currentTop = sortTimelineStoryCards(cards);
  if (currentTop.length === 0) return [...cards];

  const topMap = new Map<string, T>(currentTop.map((card) => [card.id, card]));
  const seen = new Set<string>();
  const finalOrderIds: string[] = [];

  for (const id of orderedTopIds) {
    if (topMap.has(id) && !seen.has(id)) {
      seen.add(id);
      finalOrderIds.push(id);
    }
  }
  for (const card of currentTop) {
    if (!seen.has(card.id)) {
      seen.add(card.id);
      finalOrderIds.push(card.id);
    }
  }

  const orderById = new Map<string, number>();
  finalOrderIds.forEach((id, index) => {
    orderById.set(id, index);
  });

  let changed = false;
  const nextCards = cards.map((card) => {
    const nextOrder = orderById.get(card.id);
    if (nextOrder === undefined || card.timelineOrder === nextOrder) {
      return card;
    }
    changed = true;
    return {
      ...card,
      timelineOrder: nextOrder,
    };
  });

  return changed ? nextCards : [...cards];
}

/** 將指定頂層時間軸事件移到故事順序的目標索引（0..M-1），並重算全部頂層時間軸卡的 timelineOrder。 */
export function moveTimelineCardToIndex<T extends TimelineCardInput>(
  cards: readonly T[],
  cardId: string,
  targetIndex: number,
): T[] {
  const sorted = sortTimelineStoryCards(cards);
  const fromIndex = sorted.findIndex((card) => card.id === cardId);
  if (fromIndex < 0) return [...cards];

  const clampedTarget = Math.max(0, Math.min(sorted.length - 1, Math.trunc(targetIndex)));
  if (fromIndex === clampedTarget) return [...cards];

  const ids = sorted.map((card) => card.id);
  const [movedId] = ids.splice(fromIndex, 1);
  ids.splice(clampedTarget, 0, movedId!);

  return reorderTimelineByOrderedIds(cards, ids);
}

/** 上移（delta = -1）或下移（delta = 1）指定頂層時間軸事件，並重算全部頂層時間軸卡的 timelineOrder。 */
export function moveTimelineCardByDelta<T extends TimelineCardInput>(
  cards: readonly T[],
  cardId: string,
  delta: -1 | 1,
): T[] {
  const sorted = sortTimelineStoryCards(cards);
  const fromIndex = sorted.findIndex((card) => card.id === cardId);
  if (fromIndex < 0) return [...cards];

  const targetIndex = fromIndex + delta;
  if (targetIndex < 0 || targetIndex >= sorted.length) return [...cards];

  return moveTimelineCardToIndex(cards, cardId, targetIndex);
}

/** 依 dragSession 的拖曳落點（目標卡片前／後）搬移頂層時間軸事件並重算 0..M-1；若順序未變則不寫入 timelineOrder。 */
export function moveTimelineCardByDrop<T extends TimelineCardInput>(
  cards: readonly T[],
  dragId: string,
  drop: TimelineDropTarget,
): T[] {
  if (dragId === drop.id) return [...cards];
  const sorted = sortTimelineStoryCards(cards);
  const ids = sorted.map((card) => card.id);
  if (!ids.includes(dragId) || !ids.includes(drop.id)) return [...cards];

  const remaining = ids.filter((id) => id !== dragId);
  const targetPos = remaining.indexOf(drop.id);
  const insertPos = drop.after ? targetPos + 1 : targetPos;
  remaining.splice(insertPos, 0, dragId);

  if (remaining.length === ids.length && remaining.every((id, index) => id === ids[index])) {
    return [...cards];
  }

  return reorderTimelineByOrderedIds(cards, remaining);
}

/** 以第一個全形空白（U+3000）或半形空白切分章名／卷名為前綴與副標。 */
export function splitChapterTitle(title: string): SplitChapterTitleResult {
  const trimmed = title.trim();
  if (!trimmed) return { lead: '', sub: '' };

  const sepIdx = trimmed.search(/[\u3000 ]/);
  if (sepIdx < 0) {
    return { lead: trimmed, sub: '' };
  }

  return {
    lead: trimmed.slice(0, sepIdx),
    sub: trimmed.slice(sepIdx + 1).trimStart(),
  };
}

/** 深度優先走訪目錄樹（含收合的卷），收集所有現存「章」節點 id（相容 file 與 chapter）。 */
export function collectAliveChapterIds(nodes: readonly TimelineChapterNodeInput[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly TimelineChapterNodeInput[]) => {
    for (const node of list) {
      if (isChapterNodeType(node.type)) {
        ids.add(node.id);
        continue;
      }
      if (isVolumeNodeType(node.type) && node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

function formatChapterLabels(
  title: string,
  volumeTitle: string | null,
): Omit<TimelineChapterItem, 'id' | 'title' | 'volumeTitle'> {
  const { lead, sub } = splitChapterTitle(title);
  const trimmedVolume = volumeTitle?.trim() ?? '';
  const volumeLead =
    volumeTitle != null && trimmedVolume !== ''
      ? splitChapterTitle(trimmedVolume).lead || trimmedVolume
      : null;

  const shortLead =
    volumeLead && lead ? `${volumeLead}・${lead}` : volumeLead ? volumeLead : lead;
  const pickerLabel =
    volumeLead && title ? `${volumeLead}・${title}` : title || volumeLead || '';
  const jumpTarget = shortLead || pickerLabel;

  return {
    lead,
    sub,
    volumeLead,
    headerLead: shortLead,
    headerSub: sub,
    chipLabel: shortLead,
    pickerLabel,
    jumpLabel: timelineJumpToChapter(jumpTarget),
  };
}

/**
 * 由目錄樹依深度優先順序擷取所有「章」清單（含收合的卷，略過幕；相容 folder/volume 與 file/chapter）。
 */
export function extractTimelineChapters(
  nodes: readonly TimelineChapterNodeInput[],
): TimelineChapterItem[] {
  const chapters: TimelineChapterItem[] = [];

  const walk = (list: readonly TimelineChapterNodeInput[], volumeTitle: string | null) => {
    for (const node of list) {
      if (isVolumeNodeType(node.type)) {
        if (node.children?.length) {
          walk(node.children, node.title);
        }
        continue;
      }
      if (isChapterNodeType(node.type)) {
        chapters.push({
          id: node.id,
          title: node.title,
          volumeTitle,
          ...formatChapterLabels(node.title, volumeTitle),
        });
      }
      // 幕（scene）與其他未知節點在第一版不連章，略過。
    }
  };

  walk(nodes, null);
  return chapters;
}

/** 建立章 id -> 格式化章資訊的即時查詢表（章改名或移卷時自動跟著更新）。 */
export function buildChapterIndex(
  nodes: readonly TimelineChapterNodeInput[],
): Map<string, TimelineChapterItem> {
  const map = new Map<string, TimelineChapterItem>();
  for (const chapter of extractTimelineChapters(nodes)) {
    map.set(chapter.id, chapter);
  }
  return map;
}

/**
 * 依讀者（章節）順序線性掃描計算倒敘事件 id 集合：
 * 若讀到某事件時，讀者已讀過故事順序（storyPosition）大於它的事件，即判定為倒敘。
 */
export function computeFlashbackIds(
  readingOrderEvents: readonly { id: string; storyPosition: number }[],
): Set<string> {
  let maxStorySoFar = 0;
  const flashbacks = new Set<string>();

  for (const event of readingOrderEvents) {
    if (event.storyPosition < maxStorySoFar) {
      flashbacks.add(event.id);
    }
    if (event.storyPosition > maxStorySoFar) {
      maxStorySoFar = event.storyPosition;
    }
  }

  return flashbacks;
}

/** 建立時間線三種檢視（故事順序、章節順序、雙軸對照）共用的完整資料模型。 */
export function buildTimelineModel<T extends TimelineCardInput>(
  cards: readonly T[],
  nodes: readonly TimelineChapterNodeInput[],
): TimelineModel<T> {
  const chapters = extractTimelineChapters(nodes);
  const chapterMap = new Map<string, TimelineChapterItem>(chapters.map((ch) => [ch.id, ch]));
  const sortedStoryCards = sortTimelineStoryCards(cards);

  const storyEvents: TimelineEventItem<T>[] = sortedStoryCards.map((card, index) => {
    const chapter =
      card.chapterId != null && chapterMap.has(card.chapterId)
        ? chapterMap.get(card.chapterId)!
        : null;
    return {
      card,
      id: card.id,
      title: card.title,
      storyTime: typeof card.storyTime === 'string' ? card.storyTime : '',
      color: card.color,
      storyPosition: index + 1,
      readingPosition: null,
      chapter,
      isFlashback: false,
      isUnassigned: chapter === null,
    };
  });

  const eventsByChapterId = new Map<string, TimelineEventItem<T>[]>();
  const unassignedEvents: TimelineEventItem<T>[] = [];

  for (const item of storyEvents) {
    if (item.chapter) {
      const bucket = eventsByChapterId.get(item.chapter.id) ?? [];
      bucket.push(item);
      eventsByChapterId.set(item.chapter.id, bucket);
    } else {
      unassignedEvents.push(item);
    }
  }

  const chapterSections: TimelineChapterSection<T>[] = [];
  const readingEvents: TimelineEventItem<T>[] = [];

  for (const chapter of chapters) {
    const events = eventsByChapterId.get(chapter.id);
    if (!events || events.length === 0) continue;
    chapterSections.push({ chapter, events });
    for (const event of events) {
      event.readingPosition = readingEvents.length + 1;
      readingEvents.push(event);
    }
  }

  const flashbackIds = computeFlashbackIds(readingEvents);
  for (const event of readingEvents) {
    event.isFlashback = flashbackIds.has(event.id);
  }

  const dualBottomEvents: TimelineEventItem<T>[] = [...readingEvents, ...unassignedEvents];
  const dualBottomGroups: TimelineDualBottomGroup<T>[] = chapterSections.map((section) => ({
    kind: 'chapter',
    chapter: section.chapter,
    events: section.events,
    span: section.events.length,
  }));

  if (unassignedEvents.length > 0) {
    dualBottomGroups.push({
      kind: 'unassigned',
      chapter: null,
      events: unassignedEvents,
      span: unassignedEvents.length,
    });
  }

  return {
    storyEvents,
    readingEvents,
    unassignedEvents,
    chapterSections,
    dualBottomEvents,
    dualBottomGroups,
    flashbackIds,
    chapters,
    chapterMap,
  };
}

/**
 * 計算雙軸對照 SVG 貝茲連線幾何、線色、線型與置頂排序：
 * - 起點：上排卡片底邊水平中點
 * - 終點：下排卡片水平中點、縱座標停在「讀者讀到的順序」標題上方 8px
 * - 選中事件線條加粗為 3.5 且排在最後置頂，未選中線降至 0.4 不透明度
 */
export function computeDualAxisLines(
  stageBox: Pick<DualAxisRect, 'left' | 'top'>,
  bottomLabelTop: number,
  pairs: readonly DualAxisLinePair[],
  selectedId: string | null = null,
): DualAxisLine[] {
  const hasSelection = selectedId !== null && pairs.some((pair) => pair.id === selectedId);
  const y2 = bottomLabelTop - stageBox.top - 8;

  const lines = pairs.map((pair): DualAxisLine => {
    const x1 = pair.topBox.left + pair.topBox.width / 2 - stageBox.left;
    const y1 = pair.topBox.bottom - stageBox.top;
    const x2 = pair.bottomBox.left + pair.bottomBox.width / 2 - stageBox.left;
    const my = (y1 + y2) / 2;
    const pathD = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;

    let kind: DualAxisLineKind = 'normal';
    let stroke = 'color-mix(in srgb, var(--accent) 60%, transparent)';
    let strokeDasharray: string | undefined;

    if (pair.isUnassigned) {
      kind = 'unassigned';
      stroke = 'var(--muted)';
      strokeDasharray = '6 6';
    } else if (pair.isFlashback) {
      kind = 'flashback';
      stroke = 'var(--flashback)';
    }

    const isSelected = hasSelection && pair.id === selectedId;
    return {
      id: pair.id,
      kind,
      x1,
      y1,
      x2,
      y2,
      pathD,
      stroke,
      strokeWidth: isSelected ? 3.5 : 2.2,
      strokeDasharray,
      opacity: hasSelection ? (isSelected ? 1 : 0.4) : 1,
      isSelected,
    };
  });

  if (!hasSelection) return lines;
  return [...lines.filter((line) => !line.isSelected), ...lines.filter((line) => line.isSelected)];
}
