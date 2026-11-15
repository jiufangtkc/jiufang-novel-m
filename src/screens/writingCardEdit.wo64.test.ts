import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { savedCardToast } from '../copy/cardEditCopy';
import {
  placeLineExcerpt,
  writingPlaceLabel,
  writingPlaceSpoken,
} from '../copy/writingCardEditCopy';
import { CARDS_READONLY_BADGE } from '../copy/userFacing';
import { WritingCardsDrawer } from '../components/WritingCardsDrawer';
import { SampleProvider } from '../state/sampleStore';
import {
  endCardEdit,
  flushCardEdit,
  getCardEditSnapshot,
  registerBodyPrepare,
  registerCardEditFlush,
  resetCardEditSession,
  startCardEdit,
} from '../state/writingCardEditSession';

const OWN_CARDS = [
  {
    id: 'own-1',
    parent_id: null,
    category: 'character',
    title: '【範例】測試稿自己的角色',
    content: '這是這份測試稿自己的角色內容',
    color: '#3C3F41',
    is_collapsed: 0,
    sort_order: 1,
  },
];

vi.mock('../state/sampleStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/sampleStore')>();
  return {
    ...actual,
    useProject: (projectId: string | undefined) =>
      projectId === 'own-book'
        ? { id: 'own-book', title: '【範例】自己的測試稿', updatedLabel: '剛剛', bookGoal: 50000, nodes: [], cards: OWN_CARDS }
        : actual.useProject(projectId),
  };
});

function renderCard(): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      null,
      createElement(WritingCardsDrawer, {
        projectId: 'own-book',
        initialCategoryId: 'character',
        initialCardId: 'own-1',
        onClose: () => {},
        onOpenInDataset: () => {},
      }),
    ),
  );
}

afterEach(() => resetCardEditSession());

describe('WO-64：寫作位置文字與朗讀', () => {
  it('位置提示帶入章名與游標前的那行，朗讀把「・」換成「，」', () => {
    // 游標在「她推開門，風從背後」之後：那行共 11 字以上，只取最後 10 字
    const label = writingPlaceLabel('第三章', '開頭\n她推開門，風從背後灌進來', 12);
    expect(label).toBe('寫作位置已記住：第三章・她推開門，風從背後那行');
    expect(writingPlaceSpoken(label)).toBe(label.replace('・', '，'));
    expect(writingPlaceSpoken(label)).not.toContain('・');
  });

  it('太長的行取最後 10 字加「…」，空行寫「新的一行」', () => {
    expect(placeLineExcerpt('一二三四五六七八九十甲乙丙', 13)).toBe('…四五六七八九十甲乙丙那行');
    expect(placeLineExcerpt('上一行\n', 4)).toBe('新的一行');
  });

  it('存好提示：正常標題與空白標題', () => {
    expect(savedCardToast('【範例】白芷')).toBe('已存好「【範例】白芷」');
    expect(savedCardToast('  ')).toBe('已存好「未命名卡片」');
  });
});

describe('WO-64：編輯狀態與先存再離開', () => {
  it('開始編輯前先請正文收好組字並記住位置', () => {
    const prepare = vi.fn(() => '寫作位置已記住：第一章・新的一行');
    registerBodyPrepare(prepare);
    startCardEdit();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(getCardEditSnapshot().editing).toBe(true);
    expect(getCardEditSnapshot().placeLabel).toContain('第一章');
  });

  it('點正文、往下滑、關閉都走同一個「先存卡片」出口；沒在編輯就不動作', () => {
    const flush = vi.fn((kind) => endCardEdit(kind));
    registerCardEditFlush(flush);
    flushCardEdit('body');
    expect(flush).not.toHaveBeenCalled();
    startCardEdit();
    flushCardEdit('body');
    expect(flush).toHaveBeenCalledWith('body');
    expect(getCardEditSnapshot().editing).toBe(false);
    expect(getCardEditSnapshot().endKind).toBe('body');
    startCardEdit();
    flushCardEdit('close');
    expect(flush).toHaveBeenLastCalledWith('close');
    expect(getCardEditSnapshot().endSeq).toBe(2);
  });
});

describe('WO-64：看卡片內容層', () => {
  it('預覽有「編輯」「⋯」，沒有「只能看」', () => {
    const html = renderCard();
    expect(html).not.toContain(CARDS_READONLY_BADGE);
    expect(html).toContain('data-testid="card-editor-start-edit-btn"');
    expect(html).toContain('編輯');
    expect(html).toContain('data-testid="card-editor-more-btn"');
    expect(html).toContain('⋯');
  });

  it('編輯中用既有 CardEditor 的標題、顏色、內容與完成，並標記面板為編輯中', () => {
    startCardEdit();
    const html = renderCard();
    expect(html).toContain('data-card-editing="true"');
    expect(html).toContain('data-testid="card-editor-title-input"');
    expect(html).toContain('data-testid="card-editor-content-textarea"');
    expect(html).toContain('data-testid="card-editor-done-btn"');
    expect(html).toContain('這是這份測試稿自己的角色內容');
    expect(html).not.toContain(CARDS_READONLY_BADGE);
  });
});
