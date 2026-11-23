import type { DiskFile } from './fileTarget';

const files = new Map<string, DiskFile | null>();
const fingerprints = new Map<string, { file: DiskFile; fingerprint: string | null }>();

/** 這次開啟記在記憶體裡的檔案把手。還沒查過是 undefined。 */
export function recallOpenFile(key: string): DiskFile | null | undefined {
  return files.has(key) ? files.get(key) ?? null : undefined;
}

export function rememberOpenFile(key: string, file: DiskFile | null): void {
  files.set(key, file);
  if (!file) fingerprints.delete(key);
}

/** WO-132 嚴-2：針對同一把記憶體檔案把手快取最近已知指紋，供 IndexedDB 不可用時仍可比對。 */
export function rememberOpenFileFingerprint(
  key: string,
  file: DiskFile | null,
  fingerprint: string | null,
): void {
  if (!file) {
    fingerprints.delete(key);
    return;
  }
  fingerprints.set(key, { file, fingerprint });
}

export function recallOpenFileFingerprint(key: string, file: DiskFile | null): string | null | undefined {
  if (!file) return undefined;
  const entry = fingerprints.get(key);
  if (!entry || entry.file !== file) return undefined;
  return entry.fingerprint;
}

/** 刪稿或清除把手時，一併移出這次開啟的記憶體快取。 */
export function forgetOpenFile(key: string): void {
  files.delete(key);
  fingerprints.delete(key);
}
