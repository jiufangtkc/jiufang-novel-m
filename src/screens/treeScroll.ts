export interface TreeScrollMemory {
  scrollTop: number;
  highlightId: string | null;
}

export interface TreePlace {
  nodeId: string;
  prevId: string | null;
  offset: number;
}

export function treePlaceKey(projectId: string): string {
  return `jiufang-novel-m.tree-place.v1:${projectId}`;
}

export function saveTreePlace(store: Pick<Storage, 'setItem'>, projectId: string, place: TreePlace): void {
  store.setItem(treePlaceKey(projectId), JSON.stringify(place));
}

export function loadTreePlace(store: Pick<Storage, 'getItem'>, projectId: string): TreePlace | null {
  const raw = store.getItem(treePlaceKey(projectId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TreePlace;
    if (!parsed || typeof parsed.nodeId !== 'string' || typeof parsed.offset !== 'number') return null;
    return { nodeId: parsed.nodeId, prevId: parsed.prevId ?? null, offset: parsed.offset };
  } catch {
    return null;
  }
}

export function scrollTopForRow(rowOffsetTop: number, distanceFromPaneTop: number): number {
  return Math.max(0, rowOffsetTop - distanceFromPaneTop);
}

export function rememberTreeScroll(
  previous: TreeScrollMemory | null,
  event: { type: 'open'; chapterId: string; scrollTop: number } | { type: 'back' },
): TreeScrollMemory {
  const current = previous ?? { scrollTop: 0, highlightId: null };
  if (event.type === 'open') {
    return { scrollTop: event.scrollTop, highlightId: event.chapterId };
  }
  return current;
}
