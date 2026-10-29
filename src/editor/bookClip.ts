import type { InternalClip } from './clipboardPolicy';

let current: { bookId: string; clip: InternalClip } | null = null;

export function rememberBookClip(bookId: string, clip: InternalClip) {
  current = { bookId, clip };
}

export function clipForBook(bookId: string): InternalClip | null {
  if (!current || current.bookId !== bookId) return null;
  return current.clip;
}

export function clearBookClip() {
  current = null;
}
