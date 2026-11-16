import { useEffect, useRef, useState, type UIEvent } from 'react';
import {
  patchCardsPlace,
  readCardsPlace,
  selectionPatch,
  type CardsPlace,
} from './navMemory';

/** 三種可捲動區：分類清單、卡片清單、卡片內容（預覽）。 */
export type CardsPaneRole = 'category' | 'list' | 'preview';

const SCROLL_FIELD: Record<CardsPaneRole, 'categoryScroll' | 'listScroll' | 'previewScroll'> = {
  category: 'categoryScroll',
  list: 'listScroll',
  preview: 'previewScroll',
};

/** 卡片內容在部分版面由 CardEditor 內層的內容區捲動 */
const INNER_SCROLLER = 'card-editor-body';

/** 實際在捲的那一層：外層能捲就用外層，否則用卡片內容的內層。 */
function scrollerOf(el: HTMLElement, role: CardsPaneRole): HTMLElement {
  if (role !== 'preview' || el.scrollHeight > el.clientHeight + 1) return el;
  const inner = el.querySelector<HTMLElement>(`.${INNER_SCROLLER}`);
  return inner && inner.scrollHeight > inner.clientHeight + 1 ? inner : el;
}

/**
 * 某個捲動區（新建立的那一個元素）該放回的位置；不放回回傳 null。
 * 以「目前記憶」為準，所以清單、卡片內容重建（例如開卡片再按「返回」）時每次都放回。
 * 只在記憶裡的分類／卡片就是目前這個時放回：換分類從清單頂端、換卡片從內容頂端開始。
 */
export function scrollToRestoreOnMount(
  role: CardsPaneRole,
  stored: CardsPlace | null,
  selection: { categoryId: string | null; cardId: string | null },
): number | null {
  if (!stored) return null;
  if (role === 'list' && stored.categoryId !== selection.categoryId) return null;
  if (role === 'preview' && stored.cardId !== selection.cardId) return null;
  const top = stored[SCROLL_FIELD[role]];
  return top > 0 ? top : null;
}

/**
 * WO-65：資料集與看卡片共用的位置記憶（同一份 navMemory）。
 * - 掛載時先讀記憶（由呼叫端拿來當初始值），之後選取、展開有變就寫回。
 * - 各捲動區每次「新建立」時依目前記憶放回位置（同一個元素重畫不重放），捲動時隨時記下。
 */
export function useCardsPlaceMemory(
  projectId: string,
  selection: { categoryId: string | null; cardId: string | null; collapsedIds: ReadonlySet<string> },
  enabled = true,
) {
  const [initial] = useState<CardsPlace | null>(() => readCardsPlace(projectId));
  /** 各捲動區上次放回過的元素；同一個元素只放一次，新建立的元素再放一次 */
  const placed = useRef<Partial<Record<CardsPaneRole, HTMLElement>>>({});
  const current = useRef(selection);
  current.current = selection;

  const { categoryId, cardId, collapsedIds } = selection;
  useEffect(() => {
    if (!enabled || !projectId) return;
    const previous = readCardsPlace(projectId);
    patchCardsPlace(projectId, {
      ...selectionPatch(previous, categoryId, cardId),
      collapsedIds: [...collapsedIds],
    });
  }, [enabled, projectId, categoryId, cardId, collapsedIds]);

  const bind = (role: CardsPaneRole) => ({
    'data-nav-pane': role,
    ref: (el: HTMLElement | null) => {
      if (!el || !enabled) return;
      if (placed.current[role] === el) return;
      placed.current[role] = el;
      if (!projectId) return;
      // 記憶的選取由 effect 寫回，比 ref 晚；這裡比對的是「記憶裡的」分類／卡片與目前畫面上的
      const top = scrollToRestoreOnMount(role, readCardsPlace(projectId), current.current);
      if (top !== null) scrollerOf(el, role).scrollTop = top;
    },
    // 捲動事件不會往上傳，用捕捉階段收：卡片內容在某些版面是內層的內容區在捲
    onScrollCapture: (event: UIEvent<HTMLElement>) => {
      if (!enabled || !projectId) return;
      const target = event.target as HTMLElement;
      if (target !== event.currentTarget && !(role === 'preview' && target.classList?.contains(INNER_SCROLLER))) return;
      patchCardsPlace(projectId, { [SCROLL_FIELD[role]]: Math.round(target.scrollTop) });
    },
  });

  return { initial, bind };
}
