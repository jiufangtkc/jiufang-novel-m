const SQLITE_HEADER_BYTES = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
] as const;

export type DatabaseOpenErrorCode = 'not-jiufang' | 'newer-schema' | 'storage-failed';

export class DatabaseOpenError extends Error {
  readonly code: DatabaseOpenErrorCode;
  readonly foundVersion?: number;

  constructor(code: DatabaseOpenErrorCode, foundVersion?: number, message?: string) {
    super(message ?? defaultOpenErrorMessage(code, foundVersion));
    this.name = 'DatabaseOpenError';
    this.code = code;
    if (foundVersion !== undefined) {
      this.foundVersion = foundVersion;
    }
  }
}

function defaultOpenErrorMessage(code: DatabaseOpenErrorCode, foundVersion?: number): string {
  if (code === 'newer-schema') {
    return foundVersion !== undefined
      ? `這份稿件來自較新版本的九方編輯器（v${foundVersion}）`
      : '這份稿件來自較新版本的九方編輯器';
  }
  if (code === 'storage-failed') {
    return '這個裝置目前存不下這份稿件';
  }
  return '這不是九方稿件檔';
}

export function isDatabaseOpenError(error: unknown): error is DatabaseOpenError {
  return error instanceof DatabaseOpenError;
}

export function hasSqliteHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < SQLITE_HEADER_BYTES.length) return false;
  for (let i = 0; i < SQLITE_HEADER_BYTES.length; i += 1) {
    if (bytes[i] !== SQLITE_HEADER_BYTES[i]) return false;
  }
  return true;
}
