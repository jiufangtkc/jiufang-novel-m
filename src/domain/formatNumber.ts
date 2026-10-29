/** 四位數以上加千分位（臺灣習慣）。 */
export function formatInteger(value: number): string {
  return value.toLocaleString('zh-TW');
}
