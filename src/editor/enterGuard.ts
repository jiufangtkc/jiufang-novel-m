/** Safari 在選字結束後，仍可能緊接著送出 Enter。這段時間內的 Enter 不當成換行。待實機確認。 */
export const IME_ENTER_WINDOW_MS = 100;

export interface EnterGuardInput {
  key: string;
  isComposing: boolean;
  keyCode: number;
  timeStamp: number;
  lastCompositionEndTimeStamp: number | null;
  composingFlag: boolean;
}

export interface EnterGuardDecision {
  /** Safari 選字已結束時，擋下這次 Enter，避免多出一行。組字還沒結束時不擋，以免選字確認被吃掉。 */
  blockNewline: boolean;
  /** 不要把這次按鍵當成存檔、送出或其他動作。 */
  suppressActions: boolean;
}

export function decideEnterKey(input: EnterGuardInput): EnterGuardDecision {
  if (input.key !== 'Enter') {
    const ime = input.isComposing || input.composingFlag || input.keyCode === 229;
    return { blockNewline: false, suppressActions: ime };
  }
  if (input.isComposing || input.composingFlag) {
    return { blockNewline: false, suppressActions: true };
  }
  const nearEnd =
    input.lastCompositionEndTimeStamp !== null &&
    Math.abs(input.timeStamp - input.lastCompositionEndTimeStamp) <= IME_ENTER_WINDOW_MS;
  if (input.keyCode === 229 || nearEnd) {
    return { blockNewline: true, suppressActions: true };
  }
  return { blockNewline: false, suppressActions: false };
}

/**
 * 若瀏覽器還是在選字確認時塞進換行，且這次換行擋不掉，
 * 就在組字結束之後拿掉游標旁多出來的那一個換行。組字進行中不呼叫。
 */
export function removeSpuriousLineBreak(
  value: string,
  caret: number,
): { value: string; caret: number } | null {
  if (caret > 0 && value[caret - 1] === '\n') {
    return { value: value.slice(0, caret - 1) + value.slice(caret), caret: caret - 1 };
  }
  if (caret >= 0 && caret < value.length && value[caret] === '\n') {
    return { value: value.slice(0, caret) + value.slice(caret + 1), caret };
  }
  return null;
}
