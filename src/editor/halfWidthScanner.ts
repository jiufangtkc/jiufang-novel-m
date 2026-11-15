import { findHalfWidthMarks, shiftMarksForEdit, type HalfWidthMark } from '../domain/halfWidthPunct';
import { createIdleGate } from './idleGate';

/** 停筆多久才檢查（毫秒）。 */
export const HALF_WIDTH_IDLE_MS = 3000;

/**
 * WO-76 乙段：什麼時候檢查半形標點。
 *
 * - 打字（input）：只把舊底線跟著平移，停筆 3 秒才重新檢查。
 * - 組字中（compositionstart 到 compositionend）：不計時、不檢查；選完字後重新計時 3 秒。
 * - 收起鍵盤（blur）：沒在組字就不等 3 秒，直接檢查。
 * - 檢查只讀正文，不改字、不動游標。
 */
export function createHalfWidthScanner(options: {
  read: () => string;
  /** 重新檢查完。 */
  onScan: (marks: HalfWidthMark[], text: string) => void;
  /** 打字中，舊底線跟著平移（尚未重新檢查）。 */
  onShift: (marks: HalfWidthMark[], text: string) => void;
  idleMs?: number;
}) {
  const gate = createIdleGate(options.idleMs ?? HALF_WIDTH_IDLE_MS);
  let composing = false;
  let text = '';
  let marks: HalfWidthMark[] = [];

  const scan = () => {
    if (composing) return;
    text = options.read();
    marks = findHalfWidthMarks(text);
    options.onScan(marks, text);
  };

  const input = () => {
    const next = options.read();
    if (next !== text) {
      marks = shiftMarksForEdit(marks, text, next);
      text = next;
      options.onShift(marks, text);
    }
    gate.schedule(scan);
  };

  return {
    /** 打開這一章時檢查一次。 */
    start: scan,
    /** 立刻重新檢查（改成全形、復原之後）。組字中不做。 */
    rescan: scan,
    input,
    compositionStart() {
      composing = true;
      gate.setComposing(true);
    },
    compositionEnd() {
      composing = false;
      gate.setComposing(false);
      // 選完字後重新計時。
      input();
    },
    blur() {
      if (!composing) gate.flush();
    },
    cancel() {
      gate.cancel();
    },
    get composing() {
      return composing;
    },
    get marks() {
      return marks;
    },
    get text() {
      return text;
    },
  };
}

export type HalfWidthScanner = ReturnType<typeof createHalfWidthScanner>;
