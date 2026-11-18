import { localDevicePhrase } from '../copy/userFacing';
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
  // 電腦與平板（中等、寬版）說「這個裝置」，手機說「這支手機」。
  const device = localDevicePhrase(options.computer);
  if (!options.stored) return `還沒存進${device}的 App 空間`;
  if (options.lastSaveMs == null) return `已自動存在${device}的 App 空間`;
  return `已自動存在${device}的 App 空間・最後暫存 ${formatClockTime(new Date(options.lastSaveMs))}`;
}
