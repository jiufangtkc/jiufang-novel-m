import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../db/migrations';
import * as copy from './userFacing';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** 去掉區塊與整行註解，只留程式碼（保守：不處理字串內含 // 的情形，本單檔案沒有）。 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('WO-122 暫定用字（待九方審定）逐字相符', () => {
  it('入口、選單、功能、範圍', () => {
    expect(copy.FORMAT_MORE_GLYPH).toBe('⋯');
    expect(copy.FORMAT_MORE_ARIA).toBe('更多');
    expect(copy.FORMAT_MENU_ITEM).toBe('排版');
    expect(copy.FORMAT_DIALOG_TITLE).toBe('排版');
    expect(copy.FORMAT_DIALOG_HINT).toBe('選一個排版方式。');
    expect(copy.FORMAT_KIND_INDENT).toBe('段首加兩個全形空格');
    expect(copy.FORMAT_KIND_STRIP_BLANK).toBe('去除空行');
    expect(copy.FORMAT_KIND_SPACE_PARAGRAPHS).toBe('段落之間加空行');
    expect(copy.FORMAT_SCOPE_TITLE).toBe('要改哪裡？');
    expect(copy.FORMAT_SCOPE_CHAPTER).toBe('這一章');
    expect(copy.FORMAT_SCOPE_BOOK).toBe('全書');
    expect(copy.FORMAT_BACK).toBe('上一步');
    expect(copy.FORMAT_KIND_GROUP_ARIA).toBe('排版方式');
    expect(copy.FORMAT_SCOPE_GROUP_ARIA).toBe('排版範圍');
  });

  it('確認視窗', () => {
    expect(copy.FORMAT_CONFIRM_TITLE).toBe('開始排版嗎？');
    expect(copy.formatConfirmSentence('這一章', '去除空行')).toBe(
      '要把這一章的正文做「去除空行」嗎？只改正文，改完可以復原。',
    );
    expect(copy.formatConfirmSentence('全書', '段落之間加空行')).toBe(
      '要把全書的正文做「段落之間加空行」嗎？只改正文，改完可以復原。',
    );
    expect(copy.FORMAT_CONFIRM_BOOK_NOTE).toBe('全書會一起改這本稿子裡所有章和幕的正文。');
    expect(copy.FORMAT_UNDO_WARNING).toBe('按「復原」會回到這次排版前，連排版後在這些正文新打的字也會一起還原。');
    expect(copy.FORMAT_CANCEL).toBe('取消');
    expect(copy.FORMAT_START).toBe('開始排版');
  });

  it('完成提示、復原與各種提示', () => {
    expect(copy.FORMAT_DONE).toBe('排版好了');
    expect(copy.FORMAT_UNDO_BUTTON).toBe('復原');
    expect(copy.FORMAT_UNDONE_TOAST).toBe('已回到排版前的樣子。');
    expect(copy.FORMAT_UNCHANGED_TOAST).toBe('已經是這個樣子，不用再改。');
    expect(copy.FORMAT_NO_TARGET_TOAST).toBe('先打開一章或一幕，再來排版。');
    expect(copy.FORMAT_COMPOSING_TOAST).toBe('先把正在輸入的字打完，再來排版。');
    expect(copy.FORMAT_STALE_TOAST).toBe('稿子或章節換了，請重新選一次排版。');
    expect(copy.FORMAT_UNDO_GONE_TOAST).toBe('這次排版的內容已經不在，沒辦法復原了。');
    expect(copy.FORMAT_NOTICE_CLOSE).toBe('關閉');
    expect(copy.FORMAT_NOTICE_CLOSE_ARIA).toBe('關閉排版提示');
  });

  it('不出現外部貼上被擋的提示，也沒有本單以外的新文案', () => {
    const formatKeys = Object.keys(copy).filter((key) => key.startsWith('FORMAT_') || key.startsWith('format'));
    for (const key of formatKeys) {
      const value = (copy as Record<string, unknown>)[key];
      const text = typeof value === 'function' ? (value as (a: string, b: string) => string)('甲', '乙') : String(value);
      expect(text).not.toContain('匯入已經存在的稿子');
    }
    expect(formatKeys.sort()).toEqual(
      [
        'FORMAT_BACK',
        'FORMAT_CANCEL',
        'FORMAT_COMPOSING_TOAST',
        'FORMAT_CONFIRM_BOOK_NOTE',
        'FORMAT_CONFIRM_TITLE',
        'FORMAT_DIALOG_HINT',
        'FORMAT_DIALOG_TITLE',
        'FORMAT_DONE',
        'FORMAT_KIND_GROUP_ARIA',
        'FORMAT_KIND_INDENT',
        'FORMAT_KIND_SPACE_PARAGRAPHS',
        'FORMAT_KIND_STRIP_BLANK',
        'FORMAT_MENU_ITEM',
        'FORMAT_MORE_ARIA',
        'FORMAT_MORE_GLYPH',
        'FORMAT_NOTICE_CLOSE',
        'FORMAT_NOTICE_CLOSE_ARIA',
        'FORMAT_NO_TARGET_TOAST',
        'FORMAT_SCOPE_BOOK',
        'FORMAT_SCOPE_CHAPTER',
        'FORMAT_SCOPE_GROUP_ARIA',
        'FORMAT_SCOPE_TITLE',
        'FORMAT_STALE_TOAST',
        'FORMAT_START',
        'FORMAT_UNCHANGED_TOAST',
        'FORMAT_UNDONE_TOAST',
        'FORMAT_UNDO_BUTTON',
        'FORMAT_UNDO_GONE_TOAST',
        'FORMAT_UNDO_WARNING',
        'formatConfirmSentence',
      ].sort(),
    );
  });
});

