import { DEMO_PROJECTS } from '../data/demo';

const BUILTIN_SAMPLE_BOOK_IDS: ReadonlySet<string> = new Set(
  DEMO_PROJECTS.map((project) => project.id),
);

/**
 * WO-75：是不是 App 內建的範例書（如【範例】霧港紀事）。
 * 只看稿子的識別碼，且排除從檔案開啟的稿子；書名含「【範例】」不算。
 * 範例卡片提示（SAMPLE_CARDS_NOTICE）只在這種稿子出現。
 */
export function isBuiltinSampleBook(
  project: { id: string; origin?: string } | null | undefined,
): boolean {
  if (!project) return false;
  return project.origin !== 'file' && BUILTIN_SAMPLE_BOOK_IDS.has(project.id);
}
