import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './db.ts';
import { readWorkerStatus } from './worker-status.ts';

export interface DiagnosticsReport {
  generatedAt: string;
  node: string;
  platform: string;
  schemaVersion: number;
  integrity: string;
  worker: { alive: boolean; browser: string };
  accountsBySession: Record<string, number>;
  jobsByStatus: Record<string, number>;
  /** Job đã gửi nhưng chưa rõ kết quả cần người dùng đối chiếu. */
  jobsNeedingReconcile: number;
  media: { ready: number; missingFiles: number };
  /** Ảnh chụp chẩn đoán đang lưu (chỉ có khi người dùng bật APM_DIAG_CAPTURE=on); báo cáo này không chứa chính ảnh. */
  diagnosticCaptures: { files: number; oldestAgeHours: number | null };
  recentActivity: Array<{ at: string; severity: string; action: string; reason: string | null }>;
  dataDirBytes: Record<string, number>;
  note: string;
}

const countBy = (db: Database, sql: string): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const row of db.prepare(sql).all() as Array<{ k: string; n: number }>) result[String(row.k)] = Number(row.n);
  return result;
};

function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directoryBytes(child) : statSync(child).size;
  }
  return total;
}

/**
 * Báo cáo chẩn đoán CHỈ gồm đếm, mã trạng thái và kích thước. Cố ý không đọc và không in: caption, tên máy/nhóm/tài khoản, URL, danh tính,
 * cookie, token, bí mật, nội dung log hay đường dẫn tới hồ sơ trình duyệt. Báo cáo không chứa ảnh chụp màn hình (chỉ đếm số ảnh đang lưu) và không có trace.
 */
export function buildDiagnostics(db: Database, options: { dataDir: string; now?: number }): DiagnosticsReport {
  const now = options.now ?? Date.now();
  const missingFiles = (db.prepare("SELECT storage_key FROM media WHERE state='ready'").all() as Array<{ storage_key: string }>)
    .filter((row) => !existsSync(join(options.dataDir, 'media', 'objects', `${row.storage_key}.blob`))).length;
  const sizes: Record<string, number> = {};
  for (const name of ['db', 'media', 'logs', 'profiles', 'backups', 'diagnostics']) sizes[name] = directoryBytes(join(options.dataDir, name)); // chỉ tổng kích thước, không liệt kê file
  const captureDir = join(options.dataDir, 'diagnostics');
  const captures = existsSync(captureDir) ? readdirSync(captureDir).filter((name) => name.endsWith('.png')).map((name) => statSync(join(captureDir, name)).mtimeMs) : [];
  const worker = readWorkerStatus(db, now);
  return {
    generatedAt: new Date(now).toISOString(),
    node: process.version,
    platform: process.platform,
    schemaVersion: Number(db.prepare('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations').get()?.v),
    integrity: String(db.prepare('PRAGMA integrity_check').get()?.integrity_check),
    worker: { alive: worker.alive, browser: worker.browser },
    accountsBySession: countBy(db, 'SELECT session_status AS k,count(*) AS n FROM accounts WHERE archived_at IS NULL GROUP BY session_status'),
    jobsByStatus: countBy(db, 'SELECT status AS k,count(*) AS n FROM publish_jobs GROUP BY status'),
    jobsNeedingReconcile: Number(db.prepare("SELECT count(*) AS n FROM publish_jobs WHERE status IN ('unknown','pending_approval')").get()?.n),
    media: { ready: Number(db.prepare("SELECT count(*) AS n FROM media WHERE state='ready'").get()?.n), missingFiles },
    recentActivity: (db.prepare('SELECT occurred_at,severity,action_code,reason_code FROM activity_log ORDER BY occurred_at DESC,rowid DESC LIMIT 20').all() as Array<Record<string, unknown>>)
      .map((row) => ({ at: new Date(Number(row.occurred_at)).toISOString(), severity: String(row.severity), action: String(row.action_code), reason: row.reason_code === null ? null : String(row.reason_code) })),
    diagnosticCaptures: { files: captures.length, oldestAgeHours: captures.length ? Math.max(0, Math.round(((now - Math.min(...captures)) / 3_600_000) * 10) / 10) : null },
    dataDirBytes: sizes,
    note: 'Báo cáo không chứa nội dung bài, tên, liên kết, cookie hay bí mật. Không bao giờ thu trace. Ảnh chụp màn hình chỉ có khi bật APM_DIAG_CAPTURE=on.',
  };
}
