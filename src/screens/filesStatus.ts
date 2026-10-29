import { formatClockTime } from '../domain/saveClock';

export function isComputerLayout(width: number): boolean {
  return width >= 600;
}

/** 狀態卡只在真的寫進 App 空間之後才說已存在。 */
export function appSpaceStatusLine(options: {
  stored: boolean;
  computer: boolean;
  lastSaveMs: number | null;
}): string {
  const device = options.computer ? '這台電腦' : '這支手機';
  if (!options.stored) return `還沒存進${device}的 App 空間`;
  if (options.lastSaveMs == null) return `已自動存在${device}的 App 空間`;
  return `已自動存在${device}的 App 空間・最後暫存 ${formatClockTime(new Date(options.lastSaveMs))}`;
}
