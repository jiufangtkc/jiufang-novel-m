import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sql, SqlValue } from './sql';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

let modulePromise: Promise<Sqlite3> | null = null;

function loadModule(): Promise<Sqlite3> {
  modulePromise ??= sqlite3InitModule();
  return modulePromise;
}

export interface MemoryDb {
  sql: Sql;
  exportBytes(): Uint8Array;
  close(): void;
}

/** 把一整個 .db 讀進記憶體。寫完後再把位元組存回手機。 */
export async function openMemoryDb(bytes: Uint8Array): Promise<MemoryDb> {
  const sqlite3 = await loadModule();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  if (bytes.byteLength > 0) {
    const dbPointer = db.pointer;
    if (dbPointer == null) throw new Error('這個檔案讀不了');
    const pointer = sqlite3.wasm.alloc(bytes.byteLength);
    sqlite3.wasm.heap8u().set(bytes, pointer);
    const flags =
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const result = sqlite3.capi.sqlite3_deserialize(
      dbPointer,
      'main',
      pointer,
      bytes.byteLength,
      bytes.byteLength,
      flags,
    );
    if (result !== 0) {
      db.close();
      throw new Error('這個檔案不是可以讀的資料庫');
    }
  }
  const sql: Sql = {
    exec(statement) {
      db.exec(statement);
    },
    select(statement, params = []) {
      const rows = db.exec({
        sql: statement,
        bind: params,
        rowMode: 'object',
        returnValue: 'resultRows',
      });
      return rows as Record<string, unknown>[];
    },
    run(statement, params = []) {
      db.exec({ sql: statement, bind: params as SqlValue[] });
    },
  };
  return {
    sql,
    exportBytes() {
      const dbPointer = db.pointer;
      if (dbPointer == null) throw new Error('這個檔案讀不了');
      return sqlite3.capi.sqlite3_js_db_export(dbPointer);
    },
    close() {
      db.close();
    },
  };
}
