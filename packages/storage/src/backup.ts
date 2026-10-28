import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { backup } from 'node:sqlite';
import { openDatabase, type Database } from './db.ts';
import { loadMigrations, migrate } from './migrate.ts';

const BACKUP_FORMAT = 1;
/** Không bao giờ nằm trong bản sao lưu thường: cookie/phiên trình duyệt, khóa/bí mật bảo vệ theo Windows, log, bản sao lưu khác. */
export const EXCLUDED_FROM_BACKUP = ['profiles', 'secrets', 'logs', 'backups', 'spikes', 'cache'] as const;

export interface BackupManifest {
  format: number;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  db: { file: string; sha256: string; bytes: number };
  media: Array<{ file: string; sha256: string; bytes: number }>;
  /** Ảnh có trong DB nhưng file không còn trong kho lúc sao lưu (không được tính là có đủ). */
  missingMedia: string[];
  excluded: readonly string[];
  note: string;
}

const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const appVersion = (): string => {
  try { return String((JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? 'unknown'); } catch { return 'unknown'; }
};
const emptyDir = (dir: string) => !existsSync(dir) || readdirSync(dir).length === 0;

/**
 * Sao lưu nhất quán: DB qua API sao lưu trực tuyến của SQLite (không copy file đang ghi) + ảnh trong kho + manifest mã băm.
 * Manifest được ghi CUỐI CÙNG nên thư mục sao lưu dở dang không có manifest và bị từ chối khi phục hồi. Không đưa vào hồ sơ trình duyệt,
 * cookie, khóa hay log.
 */
export async function createBackup(db: Database, options: { dataDir: string; outDir: string; now?: Date }): Promise<BackupManifest> {
  const out = resolve(options.outDir);
  if (!emptyDir(out)) throw new Error('backup_dir_not_empty');
  mkdirSync(join(out, 'media'), { recursive: true });
  const dbFile = join(out, 'db.sqlite');
  await backup(db, dbFile);
  const media: BackupManifest['media'] = [];
  const missing: string[] = [];
  const rows = db.prepare("SELECT storage_key FROM media WHERE state='ready' ORDER BY storage_key").all() as Array<{ storage_key: string }>;
  for (const row of rows) {
    const source = join(options.dataDir, 'media', 'objects', `${row.storage_key}.blob`);
    if (!existsSync(source)) { missing.push(row.storage_key); continue; }
    const target = join(out, 'media', `${row.storage_key}.blob`);
    copyFileSync(source, target);
    media.push({ file: `media/${row.storage_key}.blob`, sha256: sha256File(target), bytes: statSync(target).size });
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, createdAt: (options.now ?? new Date()).toISOString(), appVersion: appVersion(),
    schemaVersion: Number(db.prepare('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations').get()?.v),
    db: { file: 'db.sqlite', sha256: sha256File(dbFile), bytes: statSync(dbFile).size }, media, missingMedia: missing, excluded: EXCLUDED_FROM_BACKUP,
    note: 'Không chứa cookie, hồ sơ trình duyệt, khóa hay log. Sau khi phục hồi cần đăng nhập/kết nối lại các tài khoản.',
  };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export interface BackupCheck { ok: boolean; problems: string[]; manifest?: BackupManifest }

/** Kiểm tra bản sao lưu mà KHÔNG sửa gì: manifest, mã băm DB và từng ảnh, DB mở được và qua integrity_check, schema không mới hơn mã nguồn. */
export function verifyBackup(dir: string): BackupCheck {
  const root = resolve(dir);
  const problems: string[] = [];
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as BackupManifest;
  } catch {
    return { ok: false, problems: ['Thiếu hoặc hỏng manifest.json (bản sao lưu dở dang hoặc không hợp lệ).'] };
  }
  if (manifest.format !== BACKUP_FORMAT) return { ok: false, problems: ['Định dạng sao lưu không được hỗ trợ.'] };
  const check = (relative: string, sha256: string, bytes: number, label: string) => {
    const path = join(root, relative);
    if (!existsSync(path)) { problems.push(`${label}: thiếu file.`); return; }
    if (statSync(path).size !== bytes || sha256File(path) !== sha256) problems.push(`${label}: mã băm hoặc kích thước không khớp (file bị sửa/hỏng).`);
  };
  check(manifest.db.file, manifest.db.sha256, manifest.db.bytes, 'Cơ sở dữ liệu');
  for (const [index, item] of manifest.media.entries()) check(item.file, item.sha256, item.bytes, `Ảnh #${index + 1}`);
  const latest = loadMigrations().at(-1)?.version ?? 0;
  if (manifest.schemaVersion > latest) problems.push(`Bản sao lưu có schema v${manifest.schemaVersion} mới hơn mã nguồn (v${latest}); cập nhật ứng dụng trước.`);
  if (problems.length === 0) {
    try {
      const probe = openDatabase(join(root, manifest.db.file));
      try {
        if (probe.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') problems.push('Cơ sở dữ liệu không qua integrity_check.');
      } finally { probe.close(); }
    } catch { problems.push('Không mở được cơ sở dữ liệu trong bản sao lưu.'); }
  }
  return { ok: problems.length === 0, problems, manifest };
}

export interface RestoreResult {
  targetDataDir: string;
  previousKeptAt: string | null;
  mediaRestored: number;
  missingMedia: number;
  pausedJobs: number;
  accountsNeedLogin: number;
  keptLocalState: boolean;
}

/**
 * Phục hồi vào VÙNG TẠM, kiểm tra xong mới thay: bản sao lưu hỏng thì thư mục dữ liệu hiện tại không bị đụng tới. Thư mục đích đã có thì phải
 * chọn `replace` và bản cũ được ĐỔI TÊN (không xóa). Lịch không tự chạy sau phục hồi: job đang chờ chuyển sang tạm dừng; tài khoản phải đăng
 * nhập/kiểm tra phiên lại. Hồ sơ trình duyệt và khóa không có trong bản sao lưu; thay thế trên cùng máy thì giữ lại của bản cũ.
 */
export function restoreBackup(options: { backupDir: string; targetDataDir: string; dbFileName: string; replace?: boolean; now?: Date }): RestoreResult {
  const check = verifyBackup(options.backupDir);
  if (!check.ok || !check.manifest) throw new Error(`backup_invalid: ${check.problems.join(' | ')}`);
  const manifest = check.manifest;
  const target = resolve(options.targetDataDir);
  const stamp = (options.now ?? new Date()).toISOString().replace(/\D/gu, '').slice(0, 14);
  const exists = existsSync(target) && !emptyDir(target);
  if (exists && !options.replace) throw new Error('target_exists_use_replace');
  const staging = `${target}.restoring-${stamp}`;
  if (existsSync(staging)) throw new Error('staging_exists');
  mkdirSync(join(staging, 'media', 'objects'), { recursive: true });
  mkdirSync(join(staging, 'db'), { recursive: true });
  try {
    const dbPath = join(staging, 'db', options.dbFileName);
    copyFileSync(join(resolve(options.backupDir), manifest.db.file), dbPath);
    for (const item of manifest.media) copyFileSync(join(resolve(options.backupDir), item.file), join(staging, 'media', 'objects', item.file.split('/').pop() as string));
    // Kiểm tra lại bản đã chép ở vùng tạm, rồi mới chỉnh trạng thái an toàn.
    for (const item of manifest.media) {
      if (sha256File(join(staging, 'media', 'objects', item.file.split('/').pop() as string)) !== item.sha256) throw new Error('copy_corrupted');
    }
    const restored = openDatabase(dbPath);
    let paused = 0;
    let accounts = 0;
    try {
      migrate(restored);
      if (restored.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('integrity_failed');
      restored.exec('BEGIN IMMEDIATE');
      try {
        const queued = restored.prepare("SELECT id FROM publish_jobs WHERE status='queued'").all() as Array<{ id: string }>;
        for (const job of queued) {
          restored.prepare("UPDATE publish_jobs SET status='paused' WHERE id=?").run(job.id);
          restored.prepare("INSERT INTO activity_log(id,job_id,severity,action_code,reason_code,occurred_at) VALUES(?,?,'warn','restored_paused','not_auto_resumed',?)")
            .run(randomUUID(), job.id, (options.now ?? new Date()).getTime());
          paused += 1;
        }
        accounts = restored.prepare("UPDATE accounts SET session_status='login_required' WHERE archived_at IS NULL").run().changes as number;
        restored.prepare("INSERT INTO app_meta(key,value) VALUES('restored_from',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(manifest.createdAt);
        restored.exec('COMMIT');
      } catch (error) { restored.exec('ROLLBACK'); throw error; }
    } finally { restored.close(); }

    let previousKeptAt: string | null = null;
    let kept = false;
    if (exists) {
      previousKeptAt = `${target}.before-restore-${stamp}`;
      renameSync(target, previousKeptAt);
      // Cùng máy: giữ hồ sơ trình duyệt và khóa của bản cũ (không có trong sao lưu).
      for (const name of ['profiles', 'secrets'] as const) {
        const old = join(previousKeptAt, name);
        if (existsSync(old)) { renameSync(old, join(staging, name)); kept = true; }
      }
    }
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) rmdirSync(target); // chỉ xóa được thư mục RỖNG (Windows không cho đổi tên đè lên thư mục đã có)
    renameSync(staging, target);
    return { targetDataDir: target, previousKeptAt, mediaRestored: manifest.media.length, missingMedia: manifest.missingMedia.length, pausedJobs: paused,
      accountsNeedLogin: accounts, keptLocalState: kept };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true }); // vùng tạm bỏ đi; dữ liệu hiện tại chưa bị đụng tới
    throw error;
  }
}
