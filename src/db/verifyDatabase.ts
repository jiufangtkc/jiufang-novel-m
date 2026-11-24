import { CURRENT_SCHEMA_VERSION } from './migrations';
import { hasSqliteHeader } from './openDbError';

export async function verifyExportedDatabase(
  bytes: Uint8Array,
  readVersion: (bytes: Uint8Array) => Promise<number | null>,
): Promise<number> {
  if (!hasSqliteHeader(bytes)) throw new Error('這不是資料庫檔');
  const version = await readVersion(bytes);
  if (version == null || version < 1) throw new Error('讀不到資料庫版本');
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`資料庫版本過新（v${version}）`);
  }
  return version;
}
