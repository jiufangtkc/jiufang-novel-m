/**
 * WO-64：寫作時看卡片「編輯中」的小型共用狀態。
 *
 * 看卡片面板（WritingCardsDrawer）與正文（EditorPane）在寬版時分屬不同元件，
 * 需要共用三件事：現在是不是正在編輯卡片、編輯結束的原因、以及「先存卡片再離開」的出口。
 * 這裡不存任何卡片或正文內容，也不碰存檔流程；卡片仍由既有的 actions.updateCard 更新。
 */

export type CardEditEndKind = 'done' | 'cancel' | 'close' | 'body';

export interface CardEditSnapshot {
  editing: boolean;
  /** 「寫作位置已記住：…」的顯示文字；沒有就是 null */
  placeLabel: string | null;
  /** 每結束一次編輯加 1，供畫面判斷「剛結束」 */
  endSeq: number;
  endKind: CardEditEndKind | null;
}

let snapshot: CardEditSnapshot = { editing: false, placeLabel: null, endSeq: 0, endKind: null };
let bodyPrepare: (() => string | null) | null = null;
let flushHandler: ((kind: CardEditEndKind) => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: CardEditSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeCardEdit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCardEditSnapshot(): CardEditSnapshot {
  return snapshot;
}

/** 正文登記：開始編輯前先收好組字、記住位置；回傳「寫作位置已記住」要顯示的字。 */
export function registerBodyPrepare(fn: (() => string | null) | null): void {
  bodyPrepare = fn;
}

/** 面板登記：「先存卡片再結束編輯」的出口，給點正文、收起面板等共用。 */
export function registerCardEditFlush(fn: ((kind: CardEditEndKind) => void) | null): void {
  flushHandler = fn;
}

export function startCardEdit(): void {
  if (snapshot.editing) return;
  const placeLabel = bodyPrepare ? bodyPrepare() : null;
  publish({ ...snapshot, editing: true, placeLabel });
}

export function endCardEdit(kind: CardEditEndKind): void {
  if (!snapshot.editing) return;
  publish({ editing: false, placeLabel: null, endSeq: snapshot.endSeq + 1, endKind: kind });
}

/** 先存卡片再結束編輯；沒有在編輯就什麼都不做。 */
export function flushCardEdit(kind: CardEditEndKind): void {
  if (!snapshot.editing) return;
  if (flushHandler) flushHandler(kind);
  else endCardEdit(kind);
}

/** 測試用：回到初始狀態。 */
export function resetCardEditSession(): void {
  bodyPrepare = null;
  flushHandler = null;
  snapshot = { editing: false, placeLabel: null, endSeq: 0, endKind: null };
  listeners.forEach((listener) => listener());
}
