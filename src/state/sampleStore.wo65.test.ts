import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PROJECTS } from '../data/demo';
import { DEMO_CARDS } from '../data/demoCards';
import { createArchiveClient } from '../db/chapterArchive';
import type { FileCard } from '../db/projectFile';
import * as cardArchive from '../domain/cardArchive';
import { resolveVisibleCategories } from '../domain/cardCategories';
import { emptyArchive, type BookArchive } from '../domain/chapterVersions';
import {
  createState,
  deleteProjectCardWithArchive,
  getProjectCards,
  getProjectCategorySettings,
  reduce,
  restoreProjectCardFromArchive,
  type Action,
  type SampleState,
} from './sampleStore';

vi.mock('../domain/cardArchive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/cardArchive')>();
  return { ...actual, placeRecoveredCard: vi.fn(actual.placeRecoveredCard) };
});

const placeSpy = vi.mocked(cardArchive.placeRecoveredCard);

function memoryArchive() {
  const store = new Map<string, BookArchive>();
  return createArchiveClient({
    async read(bookId) {
      return structuredClone(store.get(bookId) ?? emptyArchive());
    },
    async write(bookId, archive) {
      store.set(bookId, structuredClone(archive));
    },
  });
}

/** 原本（WO-53）的放回結果：用來對照行為不變。 */
async function expectedRestore(state: SampleState, projectId: string, record: cardArchive.DeletedCardRecord, atEnd: boolean) {
  const actual = await vi.importActual<typeof import('../domain/cardArchive')>('../domain/cardArchive');
  const cards = getProjectCards(state, projectId);
  const settings = getProjectCategorySettings(state, projectId);
  const visible = resolveVisibleCategories({ categoryOrder: settings.categoryOrder, categoriesMeta: settings.categoriesMeta, cards }).map((c) => c.id);
  return actual.placeRecoveredCard(cards, record, { atEnd, validCategoryIds: visible });
}

beforeEach(() => {
  placeSpy.mockClear();
});
afterEach(() => {
  placeSpy.mockClear();
});

describe('WO-65：WO-53 之後改 2 項', () => {
  it('WO-65：恢復卡片的放回位置只在 reducer 計算一次，原位置、放到最後與歸檔結果與原行為相同', async () => {
    for (const atEnd of [false, true]) {
      let state = createState(new Date('2026-11-15T12:00:00Z'));
      const archive = memoryArchive();
      const dispatch = (action: Action) => {
        state = reduce(state, action);
      };
      const record = await deleteProjectCardWithArchive(state, dispatch, 'fog', '20000000-0000-4000-8000-000000000001', {
        archive,
        deletedAt: 1000,
        recordId: `del-once-${atEnd}`,
      });
      expect(record).not.toBeNull();
      const expected = await expectedRestore(state, 'fog', record!, atEnd);
      placeSpy.mockClear();

      const returned = await restoreProjectCardFromArchive(state, dispatch, 'fog', `del-once-${atEnd}`, { archive, atEnd });
      expect(placeSpy).toHaveBeenCalledTimes(1);
      // 呼叫端回傳契約：回傳放回後的完整卡片清單，與 store 內容一致
      expect(returned).toEqual(expected);
      expect(getProjectCards(state, 'fog')).toEqual(expected);
      expect((await archive.read('fog')).deletedCards).toEqual([]);
    }
  });

  it('WO-65：恢復前卡片清單已變時，reducer 依最新狀態重新計算，不用過時結果蓋掉期間修改', async () => {
    let state = createState(new Date('2026-11-15T12:00:00Z'));
    const archive = memoryArchive();
    const record = await deleteProjectCardWithArchive(
      state,
      (action) => {
        state = reduce(state, action);
      },
      'fog',
      '20000000-0000-4000-8000-000000000001',
      { archive, deletedAt: 2000, recordId: 'del-stale' },
    );
    const snapshot = state;
    // 期間另一張卡片被修改（呼叫端拿到的是修改前的快照）
    state = reduce(state, {
      type: 'update-card',
      projectId: 'fog',
      cardId: '20000000-0000-4000-8000-000000000004',
      patch: { title: '【範例】陸明遠（期間修改）' },
    });
    placeSpy.mockClear();
    await restoreProjectCardFromArchive(snapshot, (action) => {
      state = reduce(state, action);
    }, 'fog', record!, { archive });
    const cards = getProjectCards(state, 'fog');
    expect(cards.find((c) => c.id === '20000000-0000-4000-8000-000000000001')).toBeDefined();
    expect(cards.find((c) => c.id === '20000000-0000-4000-8000-000000000004')!.title).toBe('【範例】陸明遠（期間修改）');
    // 回傳值一次＋清單已變時 reducer 依最新狀態重算一次
    expect(placeSpy).toHaveBeenCalledTimes(2);
  });

  it('WO-65：範例書初始化深層複製：兩次 store、不同書與範例常數互不影響', () => {
    const constantsBefore = JSON.stringify(DEMO_PROJECTS);
    const cardsBefore = JSON.stringify(DEMO_CARDS);
    const first = createState(new Date());
    const second = createState(new Date());
    const fogA = first.projects.find((p) => p.id === 'fog')!;
    const fogB = second.projects.find((p) => p.id === 'fog')!;
    const otherA = first.projects.find((p) => p.id === 'second')!;

    // 直接改第一份的深層內容（章節正文、子節點、卡片）
    fogA.nodes[0]!.children![0]!.content = '【範例】只改第一份 store';
    fogA.nodes[0]!.title = '【範例】第一份改過的卷名';
    (fogA.cards as FileCard[])[0]!.title = '【範例】只改第一份的卡片';

    expect(fogB.nodes[0]!.children![0]!.content).not.toBe('【範例】只改第一份 store');
    expect(fogB.nodes[0]!.title).not.toBe('【範例】第一份改過的卷名');
    expect(fogB.cards![0]!.title).not.toBe('【範例】只改第一份的卡片');
    expect(otherA.cards![0]!.title).not.toBe('【範例】只改第一份的卡片');
    expect(JSON.stringify(DEMO_PROJECTS)).toBe(constantsBefore);
    expect(JSON.stringify(DEMO_CARDS)).toBe(cardsBefore);
    // 不同書的卡片物件也是各自一份
    expect(otherA.cards![0]).not.toBe(fogA.cards![0]);
    expect(fogA.nodes).not.toBe(DEMO_PROJECTS[0]!.nodes);
  });
});
