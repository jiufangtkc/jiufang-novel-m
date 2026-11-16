import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CategoryManager } from '../components/CategoryManager';
import { DailyProgressBar } from '../components/DailyProgressBar';
import { DeletedCardsList } from '../components/DeletedCardsList';
import {
  ADD_CATEGORY_BUTTON,
  CATEGORY_BUILTIN_ARIA,
  PUT_BACK_ORIGINAL_BUTTON,
  UNDO_BUTTON,
  restoredCardToast,
  undoToastSpoken,
} from '../copy/cardEditCopy';
import {
  SAVE_FATAL_FAIL,
  SETTINGS_WRITING_LOG_HINT,
  VISUAL_WRITING_RECORD,
  categoryRowAria,
  dailyProgressAriaLabel,
  dailyProgressCompactLabel,
  lastEditDisplay,
  localDevicePhrase,
  stashDraftHint,
} from '../copy/userFacing';
import type { DeletedCardRecord } from '../domain/cardArchive';
import { LayoutProvider, type LayoutMode } from '../layout';
import { SampleProvider } from '../state/sampleStore';
import { CardsScreen, type CardsScreenProps } from './CardsScreen';
import { FilesScreen } from './FilesScreen';
import { LogsScreen } from './LogsScreen';
import { SettingsScreen, goalApplyPlan } from './SettingsScreen';
import { StatsScreen } from './StatsScreen';
import { appSpaceStatusLine } from './filesStatus';
import { demoFixtureState } from '../state/testing/sampleFixture';

const SIMPLIFIED = /[这个录导汇备开关写预败]/;

function renderAt(element: ReactElement, path: string, url: string, mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        { initialMode: mode },
        createElement(
          MemoryRouter,
          { initialEntries: [url] },
          createElement(Routes, null, createElement(Route, { path, element })),
        ),
      ),
    ),
  );
}

