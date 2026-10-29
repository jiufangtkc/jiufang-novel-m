/**
 * 字數：去掉空白（空格、換行、定位字元）之後，一個 Unicode 字算一個。
 * 標點與數字都算。範例專案沿用這個算法，畫面數字才跟已審過的樣品一致。
 * 從電腦版匯入的書改用 countManuscriptWords，與電腦版快照同一套。
 */
export function countWords(text: string): number {
  const stripped = text.replace(/\s+/gu, '');
  return Array.from(stripped).length;
}
