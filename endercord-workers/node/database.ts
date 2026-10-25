import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import schema from '../schema.sql';
import type { BotDatabase, PreparedStatement, SQLValue } from '../src/types.js';

// The shared handlers use only this small subset of D1's SQLite API.
export class SQLiteDatabase implements BotDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(schema);
  }

  prepare(sql: string): SQLiteStatement {
    return new SQLiteStatement(this.db, sql);
  }

  async batch(statements: PreparedStatement[]) {
    this.db.exec('BEGIN');
    try {
      // Execute synchronously inside the transaction: no other request can interleave.
      const result = statements.map(statement => {
        if (!(statement instanceof SQLiteStatement)) throw new Error('Invalid SQLite statement');
        return statement.execute();
      });
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.db.close(); }
}

class SQLiteStatement {
  private values: SQLInputValue[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: SQLValue[]): this { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[], success: true };
  }
  execute() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } };
  }
  async run() { return this.execute(); }
}
