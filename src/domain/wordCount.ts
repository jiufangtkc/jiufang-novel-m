/**
 * 字數：去掉空白（空格、換行、定位字元）之後，一個 Unicode 字算一個。
 * 標點與數字都算。這是樣品階段的算法，是否與電腦版完全相同，待對過。
 */
export function countWords(text: string): number {
  const stripped = text.replace(/\s+/gu, '');
  return Array.from(stripped).length;
}
