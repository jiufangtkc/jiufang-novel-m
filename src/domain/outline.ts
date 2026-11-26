import type { ChapterNode, DemoProject } from '../data/demo';
import {
  cloneDemoCards,
  DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
  DEMO_CATEGORIES_META_RAW,
  DEMO_CATEGORY_ORDER_RAW,
  DEMO_EXPANDED_CATEGORIES_RAW,
} from '../data/demoCards';
import { isBuiltinSampleBook } from './builtinSampleBook';
import { normalizeTrashItems } from './trash';

/** 對齊日後寫進資料庫的列。parent_id 指向上一層，node_type 用 folder、file、scene。 */
export interface OutlineRow {
  id: string;
  parent_id: string | null;
  node_type: ChapterNode['type'];
  title: string;
  order: number;
}

export function outlineRows(
  nodes: readonly ChapterNode[],
  parentId: string | null = null,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  nodes.forEach((node, index) => {
    rows.push({
      id: node.id,
      parent_id: parentId,
      node_type: node.type,
      title: node.title,
      order: index,
    });
    if (node.children?.length) rows.push(...outlineRows(node.children, node.id));
  });
  return rows;
}

export function createScene(chapter: ChapterNode, id: string): ChapterNode {
  const count = (chapter.children ?? []).filter((child) => child.type === 'scene').length + 1;
  return {
    id,
    type: 'scene',
    title: `幕 ${count}　新幕`,
    progress: 'Draft',
    content: '',
  };
}

/** 只加在「章」底下，並把該章展開。找不到章就回傳 null。 */
export function addSceneUnderChapter(
  nodes: readonly ChapterNode[],
  chapterId: string,
  scene: ChapterNode,
): ChapterNode[] | null {
  let added = false;
  const walk = (node: ChapterNode): ChapterNode => {
    if (node.id === chapterId) {
      if (node.type !== 'file') return node;
      added = true;
      return { ...node, expanded: true, children: [...(node.children ?? []), scene] };
    }
    if (!node.children) return node;
    return { ...node, children: node.children.map(walk) };
  };
  const next = nodes.map(walk);
  return added ? next : null;
}

export const OUTLINE_STORAGE_KEY = 'jiufang-novel-m.outline.v1';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 讀回本機稿子時補齊卡片與分類欄位。
 * WO-95：只有內建範例書才補範例卡片與範例分類；其他稿子缺欄位時補空卡片與新稿子的預設分類，
 * 不把範例卡片塞進使用者自己的稿子。
 */
export function normalizeLoadedProject(project: DemoProject): DemoProject {
  if (project.origin === 'file') {
    return project;
  }
  const sample = isBuiltinSampleBook(project);
  const hasCardsArray = Array.isArray(project.cards);
  return {
    ...project,
    cards: hasCardsArray ? project.cards : sample ? cloneDemoCards() : [],
    categoryOrderRaw:
      project.categoryOrderRaw !== undefined
        ? project.categoryOrderRaw
        : sample
          ? DEMO_CATEGORY_ORDER_RAW
          : DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
    expandedCategoriesRaw:
      project.expandedCategoriesRaw !== undefined
        ? project.expandedCategoriesRaw
        : sample
          ? DEMO_EXPANDED_CATEGORIES_RAW
          : null,
    categoriesMetaRaw:
      project.categoriesMetaRaw !== undefined
        ? project.categoriesMetaRaw
        : sample
          ? DEMO_CATEGORIES_META_RAW
          : '{}',
    ...(project.trashItems !== undefined
      ? { trashItems: normalizeTrashItems(project.trashItems) }
      : {}),
  };
}

export function saveProjects(store: KeyValueStore, projects: readonly DemoProject[]): void {
  store.setItem(OUTLINE_STORAGE_KEY, JSON.stringify(projects));
}

/**
 * 讀回本機稿子清單。沒有存過、或內容壞掉時回傳 null；
 * WO-95：存的是空陣列就回傳空陣列，代表「已經沒有稿子」，不再當成要放範例。
 */
export function loadProjects(store: KeyValueStore): DemoProject[] | null {
  const raw = store.getItem(OUTLINE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return (parsed as DemoProject[]).map(normalizeLoadedProject);
  } catch {
    return null;
  }
}
