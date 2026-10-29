import { describe, expect, it } from 'vitest';
import { appSpaceStatusLine, isComputerLayout } from './filesStatus';

describe('檔案頁狀態卡', () => {
  it('還沒存成功時不說已在 App 空間', () => {
    expect(appSpaceStatusLine({ stored: false, computer: false, lastSaveMs: null })).toBe(
      '還沒存進這支手機的 App 空間',
    );
    expect(appSpaceStatusLine({ stored: false, computer: true, lastSaveMs: Date.now() })).toBe(
      '還沒存進這台電腦的 App 空間',
    );
  });

  it('存成功後才寫已自動存在，電腦用這台電腦', () => {
    const at = new Date(2026, 9, 29, 14, 46, 0).getTime();
    expect(appSpaceStatusLine({ stored: true, computer: true, lastSaveMs: at })).toBe(
      '已自動存在這台電腦的 App 空間・最後暫存 14:46',
    );
    expect(appSpaceStatusLine({ stored: true, computer: false, lastSaveMs: at })).toBe(
      '已自動存在這支手機的 App 空間・最後暫存 14:46',
    );
  });

  it('寬度 600 以上當成電腦版面', () => {
    expect(isComputerLayout(599)).toBe(false);
    expect(isComputerLayout(600)).toBe(true);
  });
});
