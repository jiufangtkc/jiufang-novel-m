const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 寫作日 YYYY-MM-DD →「7月2日（四）」；跨年才加年份。 */
export function formatCalendarDate(dayKey: string, now = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return dayKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAY[new Date(year, month - 1, day).getDay()];
  if (year === now.getFullYear()) {
    return `${month}月${day}日（${weekday}）`;
  }
  return `${year}年${month}月${day}日（${weekday}）`;
}

/** 首頁「上次編輯」：ISO 日改口語，其餘（剛剛、3 天前）原樣。 */
export function formatProjectUpdatedLabel(label: string, now = new Date()): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    return formatCalendarDate(label, now);
  }
  return label;
}

/** 由 Date 的本地年月日組成寫作日字串再格式化。 */
export function formatCalendarDateFromDate(date: Date, now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const dayKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return formatCalendarDate(dayKey, now);
}
