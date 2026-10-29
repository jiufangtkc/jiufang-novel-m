/** 顯示存檔時間（臺灣習慣，24 小時制）。 */
export function formatClockTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatLastExportLabel(timestampMs: number | null, now = new Date()): string {
  if (timestampMs == null) return '還沒另存過';
  const when = new Date(timestampMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWhen = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  if (startOfWhen.getTime() === startOfToday.getTime()) {
    return `今天 ${formatClockTime(when)}`;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}/${pad(when.getMonth() + 1)}/${pad(when.getDate())} ${formatClockTime(when)}`;
}

export function formatLastProjectSave(timestampMs: number | null, now = new Date()): string {
  if (timestampMs == null) return '還沒儲存過';
  const when = new Date(timestampMs);
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  if (sameDay) return formatClockTime(when);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}/${pad(when.getMonth() + 1)}/${pad(when.getDate())} ${formatClockTime(when)}`;
}

export function latestSaveTimestamp(meta: {
  lastAutoSaveMs: number | null;
  lastManualSaveMs: number | null;
}): number | null {
  const values = [meta.lastAutoSaveMs, meta.lastManualSaveMs].filter(
    (value): value is number => value != null,
  );
  if (values.length === 0) return null;
  return Math.max(...values);
}
