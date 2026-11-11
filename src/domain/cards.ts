import type { CardCategory, DemoCard } from '../data/demoCards';

/**
 * 代碼待以電腦版範例檔確認
 * 手機版完全不顯示「AI 對話紀錄」分類（九方 11/10 定案乙）。
 */
export const HIDDEN_CATEGORY_IDS = new Set<string>([
  'ai_chat',
  'ai_dialogue',
  'ai_conversation',
  'ai_history',
  'ai_log',
  'ai_records',
  'AI對話紀錄',
  'AI 對話紀錄',
  'scene',
  '場景',
]);

/** 判斷分類是否屬於需隱藏的 AI 對話紀錄、場景等分類 */
export function isCategoryHidden(categoryIdOrName: string): boolean {
  if (!categoryIdOrName) return false;
  const raw = categoryIdOrName.trim();
  if (HIDDEN_CATEGORY_IDS.has(raw)) return true;
  const lower = raw.toLowerCase();
  if (HIDDEN_CATEGORY_IDS.has(lower)) return true;
  if (lower === 'ai_chat' || lower === 'ai對話紀錄' || lower === 'ai 對話紀錄') return true;
  if (lower === 'scene' || lower === '場景') return true;
  return false;
}

/** 過濾出手機版允許顯示的分類清單 */
export function filterVisibleCategories(categories: readonly CardCategory[]): CardCategory[] {
  return categories.filter((c) => !isCategoryHidden(c.id) && !isCategoryHidden(c.name));
}

/** 計算某一分類下的卡片總數（包含頂層與所有子卡片） */
export function countCardsInCategory(cards: readonly DemoCard[], categoryId: string): number {
  return cards.filter((c) => c.category === categoryId).length;
}

export interface CardTreeNode {
  card: DemoCard;
  children: CardTreeNode[];
  level: number;
}

/** 將某一分類的平坦卡片清單整理成樹狀結構（最多 3 層：level 0, 1, 2） */
export function buildCardTree(cards: readonly DemoCard[], categoryId: string): CardTreeNode[] {
  const categoryCards = cards
    .filter((c) => c.category === categoryId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));

  const cardMap = new Map<string, DemoCard>();
  for (const card of categoryCards) {
    cardMap.set(card.id, card);
  }

  // 偵測循環參照（如 A→B→A 或 A→A）
  // 循環中的節點打斷其父參照，直接提升為頂層卡片，避免無限遞迴
  const inCycleIds = new Set<string>();
  for (const startCard of categoryCards) {
    if (inCycleIds.has(startCard.id)) continue;
    const path: string[] = [];
    const visitedOnPath = new Set<string>();
    let curr: DemoCard | undefined = startCard;

    while (curr && curr.parent_id && cardMap.has(curr.parent_id)) {
      path.push(curr.id);
      visitedOnPath.add(curr.id);
      const nextId = curr.parent_id;

      if (visitedOnPath.has(nextId)) {
        const cycleStartIndex = path.indexOf(nextId);
        for (let i = cycleStartIndex; i < path.length; i++) {
          inCycleIds.add(path[i]);
        }
        break;
      }
      if (inCycleIds.has(nextId)) {
        break;
      }
      curr = cardMap.get(nextId);
    }
  }

  // 分組：parentId -> children
  const childrenMap = new Map<string, DemoCard[]>();
  const roots: DemoCard[] = [];

  for (const card of categoryCards) {
    const isCycleNode = inCycleIds.has(card.id);
    const hasValidParent = Boolean(card.parent_id && cardMap.has(card.parent_id));

    if (hasValidParent && !isCycleNode) {
      const list = childrenMap.get(card.parent_id!) ?? [];
      list.push(card);
      childrenMap.set(card.parent_id!, list);
    } else {
      roots.push(card);
    }
  }

  const assembledIds = new Set<string>();

  function assemble(card: DemoCard, level: number): CardTreeNode {
    assembledIds.add(card.id);
    const rawChildren = childrenMap.get(card.id) ?? [];
    // 最多 3 層（level 0, 1, 2）
    const nextLevel = Math.min(level + 1, 2);
    const children: CardTreeNode[] = [];

    for (const child of rawChildren) {
      if (!assembledIds.has(child.id)) {
        children.push(assemble(child, nextLevel));
      }
    }

    return {
      card,
      children,
      level,
    };
  }

  const result: CardTreeNode[] = [];
  for (const root of roots) {
    if (!assembledIds.has(root.id)) {
      result.push(assemble(root, 0));
    }
  }

  // 防禦性檢查：若有任何遺漏卡片，一律作為頂層卡片加入，確保不重複、不遺漏
  for (const card of categoryCards) {
    if (!assembledIds.has(card.id)) {
      result.push(assemble(card, 0));
    }
  }

  return result;
}

