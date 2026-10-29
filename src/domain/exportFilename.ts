/** 去掉檔名不允許的字元。 */
export function sanitizeDbBasename(title: string): string {
  const trimmed = title
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed.slice(0, 80) || '未命名';
}

/** 另存到雲端時的預設檔名：書名_YYYYMMDD-HHMM.db */
export function exportDbFilename(title: string, now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${sanitizeDbBasename(title)}_${stamp}.db`;
}

/** 儲存專案時的預設檔名：有原檔名就用原檔名，否則用書名.db。 */
export function projectSaveFilename(title: string, originalFilename?: string | null): string {
  const raw = originalFilename?.trim() ?? '';
  if (raw) {
    const cleaned = raw.replace(/[/\\:*?"<>|]/g, '').replace(/[\u0000-\u001f]/g, '').trim();
    if (cleaned) return cleaned.toLowerCase().endsWith('.db') ? cleaned : `${cleaned}.db`;
  }
  return `${sanitizeDbBasename(title)}.db`;
}

export function localDbFilename(title: string, importedName?: string): string {
  return projectSaveFilename(title, importedName);
}
