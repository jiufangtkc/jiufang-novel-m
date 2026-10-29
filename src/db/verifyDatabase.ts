const SQLITE_HEADER = 'SQLite format 3';

export async function verifyExportedDatabase(
  bytes: Uint8Array,
  readVersion: (bytes: Uint8Array) => Promise<number | null>,
): Promise<number> {
  const header = new TextDecoder().decode(bytes.subarray(0, SQLITE_HEADER.length));
  if (header !== SQLITE_HEADER) throw new Error('這不是資料庫檔');
  const version = await readVersion(bytes);
  if (version == null || version < 1) throw new Error('讀不到資料庫版本');
  return version;
}
