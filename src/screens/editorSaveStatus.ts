import { formatClockTime } from '../domain/saveClock';

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** 正文底部的存檔狀態。沒有「儲存專案」且今天還沒另存時，改提示並可點去檔案頁。 */
export function editorSaveStatus(options: {
  directWriteback: boolean;
  lastSaveMs: number | null;
  lastExportMs: number | null;
  now: Date;
}): { label: string; openFiles: boolean } {
  const exportedToday =
    options.lastExportMs != null && sameDay(new Date(options.lastExportMs), options.now);
  if (!options.directWriteback && !exportedToday) {
    return { label: '今天還沒另存', openFiles: true };
  }
  if (options.lastSaveMs != null) {
    return { label: `已暫存 ${formatClockTime(new Date(options.lastSaveMs))}`, openFiles: false };
  }
  return { label: '尚未暫存', openFiles: false };
}
