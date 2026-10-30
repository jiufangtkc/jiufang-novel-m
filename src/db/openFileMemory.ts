import type { DiskFile } from './fileTarget';

const files = new Map<string, DiskFile | null>();

/** 這次開啟記在記憶體裡的檔案把手。還沒查過是 undefined。 */
export function recallOpenFile(key: string): DiskFile | null | undefined {
  return files.has(key) ? files.get(key) ?? null : undefined;
}

export function rememberOpenFile(key: string, file: DiskFile | null): void {
  files.set(key, file);
}
