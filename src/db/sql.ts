export type SqlValue = string | number | null;

export interface Sql {
  exec(sql: string): void;
  select(sql: string, params?: SqlValue[]): Record<string, unknown>[];
  run(sql: string, params?: SqlValue[]): void;
}

export function columnNames(sql: Sql, table: string): Set<string> {
  return new Set(sql.select(`PRAGMA table_info(${table})`).map((row) => String(row.name)));
}

export function tableNames(sql: Sql): Set<string> {
  return new Set(
    sql
      .select("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => String(row.name)),
  );
}
