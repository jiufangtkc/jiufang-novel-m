export interface TreeScrollMemory {
  scrollTop: number;
  highlightId: string | null;
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
