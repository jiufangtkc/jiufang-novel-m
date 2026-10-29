export interface InternalClip {
  text: string;
  /** 放到系統剪貼簿的標記。外面貼上只會看到這個，看不到正文。 */
  marker: string;
}

export type PasteDecision =
  | { action: 'ignore-composing' }
  | { action: 'block' }
  | { action: 'insert'; text: string };

export function createClipMarker(): string {
  return '\u2060jiufang-novel-m\u2060';
}

/**
 * 只有剪貼簿內容是我們剛放上去的標記、正文本身，或是被清成空的，才允許貼回。
 * 讀不到內容（null）就擋下，避免把外面的文字誤放進來。
 * 組字進行中不改輸入框。
 */
export function decidePaste(
  incoming: string | null,
  internal: InternalClip | null,
  composing: boolean,
): PasteDecision {
  if (composing) return { action: 'ignore-composing' };
  if (!internal || internal.text.length === 0) return { action: 'block' };
  if (incoming === null) return { action: 'block' };
  if (
    incoming === internal.marker ||
    incoming === internal.text ||
    incoming === ''
  ) {
    return { action: 'insert', text: internal.text };
  }
  return { action: 'block' };
}
