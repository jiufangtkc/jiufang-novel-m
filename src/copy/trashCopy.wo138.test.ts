import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormatLayer, type FormatTools } from '../components/FormatTools';
import { TrashCornerNotice } from '../components/TrashCornerNotice';
import * as trashCopy from './trashCopy';

const SIMPLIFIED_CHARS = /[删暂记说这为没现还进时请标样]/u;
const FORBIDDEN_PHRASE = '這台' + '裝置';

describe('WO-138 第 5 段：刪稿暫存區暫定用字與選單／角落提示驗證', () => {
  it('全部暫定用字常數與函式皆逐字對齊技術規劃 7.2', () => {
    expect(trashCopy.TRASH_MENU_OPEN).toBe('刪稿暫存區');
    expect(trashCopy.TRASH_MENU_MOVE_SELECTION).toBe('移到刪稿暫存區');
    expect(trashCopy.trashMenuBadge(3)).toBe('3 則');
    expect(trashCopy.TRASH_SHEET_TITLE).toBe('刪稿暫存區');
    expect(trashCopy.TRASH_CLOSE_ARIA).toBe('關閉刪稿暫存區');
    expect(trashCopy.TRASH_CLOSE_LABEL).toBe('關閉');
    expect(trashCopy.TRASH_BACK_LABEL).toBe('返回');
    expect(trashCopy.TRASH_EMPTY_HINT).toBe('還沒有刪掉的段落。');
    expect(trashCopy.TRASH_CORNER_ADDED).toBe('已放到刪稿暫存區');
    expect(trashCopy.TRASH_CORNER_VIEW).toBe('查看');
    expect(trashCopy.TRASH_CORNER_CLOSE_ARIA).toBe('關閉刪稿提示');
    expect(trashCopy.trashCornerAddedWithEvict(1)).toBe(
      '已放到刪稿暫存區，並清掉最舊的一則未註記刪稿',
    );
    expect(trashCopy.trashCornerAddedWithEvict(3)).toBe(
      '已放到刪稿暫存區，並清掉最舊的 3 則未註記刪稿',
    );
    expect(trashCopy.TRASH_CORNER_BLOCKED_FULL).toBe(
      '刪稿暫存區已經滿了，且每一則都有寫原因，請先整理',
    );
    expect(trashCopy.TRASH_CORNER_BLOCKED_EXCEEDS_MAX_WORDS).toBe(
      '這段超過 50,000 字上限，放不進刪稿暫存區',
    );
    expect(trashCopy.trashBlockedMessage('all-annotated')).toBe(
      trashCopy.TRASH_CORNER_BLOCKED_FULL,
    );
    expect(trashCopy.trashBlockedMessage('exceeds-max-words')).toBe(
      trashCopy.TRASH_CORNER_BLOCKED_EXCEEDS_MAX_WORDS,
    );
    expect(trashCopy.trashUsageSummary(12, 1234)).toBe('已存 12／50 則 · 1,234／50,000 字');
    expect(trashCopy.TRASH_LIMIT_NEAR_HINT).toBe(
      '快滿了。滿了會先清掉最舊、沒寫原因的刪稿；有寫原因的會留著。',
    );
    expect(trashCopy.TRASH_LIMIT_FULL_EVICTABLE_HINT).toBe(
      '已經滿了。下次有新刪稿時，會先清掉最舊、沒寫原因的那則。',
    );
    expect(trashCopy.TRASH_LIMIT_FULL_LOCKED_HINT).toBe(
      '已經滿了，而且每一則都有寫原因。新的刪稿放不進來，請先整理幾則。',
    );
    expect(trashCopy.TRASH_NEWER_REVISION_HINT).toBe(
      '這份稿子的刪稿暫存區來自較新版本，目前先原樣保留，請更新後再查看與管理。',
    );
    expect(trashCopy.TRASH_CORRUPT_HINT).toBe(
      '這份稿子的刪稿暫存區資料有損壞，正文不受影響，目前無法修改暫存區。',
    );
    expect(trashCopy.trashItemWords(1200)).toBe('1,200 字');
    expect(trashCopy.trashOriginalChapterGone('第三章')).toBe('第三章（原章已不在）');
    expect(trashCopy.trashOriginalChapterGone('')).toBe('原章（原章已不在）');
    expect(trashCopy.TRASH_DETAIL_CONTENT_ARIA).toBe('刪稿全文');
    expect(trashCopy.TRASH_REASON_LABEL).toBe('當時為什麼刪（選填）');
    expect(trashCopy.TRASH_REASON_PLACEHOLDER).toBe('想記的話寫在這裡，隨時可改');
    expect(trashCopy.TRASH_REASON_SAVE).toBe('記下原因');
    expect(trashCopy.TRASH_REASON_SAVED_TOAST).toBe('已記下原因');
    expect(trashCopy.TRASH_PUT_BACK_BUTTON).toBe('放回原章');
    expect(trashCopy.TRASH_PICK_CHAPTER_BUTTON).toBe('選一章放回');
    expect(trashCopy.TRASH_PICK_CHAPTER_TITLE).toBe('原來的章已經不在');
    expect(trashCopy.TRASH_PICK_CHAPTER_HINT).toBe(
      '請選一個現有的章放進去，不會另外新建章節。',
    );
    expect(trashCopy.TRASH_NO_CHAPTER_AVAILABLE).toBe(
      '這份稿子現在沒有章可以放，請先回目錄新增一章。',
    );
    expect(trashCopy.TRASH_PUT_BACK_ORIGINAL_TOAST).toBe('已放回原來的位置');
    expect(trashCopy.TRASH_PUT_BACK_END_TOAST).toBe('原位置已經變了，已放在本章最末');
    expect(trashCopy.trashPutBackPickedToast('第一章')).toBe('已放在「第一章」最末');
    expect(trashCopy.trashSceneTargetLabel('第一章', '第一幕')).toBe('第一章 ／ 第一幕');
    expect(trashCopy.TRASH_COMPOSING_TOAST).toBe('先把正在輸入的字打完，再放回刪稿。');
    expect(trashCopy.TRASH_DISCARD_BUTTON).toBe('丟掉');
    expect(trashCopy.TRASH_DISCARD_CONFIRM_TITLE).toBe('要丟掉這則刪稿嗎？');
    expect(trashCopy.TRASH_DISCARD_CONFIRM_HINT).toBe('丟掉後 10 秒內可以按「復原」。');
    expect(trashCopy.TRASH_DISCARD_CONFIRM_OK).toBe('丟掉');
    expect(trashCopy.TRASH_DISCARD_CANCEL).toBe('取消');
    expect(trashCopy.TRASH_DISCARDED_BAR).toBe('已丟掉這則刪稿');
    expect(trashCopy.TRASH_UNDO_BUTTON).toBe('復原');
    expect(trashCopy.TRASH_RESTORED_TOAST).toBe('已放回刪稿暫存區');
  });

  it('全部用字遵守臺灣繁體中文（無簡體字、無「您」、無「這台＋裝置」、無「彈窗」）', () => {
    const texts: string[] = [];
    for (const value of Object.values(trashCopy)) {
      if (typeof value === 'string') {
        texts.push(value);
      } else if (typeof value === 'function') {
        texts.push(value(1 as never, 120 as never));
        texts.push(value(3 as never, 12345 as never));
        texts.push(value('範例章' as never, 120 as never));
      }
    }
    for (const text of texts) {
      expect(text).not.toMatch(SIMPLIFIED_CHARS);
      expect(text).not.toContain('您');
      expect(text).not.toContain(FORBIDDEN_PHRASE);
      expect(text).not.toContain('彈窗');
    }
  });

  it('不與 userFacing.ts 既有 FORMAT_／format 鍵衝突，且新元件不硬寫未納入 copy 的中文', () => {
    for (const key of Object.keys(trashCopy)) {
      expect(key).not.toMatch(/^FORMAT_|^format/);
    }
    const noticeSrc = readFileSync(
      new URL('../components/TrashCornerNotice.tsx', import.meta.url),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(noticeSrc).not.toMatch(/[㐀-鿿　-〿＀-￯]/u);
    expect(noticeSrc).toContain("from '../copy/trashCopy'");
  });

  it('FormatLayer 支援 extraMenuItems（排在排版旁且支援筆數小字與選取送入），TrashCornerNotice 可點擊', () => {
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

    const menuHtml = renderToStaticMarkup(
      createElement(FormatLayer, {
        tools: toolsStub,
        extraMenuItems: [
          {
            id: 'trash-open',
            label: trashCopy.TRASH_MENU_OPEN,
            badge: trashCopy.trashMenuBadge(2),
            onSelect: () => undefined,
          },
          {
            id: 'trash-move-selection',
            label: trashCopy.TRASH_MENU_MOVE_SELECTION,
            onSelect: () => undefined,
          },
        ],
      }),
    );

    const formatIdx = menuHtml.indexOf('data-testid="format-menu-item"');
    const openIdx = menuHtml.indexOf('data-testid="format-menu-trash-open"');
    const moveIdx = menuHtml.indexOf('data-testid="format-menu-trash-move-selection"');
    expect(formatIdx).toBeGreaterThan(-1);
    expect(openIdx).toBeGreaterThan(formatIdx);
    expect(moveIdx).toBeGreaterThan(openIdx);
    expect(menuHtml).toContain(trashCopy.TRASH_MENU_OPEN);
    expect(menuHtml).toContain('2 則');
    expect(menuHtml).toContain(trashCopy.TRASH_MENU_MOVE_SELECTION);

    const noticeHtml = renderToStaticMarkup(
      createElement(TrashCornerNotice, {
        message: trashCopy.TRASH_CORNER_ADDED,
        onOpen: () => undefined,
        onDismiss: () => undefined,
      }),
    );
    expect(noticeHtml).toContain('data-testid="trash-corner-notice"');
    expect(noticeHtml).toContain('data-testid="trash-corner-open"');
    expect(noticeHtml).toContain('data-testid="trash-corner-close"');
    expect(noticeHtml).toContain(trashCopy.TRASH_CORNER_ADDED);
    expect(noticeHtml).toContain(trashCopy.TRASH_CORNER_VIEW);

    const toolsCss = readFileSync(
      new URL('../components/formatTools.css', import.meta.url),
      'utf8',
    );
    expect(toolsCss).toMatch(/\.format-menu\s*\{[\s\S]*?width:\s*204px/);

    const trashCss = readFileSync(
      new URL('../components/trashSheet.css', import.meta.url),
      'utf8',
    );
    expect(trashCss).toMatch(/html\[data-focus-mode="true"\] \.trash-corner-notice/);
  });
});