export interface VisibleCardRow {
  card: DemoCard;
  level: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

/** 依收合狀態將樹狀結構攤平為視覺清單列 */
export function flattenVisibleCards(
  nodes: readonly CardTreeNode[],
  collapsedIds: ReadonlySet<string>,
): VisibleCardRow[] {
  const rows: VisibleCardRow[] = [];

  function walk(node: CardTreeNode) {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && !collapsedIds.has(node.card.id);

    rows.push({
      card: node.card,
      level: node.level,
      hasChildren,
      isExpanded,
    });

    if (isExpanded) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return rows;
}

/* ================= 色彩與對比度處理 ================= */

/** 計算 sRGB 相對亮度 (Relative Luminance, WCAG 2.1) */
export function sRgbLuminance(r: number, g: number, b: number): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** 解析十六進位色碼，支援 #rrggbb 與 #rgb（大小寫皆可）；無效色碼回傳 null */
export function parseHexColor(hex?: string | null): [number, number, number] | null {
  if (!hex) return null;
  const trimmed = hex.trim();
  const m6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (m6) {
    return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)];
  }
  const m3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (m3) {
    return [
      parseInt(m3[1] + m3[1], 16),
      parseInt(m3[2] + m3[2], 16),
      parseInt(m3[3] + m3[3], 16),
    ];
  }
  return null;
}

function clampByte(val: number): number {
  return Math.max(0, Math.min(255, Math.round(val)));
}

