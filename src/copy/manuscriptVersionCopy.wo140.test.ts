import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormatLayer, type FormatTools } from '../components/FormatTools';
import {
  ManuscriptVersionSheet,
  resolveSaveVersionFeedback,
  restoreOutcomeHint,
} from '../components/ManuscriptVersionSheet';
import { resolveVersionRestoreToast } from '../screens/EditorPane';
import type { VersionRestoreOutcome } from '../editor/versionRestoreFlow';
import { VersionRestoreNotice } from '../components/VersionRestoreNotice';
import { TRASH_MENU_MOVE_SELECTION, TRASH_MENU_OPEN } from './trashCopy';
import * as versionCopy from './manuscriptVersionCopy';
import { createManuscriptVersion } from '../domain/manuscriptVersions';

const SIMPLIFIED_CHARS = /[删暂记说这为没现还进时请标样选会备储复预关条满丢仅写显隐确认实体处个变对无损坏较资来]/u;
const FORBIDDEN_PHRASE = '這台' + '裝置';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('WO-140 第 5 段：稿子版本暫定用字、選單與元件守衛驗證', () => {
  it('第 7.1 節 19 項與第 7.2 節補充暫定用字皆逐字對齊規劃', () => {
    // 7.1 白話工單明列之 19 項暫定用字
    expect(versionCopy.VERSION_MENU_OPEN).toBe('版本');
    expect(versionCopy.VERSION_SHEET_TITLE).toBe('版本');
    expect(versionCopy.VERSION_EMPTY_HINT).toBe('這一章還沒有存過版本。');
    expect(versionCopy.VERSION_SAVE_BUTTON).toBe('儲存新版本');
    expect(versionCopy.VERSION_NOTE_HINT).toBe('請寫一句備註（可留白）。');
    expect(versionCopy.VERSION_NOTE_PLACEHOLDER).toBe('例如「改稿前」');
    expect(versionCopy.VERSION_SAVED_TOAST).toBe('版本已儲存');
    expect(versionCopy.VERSION_DUPLICATE_HINT).toBe('內容與最新版本相同。');
    expect(versionCopy.VERSION_PREVIEW_BUTTON).toBe('預覽');
    expect(versionCopy.VERSION_PREVIEW_READONLY_HINT).toBe(
      '這一版只能看，點「用這一版」換上。',
    );
    expect(versionCopy.VERSION_RESTORE_BUTTON).toBe('用這一版');
    expect(versionCopy.VERSION_RESTORE_CONFIRM_BODY).toBe(
      '要把這一章換成這份舊版嗎？現版本會先自動另存，可用來復原。',
    );
    expect(versionCopy.VERSION_AUTO_SAVE_NOTE).toBe('回到舊版前自動保存');
    expect(versionCopy.VERSION_RESTORED_NOTICE_TITLE).toBe('已換成舊版');
    expect(versionCopy.VERSION_UNDO_BUTTON).toBe('復原');
    expect(versionCopy.VERSION_UNDONE_TOAST).toBe('已復原到用舊版之前的樣子');
    expect(versionCopy.VERSION_UNDO_WARNING).toBe(
      '按「復原」會回到用舊版之前，連之後在這章新打的字也會一起還原。',
    );
    expect(versionCopy.VERSION_EVICTED_HINT).toBe(
      '這一章的版本已滿 20 份，已自動清除最舊版本。',
    );
    expect(versionCopy.VERSION_FULL_LOCKED_HINT).toBe(
      '這一章的版本已滿 20 份，而且都有備註。請先丟掉不需要的，再存新的。',
    );
    expect(versionCopy.VERSION_DISCARD_CONFIRM_TITLE).toBe('要丟掉這一版嗎？');
    expect(versionCopy.VERSION_DISCARD_CONFIRM_HINT).toBe(
      '丟掉後 10 秒內可以按「復原」。',
    );

    // 7.2 補充用字
    expect(versionCopy.versionMenuBadge(3)).toBe('3 份');
    expect(versionCopy.versionWordsLabel(1234)).toBe('1,234 字');
    expect(versionCopy.versionUsageSummary(3)).toBe('這一章已存 3／20 份');
    expect(versionCopy.VERSION_CLOSE_LABEL).toBe('關閉');
    expect(versionCopy.VERSION_CLOSE_ARIA).toBe('關閉版本清單');
    expect(versionCopy.VERSION_BACK_LABEL).toBe('返回');
    expect(versionCopy.VERSION_CANCEL_LABEL).toBe('取消');
    expect(versionCopy.VERSION_PREVIEW_CONTENT_ARIA).toBe('舊版全文');
    expect(versionCopy.VERSION_EDIT_NOTE_LABEL).toBe('備註（可空白）');
    expect(versionCopy.VERSION_EDIT_NOTE_SAVE).toBe('記下備註');
    expect(versionCopy.VERSION_EDIT_NOTE_SAVED_HINT).toBe('已更新備註');
    expect(versionCopy.VERSION_DISCARD_BUTTON).toBe('丟掉');
    expect(versionCopy.VERSION_DISCARDED_BAR).toBe('已丟掉這一版');
    expect(versionCopy.VERSION_DISCARD_UNDONE_HINT).toBe('已放回版本清單');
    expect(versionCopy.VERSION_RESTORE_CONFIRM_TITLE).toBe('要換成這一版嗎？');
    expect(versionCopy.VERSION_RESTORE_OVER_LIMIT_TOAST).toBe(
      '已換成舊版；這一章原本 20 份都有備註，已暫時多留一份自動保存，請抽空整理。',
    );
    expect(versionCopy.VERSION_AUTO_SAVE_FAIL_TOAST).toBe(
      '現版本沒有另存成功，先不換。',
    );
    expect(versionCopy.VERSION_SAVE_COMPOSING_TOAST).toBe(
      '先把正在輸入的字打完，再儲存新版本。',
    );
    expect(versionCopy.VERSION_RESTORE_COMPOSING_TOAST).toBe(
      '先把正在輸入的字打完，再換成舊版。',
    );
    expect(versionCopy.VERSION_UNDO_COMPOSING_TOAST).toBe(
      '先把正在輸入的字打完，再復原。',
    );
    expect(versionCopy.VERSION_NOTICE_CLOSE_ARIA).toBe('關閉版本提示');
    expect(versionCopy.VERSION_NEWER_REVISION_HINT).toBe(
      '這份稿子的版本資料來自較新版本，目前先原樣保留，請更新後再查看與管理。',
    );
    expect(versionCopy.VERSION_CORRUPT_HINT).toBe(
      '這份稿子的版本資料有損壞，正文不受影響，目前無法修改版本。',
    );
    expect(versionCopy.VERSION_SAVE_STASH_FAIL_HINT).toBe(
      '這一版還沒存進本機暫存，請再試一次。',
    );
    expect(versionCopy.VERSION_RESTORE_BLOCKED_FULL_HINT).toBe(
      '這一章的版本已超過 20 份，而且都有備註，沒辦法再自動保存，先不換。請先整理並丟掉不需要的舊版。',
    );
  });

  it('全部用字遵守臺灣繁體中文（無簡體字、無「您」、無「這台＋裝置」、無「彈窗」）', () => {
    const texts: string[] = [];
    for (const value of Object.values(versionCopy)) {
      if (typeof value === 'string') {
        texts.push(value);
      } else if (typeof value === 'function') {
        texts.push(value(1));
        texts.push(value(3));
        texts.push(value(1234));
      }
    }
    for (const text of texts) {
      expect(text).not.toMatch(SIMPLIFIED_CHARS);
      expect(text).not.toContain('您');
      expect(text).not.toContain(FORBIDDEN_PHRASE);
      expect(text).not.toContain('彈窗');
    }
  });

  it('不與 FORMAT_／TRASH_ 鍵衝突，且新元件與新檔案不硬寫未納入 copy 的中文', () => {
    for (const key of Object.keys(versionCopy)) {
      expect(key).not.toMatch(/^FORMAT_|^format|^TRASH_|^trash/);
    }

    const sheetSrc = stripComments(
      readFileSync(new URL('../components/ManuscriptVersionSheet.tsx', import.meta.url), 'utf8'),
    );
    expect(sheetSrc).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
    expect(sheetSrc).toContain("from '../copy/manuscriptVersionCopy'");

    const noticeSrc = stripComments(
      readFileSync(new URL('../components/VersionRestoreNotice.tsx', import.meta.url), 'utf8'),
    );
    expect(noticeSrc).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
    expect(noticeSrc).toContain("from '../copy/manuscriptVersionCopy'");
  });

  it('FormatLayer 選單依序呈現排版、版本（有份數才顯示小字）、刪稿暫存區與選取送入，且 EditorPane getMenuItemCount 為 3 + (hasSel ? 1 : 0)', () => {
    const toolsStub = {
      flow: { step: 'menu', kind: null, scope: null, menuPos: { left: 100, top: 64 } },
      isOpen: true,
      open: () => undefined,
      close: () => undefined,
      dismissMenu: () => undefined,
      confirm: () => undefined,
      undo: () => undefined,
      dismissNotice: () => undefined,
      hasSnapshot: false,
      pick: {
        menu: () => undefined,
        kind: () => undefined,
        scope: () => undefined,
        back: () => undefined,
      },
    } as unknown as FormatTools;

    const menuWithBadge = renderToStaticMarkup(
      createElement(FormatLayer, {
        tools: toolsStub,
        extraMenuItems: [
          {
            id: 'versions-open',
            label: versionCopy.VERSION_MENU_OPEN,
            badge: versionCopy.versionMenuBadge(3),
            onSelect: () => undefined,
          },
          {
            id: 'trash-open',
            label: TRASH_MENU_OPEN,
            onSelect: () => undefined,
          },
          {
            id: 'trash-move-selection',
            label: TRASH_MENU_MOVE_SELECTION,
            onSelect: () => undefined,
          },
        ],
      }),
    );

    const formatIdx = menuWithBadge.indexOf('data-testid="format-menu-item"');
    const verIdx = menuWithBadge.indexOf('data-testid="format-menu-versions-open"');
    const trashIdx = menuWithBadge.indexOf('data-testid="format-menu-trash-open"');
    const moveIdx = menuWithBadge.indexOf('data-testid="format-menu-trash-move-selection"');
    expect(formatIdx).toBeGreaterThan(-1);
    expect(verIdx).toBeGreaterThan(formatIdx);
    expect(trashIdx).toBeGreaterThan(verIdx);
    expect(moveIdx).toBeGreaterThan(trashIdx);
    expect(menuWithBadge).toContain(versionCopy.VERSION_MENU_OPEN);
    expect(menuWithBadge).toContain('3 份');

    const menuWithoutBadge = renderToStaticMarkup(
      createElement(FormatLayer, {
        tools: toolsStub,
        extraMenuItems: [
          {
            id: 'versions-open',
            label: versionCopy.VERSION_MENU_OPEN,
            badge: undefined,
            onSelect: () => undefined,
          },
          {
            id: 'trash-open',
            label: TRASH_MENU_OPEN,
            onSelect: () => undefined,
          },
        ],
      }),
    );
    expect(menuWithoutBadge).toContain('data-testid="format-menu-versions-open"');
    expect(menuWithoutBadge).not.toContain('0 份');

    const editorPaneSrc = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    expect(editorPaneSrc).toContain('return 3 + (hasSel ? 1 : 0);');
    expect(editorPaneSrc).toContain("id: 'versions-open'");
    expect(editorPaneSrc).toContain('halfWidth.rescan()');
  });

  it('ManuscriptVersionSheet、VersionRestoreNotice 與樣式在各狀態下正確渲染且專注模式強制隱藏', () => {
    const noopAsync = async () => ({ kind: 'saved', noticeCode: 'saved' }) as const;
    const baseProps = {
      open: true,
      projectId: 'p1',
      chapterId: 'c1',
      chapterTitle: '【範例】第一章',
      versions: [],
      versionRead: { kind: 'absent' } as const,
      layoutMode: 'phone-portrait' as const,
      isComposing: () => false,
      onClose: () => undefined,
      onSaveVersion: noopAsync,
      onUpdateNote: async () => ({ kind: 'updated' }) as const,
      onDiscard: async () => ({ kind: 'discarded' }) as const,
      onUndoDiscard: async () => ({ kind: 'restored' }) as const,
      onRestoreVersion: async () => ({ status: 'no-target' }) as const,
    };

    expect(
      renderToStaticMarkup(createElement(ManuscriptVersionSheet, { ...baseProps, open: false })),
    ).toBe('');

    const emptyHtml = renderToStaticMarkup(createElement(ManuscriptVersionSheet, baseProps));
    expect(emptyHtml).toContain('data-testid="version-sheet"');
    expect(emptyHtml).toContain(versionCopy.VERSION_EMPTY_HINT);
    expect(emptyHtml).toContain(versionCopy.VERSION_SAVE_BUTTON);
    expect(emptyHtml).toContain(versionCopy.VERSION_NOTE_HINT);
    expect(emptyHtml).toContain(versionCopy.VERSION_NOTE_PLACEHOLDER);

    const v1 = createManuscriptVersion({
      version_id: 'v-1',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】第一版正文',
      note: '大改前',
      source: 'manual',
      saved_at_ms: new Date(2026, 10, 26, 14, 15).getTime(),
    });
    const v2 = createManuscriptVersion({
      version_id: 'v-2',
      chapter_id: 'c1',
      chapter_title_snapshot: '【範例】第一章',
      content: '【範例】無備註版本正文',
      note: '',
      source: 'manual',
      saved_at_ms: new Date(2026, 10, 26, 14, 10).getTime(),
    });

    const listHtml = renderToStaticMarkup(
      createElement(ManuscriptVersionSheet, {
        ...baseProps,
        versions: [v2, v1],
        versionRead: { kind: 'ok', revision: 1, versions: [v2, v1] },
      }),
    );
    expect(listHtml).toContain('這一章已存 2／20 份');
    expect(listHtml).toContain('大改前');
    expect(listHtml).toContain('data-testid="version-item-note-v-1"');
    expect(listHtml).not.toContain('data-testid="version-item-note-v-2"');
    expect(listHtml).toContain(versionCopy.VERSION_PREVIEW_BUTTON);
    expect(listHtml.indexOf('data-testid="version-item-v-1"')).toBeLessThan(
      listHtml.indexOf('data-testid="version-item-v-2"'),
    );

    const newerHtml = renderToStaticMarkup(
      createElement(ManuscriptVersionSheet, {
        ...baseProps,
        versionRead: { kind: 'newer-revision', revision: 2 },
      }),
    );
    expect(newerHtml).toContain('data-testid="version-newer-revision-hint"');
    expect(newerHtml).toContain(versionCopy.VERSION_NEWER_REVISION_HINT);
    expect(newerHtml).not.toContain('data-testid="version-save-box"');

    const corruptHtml = renderToStaticMarkup(
      createElement(ManuscriptVersionSheet, {
        ...baseProps,
        versionRead: { kind: 'corrupt', reason: '損壞' },
      }),
    );
    expect(corruptHtml).toContain('data-testid="version-corrupt-hint"');
    expect(corruptHtml).toContain(versionCopy.VERSION_CORRUPT_HINT);
    expect(corruptHtml).not.toContain('data-testid="version-save-box"');

    const noticeHtml = renderToStaticMarkup(
      createElement(VersionRestoreNotice, {
        snapshot: {
          projectId: 'p1',
          chapterId: 'c1',
          targetVersionId: 'v-1',
          autoSavedVersionId: 'v-auto',
          beforeContent: 'a',
          afterContent: 'b',
        },
        projectId: 'p1',
        chapterId: 'c1',
        onUndo: () => undefined,
        onDismiss: () => undefined,
      }),
    );
    expect(noticeHtml).toContain('data-testid="version-restore-notice"');
    expect(noticeHtml).toContain('data-testid="version-restore-undo"');
    expect(noticeHtml).toContain('data-testid="version-restore-notice-close"');
    expect(noticeHtml).toContain(versionCopy.VERSION_RESTORED_NOTICE_TITLE);
    expect(noticeHtml).toContain(versionCopy.VERSION_UNDO_BUTTON);
    expect(noticeHtml).toContain(versionCopy.VERSION_UNDO_WARNING);

    expect(
      renderToStaticMarkup(
        createElement(VersionRestoreNotice, {
          snapshot: {
            projectId: 'p1',
            chapterId: 'c1',
            targetVersionId: 'v-1',
            autoSavedVersionId: 'v-auto',
            beforeContent: 'a',
            afterContent: 'b',
          },
          projectId: 'p1',
          chapterId: 'c2',
          onUndo: () => undefined,
          onDismiss: () => undefined,
        }),
      ),
    ).toBe('');

    const versionCss = readFileSync(
      new URL('../components/manuscriptVersionSheet.css', import.meta.url),
      'utf8',
    );
    expect(versionCss).toMatch(/html\[data-focus-mode="true"\] \.version-restore-notice/);
    expect(versionCss).toMatch(/html\[data-focus-mode="true"\] \.version-sheet-backdrop/);
    expect(versionCss).toContain('min-height: 44px;');
  });

  it('返工畫面提示（必修 1、2、4）：暫存失敗不可顯示已存成版本；滿 21 全保護換版提示整理；滿 20 清舊版換版提示 VERSION_EVICTED_HINT', () => {
    expect(
      resolveSaveVersionFeedback({
        kind: 'saved',
        noticeCode: 'saved',
        persisted: false,
      }),
    ).toEqual({
      message: versionCopy.VERSION_SAVE_STASH_FAIL_HINT,
      clearDraft: false,
    });
    expect(
      resolveSaveVersionFeedback({
        kind: 'saved',
        noticeCode: 'saved-evicted-oldest',
        persisted: false,
      }).message,
    ).not.toBe(versionCopy.VERSION_SAVED_TOAST);
    expect(
      resolveSaveVersionFeedback({
        kind: 'saved',
        noticeCode: 'saved',
        persisted: true,
      }),
    ).toEqual({
      message: versionCopy.VERSION_SAVED_TOAST,
      clearDraft: true,
    });
    expect(
      resolveSaveVersionFeedback({
        kind: 'duplicate',
        persisted: false,
      }),
    ).toEqual({
      message: versionCopy.VERSION_SAVE_STASH_FAIL_HINT,
      clearDraft: false,
    });
    expect(
      resolveSaveVersionFeedback({
        kind: 'duplicate',
        persisted: false,
      }).message,
    ).not.toBe(versionCopy.VERSION_DUPLICATE_HINT);
    expect(
      resolveSaveVersionFeedback({
        kind: 'duplicate',
        persisted: true,
      }),
    ).toEqual({
      message: versionCopy.VERSION_SAVED_TOAST,
      clearDraft: true,
    });

    expect(
      restoreOutcomeHint({ status: 'auto-save-failed', reason: 'blocked-full' }),
    ).toBe(versionCopy.VERSION_RESTORE_BLOCKED_FULL_HINT);
    expect(restoreOutcomeHint({ status: 'auto-save-failed' })).toBe(
      versionCopy.VERSION_AUTO_SAVE_FAIL_TOAST,
    );

    const evictedRestoreOutcome: VersionRestoreOutcome = {
      status: 'restored',
      snapshot: {
        projectId: 'p1',
        chapterId: 'c1',
        targetVersionId: 'v1',
        autoSavedVersionId: 'v-auto',
        beforeContent: 'a',
        afterContent: 'b',
      },
      autoSave: {
        kind: 'saved',
        version: createManuscriptVersion({
          version_id: 'v-auto',
          chapter_id: 'c1',
          content: 'a',
          source: 'auto-before-restore',
          saved_at_ms: 1_764_100_000_000,
        }),
        versions: [],
        evictedVersions: [],
        evictedCount: 1,
        overLimit: false,
        noticeCode: 'auto-saved-evicted-oldest',
        persisted: true,
      },
      overLimit: false,
    };
    expect(resolveVersionRestoreToast(evictedRestoreOutcome)).toBe(
      versionCopy.VERSION_EVICTED_HINT,
    );
    expect(
      resolveVersionRestoreToast({
        ...evictedRestoreOutcome,
        overLimit: true,
      }),
    ).toBe(versionCopy.VERSION_RESTORE_OVER_LIMIT_TOAST);
  });
});
