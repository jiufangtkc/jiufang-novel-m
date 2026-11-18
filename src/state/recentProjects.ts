import type { DemoProject } from '../data/demo';
import type { SaveMetaEntry } from './deviceSaveRecord';

/**
 * WO-84：首頁最近清單的顯示用合併。
 *
 * - 「同名」以首頁看得到的書名（project.title，去掉頭尾空白後逐字相同）為準，不做模糊比對。
 * - 同名只留一筆：最近一次「成功存下來」的那份。存下來只指另存（lastExportMs）、
 *   存回檔案（lastProjectSaveMs）；暫存到 App 空間（lastManualSaveMs）與自動暫存都不算，「最近開啟」「已在手機」「字數」也不當依據。
 * - 時間相同或都沒有紀錄時的備援：先留從檔案開回的那份（內容就是存下來的檔），
 *   再看最近清單的順序（排前面的留下）。這只是穩定備援，不代表存檔先後。
 * - 只決定首頁顯示，不刪底層專案、不動檔案。
 */
type SaveMetaMap = Record<string, Partial<SaveMetaEntry> | undefined>;

export function lastSuccessfulSaveMs(meta: Partial<SaveMetaEntry> | undefined): number {
  if (!meta) return -1;
  return Math.max(meta.lastExportMs ?? -1, meta.lastProjectSaveMs ?? -1);
}

export function recentDisplayProjects(
  projects: readonly DemoProject[],
  recentIds: readonly string[],
  saveMeta: SaveMetaMap,
): DemoProject[] {
  const listed = recentIds
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is DemoProject => project !== undefined);
  const winners = new Map<string, DemoProject>();
  for (const project of listed) {
    const key = project.title.trim();
    const current = winners.get(key);
    if (!current || beats(project, current, saveMeta)) winners.set(key, project);
  }
  // 照最近清單原本的順序輸出，每個書名只放代表那一筆。
  return listed.filter((project) => winners.get(project.title.trim()) === project);
}

function beats(candidate: DemoProject, current: DemoProject, saveMeta: SaveMetaMap): boolean {
  const a = lastSuccessfulSaveMs(saveMeta[candidate.id]);
  const b = lastSuccessfulSaveMs(saveMeta[current.id]);
  if (a !== b) return a > b;
  const aFile = candidate.origin === 'file';
  const bFile = current.origin === 'file';
  if (aFile !== bFile) return aFile;
  return false; // 完全平手：保留清單中排在前面的
}