function toHexColor(r: number, g: number, b: number): string {
  const h = (c: number) => clampByte(c).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 計算兩相對亮度之間的 WCAG 對比率 */
export function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rf:
        h = (gf - bf) / d + (gf < bf ? 6 : 0);
        break;
      case gf:
        h = (bf - rf) / d + 2;
        break;
      case bf:
        h = (rf - gf) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const val = clampByte(l * 255);
    return [val, val, val];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let normalizedT = t;
    if (normalizedT < 0) normalizedT += 1;
    if (normalizedT > 1) normalizedT -= 1;
    if (normalizedT < 1 / 6) return p + (q - p) * 6 * normalizedT;
    if (normalizedT < 1 / 2) return q;
    if (normalizedT < 2 / 3) return p + (q - p) * (2 / 3 - normalizedT) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = clampByte(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = clampByte(hue2rgb(p, q, h) * 255);
  const b = clampByte(hue2rgb(p, q, h - 1 / 3) * 255);

  return [r, g, b];
}

/**
 * 太暗的顏色只在畫面上調亮，資料照原值；與背景對比至少 3:1。
 * 基準背景為深色主題面板 #252526（亮度約 0.0177）及底色 #1e1e1e（亮度約 0.0121）。
 */
export function adjustColorForDarkTheme(hexColor: string, minContrast = 3.0): string {
  const rgb = parseHexColor(hexColor);
  if (!rgb) return hexColor;

  const bgLum = sRgbLuminance(0x25, 0x25, 0x26);
  let curLum = sRgbLuminance(rgb[0], rgb[1], rgb[2]);

  if (contrastRatio(curLum, bgLum) >= minContrast) {
    return toHexColor(rgb[0], rgb[1], rgb[2]);
  }

  const [h, s, initL] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  let l = initL;
  let adjustedRgb = rgb;

  while (l <= 0.95) {
    l += 0.02;
    adjustedRgb = hslToRgb(h, s, l);
    curLum = sRgbLuminance(adjustedRgb[0], adjustedRgb[1], adjustedRgb[2]);
    if (contrastRatio(curLum, bgLum) >= minContrast) {
      break;
    }
  }

  return toHexColor(adjustedRgb[0], adjustedRgb[1], adjustedRgb[2]);
}

export interface CardVisualStyles {
  displayColor: string;
  borderLeft: string;
  backgroundImage: string;
  backgroundColor: string;
  dotColor: string;
}

/** 電腦版卡片預設色碼；畫面上把 #3C3F41（不分大小寫）與空字串皆視為預設色，不畫色條、不加淡底 */
export const DEFAULT_CARD_COLOR = '#3C3F41';

/** 舊版試看分類代碼（遇到時退回預設） */
export const LEGACY_CATEGORY_IDS = new Set<string>(['outline', 'worldview', 'scene']);

/** 舊版非 UUID 範例卡片 ID（遇到時退回預設） */
export const LEGACY_CARD_ID_REGEX = /^(?:outline|char|world|time|scene)-\d+(?:-\d+)*$/;

export function isDefaultCardColor(rawColor?: string | null): boolean {
  if (!rawColor) return true;
  const trimmed = rawColor.trim();
  return trimmed === '' || trimmed.toLowerCase() === '#3c3f41';
}

export function isLegacyCategoryId(categoryId?: string | null): boolean {
  if (!categoryId) return false;
  return LEGACY_CATEGORY_IDS.has(categoryId.trim());
}

export function isLegacyCardId(cardId?: string | null): boolean {
  if (!cardId) return false;
  return LEGACY_CARD_ID_REGEX.test(cardId.trim());
}

/**
 * 依視覺規範產生卡片顯示樣式：
 * - 左側 4px 色條與淡底均使用畫面調亮後的顏色（資料原值維持不變）
 * - 8～12% 同色淡底（採 10%），以 linear-gradient 疊加在 var(--panel) 底色上，不覆蓋面板底色
 * - 預設色（#3C3F41 不分大小寫）與空字串不加色條、不加淡底
 */
export function cardVisualStyles(rawColor?: string | null): CardVisualStyles | null {
  if (isDefaultCardColor(rawColor)) return null;
  const displayColor = adjustColorForDarkTheme(rawColor!);
  const rgb = parseHexColor(displayColor);
  if (!rgb) return null;

  const tint = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.10)`;
  return {
    displayColor,
    borderLeft: `4px solid ${displayColor}`,
    backgroundImage: `linear-gradient(${tint}, ${tint})`,
    backgroundColor: 'var(--panel)',
    dotColor: displayColor,
  };
}

/* ================= 畫面狀態與切換邏輯 (cardsViewReducer) ================= */

export interface CardsViewState {
  selectedCategoryId: string | null;
  selectedCardId: string | null;
  collapsedIds: Set<string>;
}

export type CardsViewAction =
  | { type: 'SELECT_CATEGORY'; categoryId: string }
  | { type: 'SELECT_CARD'; cardId: string }
  | { type: 'BACK_TO_CARDS' }
  | { type: 'BACK_TO_CATEGORIES' }
  | { type: 'TOGGLE_COLLAPSE'; cardId: string }
  | { type: 'RESET_FOR_PROJECT'; projectId?: string };

export const initialCardsViewState: CardsViewState = {
  selectedCategoryId: null,
  selectedCardId: null,
  collapsedIds: new Set<string>(),
};

/**
 * 卡片導覽狀態純函式 reducer：
 * 包含第一層（分類清單）、第二層（卡片清單）、第三層（卡片內容）之切換、展開收合與切換稿件重置
 */
export function cardsViewReducer(state: CardsViewState, action: CardsViewAction): CardsViewState {
  switch (action.type) {
    case 'SELECT_CATEGORY': {
      if (isLegacyCategoryId(action.categoryId) || isCategoryHidden(action.categoryId)) {
        return {
          ...state,
          selectedCategoryId: null,
          selectedCardId: null,
        };
      }
      return {
        ...state,
        selectedCategoryId: action.categoryId,
        selectedCardId: null,
      };
    }
    case 'SELECT_CARD': {
      if (isLegacyCardId(action.cardId)) {
        return {
          ...state,
          selectedCardId: null,
        };
      }
      return {
        ...state,
        selectedCardId: action.cardId,
      };
    }
    case 'BACK_TO_CARDS':
      return {
        ...state,
        selectedCardId: null,
      };
    case 'BACK_TO_CATEGORIES':
      return {
        ...state,
        selectedCategoryId: null,
        selectedCardId: null,
      };
    case 'TOGGLE_COLLAPSE': {
      const next = new Set(state.collapsedIds);
      if (next.has(action.cardId)) {
        next.delete(action.cardId);
      } else {
        next.add(action.cardId);
      }
      return {
        ...state,
        collapsedIds: next,
      };
    }
    case 'RESET_FOR_PROJECT':
      return {
        selectedCategoryId: null,
        selectedCardId: null,
        collapsedIds: new Set<string>(),
      };
    default:
      return state;
  }
}

/**
 * 判斷是否需要因切換稿件而重置卡片畫面狀態。
 * 只有在前一個 projectId 存在且與當前 projectId 不同時才需重置（初次掛載或相同稿件不重置）。
 */
export function shouldResetForProject(
  prevProjectId: string | undefined | null,
  nextProjectId: string | undefined | null,
): boolean {
  if (prevProjectId === undefined || prevProjectId === null) {
    return false;
  }
  return prevProjectId !== nextProjectId;
}


