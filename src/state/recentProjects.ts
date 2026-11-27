import type { DemoProject } from '../data/demo';
import { isSameBook } from '../domain/duplicateOpen';

/**
 * WO-143 取代 WO-84：首頁最近清單不再把同名稿子收成一筆。
 *
 * - 照 recentIds 的順序列出所有稿子（只排除 projects 裡已不存在的代號），不刪底層專案、不動檔案。
 * - 書名（去掉頭尾空白後逐字相同）有 2 份以上時，每份多帶一個標示：
 *   與清單中另一份是同一本（isSameBook）→ 'same-book'；否則 'same-title'。沒有重名的稿子 badge 為 null，外觀不變。
 * - otherSameBookIds：清單裡「同一本」的其他份（給「留下這一份，刪掉同一本的其他份」用）。
 *   只含 isSameBook 的份，不含只是同名的別本。
 */
export type RecentBadge = 'same-book' | 'same-title' | null;

export interface RecentEntry {
  project: DemoProject;
  badge: RecentBadge;
  /** 重名時要多顯示的檔名；沒重名或沒有檔名時為 null。 */
  filename: string | null;
  /** 清單中同書名的其他份數（0 代表沒有重名）。 */
  sameTitleOthers: number;
  otherSameBookIds: string[];
}

export function recentListEntries(
  projects: readonly DemoProject[],
  recentIds: readonly string[],
): RecentEntry[] {
  const listed: DemoProject[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    if (seen.has(id)) continue;
    const project = projects.find((item) => item.id === id);
    if (project) {
      listed.push(project);
      seen.add(id);
    }
  }
  return listed.map((project) => {
    const others = listed.filter((item) => item !== project && item.title.trim() === project.title.trim());
    const otherSameBookIds = others.filter((item) => isSameBook(project, item)).map((item) => item.id);
    const badge: RecentBadge = others.length === 0 ? null : otherSameBookIds.length > 0 ? 'same-book' : 'same-title';
    return {
      project,
      badge,
      filename: others.length > 0 && project.filename ? project.filename : null,
      sameTitleOthers: others.length,
      otherSameBookIds,
    };
  });
}
