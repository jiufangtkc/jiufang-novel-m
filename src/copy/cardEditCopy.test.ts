import { describe, expect, it } from 'vitest';
import {
  deleteCardQuestion,
  deleteSubcardsImpact,
  deletedCardsListHint,
  deletedCardToastTitle,
  getDeviceName,
  restoredCardToast,
  savedCardToast,
  undoCountdownText,
} from './cardEditCopy';

describe('WO-61 卡片編輯與分類管理介面文案（cardEditCopy）', () => {
  it('WO-61：裝置稱呼依版面與指標判定（這台電腦／這台平板／這支手機）', () => {
    // 寬版＋滑鼠＝這台電腦
    expect(getDeviceName('wide', 'mouse')).toBe('這台電腦');
    // 寬版＋觸控（如 iPad 橫拿）＝這台平板
    expect(getDeviceName('wide', 'touch')).toBe('這台平板');
    // 中等（iPad 直拿等）＝這台平板
    expect(getDeviceName('medium', 'touch')).toBe('這台平板');
    expect(getDeviceName('medium', 'mouse')).toBe('這台平板');
    // 手機直拿與手機橫拿＝這支手機
    expect(getDeviceName('phone-portrait', 'touch')).toBe('這支手機');
    expect(getDeviceName('phone-landscape', 'touch')).toBe('這支手機');
  });

  it('WO-61：刪除確認標題與子卡片刪除警語', () => {
    expect(deleteCardQuestion('【範例】白芷')).toBe('刪除「【範例】白芷」？');
    expect(deleteCardQuestion('')).toBe('刪除「未命名卡片」？');
    expect(deleteSubcardsImpact(2)).toBe('連同底下 2 張子卡片一起刪除。');
  });

  it('WO-61：刪除提示與 10 秒倒數文字格式', () => {
    expect(deletedCardToastTitle('【範例】白芷', 0)).toBe('已刪除「【範例】白芷」');
    expect(deletedCardToastTitle('【範例】白芷', 2)).toBe('已刪除「【範例】白芷」和 2 張子卡片');
    expect(undoCountdownText(8)).toBe('10 秒內可以復原，剩 8 秒');
  });

  it('WO-61：最近刪除說明句隨裝置稱呼替換，且提到「分類清單最下方的「最近刪除」」', () => {
    expect(deletedCardsListHint('這支手機')).toBe(
      '最近刪除的 10 項會留在這支手機，可從分類清單最下方的「最近刪除」放回來',
    );
    expect(deletedCardsListHint('這台電腦')).toBe(
      '最近刪除的 10 項會留在這台電腦，可從分類清單最下方的「最近刪除」放回來',
    );
    expect(deletedCardsListHint('這台平板')).toBe(
      '最近刪除的 10 項會留在這台平板，可從分類清單最下方的「最近刪除」放回來',
    );
    // 支援沿用 userFacing.ts 既有函式風格之 boolean（computer）參數
    expect(deletedCardsListHint(false)).toBe(
      '最近刪除的 10 項會留在這支手機，可從分類清單最下方的「最近刪除」放回來',
    );
    expect(deletedCardsListHint(true)).toBe(
      '最近刪除的 10 項會留在這台電腦，可從分類清單最下方的「最近刪除」放回來',
    );
    // 預設參數
    expect(deletedCardsListHint()).toBe(
      '最近刪除的 10 項會留在這支手機，可從分類清單最下方的「最近刪除」放回來',
    );
  });

  it('WO-61：卡片放回提示與已存好提示格式', () => {
    expect(restoredCardToast('【範例】舊站名：霧丘站', '站名')).toBe(
      '已放回「【範例】舊站名：霧丘站」到「站名」',
    );
    expect(savedCardToast('【範例】白芷')).toBe('已存好「【範例】白芷」');
    expect(savedCardToast('')).toBe('已存好「未命名卡片」');
    expect(savedCardToast(null)).toBe('已存好「未命名卡片」');
  });
});
