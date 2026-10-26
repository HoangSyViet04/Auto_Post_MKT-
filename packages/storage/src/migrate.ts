import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Database, transaction } from './db.ts';

/** Thư mục migration mặc định: packages/storage/migrations */
export const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

/** Checksum bỏ qua khác biệt CRLF/LF giữa hai máy. */
export function defineMigration(version: number, name: string, sql: string): Migration {
  const normalized = sql.replace(/\r\n/g, '\n');
  return { version, name, sql: normalized, checksum: createHash('sha256').update(normalized).digest('hex') };
}

/**
 * Đọc file NNNN_ten.sql. Phiên bản phải liên tục từ 1 để phát hiện file bị thiếu (ví dụ OneDrive chưa đồng bộ xong).
 * File migration không được tự chứa BEGIN/COMMIT — mỗi file đã chạy trong một transaction.
 */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new MigrationError(`Tên file migration không hợp lệ: ${file} (cần dạng 0001_ten_viet_thuong.sql)`);
    migrations.push(defineMigration(Number(match[1]), match[2]!, readFileSync(join(dir, file), 'utf8')));
  }
  migrations.forEach((m, index) => {
    if (m.version !== index + 1) {
      throw new MigrationError(`Migration không liên tục: cần phiên bản ${index + 1}, gặp ${m.version}`);
    }
  });
  return migrations;
}

export interface MigrateResult {
  applied: number[];
  currentVersion: number;
}

/**
 * Áp dụng migration còn thiếu, mỗi migration một transaction.
 * Dừng (không sửa DB) nếu migration đã chạy bị sửa nội dung hoặc DB mới hơn mã nguồn.
 */
export function migrate(db: Database, migrations: Migration[] = loadMigrations()): MigrateResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const known = new Map(migrations.map((m) => [m.version, m]));
  const appliedRows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
  const appliedVersions = new Set<number>();

  for (const row of appliedRows) {
    const version = Number(row.version);
    const migration = known.get(version);
    if (!migration) {
      throw new MigrationError(
        `DB đã có migration ${version} nhưng mã nguồn không có — mã nguồn cũ hơn DB? Không chạy để tránh hỏng dữ liệu.`,
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        `Migration ${version}_${migration.name} đã chạy nhưng nội dung file đã bị sửa. Tạo migration mới thay vì sửa file cũ.`,
      );
    }
    appliedVersions.add(version);
  }

  const insert = db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)');
  const applied: number[] = [];
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    try {
      transaction(db, () => {
        db.exec(migration.sql);
        insert.run(migration.version, migration.name, migration.checksum, new Date().toISOString());
      });
    } catch (error) {
      throw new MigrationError(`Migration ${migration.version}_${migration.name} lỗi, đã rollback: ${String(error)}`, {
        cause: error,
      });
    }
    applied.push(migration.version);
  }

  return { applied, currentVersion: Math.max(0, ...appliedVersions, ...applied) };
}
