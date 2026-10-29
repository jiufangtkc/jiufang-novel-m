/**
 * 進度標記的顯示名稱。九方已定案。
 * 資料仍存英文代碼，只有畫面上的字用中文。
 */
export const PROGRESS_LABELS = {
  Draft: '草稿',
  '1st Edit': '一修',
  '2nd Edit': '再修',
  Final: '完稿',
  Discarded: '棄稿',
} as const;

export type ProgressCode = keyof typeof PROGRESS_LABELS;

export const PROGRESS_ORDER: readonly ProgressCode[] = [
  'Draft',
  '1st Edit',
  '2nd Edit',
  'Final',
  'Discarded',
];

export const NODE_TYPE_LABELS = {
  folder: '卷',
  file: '章',
  scene: '幕',
} as const;

export type NodeType = keyof typeof NODE_TYPE_LABELS;

export function progressLabel(code: ProgressCode): string {
  return PROGRESS_LABELS[code];
}

export function nodeTypeLabel(type: NodeType): string {
  return NODE_TYPE_LABELS[type];
}
