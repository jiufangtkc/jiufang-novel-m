/**
 * WO-129（暫定，待九方審）：改版說明資料檔（新版排最前面）。
 * 長期規則：每次上正式站附改版說明；新增功能升中間碼（0.3.0 → 0.4.0），
 * 修錯誤或小修升最後一碼（0.3.0 → 0.3.1）。
 */

export interface ReleaseNote {
  /** 對應 package.json 的版號（X.Y.Z，不寫 v）。 */
  readonly version: string;
  /** 給使用者看的臺灣繁體白話條列（每版至少 1 條）。 */
  readonly items: readonly string[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  // WO-138（暫定，待九方審）
  {
    version: '0.6.0',
    items: [
      '新增刪稿暫存區：改稿時一次刪掉較長的段落會先留下來，可註記當時為什麼刪，也能放回原來的章節',
      '這些刪稿會跟著稿子檔一起保存；打錯字的小刪除不會進去，避免存檔無謂變大',
    ],
  },
  // WO-137（暫定，待九方審）
  {
    version: '0.5.0',
    items: [
      '替每份稿子建立固定識別紀錄，方便日後重複開檔或跨裝置時認出同一部稿子（打開舊稿不會主動改寫原檔，等你下次儲存時才寫入）',
      '統一稿子附加資料的相容規則：電腦版可照常開啟新存的稿子，遇到新版新增的附加資料也會原樣保留，不影響正文、目錄與卡片',
    ],
  },
  // WO-135（暫定，待九方審）
  {
    version: '0.4.4',
    items: [
      '刪掉章節後按復原，時間線上連到這章的事件會一起接回來',
    ],
  },
  // WO-133（暫定，待九方審）
  {
    version: '0.4.3',
    items: [
      '瀏覽器暫時記不住原檔位置時，正常的九方稿件仍可照常開啟',
      '開啟非九方稿件或較新版本的稿件檔時，會清楚說明原因，不再誤開空白稿',
      '從「最近刪除」或「復原」救回章節與卡片時，會先確認存妥再移除刪除紀錄',
      '修正另存檔案與畫面提示可能不一致的情況，並統一介面用字',
    ],
  },
  // WO-132（暫定，待九方審）
  {
    version: '0.4.2',
    items: [
      '寫作頁「還沒存成檔案」改成畫面一角的小標示，存檔狀態也改為只在一處顯示',
      '排版後一開始打字就會收起「排版好了」提示，按「復原」不會清掉新打的字',
      '誤刪章節後再復原，時間線事件會一起連回原本的章',
      '暫存或自動存檔沒成功時，畫面會清楚提醒',
      '修正在剛打完字立刻按存檔快速鍵、原檔已在別處更新，或瀏覽器暫存異常時可能漏字或覆蓋的問題',
    ],
  },
  // WO-131（暫定，待九方審）
  {
    version: '0.4.1',
    items: [
      '存檔提醒改成只在畫面角落顯示，不再跳出視窗',
    ],
  },
  // WO-130（暫定，待九方審）
  {
    version: '0.4.0',
    items: [
      '自動存檔：在電腦的 Chrome 或 Edge 存成檔案一次後，有改字就每 5 分鐘自動存回去',
      '還沒存成檔案時會提醒你',
    ],
  },
  {
    version: '0.3.0',
    items: [
      '事件時間線：照故事順序或章節順序排事件，電腦寬螢幕還能雙線對照',
      '設定頁新增贊助按鈕',
    ],
  },
];

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** 嚴格解析 X.Y.Z 三段版號為非負安全整數；格式不符回傳 null。 */
export function parseVersion(raw: string): readonly [number, number, number] | null {
  if (typeof raw !== 'string') return null;
  const match = VERSION_PATTERN.exec(raw);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  return [major, minor, patch];
}

/** 依數值比較兩組版號；任一側無法解析時回傳 null。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return null;
  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i]! < parsedB[i]!) return -1;
    if (parsedA[i]! > parsedB[i]!) return 1;
  }
  return 0;
}

/** 判斷目前版本是否高於上次看過的版本；舊值損壞無法解析時，只要字串不同就視為需要重記一次。 */
export function isNewerVersion(current: string, seen: string): boolean {
  const cmp = compareVersions(current, seen);
  if (cmp !== null) return cmp > 0;
  return current !== seen;
}

function normalizeNote(note: ReleaseNote): ReleaseNote | null {
  const validItems = note.items.filter((item) => item.trim() !== '');
  if (validItems.length === 0) return null;
  return { version: note.version, items: validItems };
}

/** 查詢指定版號的改版條目；找不到或過濾空白後沒有有效條目時回傳 null。 */
export function findReleaseNote(
  version: string,
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): ReleaseNote | null {
  const found = notes.find((note) => note.version === version);
  if (!found) return null;
  return normalizeNote(found);
}

/** 取出早於目前版本的歷版有效條目，維持新版在前順序。 */
export function previousReleaseNotes(
  currentVersion: string,
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): readonly ReleaseNote[] {
  const out: ReleaseNote[] = [];
  for (const note of notes) {
    if (note.version === currentVersion) continue;
    const cmp = compareVersions(note.version, currentVersion);
    if (cmp !== null && cmp >= 0) continue;
    const normalized = normalizeNote(note);
    if (normalized) out.push(normalized);
  }
  return out;
}
