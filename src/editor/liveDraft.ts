import { findNode, updateNode, type DemoProject } from '../data/demo';
import { OUTLINE_STORAGE_KEY, saveProjects, type KeyValueStore } from '../domain/outline';

export const LIVE_DRAFT_KEY = 'jiufang-novel-m.live-draft.v1';

export interface LiveDraft {
  projectId: string;
  chapterId: string;
  text: string;
  at: number;
}

let reader: (() => Omit<LiveDraft, 'at'> | null) | null = null;

export function setLiveReader(next: (() => Omit<LiveDraft, 'at'> | null) | null) {
  reader = next;
}

export function readLiveDraftFromEditor(): Omit<LiveDraft, 'at'> | null {
  return reader ? reader() : null;
}

export function writeLiveDraft(store: KeyValueStore, draft: LiveDraft) {
  store.setItem(LIVE_DRAFT_KEY, JSON.stringify(draft));
}

export function loadLiveDraft(store: KeyValueStore): LiveDraft | null {
  const raw = store.getItem(LIVE_DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LiveDraft>;
    if (!parsed || typeof parsed.text !== 'string' || !parsed.projectId || !parsed.chapterId) return null;
    if (typeof parsed.at !== 'number') return null;
    return {
      projectId: parsed.projectId,
      chapterId: parsed.chapterId,
      text: parsed.text,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

export function clearLiveDraft(store: KeyValueStore) {
  store.setItem(LIVE_DRAFT_KEY, '');
}

export function applyLiveDraft(projects: readonly DemoProject[], draft: LiveDraft | null): DemoProject[] {
  if (!draft) return projects.map((project) => ({ ...project }));
  return projects.map((project) => {
    if (project.id !== draft.projectId) return project;
    if (!findNode(project.nodes, draft.chapterId)) return project;
    return {
      ...project,
      nodes: updateNode(project.nodes, draft.chapterId, (node) => ({ ...node, content: draft.text })),
    };
  });
}

/** 離開頁面時立刻把正文框的字寫進可同步讀回的暫存。不等停筆計時。 */
export function flushOpenDraft(options: {
  store: KeyValueStore;
  projects: readonly DemoProject[];
  now?: number;
  read?: () => Omit<LiveDraft, 'at'> | null;
}): DemoProject[] {
  const live = (options.read ?? readLiveDraftFromEditor)();
  if (!live) return options.projects.map((project) => ({ ...project }));
  const draft: LiveDraft = { ...live, at: options.now ?? Date.now() };
  writeLiveDraft(options.store, draft);
  const merged = applyLiveDraft(options.projects, draft);
  const local = merged.filter((project) => project.origin !== 'file');
  if (local.length > 0) saveProjects(options.store, local);
  return merged;
}

export function notePersistedDraft(store: KeyValueStore, live: Omit<LiveDraft, 'at'>, startedAt: number) {
  const draft = loadLiveDraft(store);
  if (!draft) return;
  if (draft.projectId !== live.projectId || draft.chapterId !== live.chapterId) return;
  if (draft.at <= startedAt) clearLiveDraft(store);
}

export function bindLeaveFlush(
  target: {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  },
  doc: {
    visibilityState: string;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  },
  flush: () => void,
) {
  const onHide = () => {
    if (doc.visibilityState === 'hidden') flush();
  };
  doc.addEventListener('visibilitychange', onHide);
  target.addEventListener('pagehide', flush);
  target.addEventListener('beforeunload', flush);
  return () => {
    doc.removeEventListener('visibilitychange', onHide);
    target.removeEventListener('pagehide', flush);
    target.removeEventListener('beforeunload', flush);
  };
}

export { OUTLINE_STORAGE_KEY };
