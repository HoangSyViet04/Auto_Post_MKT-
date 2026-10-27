import type { Database } from './db.ts';

export type WorkerBrowserMode = 'off' | 'real';
export interface WorkerStatus {
  /** Worker có nhịp sống gần đây hay không. */
  alive: boolean;
  /** Chế độ điều khiển trình duyệt worker đang chạy; 'unknown' khi chưa có worker nào báo. */
  browser: WorkerBrowserMode | 'unknown';
}

/** Nhịp sống quá ngưỡng này thì coi worker đã dừng. */
export const WORKER_ALIVE_MS = 20_000;

/** Worker ghi nhịp sống và chế độ trình duyệt vào app_meta để server/giao diện biết có worker đang chạy hay không. */
export function writeWorkerHeartbeat(db: Database, browser: WorkerBrowserMode, now: number = Date.now()): void {
  const upsert = db.prepare(`INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  upsert.run('worker.heartbeat', String(now));
  upsert.run('worker.browser', browser);
}

export function readWorkerStatus(db: Database, now: number = Date.now()): WorkerStatus {
  const read = (key: string) => db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value;
  const beat = Number(read('worker.heartbeat'));
  const mode = read('worker.browser');
  return {
    alive: Number.isFinite(beat) && now - beat <= WORKER_ALIVE_MS,
    browser: mode === 'off' || mode === 'real' ? mode : 'unknown',
  };
}
