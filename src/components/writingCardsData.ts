import { DEMO_CARDS } from '../data/demoCards';
import type { DemoProject } from '../data/demo';
import type { FileCard } from '../db/projectFile';
import { DEFAULT_PROJECT_CATEGORY_ORDER_RAW } from '../data/demoCards';
import { isBuiltinSampleBook } from '../domain/builtinSampleBook';
import { resolveVisibleCategories, type ResolvedCategoryItem } from '../domain/cardCategories';
import {
  getProjectCards,
  getProjectCategorySettings,
  type SampleState,
} from '../state/sampleStore';

export interface WritingCardsData {
  cards: readonly FileCard[];
  categories: readonly ResolvedCategoryItem[];
  /** 是不是內建範例書；只有它才顯示「範例卡片」提示。 */
  isSample: boolean;
}

/**
 * WO-74：看卡片讀「目前這份稿子」的卡片與分類，與資料集同一份資料。
 * 讀取方式與資料集頁一致（只讀，不寫入）：內建範例書補入範例卡片，其他稿子只讀自己的卡片。
 */
export function readWritingCardsData(
  state: SampleState,
  projectId: string,
  project: DemoProject | null,
): WritingCardsData {
  // WO-95：只看真的存在的稿子；稿子不在（例如範例已清掉）時不補範例卡片。
  const isSample = isBuiltinSampleBook(project);
  let cards: readonly FileCard[];
  if (project?.origin === 'file') {
    cards = project.cards ?? getProjectCards(state, projectId);
  } else if (isSample) {
    const base = project?.cards && project.cards.length > 0 ? project.cards : DEMO_CARDS;
    const ids = new Set(base.map((c) => c.id));
    const extra = DEMO_CARDS.filter((c) => !ids.has(c.id));
    cards = extra.length > 0 ? [...base, ...extra] : base;
  } else {
    cards = project?.cards ?? getProjectCards(state, projectId);
  }

  const stored = getProjectCategorySettings(state, projectId);
  const categorySettings =
    project?.origin === 'file' && !project.categoryOrderRaw && !project.categoriesMetaRaw
      ? stored.categoryOrder || stored.categoriesMeta !== '{}'
        ? stored
        : {
            categoryOrder: DEFAULT_PROJECT_CATEGORY_ORDER_RAW,
            expandedCategories: null,
            categoriesMeta: '{}',
          }
      : {
          categoryOrder:
            project?.categoryOrderRaw !== undefined ? project.categoryOrderRaw : stored.categoryOrder,
          categoriesMeta:
            project?.categoriesMetaRaw !== undefined ? project.categoriesMetaRaw : stored.categoriesMeta,
        };

  const categories = resolveVisibleCategories({
    categoryOrder: categorySettings.categoryOrder,
    categoriesMeta: categorySettings.categoriesMeta,
    cards,
  });
  return { cards, categories, isSample };
}
