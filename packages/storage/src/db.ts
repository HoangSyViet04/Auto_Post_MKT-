import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export interface OpenDatabaseOptions {
  /** Thời gian chờ (ms) khi tiến trình khác (server/worker) đang giữ khóa ghi. */
  busyTimeoutMs?: number;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

/**
 * Mở DB SQLite dùng chung cho server và worker.
 * WAL cho phép đọc song song với một tiến trình ghi; busy_timeout tránh lỗi "database is locked" tức thì.
 */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS)}`);
    db.exec('PRAGMA foreign_keys = ON');
    // REPLACE must run DELETE triggers, or it could erase immutable audit/fence rows.
    db.exec('PRAGMA recursive_triggers = ON');
    if (path !== ':memory:') {
      const row = db.prepare('PRAGMA journal_mode = WAL').get();
      if (row?.journal_mode !== 'wal') throw new Error(`Không bật được WAL cho DB: ${String(row?.journal_mode)}`);
      db.exec('PRAGMA synchronous = NORMAL');
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/**
 * Chạy fn trong một transaction ghi (BEGIN IMMEDIATE: giành khóa ghi ngay, tránh nâng cấp khóa giữa chừng).
 * fn phải đồng bộ — không await bên trong transaction.
 */
export function transaction<T>(db: Database, fn: () => T): T {
  if (db.isTransaction) throw new Error('Không hỗ trợ transaction lồng nhau');

  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('Hàm trong transaction phải đồng bộ');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
