/**
 * WO-130 乙段畫面、四版面、三主題與無障礙守衛測試：
 * - SaveHeaderStatus 五種狀態文字、ARIA 與與 WO-98 StaleSaveReminder 互斥單列
 * - EditorPane 在四種版面（phone-portrait／phone-landscape／medium／wide）輸出完全一致的 DOM 結構
 * - SaveReminderDialog 無障礙屬性、Esc／Tab 繞圈／焦點移入標題與還原、與 WhatsNew／歡迎導覽互斥
 * - saveReminder.css 觸控熱區 ≥ 44px 與主題色票守衛
 * - 臺灣繁體中文與禁用術語守衛
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_FAILED_ARIA,
  AUTOSAVE_FAILED_BADGE,
  AUTOSAVE_FAILED_TOAST,
  AUTOSAVE_RESUMED_TOAST,
  AUTOSAVE_RESUME_ARIA,
  AUTOSAVE_RESUME_BADGE,
  AUTOSAVE_UNSAVED_BADGE,
  SAVE_REMINDER_BODY_CHANGED,
  SAVE_REMINDER_BODY_UNSAVED,
  SAVE_REMINDER_LATER,
  SAVE_REMINDER_SAVE_NOW,
  SAVE_REMINDER_TITLE,
  autosaveUnsavedAria,
  autosavedAtLabel,
  lastFileSavedLabel,
} from '../copy/userFacing';
import type { ChapterNode } from '../data/demo';
import { LayoutProvider, type LayoutMode } from '../layout';
import { EditorPane } from '../screens/EditorPane';
import { createState, reduce, SampleProvider, type SampleState } from '../state/sampleStore';
import { firstFileNode } from '../state/testing/firstFile';
import { SaveHeaderStatus } from './SaveHeaderStatus';
import { SaveReminderDialog, saveReminderDialogTabTarget } from './SaveReminderDialog';

const MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];

function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .match(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `找不到樣式規則 ${selector}`).not.toBeNull();
  return match![1]!;
}

function makeNonSampleBookState(options?: { savedAtMs?: number; startedMs?: number }): {
  state: SampleState;
  projectId: string;
  chapter: ChapterNode;
} {
  const nowMs = Date.parse('2026-11-21T04:50:00Z');
  const id = 'p-1763697600000';
  let state = createState(new Date(nowMs));
  state = reduce(state, {
    type: 'add-project',
    id,
    title: '【範例】四版面測試稿',
    shape: 'novel',
    startedMs: options?.startedMs ?? nowMs,
  });
  state = reduce(state, { type: 'focus-project', id });
  const chapter = firstFileNode(state.projects.find((p) => p.id === id)!.nodes)!;
  state = reduce(state, {
    type: 'commit-text',
    projectId: id,
    nodeId: chapter.id,
    text: '【範例】測試正文內容',
  });
  if (options?.savedAtMs != null) {
    state = reduce(state, { type: 'record-project-save', projectId: id, atMs: options.savedAtMs });
  }
  const updatedChapter = firstFileNode(state.projects.find((p) => p.id === id)!.nodes)!;
  return { state, projectId: id, chapter: updatedChapter };
}

function normalizeThumbTreeButton(html: string): string {
  return html
    .replace(/(data-testid="thumb-tree-button"[^>]*?)aria-label="[^"]*"/g, '$1aria-label="TREE"')
    .replace(/aria-label="[^"]*"([^>]*?data-testid="thumb-tree-button")/g, 'aria-label="TREE"$1');
}

function renderEditor(state: SampleState, projectId: string, chapter: ChapterNode, mode: LayoutMode): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: state },
      createElement(
        LayoutProvider,
        { initialMode: mode },
        createElement(
          MemoryRouter,
          { initialEntries: [`/p/${projectId}/write/${chapter.id}`] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/p/:projectId/write/:chapterId',
              element: createElement(EditorPane, { projectId, chapter }),
            }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-130 乙段：頁首存檔標示狀態與四版面 DOM 恆定', () => {
  it('SaveHeaderStatus 正確輸出權限恢復、失敗、未存過、已自動存檔時間、上次存檔時間與隱藏狀態', () => {
    const now = new Date('2026-11-21T10:30:00');
    const savedToday = new Date('2026-11-21T09:05:00').getTime();
    const savedEarlier = new Date('2026-11-19T21:15:00').getTime();

    const resumeHtml = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: 'needs-permission',
        canPickFiles: true,
        lastFileSaveMs: savedToday,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        onResumeAutoSave: () => {},
        onSave: () => {},
        now,
      }),
    );
    expect(resumeHtml).toContain('data-testid="save-header-status"');
    expect(resumeHtml).toContain('data-save-header-kind="needs-permission"');
    expect(resumeHtml).toContain(`aria-label="${AUTOSAVE_RESUME_ARIA}"`);
    expect(resumeHtml).toContain(`>${AUTOSAVE_RESUME_BADGE}</button>`);

    const failedHtml = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: 'failed',
        canPickFiles: true,
        lastFileSaveMs: savedToday,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        onResumeAutoSave: () => {},
        onSave: () => {},
        now,
      }),
    );
    expect(failedHtml).toContain('data-save-header-kind="failed"');
    expect(failedHtml).toContain(`aria-label="${AUTOSAVE_FAILED_ARIA}"`);
    expect(failedHtml).toContain(`>${AUTOSAVE_FAILED_BADGE}</button>`);

    const unsavedDesktop = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: 'unsaved',
        canPickFiles: true,
        lastFileSaveMs: null,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        onResumeAutoSave: () => {},
        onSave: () => {},
        now,
      }),
    );
    expect(unsavedDesktop).toContain('data-save-header-kind="unsaved"');
    expect(unsavedDesktop).toContain(`aria-label="${autosaveUnsavedAria(true)}"`);
    expect(unsavedDesktop).toContain(`>${AUTOSAVE_UNSAVED_BADGE}</button>`);

    const unsavedMobile = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: 'unsaved',
        canPickFiles: false,
        lastFileSaveMs: null,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        onResumeAutoSave: () => {},
        onSave: () => {},
        now,
      }),
    );
    expect(unsavedMobile).toContain(`aria-label="${autosaveUnsavedAria(false)}"`);

    const autoTimeHtml = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: 'time',
        canPickFiles: true,
        lastFileSaveMs: savedToday,
        autoSaveActive: true,
        lastSaveWasAuto: true,
        onResumeAutoSave: () => {},
        onSave: () => {},
        now,
      }),
    );
    expect(autoTimeHtml).toContain('<span');
    expect(autoTimeHtml).toContain(`>${autosavedAtLabel('09:05')}</span>`);

    const manualTimeHtml = renderToStaticMarkup(
      createElement(SaveHeaderStatus, {
        kind: 'time',
        canPickFiles: false,
        lastFileSaveMs: savedEarlier,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        onResumeAutoSave: () => {},
        onSave: () => {},
        now,
      }),
    );
    expect(manualTimeHtml).toContain('<span');
    expect(manualTimeHtml).toContain(`>${lastFileSavedLabel('11月19日（四） 21:15')}</span>`);

    expect(
      renderToStaticMarkup(
        createElement(SaveHeaderStatus, {
          kind: 'none',
          canPickFiles: true,
          lastFileSaveMs: null,
          autoSaveActive: false,
          lastSaveWasAuto: false,
          onResumeAutoSave: () => {},
          onSave: () => {},
          now,
        }),
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        createElement(SaveHeaderStatus, {
          kind: 'stale',
          canPickFiles: true,
          lastFileSaveMs: null,
          autoSaveActive: false,
          lastSaveWasAuto: false,
          onResumeAutoSave: () => {},
          onSave: () => {},
          now,
        }),
      ),
    ).toBe('');
  });

  it('EditorPane 四種版面輸出完全一致的 DOM（含「還沒存成檔案」與已存檔時間），且與 WO-98 互斥不疊三列', () => {
    const unsaved = makeNonSampleBookState();
    const unsavedRenders = MODES.map((m) =>
      normalizeThumbTreeButton(renderEditor(unsaved.state, unsaved.projectId, unsaved.chapter, m)),
    );
    for (const html of unsavedRenders) {
      expect(html).toContain('has-save-reminder');
      expect(html).toContain('data-testid="save-header-status"');
      expect(html).toContain(AUTOSAVE_UNSAVED_BADGE);
      expect(html).not.toContain('data-testid="stale-save-reminder"');
      expect(html.split('data-testid="save-status"').length - 1).toBe(1);
    }
    expect(unsavedRenders[0]).toBe(unsavedRenders[1]);
    expect(unsavedRenders[0]).toBe(unsavedRenders[2]);
    expect(unsavedRenders[0]).toBe(unsavedRenders[3]);

    // 滿 3 天沒存檔時，頁首次列只留 WO-98 的 StaleSaveReminder，不疊加 SaveHeaderStatus
    const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
    const stale = makeNonSampleBookState({ startedMs: fourDaysAgo });
    const staleHtml = renderEditor(stale.state, stale.projectId, stale.chapter, 'phone-portrait');
    expect(staleHtml).toContain('data-testid="stale-save-reminder"');
    expect(staleHtml).not.toContain('data-testid="save-header-status"');
  });
});

describe('WO-130 乙段：溫和存檔提醒對話框無障礙、互斥與 CSS 守衛', () => {
  it('SaveReminderDialog 具備 dialog ARIA、標題 tabindex=-1、兩種提示主文與兩個按鈕', () => {
    const unsavedHtml = renderToStaticMarkup(
      createElement(SaveReminderDialog, {
        reason: 'unsaved',
        onSaveNow: () => {},
        onLater: () => {},
      }),
    );
    expect(unsavedHtml).toContain('role="presentation"');
    expect(unsavedHtml).toContain('data-testid="save-reminder-backdrop"');
    expect(unsavedHtml).toContain('role="dialog"');
    expect(unsavedHtml).toContain('aria-modal="true"');
    expect(unsavedHtml).toContain('aria-labelledby="save-reminder-title"');
    expect(unsavedHtml).toMatch(/<h2[^>]*id="save-reminder-title"[^>]*tabindex="-1"[^>]*>要不要先存一份？<\/h2>/);
    expect(unsavedHtml).toContain(SAVE_REMINDER_BODY_UNSAVED);
    expect(unsavedHtml).toContain(SAVE_REMINDER_SAVE_NOW);
    expect(unsavedHtml).toContain(SAVE_REMINDER_LATER);

    const changedHtml = renderToStaticMarkup(
      createElement(SaveReminderDialog, {
        reason: 'changed',
        onSaveNow: () => {},
        onLater: () => {},
      }),
    );
    expect(changedHtml).toContain(SAVE_REMINDER_BODY_CHANGED);
  });

  it('Tab 繞圈、Esc 監聽、焦點移入與還原、EditorPane 禮讓 WhatsNew 與禁止 Escape 字串', () => {
    expect(saveReminderDialogTabTarget(2, 1, false)).toBe(0);
    expect(saveReminderDialogTabTarget(2, 0, true)).toBe(1);
    expect(saveReminderDialogTabTarget(2, 0, false)).toBeNull();
    expect(saveReminderDialogTabTarget(2, -1, false)).toBe(0);
    expect(saveReminderDialogTabTarget(2, -1, true)).toBe(1);

    const dialogSrc = readFileSync(new URL('./SaveReminderDialog.tsx', import.meta.url), 'utf8');
    expect(dialogSrc).toContain("document.addEventListener('keydown', onKeyDown)");
    expect(dialogSrc).toContain("document.removeEventListener('keydown', onKeyDown)");
    expect(dialogSrc).toContain("event.key === 'Escape' && !event.isComposing");
    expect(dialogSrc).toContain('titleRef.current?.focus()');
    expect(dialogSrc).toContain('previousFocus.isConnected');
    expect(dialogSrc).toContain('previousFocus.focus()');
    expect(dialogSrc).toContain('saveReminderDialogTabTarget');

    const editorSrc = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    expect(editorSrc).toContain('isWhatsNewPending');
    expect(editorSrc).toContain('hasOpenDialog()');
    expect(editorSrc).toContain('isWelcomeTourActive');
    expect(editorSrc).toContain('savingFromReminderRef');
    expect(editorSrc).toContain('nextSaveReminderOpenReason');
    expect(editorSrc).toContain('isSaveOutcomeCompleted');
    expect(editorSrc).toContain('if (nextReason !== reminderOpenReason)');
    expect(editorSrc).toContain('.finally(');
    expect(editorSrc).not.toMatch(/['"]Escape['"]/);
    expect(editorSrc).not.toMatch(/['"]Esc['"]/);
  });

  it('saveReminder.css 所有互動按鈕觸控熱區 ≥ 44px，嚴守主題色票與層級規則', () => {
    const css = readFileSync(new URL('./saveReminder.css', import.meta.url), 'utf8');
    for (const selector of ['.editor .topbar .save-header-action', '.save-reminder-save,\n.save-reminder-later']) {
      const rule = cssBlock(css, selector);
      const minH = /min-height:\s*(\d+)px/.exec(rule);
      const minW = /min-width:\s*(\d+)px/.exec(rule);
      expect(minH, `${selector} min-height`).not.toBeNull();
      expect(minW, `${selector} min-width`).not.toBeNull();
      expect(Number(minH![1])).toBeGreaterThanOrEqual(44);
      expect(Number(minW![1])).toBeGreaterThanOrEqual(44);
    }

    const backdrop = cssBlock(css, '.save-reminder-backdrop');
    const zIndex = /z-index:\s*(\d+)/.exec(backdrop);
    expect(zIndex).not.toBeNull();
    expect(Number(zIndex![1])).toBeLessThan(350);

    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toContain('--hit-size');
    expect(stripped).not.toContain('--editor');
    expect(stripped).not.toContain('--warning');
    expect(stripped.toLowerCase()).not.toContain('rgba(');
    expect(stripped.toLowerCase()).not.toContain('#fff');
    expect(stripped).toContain('html[data-layout="phone-landscape"]');
    expect(stripped).toContain('html[data-layout="wide"]');
    expect(stripped).toContain('overflow-wrap: anywhere');
    expect(stripped).toContain('--safe-top');
    expect(stripped).toContain('--safe-bottom');
  });

  it('WO-130 新增與修改檔案嚴禁簡體字與禁用術語，userFacing 標註待九方審', () => {
    const simplifiedChars = new RegExp(
      '[' +
        '\\u7b80\\u4f53\\u8bf4\\u8d44\\u8fd9\\u4e3a\\u4e0e\\u4ece\\u5bf9\\u8fdb\\u8fc7\\u8fde\\u9009\\u95e8\\u95ee\\u95f4\\u70b9\\u8c01\\u8ba9\\u5c06\\u5219\\u867d\\u4ec5\\u5e76\\u65e0\\u4f1a\\u987b\\u8be5\\u5f53\\u7ecf\\u521a\\u4eec\\u6863\\u8bbe\\u6761\\u9635\\u65ad\\u9690\\u6682\\u8d5e\\u65f6\\u987a\\u5bbd\\u53cc\\u94ae\\u6d4f\\u89c8\\u50a8\\u8bb0\\u5fc6\\u663e\\u5220\\u5199\\u8bfb\\u5173\\u5f00\\u88c5\\u9879\\u5bfc\\u5f55\\u9519\\u8bef\\u786e\\u8ba4\\u9a8c\\u8bc1\\u6d4b\\u8bd5' +
        ']',
    );
    const forbiddenTerms = /Changelog|Release\s+Notes|更新日誌|版本歷程|彈窗/i;

    const userFacingSrc = readFileSync(new URL('../copy/userFacing.ts', import.meta.url), 'utf8');
    const wo130Section = userFacingSrc.slice(userFacingSrc.indexOf('WO-130'));
    expect(wo130Section).toContain('WO-130（暫定，待九方審）');

    const files = [
      ['autoSave.ts', readFileSync(new URL('../domain/autoSave.ts', import.meta.url), 'utf8')],
      ['saveReminder.ts', readFileSync(new URL('../domain/saveReminder.ts', import.meta.url), 'utf8')],
      ['SaveHeaderStatus.tsx', readFileSync(new URL('./SaveHeaderStatus.tsx', import.meta.url), 'utf8')],
      ['SaveReminderDialog.tsx', readFileSync(new URL('./SaveReminderDialog.tsx', import.meta.url), 'utf8')],
      ['saveReminder.css', readFileSync(new URL('./saveReminder.css', import.meta.url), 'utf8')],
      ['userFacing.ts (WO-130)', wo130Section],
    ] as const;

    for (const [name, content] of files) {
      expect(content, `${name} 不可含簡體字`).not.toMatch(simplifiedChars);
      expect(content, `${name} 不可含禁詞`).not.toMatch(forbiddenTerms);
    }

    for (const text of [
      AUTOSAVE_UNSAVED_BADGE,
      autosaveUnsavedAria(true),
      autosaveUnsavedAria(false),
      AUTOSAVE_RESUME_BADGE,
      AUTOSAVE_RESUME_ARIA,
      AUTOSAVE_FAILED_BADGE,
      AUTOSAVE_FAILED_ARIA,
      autosavedAtLabel('09:05'),
      lastFileSavedLabel('09:05'),
      SAVE_REMINDER_TITLE,
      SAVE_REMINDER_BODY_UNSAVED,
      SAVE_REMINDER_BODY_CHANGED,
      SAVE_REMINDER_SAVE_NOW,
      SAVE_REMINDER_LATER,
      AUTOSAVE_RESUMED_TOAST,
      AUTOSAVE_FAILED_TOAST,
    ]) {
      expect(text).not.toMatch(simplifiedChars);
      expect(text).not.toMatch(forbiddenTerms);
    }
  });
});
