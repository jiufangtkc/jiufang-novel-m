import { DatabaseSync } from 'node:sqlite';
import type { Sql, SqlValue } from './sql';

export function openNodeSql(filename = ':memory:'): { db: DatabaseSync; sql: Sql } {
  const db = new DatabaseSync(filename);
  const sql: Sql = {
    exec(statement) {
      db.exec(statement);
    },
    select(statement, params = []) {
      return db.prepare(statement).all(...params) as Record<string, unknown>[];
    },
    run(statement, params = []) {
      db.prepare(statement).run(...(params as SqlValue[]));
    },
  };
  return { db, sql };
}
