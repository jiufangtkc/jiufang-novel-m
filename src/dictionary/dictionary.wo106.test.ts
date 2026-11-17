import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CardEditor } from '../components/CardEditor';
import { DictButton, DictOfflineNotice } from '../components/DictButton';
import { DICT_OFFLINE_NOTICE } from '../copy/dictionaryCopy';
import { createDictSelectionTracker } from './selectionTracker';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const cardSrc = read('../components/CardEditor.tsx');
const cardCss = read('../components/cardEditor.css');
const cardsScreenSrc = read('../screens/CardsScreen.tsx');
const drawerSrc = read('../components/WritingCardsDrawer.tsx');
const editorSrc = read('../screens/EditorPane.tsx');

const card = { id: 'c1', title: '假資料標題', content: '假資料內容：搭車票出門。', color: '#61afef' };

function editorHtml(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(CardEditor, {
      card,
      onSave: () => {},
      onDone: () => {},
      initialMode: 'edit',
      ...extra,
    } as never),
  );
}

describe('WO-106：卡片編輯接線（結構）', () => {
  it('只有「內容」textarea 綁選取；標題 input 不綁', () => {
    expect(cardSrc.match(/ref=\{contentRef\}/g)).toHaveLength(1);
    expect(cardSrc).toContain("useDictSelection('card', contentRef");
    // 標題 input 區塊不含 ref 或 dict
    const titleBlocks = cardSrc.match(/<input[\s\S]*?\/>/g) ?? [];
    expect(titleBlocks.length).toBeGreaterThanOrEqual(2);
    for (const b of titleBlocks) {
      expect(b).not.toMatch(/ref=|dict/i);
    }
  });
  it('寫作頁抽屜與資料集頁共用同一個 CardEditor，沒有另做一套', () => {
    expect(drawerSrc).toContain('CardEditor');
    expect(cardsScreenSrc).toContain('CardEditor');
    expect(drawerSrc).not.toContain('DictButton');
    expect(cardsScreenSrc).not.toContain('DictButton');
  });
  it('編輯模式：標題列有右端容器與提示容器；沒選字時沒有按鈕', () => {
    const html = editorHtml();
    expect(html).toContain('card-editor-header-end');
    expect(html).toContain('data-testid="card-dict-offline-notice"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('card-dict-button');
    // 提示在標題列（header）之內，即標題列下方
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(header).toContain('card-dict-offline-notice');
  });
  it('既有按鈕與已存提示不受影響', () => {
    const html = editorHtml({ savedNotice: '已儲存' });
    for (const id of ['card-editor-cancel-btn', 'card-editor-done-btn', 'card-editor-color-btn', 'card-editor-saved-hint', 'card-editor-title-input', 'card-editor-content-textarea']) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(html).toContain('編輯卡片');
  });
  it('預覽模式沒有查字典元件；各版面編輯都有', () => {
    expect(editorHtml({ initialMode: 'preview' })).not.toContain('card-dict-offline-notice');
    for (const layoutMode of ['phone-portrait', 'phone-landscape', 'medium', 'wide']) {
      expect(editorHtml({ layoutMode })).toContain('card-dict-offline-notice');
    }
  });
  it('內容 textarea 的值原文不變', () => {
    expect(editorHtml()).toContain('假資料內容：搭車票出門。');
  });
});

describe('WO-106：按鈕畫面與朗讀（卡片）', () => {
  const btn = (word: string) =>
    renderToStaticMarkup(
      createElement(DictButton, {
        word,
        placement: 'card',
        onPointerDown: () => {},
        onPress: () => 'opened' as const,
        onOffline: () => {},
      }),
    );
  it('朗讀同 F-2，念完整的詞', () => {
    expect(btn('車票')).toContain('aria-label="查字典，車票。會在新分頁開教育部辭典"');
    const h = btn('狐狸沒有');
    expect(h).toContain('狐狸…');
    expect(h).toContain('aria-label="查字典，狐狸沒有。會在新分頁開教育部辭典"');
  });
  it('card 版型 class；高 44 寬 ≥44 由共用 .dict-button 規則提供', () => {
    expect(btn('車票')).toContain('dict-button is-card');
    expect(read('../screens/focusMode.css')).toMatch(/\.dict-button \{[^}]*height: 44px;[^}]*min-width: 44px/);
  });
  it('提示同一句、role=status、不用 toast', () => {
    const h = renderToStaticMarkup(createElement(DictOfflineNotice, { visible: true, placement: 'card' }));
    expect(h).toContain(DICT_OFFLINE_NOTICE);
    expect(h).toContain('role="status"');
    expect(h).not.toContain('toast');
  });
  it('CSS：提示在標題列下方、左右 12、不推動版面', () => {
    expect(cardCss).toMatch(/\.card-editor-header \.dict-offline-notice\[data-visible="true"\] \{[^}]*position: absolute;[^}]*left: 12px;[^}]*right: 12px;[^}]*top: calc\(100% \+ 4px\)/);
    expect(cardCss).toMatch(/\.card-editor-header \{[^}]*position: relative/);
  });
});

