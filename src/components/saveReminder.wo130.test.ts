/**
 * WO-130／WO-131 乙段畫面、四版面、三主題與無障礙守衛測試：
 * - SaveHeaderStatus 五種狀態文字、ARIA 與 WO-98 StaleSaveReminder 互斥單列
 * - EditorPane 在四種版面（phone-portrait／phone-landscape／medium／wide）輸出完全一致的 DOM 結構，且不含整畫面提醒視窗
 * - saveReminder.css 觸控熱區 ≥ 44px、主題色票守衛，以及確認已清除提醒視窗樣式與程式
 * - 臺灣繁體中文與禁用術語守衛
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_FAILED_ARIA,
  AUTOSAVE_FAILED_BADGE,
  AUTOSAVE_FAILED_TOAST,
  AUTOSAVE_RESUMED_TOAST,
  AUTOSAVE_RESUME_ARIA,
  AUTOSAVE_RESUME_BADGE,
  AUTOSAVE_UNSAVED_BADGE,
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

const MODES: LayoutMode[] = ['phone-portrait', 'phone-landscape', 'medium', 'wide'];
const FIXED_NOW = new Date(2026, 10, 21, 10, 30, 0);
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function expectedClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function expectedEarlierDateTime(when: Date, now: Date): string {
  const month = when.getMonth() + 1;
  const day = when.getDate();
  const weekday = WEEKDAYS[when.getDay()];
  const datePart =
    when.getFullYear() === now.getFullYear()
      ? `${month}月${day}日（${weekday}）`
      : `${when.getFullYear()}年${month}月${day}日（${weekday}）`;
  return `${datePart} ${expectedClock(when)}`;
}

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
  const nowMs = Date.now();
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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SaveHeaderStatus 正確輸出權限恢復、失敗、未存過、已自動存檔時間、上次存檔時間與隱藏狀態', () => {
    const now = new Date();
    const savedTodayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5, 0);
    const savedToday = savedTodayDate.getTime();
    const savedEarlierDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 21, 15, 0);
    const savedEarlier = savedEarlierDate.getTime();

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
    expect(unsavedDesktop).toContain('class="save-header-slot"');
    expect(unsavedDesktop).toContain('data-save-header-kind="unsaved"');
    expect(unsavedDesktop).toContain(`aria-label="${autosaveUnsavedAria(true)}"`);
    expect(unsavedDesktop).toContain('<svg');
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
    expect(autoTimeHtml).toContain(`>${autosavedAtLabel(expectedClock(savedTodayDate))}</span>`);

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
    expect(manualTimeHtml).toContain(`>${lastFileSavedLabel(expectedEarlierDateTime(savedEarlierDate, now))}</span>`);

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
      expect(html).not.toContain('save-reminder-dialog');
      expect(html).not.toContain('save-reminder-backdrop');
      // WO-132 嚴-7：非範例書頁首已顯示外部存檔狀態，底列不再重複渲染第二份 save-status，專注底列亦採同一套說法。
      expect(html.split('data-testid="save-status"').length - 1).toBe(0);
      expect(html).not.toContain('今天還沒另存');
    }
    expect(unsavedRenders[0]).toBe(unsavedRenders[1]);
    expect(unsavedRenders[0]).toBe(unsavedRenders[2]);
    expect(unsavedRenders[0]).toBe(unsavedRenders[3]);

    // 不支援自動存檔的瀏覽器（canPickLocalFiles() === false）在已存過檔時，四版面同樣顯示「上次存檔 時間」且 DOM 一致
    const saved = makeNonSampleBookState({ savedAtMs: Date.now() - 60 * 60 * 1000 });
    const savedRenders = MODES.map((m) =>
      normalizeThumbTreeButton(renderEditor(saved.state, saved.projectId, saved.chapter, m)),
    );
    for (const html of savedRenders) {
      expect(html).toContain('has-save-reminder');
      expect(html).toContain('data-testid="save-header-status"');
      expect(html).toContain('data-save-header-kind="time"');
      expect(html).toContain('上次存檔');
      expect(html).not.toContain('save-reminder-dialog');
      expect(html).not.toContain('save-reminder-backdrop');
    }
    expect(savedRenders[0]).toBe(savedRenders[1]);
    expect(savedRenders[0]).toBe(savedRenders[2]);
    expect(savedRenders[0]).toBe(savedRenders[3]);

    // 滿 3 天沒存檔時，頁首次列只留 WO-98 的 StaleSaveReminder，不疊加 SaveHeaderStatus
    const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
    const stale = makeNonSampleBookState({ startedMs: fourDaysAgo });
    const staleHtml = renderEditor(stale.state, stale.projectId, stale.chapter, 'phone-portrait');
    expect(staleHtml).toContain('data-testid="stale-save-reminder"');
    expect(staleHtml).not.toContain('data-testid="save-header-status"');
  });
});

describe('WO-130／WO-131 乙段：頁首標示 CSS、清除提醒視窗與繁體白話守衛', () => {
  it('saveReminder.css 頁首互動按鈕觸控熱區 ≥ 44px，嚴守主題色票並已移除提醒視窗樣式', () => {
    const css = readFileSync(new URL('./saveReminder.css', import.meta.url), 'utf8');
    const rule = cssBlock(css, '.editor .topbar .save-header-action');
    const minH = /min-height:\s*(\d+)px/.exec(rule);
    const minW = /min-width:\s*(\d+)px/.exec(rule);
    expect(minH, '.editor .topbar .save-header-action min-height').not.toBeNull();
    expect(minW, '.editor .topbar .save-header-action min-width').not.toBeNull();
    expect(Number(minH![1])).toBeGreaterThanOrEqual(44);
    expect(Number(minW![1])).toBeGreaterThanOrEqual(44);
    expect(rule).not.toContain('flex: 1 0 100%');
    expect(rule).toContain('width: auto');
    expect(rule).toContain('border: 0');
    expect(rule).toContain('background: transparent');
    expect(rule).toContain('font-size: 12px');

    const landscapeSlot = cssBlock(css, 'html[data-layout="phone-landscape"] .editor .topbar .save-header-slot');
    expect(landscapeSlot).toContain('order: 2');
    expect(landscapeSlot).toContain('flex: 0 0 auto');

    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toContain('.save-reminder-backdrop');
    expect(stripped).not.toContain('.save-reminder-dialog');
    expect(stripped).not.toContain('--hit-size');
    expect(stripped).not.toContain('--editor');
    expect(stripped).not.toContain('--warning');
    expect(stripped.toLowerCase()).not.toContain('rgba(');
    expect(stripped.toLowerCase()).not.toContain('#fff');
    expect(stripped).toContain('overflow-wrap: anywhere');
  });

  it('WO-130／WO-131 保留檔案嚴禁簡體字與禁用術語，已清除提醒視窗符號，userFacing 標註待九方審', () => {
    const simplifiedChars = new RegExp(
      '[' +
        '\\u7b80\\u4f53\\u8bf4\\u8d44\\u8fd9\\u4e3a\\u4e0e\\u4ece\\u5bf9\\u8fdb\\u8fc7\\u8fde\\u9009\\u95e8\\u95ee\\u95f4\\u70b9\\u8c01\\u8ba9\\u5c06\\u5219\\u867d\\u4ec5\\u5e76\\u65e0\\u4f1a\\u987b\\u8be5\\u5f53\\u7ecf\\u521a\\u4eec\\u6863\\u8bbe\\u6761\\u9635\\u65ad\\u9690\\u6682\\u8d5e\\u65f6\\u987a\\u5bbd\\u53cc\\u94ae\\u6d4f\\u89c8\\u50a8\\u8bb0\\u5fc6\\u663e\\u5220\\u5199\\u8bfb\\u5173\\u5f00\\u88c5\\u9879\\u5bfc\\u5f55\\u9519\\u8bef\\u786e\\u8ba4\\u9a8c\\u8bc1\\u6d4b\\u8bd5' +
        ']',
    );
    const forbiddenTerms = /Changelog|Release\s+Notes|更新日誌|版本歷程|彈窗/i;

    const userFacingSrc = readFileSync(new URL('../copy/userFacing.ts', import.meta.url), 'utf8');
    const wo130Section = userFacingSrc.slice(userFacingSrc.indexOf('WO-130'));
    expect(wo130Section).toContain('WO-130（暫定，待九方審）');
    expect(userFacingSrc).not.toContain('SAVE_REMINDER_');

    const editorSrc = readFileSync(new URL('../screens/EditorPane.tsx', import.meta.url), 'utf8');
    expect(editorSrc).not.toContain('SaveReminderDialog');
    expect(editorSrc).not.toContain('snoozeSaveReminder');
    expect(editorSrc).not.toContain('reminderSessions');
    expect(editorSrc).not.toContain('fromReminder');
    expect(editorSrc).not.toContain('savingFromReminder');

    const storeSrc = readFileSync(new URL('../state/sampleStore.tsx', import.meta.url), 'utf8');
    expect(storeSrc).not.toContain('reminderSessions');
    expect(storeSrc).not.toContain('snoozeSaveReminder');
    expect(storeSrc).not.toContain('fromReminder');

    const whatsNewHostSrc = readFileSync(new URL('../screens/WhatsNewHost.tsx', import.meta.url), 'utf8');
    expect(whatsNewHostSrc).not.toContain('isWhatsNewPending');

    const files = [
      ['autoSave.ts', readFileSync(new URL('../domain/autoSave.ts', import.meta.url), 'utf8')],
      ['SaveHeaderStatus.tsx', readFileSync(new URL('./SaveHeaderStatus.tsx', import.meta.url), 'utf8')],
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
      AUTOSAVE_RESUMED_TOAST,
      AUTOSAVE_FAILED_TOAST,
    ]) {
      expect(text).not.toMatch(simplifiedChars);
      expect(text).not.toMatch(forbiddenTerms);
    }
  });
});
