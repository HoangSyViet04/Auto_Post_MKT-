import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, transaction } from './db.ts';

// Thư mục có khoảng trắng và dấu tiếng Việt, giống đường dẫn OneDrive thật
let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'apm dữ liệu '));
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('openDatabase', () => {
  test('bật WAL, foreign_keys, busy_timeout và tạo thư mục cha', () => {
    const db = openDatabase(join(dir, 'nested', 'a.sqlite'), { busyTimeoutMs: 1234 });
    try {
      assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
      assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
      assert.equal(db.prepare('PRAGMA busy_timeout').get()?.timeout, 1234);
    } finally {
      db.close();
    }
  });

  test('dữ liệu còn sau khi đóng và mở lại', () => {
    const path = join(dir, 'persist.sqlite');
    const first = openDatabase(path);
    first.exec("CREATE TABLE t (v TEXT) STRICT; INSERT INTO t VALUES ('máy iPhone 13')");
    first.close();

    const second = openDatabase(path);
    try {
      assert.equal(second.prepare('SELECT v FROM t').get()?.v, 'máy iPhone 13');
    } finally {
      second.close();
    }
  });
});

describe('transaction', () => {
  test('rollback khi lỗi và ném lại lỗi', () => {
    const db = openDatabase(join(dir, 'tx.sqlite'));
    try {
      db.exec('CREATE TABLE t (v INTEGER) STRICT');
      assert.throws(
        () =>
          transaction(db, () => {
            db.prepare('INSERT INTO t VALUES (1)').run();
            throw new Error('boom');
          }),
        /boom/,
      );
      assert.equal(db.isTransaction, false);
      assert.equal(db.prepare('SELECT count(*) AS n FROM t').get()?.n, 0);
    } finally {
      db.close();
    }
  });

  test('từ chối hàm async và transaction lồng nhau', () => {
    const db = openDatabase(':memory:');
    try {
      assert.throws(() => transaction(db, async () => 1), /đồng bộ/);
      assert.equal(db.isTransaction, false);
      assert.throws(() => transaction(db, () => transaction(db, () => 1)), /lồng nhau/);
      assert.equal(db.isTransaction, false);
    } finally {
      db.close();
    }
  });

  test('kết nối thứ hai chờ rồi báo bận khi kết nối đầu đang giữ khóa ghi', () => {
    const path = join(dir, 'lock.sqlite');
    const a = openDatabase(path);
    const b = openDatabase(path, { busyTimeoutMs: 50 });
    try {
      a.exec('CREATE TABLE t (v INTEGER) STRICT');
      a.exec('BEGIN IMMEDIATE');
      assert.throws(() => b.exec('BEGIN IMMEDIATE'), /locked|busy/i);
      // WAL: vẫn đọc được trong lúc bên kia đang ghi
      assert.equal(b.prepare('SELECT count(*) AS n FROM t').get()?.n, 0);
      a.exec('COMMIT');
      assert.equal(transaction(b, () => b.prepare('INSERT INTO t VALUES (1)').run().changes), 1);
    } finally {
      a.close();
      b.close();
    }
  });
});

describe('nhận job có điều kiện giữa nhiều tiến trình (T04)', () => {
  test('mỗi job chỉ được đúng một tiến trình nhận', async () => {
    const path = join(dir, 'claim.sqlite');
    const JOBS = 2_000;
    const WORKERS = 4;

    const db = openDatabase(path);
    db.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY, status TEXT NOT NULL, claimed_by TEXT) STRICT");
    transaction(db, () => {
      const insert = db.prepare("INSERT INTO jobs (status) VALUES ('queued')");
      for (let i = 0; i < JOBS; i++) insert.run();
    });

    const script = join(import.meta.dirname, 'test-fixtures', 'claim-loop.ts');
    const startAt = String(Date.now() + 1_500);
    const results = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => runChild(process.execPath, [script, path, `w${i}`, startAt])),
    );

    const claimedByWorker = results.map((out) => JSON.parse(out) as number[]);
    const all = claimedByWorker.flat();
    assert.equal(all.length, JOBS, 'tổng số job được nhận');
    assert.equal(new Set(all).size, JOBS, 'không job nào bị nhận hai lần');
    assert.ok(claimedByWorker.filter((ids) => ids.length > 0).length >= 2, 'các tiến trình thật sự chạy song song');

    assert.equal(db.prepare("SELECT count(*) AS n FROM jobs WHERE status = 'queued'").get()?.n, 0);
    claimedByWorker.forEach((ids, i) => {
      const owned = db.prepare('SELECT count(*) AS n FROM jobs WHERE claimed_by = ?').get(`w${i}`)?.n;
      assert.equal(owned, ids.length, `claimed_by khớp với worker w${i}`);
    });
    db.close();
  });
});

function runChild(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}: ${stderr}`))));
  });
}