describe('WO-106：選取互斥與判定（tracker）', () => {
  it('卡片內容選合格字：來源 card、可查；正文頁首看不到（只認 body）', () => {
    const t = createDictSelectionTracker();
    t.update({ source: 'card', focused: true, value: '搭車票出門', selectionStart: 1, selectionEnd: 3 });
    const s = t.getState();
    expect(s.source).toBe('card');
    expect(s.canLookup).toBe(true);
    expect(s.word).toBe('車票');
    // 與 useDictSelection 相同：visible = canLookup && source===自己
    expect(s.canLookup && s.source === 'body').toBe(false);
    expect(s.canLookup && s.source === 'card').toBe(true);
  });
  it('11 字、跨段、組字中都不可查', () => {
    const t = createDictSelectionTracker();
    t.update({ source: 'card', focused: true, value: '一二三四五六七八九十甲', selectionStart: 0, selectionEnd: 11 });
    expect(t.getState().canLookup).toBe(false);
    t.update({ source: 'card', focused: true, value: '車\n票', selectionStart: 0, selectionEnd: 3 });
    expect(t.getState().canLookup).toBe(false);
    t.update({ source: 'card', focused: true, value: '車票', selectionStart: 0, selectionEnd: 2 });
    expect(t.getState().canLookup).toBe(true);
    t.compositionStart('card');
    expect(t.getState().canLookup).toBe(false);
    t.compositionEnd('card');
    t.update({ source: 'card', focused: true, value: '車票', selectionStart: 0, selectionEnd: 2 });
    expect(t.getState().canLookup).toBe(true);
  });
  it('正文有舊選取時，卡片內容選字只跟卡片；回正文再換回', () => {
    const t = createDictSelectionTracker();
    t.update({ source: 'body', focused: true, value: '搭車票出門', selectionStart: 1, selectionEnd: 3 });
    t.blur('body');
    t.update({ source: 'card', focused: true, value: '燈塔守夜', selectionStart: 0, selectionEnd: 2 });
    expect(t.getState().source).toBe('card');
    expect(t.getState().word).toBe('燈塔');
    t.update({ source: 'body', focused: true, value: '搭車票出門', selectionStart: 1, selectionEnd: 3 });
    expect(t.getState().source).toBe('body');
  });
  it('按下：先暫存、有網路同步 window.open 一次、noopener、原文不換字；離線不開窗', () => {
    const t = createDictSelectionTracker();
    t.update({ source: 'card', focused: true, value: '台幣', selectionStart: 0, selectionEnd: 2 });
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', { onLine: true });
    t.beginPress(); // 與按鈕 pointerdown 相同
    t.blur('card'); // 按下時輸入框已失焦，仍用暫存
    expect(t.press()).toBe('opened');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      `https://dict.revised.moe.edu.tw/search.jsp?md=1&word=${encodeURIComponent('台幣')}`,
      '_blank',
      'noopener',
    );
    vi.stubGlobal('navigator', { onLine: false });
    expect(t.press()).toBe('offline');
    expect(open).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it('寫作頁頁首只認 body 來源（卡片選字時頁首不出現）', () => {
    expect(editorSrc).toContain("useDictSelection('body', ref)");
  });
});