describe('WO-122 元件與流程的來源防護', () => {
  it('元件與流程程式碼內沒有硬寫的中文字串，用字全部由 userFacing 匯入', () => {
    for (const path of ['../components/FormatTools.tsx', '../editor/formatFlow.ts', '../editor/formatScope.ts']) {
      expect(code(read(path)), path).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
    }
    expect(read('../components/FormatTools.tsx')).toMatch(/from '\.\.\/copy\/userFacing'/);
  });

  it('排版流程不碰 paste／noteLarge／輸入事件', () => {
    for (const path of ['../components/FormatTools.tsx', '../editor/formatFlow.ts', '../editor/formatScope.ts', '../editor/formatText.ts']) {
      const src = code(read(path));
      expect(src, path).not.toMatch(/noteLarge|note-large|clipboard|beforeinput|dispatchEvent|InputEvent|insertFromPaste/i);
      expect(src, path).not.toMatch(/\.value\s*=/);
    }
  });

  it('replaceText 的同步路徑不經 process／noteLarge（維持與 WO-76 相同）', () => {
    const src = read('../editor/useWritingSurface.ts');
    const start = src.indexOf('replaceRef.current = (next');
    const end = src.indexOf('const onCompositionStart');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/noteLarge|process\(|setDirty/);
    expect(block).toMatch(/latest\.current = next/);
    expect(block).toMatch(/flush\(\)/);
    expect(block).toMatch(/if \(composing\.current\) return false/);
  });

  it('EditorPane：入口只在非專注模式產生、沒有直接寫 Escape、保留 WO-119 接線', () => {
    const src = read('../screens/EditorPane.tsx');
    expect(src).toMatch(/useFormatTools\(/);
    expect(src).toMatch(/!focusMode \? \(\s*<FormatMoreButton[^>]*format-more-topbar/);
    expect(src).toMatch(/!focusMode \? \(\s*<FormatMoreButton[^>]*format-more-landscape/);
    expect(src).toMatch(/useFocusEscape\(/);
    expect(src).not.toMatch(/['"]Escape['"]/);
  });

  it('EditorPane 不直接寫新的顯示字串（用字只在 userFacing）', () => {
    const src = read('../screens/EditorPane.tsx');
    for (const text of ['排版好了', '段首加兩個全形空格', '去除空行', '段落之間加空行', '開始排版', '復原']) {
      expect(src).not.toContain(text);
    }
  });

  it('專注模式 CSS 隱藏「⋯」、選單與提示；橫拿打字時浮動鈕移到左上', () => {
    const css = read('../components/formatTools.css');
    expect(css).toMatch(/html\[data-focus-mode="true"\] \.format-more-button[\s\S]*?display: none !important/);
    expect(css).toMatch(/html\[data-focus-mode="true"\] \.format-more-floating/);
    expect(css).toMatch(/html\[data-focus-mode="true"\] \.format-notice/);
    expect(css).toMatch(/html\.landscape-writing\[data-layout="phone-landscape"\] \.format-more-floating \{\s*top: 8px/);
    expect(css).toMatch(/html\[data-layout="phone-landscape"\] \.format-more-button \{\s*display: none/);
  });

  it('不改保護檔的內容關鍵（WO-118／WO-119 的接線仍在）', () => {
    expect(read('../screens/useFocusEscape.ts')).toMatch(/shouldExitFocusOnEscape/);
    expect(read('../editor/useWritingKeyboard.ts').length).toBeGreaterThan(0);
  });

  it('schema 維持 14，排版不新增儲存格式', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(14);
    const store = read('../state/sampleStore.tsx');
    expect(store).toMatch(/formatUndo\?: FormatSnapshot \| null/);
    // 快照不進 persistDeviceSaveRecord／saveProjects 的輸入
    const persist = store.slice(store.indexOf('export function persistDeviceSaveRecord'), store.indexOf('export function adoptExportEventsByFingerprint'));
    expect(persist).not.toMatch(/formatUndo/);
  });
});

describe('WO-122 返工：復原快照不因切分頁而清掉；寬版長章名不擠掉入口', () => {
  it('WriteScreen 卸載（切到統計／檔案／卡片）時不清排版復原快照', () => {
    const write = code(read('../screens/WriteScreen.tsx'));
    expect(write).not.toMatch(/clearFormatUndo/);
    // 清除只在 FormatTools（關提示、復原後）與 store 換稿時發生
    expect(code(read('../components/FormatTools.tsx'))).toMatch(/clearFormatUndo/);
    expect(code(read('../state/sampleStore.tsx'))).toMatch(/activeProjectId !== next\.formatUndo\.projectId/);
  });

  it('寬版主內容欄與寫作容器允許縮窄（min-width: 0），長章名才會先省略', () => {
    const css = read('../styles/global.css');
    const rule = css.match(/html\[data-layout="wide"\] \.workspace-body,\s*html\[data-layout="wide"\] \.write-layout \{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/min-width:\s*0/);
    const h1 = css.match(/\.topbar h1 \{([^}]*)\}/);
    expect(h1?.[1]).toMatch(/min-width:\s*0/);
    expect(h1?.[1]).toMatch(/text-overflow:\s*ellipsis/);
  });
});