describe('WO-91 用字與朗讀', () => {
  it('兩處「視覺化的寫作記錄」，設定說明與紀錄頁項目一致', () => {
    expect(VISUAL_WRITING_RECORD).toBe('視覺化的寫作記錄');
    expect(SETTINGS_WRITING_LOG_HINT).toBe('每日字數、寫作時間、匯入匯出、大量刪除');

    const logs = renderAt(createElement(LogsScreen), '/p/:projectId/logs', '/p/fog/logs', 'phone-portrait');
    expect(logs).toContain('視覺化的寫作記錄');
    expect(logs).not.toContain('視覺化的寫作紀錄');

    const settings = renderAt(
      createElement(SettingsScreen),
      '/p/:projectId/settings',
      '/p/fog/settings',
      'phone-portrait',
    );
    expect(settings).toContain(SETTINGS_WRITING_LOG_HINT);
    expect(settings).not.toContain('大量文字出現');

    for (const mode of ['phone-portrait', 'phone-landscape', 'medium', 'wide'] as const) {
      const stats = renderAt(createElement(StatsScreen), '/p/:projectId/stats', '/p/fog/stats', mode);
      if (mode === 'wide') {
        expect(stats).toContain('視覺化的寫作記錄');
        expect(stats).not.toContain('視覺化的寫作紀錄');
      } else {
        expect(stats).not.toContain('stats-wide-logs');
      }
      expect(stats).toContain('寫作過程紀錄');
    }
  });

  it('進度條朗讀與畫面一致，打字精簡數字有千分位和「字」', () => {
    expect(dailyProgressAriaLabel(12345, 10000, false)).toBe('今天寫了 12,345 字，每日目標 10,000 字');
    expect(dailyProgressAriaLabel(12345, 10000, true)).toBe('✦ 今天寫了 12,345 字，已達標，每日目標 10,000 字');
    expect(dailyProgressCompactLabel(12345, 10000)).toBe('12,345／10,000 字');
    expect(dailyProgressCompactLabel(300, 1000)).toBe('300／1,000 字');

    const full = renderToStaticMarkup(createElement(DailyProgressBar, { words: 12345, goal: 10000, met: false }));
    expect(full).toContain('今天寫了 12,345 字');
    expect(full).toContain('aria-label="今天寫了 12,345 字，每日目標 10,000 字"');
    expect(full).not.toContain('今日已寫');
  });

  it('分類列是「N 張」；內建分類朗讀含不能刪除；符號不進朗讀', () => {
    expect(categoryRowAria('角色', 5)).toBe('角色，5 張');
    expect(categoryRowAria('角色', 1000)).toBe('角色，1000 張');

    const manager = renderToStaticMarkup(
      createElement(CategoryManager, {
        categories: [
          { id: 'character', name: '角色', sort_order: 0, isBuiltin: true, isCustom: false, isOrphan: false },
          { id: 'custom_00000001', name: '【範例】地點', sort_order: 1, isBuiltin: false, isCustom: true, isOrphan: false },
        ],
        cards: [],
        onMoveUp: () => {},
        onMoveDown: () => {},
        onRename: () => {},
        onDelete: () => {},
        onAddCategory: () => {},
        onDone: () => {},
      }),
    );
    expect(manager).toContain(`aria-label="${CATEGORY_BUILTIN_ARIA}"`);
    expect(CATEGORY_BUILTIN_ARIA).toContain('不能刪除');
    expect(manager).toContain('aria-hidden="true">內建');
    expect(manager).toContain(`aria-label="${ADD_CATEGORY_BUTTON}"`);
    expect(manager).toContain('aria-hidden="true">+');

    const deleted = renderToStaticMarkup(
      createElement(DeletedCardsList, {
        deletedCards: [
          {
            id: 'del-1',
            rootCardId: 'card-1',
            title: '【範例】舊站名',
            category: 'character',
            parentId: null,
            index: 0,
            beforeIds: [],
            afterIds: [],
            cards: [],
            deletedAt: 1,
          },
        ],
        categories: [{ id: 'character', name: '角色' }],
        onRestore: () => {},
        onBack: () => {},
      }),
    );
    expect(deleted).toContain(`aria-label="${PUT_BACK_ORIGINAL_BUTTON}"`);
    expect(deleted).toContain('aria-hidden="true">↺');
  });

  it('刪除倒數只放在念一次的狀態句，畫面倒數不進朗讀', () => {
    const record: DeletedCardRecord = {
      id: 'del-wo91',
      rootCardId: '20000000-0000-4000-8000-000000000003',
      title: '【範例】陸承安',
      category: 'character',
      parentId: null,
      index: 0,
      beforeIds: [],
      afterIds: [],
      cards: [],
      deletedAt: 1,
    };
    const html = renderAt(
      createElement<CardsScreenProps>(CardsScreen, { initialUndoRecord: record }),
      '/p/:projectId/cards',
      '/p/fog/cards',
      'phone-portrait',
    );
    const spoken = undoToastSpoken('已刪除「【範例】陸承安」');
    expect(spoken).toBe('已刪除「【範例】陸承安」。10 秒內可以復原，剩 10 秒');
    expect(html).toContain(`role="status"`);
    expect(html).toContain(spoken);
    expect(html).toContain('card-undo-toast-info" aria-hidden="true"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain(`aria-label="${UNDO_BUTTON}"`);
    expect(html).toContain('aria-hidden="true">↺');

    const source = readFileSync(new URL('./CardsScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('undoToastSpoken(undoState.title)');
    expect(source).not.toMatch(/role="status"[\s\S]{0,120}remainingSeconds/);
  });

  it('放回卡片的提示改成「已把」', () => {
    expect(restoredCardToast('【範例】霧丘站', '角色')).toBe('已把「【範例】霧丘站」放回「角色」');
    expect(restoredCardToast('【範例】霧丘站', '角色')).not.toContain('已放回');
  });

  it('檔案頁與首頁用同一套裝置稱呼，並顯示上次編輯', () => {
    expect(localDevicePhrase(false)).toBe('這支手機');
    expect(localDevicePhrase(true)).toBe('這個裝置');
    expect(stashDraftHint(false)).toBe('立刻存進這支手機的 App 空間，防止掉字');
    expect(stashDraftHint(true)).toBe('立刻存進這個裝置的 App 空間，防止掉字');

    const at = new Date(2026, 10, 15, 9, 5).getTime();
    expect(
      lastEditDisplay({ updatedLabel: '已在手機', notPhone: false, lastEditMs: at, now: new Date(at) }),
    ).toBe('今天 09:05');
    expect(lastEditDisplay({ updatedLabel: '已在手機', notPhone: true, lastEditMs: null })).toBe('已在這個裝置');
    expect(lastEditDisplay({ updatedLabel: '已在手機', notPhone: false, lastEditMs: null })).toBe('已在這支手機');
    expect(lastEditDisplay({ updatedLabel: '12 分鐘前', notPhone: true, lastEditMs: null })).toBe('12 分鐘前');

    for (const mode of ['phone-portrait', 'phone-landscape'] as const) {
      const html = renderAt(createElement(FilesScreen), '/p/:projectId/files', '/p/fog/files', mode);
      expect(html).toContain('還沒存進這支手機的 App 空間');
      expect(html).toContain(stashDraftHint(false));
      expect(html).not.toContain('這個裝置');
      expect(html).toContain('上次編輯：12 分鐘前');
      expect(html).toContain('存檔');
      expect(html).toContain('開啟與關閉');
      expect(html).toContain('匯入與匯出');
    }
    for (const mode of ['medium', 'wide'] as const) {
      const html = renderAt(createElement(FilesScreen), '/p/:projectId/files', '/p/fog/files', mode);
      expect(html).toContain('還沒存進這個裝置的 App 空間');
      expect(html).toContain(stashDraftHint(true));
      expect(html).not.toContain('這支手機');
      expect(html).not.toContain('這台電腦');
      expect(html).toContain('上次編輯：12 分鐘前');
    }
    expect(appSpaceStatusLine({ stored: true, computer: true, lastSaveMs: at })).toContain('這個裝置');
  });

  it('存檔失敗用定案句；開啟稿子不說已匯入；只改每日目標不說全書目標', () => {
    expect(SAVE_FATAL_FAIL).toBe('存檔失敗。稿件目前仍在 APP 暫存空間。');
    const store = readFileSync(new URL('../state/sampleStore.tsx', import.meta.url), 'utf8');
    expect(store).not.toContain('這支裝置');
    expect(store).not.toMatch(/message:\s*'已匯入檔案'/);
    expect(store).not.toMatch(/toast:\s*'已匯入檔案'/);
    expect(store).toContain('SAVE_FATAL_FAIL');
    expect(goalApplyPlan(1000, 1500, 100000, 100000)).toEqual({ daily: true, book: false });
    expect(goalApplyPlan(1000, 1000, 100000, 80000)).toEqual({ daily: false, book: true });
    expect(goalApplyPlan(1000, 1000, 100000, 100000)).toEqual({ daily: false, book: false });
  });

  it('本張新句子沒有簡體字、「您」或「假資料」', () => {
    const phrases = [
      VISUAL_WRITING_RECORD,
      SETTINGS_WRITING_LOG_HINT,
      SAVE_FATAL_FAIL,
      dailyProgressAriaLabel(12345, 10000, true),
      dailyProgressCompactLabel(12345, 10000),
      categoryRowAria('角色', 12),
      restoredCardToast('【範例】霧丘站', '角色'),
      undoToastSpoken('已刪除「【範例】陸承安」'),
      stashDraftHint(true),
      lastEditDisplay({ updatedLabel: '已在手機', notPhone: true, lastEditMs: null }),
      CATEGORY_BUILTIN_ARIA,
    ];
    for (const phrase of phrases) {
      expect(phrase).not.toMatch(SIMPLIFIED);
      expect(phrase).not.toContain('您');
      expect(phrase).not.toContain('假資料');
    }
  });
});
