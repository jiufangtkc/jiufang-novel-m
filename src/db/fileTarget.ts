/** 可寫回的本機檔。寫入失敗時不得留下半套內容。 */
export interface DiskFile {
  name: string;
  read(): Promise<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
  queryPermission(): Promise<'granted' | 'prompt' | 'denied'>;
  requestPermission(): Promise<'granted' | 'denied'>;
  /** 瀏覽器的檔案把手。存檔視窗要用它從舊檔的資料夾開。 */
  directoryHint?: unknown;
}

export interface SaveTarget {
  filename: string;
  file: DiskFile | null;
}

export interface TargetStore {
  load(bookKey: string): Promise<SaveTarget | null>;
  save(bookKey: string, target: SaveTarget): Promise<void>;
}

export interface StoredTargetRow {
  filename: string;
  handle: unknown | null;
}

export function createMemoryTargetStore(): TargetStore {
  const rows = new Map<string, SaveTarget>();
  return {
    async load(bookKey) {
      return rows.get(bookKey) ?? null;
    },
    async save(bookKey, target) {
      rows.set(bookKey, target);
    },
  };
}

/** IndexedDB 列與還原後的目標。handle 本體原樣放回，不重新包裝成別的物件。 */
export function restoreTarget(
  row: StoredTargetRow | null,
  wrap: (handle: unknown, filename: string) => DiskFile,
): SaveTarget | null {
  if (!row) return null;
  return {
    filename: row.filename,
    file: row.handle ? wrap(row.handle, row.filename) : null,
  };
}

export function targetRow(target: SaveTarget, handle: unknown | null): StoredTargetRow {
  return { filename: target.filename, handle };
}
