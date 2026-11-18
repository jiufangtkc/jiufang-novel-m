export interface InternalClip {
  /** 最近一次從這份稿子正文複製／剪下的真正文字。 */
  text: string;
}

export type PasteDecision =
  | { action: 'ignore-composing' }
  | { action: 'block' }
  | { action: 'insert'; text: string };

/**
 * 只有剪貼簿的文字與這份稿子最近一次正文複製／剪下的文字完全相同，才允許貼回。
 * 讀不到內容（null）、空字串、外面的文字一律擋下。
 * 組字進行中不改輸入框。
 */
export function decidePaste(
  incoming: string | null,
  internal: InternalClip | null,
  composing: boolean,
): PasteDecision {
  if (composing) return { action: 'ignore-composing' };
  if (!internal || internal.text.length === 0) return { action: 'block' };
  if (incoming === null || incoming === '') return { action: 'block' };
  if (incoming === internal.text) return { action: 'insert', text: internal.text };
  return { action: 'block' };
}
