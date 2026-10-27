import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase } from './db.ts';
import { defineMigration, loadMigrations, migrate, MigrationError } from './migrate.ts';

let dir: string;
let counter = 0;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm migrate '));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const dbPath = () => join(dir, `db-${++counter}.sqlite`);
const tableExists = (db: ReturnType<typeof openDatabase>, name: string) =>
  db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

const m1 = defineMigration(1, 'one', 'CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;');
const m2 = defineMigration(2, 'two', 'CREATE TABLE b (id INTEGER PRIMARY KEY) STRICT;');

describe('migrate', () => {
  test('migration thật của dự án chạy được trên DB mới', () => {
    const db = openDatabase(dbPath());
    try {
      const result = migrate(db);
      assert.deepEqual(result.applied, [1, 2, 3]);
      assert.equal(result.currentVersion, 3);
      assert.ok(db.prepare("SELECT value FROM app_meta WHERE key = 'created_at'").get()?.value);
    } finally {
      db.close();
    }
  });

  test('chạy lại không áp dụng lần hai; giữ sau khi mở lại DB', () => {
    const path = dbPath();
    const first = openDatabase(path);
    assert.deepEqual(migrate(first, [m1]).applied, [1]);
    first.close();

    const second = openDatabase(path);
    try {
      assert.deepEqual(migrate(second, [m1]), { applied: [], currentVersion: 1 });
      assert.deepEqual(migrate(second, [m1, m2]), { applied: [2], currentVersion: 2 });
    } finally {
      second.close();
    }
  });

  test('migration lỗi thì rollback toàn bộ file đó, giữ các migration trước', () => {
    const db = openDatabase(dbPath());
    try {
      const bad = defineMigration(2, 'bad', 'CREATE TABLE b (id INTEGER) STRICT; SELECT * FROM khong_ton_tai;');
      assert.throws(() => migrate(db, [m1, bad]), MigrationError);
      assert.equal(tableExists(db, 'a'), true);
      assert.equal(tableExists(db, 'b'), false);
      assert.deepEqual(
        db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
        [1],
      );
      assert.equal(db.isTransaction, false);
    } finally {
      db.close();
    }
  });

  test('từ chối khi migration đã chạy bị sửa nội dung', () => {
    const db = openDatabase(dbPath());
    try {
      migrate(db, [m1]);
      const edited = defineMigration(1, 'one', 'CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT) STRICT;');
      assert.throws(() => migrate(db, [edited, m2]), /đã bị sửa/);
      assert.equal(tableExists(db, 'b'), false, 'không áp dụng tiếp migration mới');
    } finally {
      db.close();
    }
  });

  test('từ chối khi DB mới hơn mã nguồn', () => {
    const db = openDatabase(dbPath());
    try {
      migrate(db, [m1, m2]);
      assert.throws(() => migrate(db, [m1]), /cũ hơn DB/);
    } finally {
      db.close();
    }
  });
});

describe('loadMigrations', () => {
  const makeDir = (files: Record<string, string>) => {
    const target = join(dir, `migrations-${++counter}`);
    mkdirSync(target);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(target, name), content);
    return target;
  };

  test('đọc theo thứ tự; checksum không phụ thuộc CRLF/LF', () => {
    const lf = loadMigrations(makeDir({ '0002_b.sql': 'SELECT 2;\n', '0001_a.sql': 'SELECT 1;\nSELECT 1;\n' }));
    const crlf = loadMigrations(makeDir({ '0001_a.sql': 'SELECT 1;\r\nSELECT 1;\r\n', '0002_b.sql': 'SELECT 2;\r\n' }));
    assert.deepEqual(lf.map((m) => `${m.version}_${m.name}`), ['1_a', '2_b']);
    assert.deepEqual(lf.map((m) => m.checksum), crlf.map((m) => m.checksum));
  });

  test('báo lỗi khi thiếu phiên bản hoặc tên file sai', () => {
    assert.throws(() => loadMigrations(makeDir({ '0001_a.sql': '', '0003_c.sql': '' })), /không liên tục/);
    assert.throws(() => loadMigrations(makeDir({ '1_a.sql': '' })), /không hợp lệ/);
  });
});
