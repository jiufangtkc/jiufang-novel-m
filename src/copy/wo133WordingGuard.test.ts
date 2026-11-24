import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findReleaseNote, RELEASE_NOTES } from '../data/whatsNew';
import { getDeviceName } from './cardEditCopy';
import {
  IMPORT_TEXT_STORAGE_FAIL,
  deleteRecoverableHint,
  localDevicePhrase,
} from './userFacing';

const FORBIDDEN_PHRASE = '這台' + '裝置';

const ALLOWED_NEGATIVE_GUARD_FILES = new Set([
  'src/state/wo132StashFail.test.ts',
  'src/screens/appearanceSettings.test.ts',
]);

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('WO-133 第 5 段：全區「這個裝置」用字與 0.4.0 改版說明守衛（中-3）', () => {
  it('src/ 與 qa/ 所有 .ts/.tsx/.mjs 檔案（除明確反向守衛外）零出現舊稱「這台＋裝置」', () => {
    const root = process.cwd();
    const files = [
      ...collectFiles(join(root, 'src')),
      ...collectFiles(join(root, 'qa')),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, '/');
      if (ALLOWED_NEGATIVE_GUARD_FILES.has(rel)) continue;
      const content = readFileSync(file, 'utf8');
      if (content.includes(FORBIDDEN_PHRASE)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('0.4.2 已修正之 IMPORT_TEXT_STORAGE_FAIL 與保留的裝置稱呼維持正確', () => {
    expect(IMPORT_TEXT_STORAGE_FAIL).toBe('這個裝置存不下這份稿子，這次沒有匯入。');
    expect(IMPORT_TEXT_STORAGE_FAIL).not.toContain(FORBIDDEN_PHRASE);
    expect(localDevicePhrase(true)).toBe('這個裝置');
    expect(localDevicePhrase(false)).toBe('這支手機');

    expect(deleteRecoverableHint(true)).toContain('這台電腦');
    expect(deleteRecoverableHint(false)).toContain('這支手機');
    expect(getDeviceName('wide', 'mouse')).toBe('這台電腦');
    expect(getDeviceName('wide', 'touch')).toBe('這台平板');
    expect(getDeviceName('phone-portrait', 'touch')).toBe('這支手機');
  });

  it('whatsNew.ts 的 0.4.0 第 1 條已改為暫定新句，其餘舊條目原文一字不動', () => {
    const note040 = findReleaseNote('0.4.0', RELEASE_NOTES);
    expect(note040?.items).toEqual([
      '自動存檔：在電腦的 Chrome 或 Edge 存成檔案一次後，有改字就每 5 分鐘自動存回去',
      '還沒存成檔案時會提醒你',
    ]);
    expect(findReleaseNote('0.4.2', RELEASE_NOTES)?.items).toEqual([
      '寫作頁「還沒存成檔案」改成畫面一角的小標示，存檔狀態也改為只在一處顯示',
      '排版後一開始打字就會收起「排版好了」提示，按「復原」不會清掉新打的字',
      '誤刪章節後再復原，時間線事件會一起連回原本的章',
      '暫存或自動存檔沒成功時，畫面會清楚提醒',
      '修正在剛打完字立刻按存檔快速鍵、原檔已在別處更新，或瀏覽器暫存異常時可能漏字或覆蓋的問題',
    ]);
    expect(findReleaseNote('0.4.1', RELEASE_NOTES)?.items).toEqual([
      '存檔提醒改成只在畫面角落顯示，不再跳出視窗',
    ]);
    expect(findReleaseNote('0.3.0', RELEASE_NOTES)?.items).toEqual([
      '事件時間線：照故事順序或章節順序排事件，電腦寬螢幕還能雙線對照',
      '設定頁新增贊助按鈕',
    ]);
  });
});
