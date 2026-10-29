import type { ChapterNode, DemoProject } from '../data/demo';

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
    content: '【範例】新加的幕，可以在這裡寫。\n',
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

export function saveProjects(store: KeyValueStore, projects: readonly DemoProject[]): void {
  store.setItem(OUTLINE_STORAGE_KEY, JSON.stringify(projects));
}

export function loadProjects(store: KeyValueStore): DemoProject[] | null {
  const raw = store.getItem(OUTLINE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as DemoProject[];
  } catch {
    return null;
  }
}
