/** Còn tiến trình `pid` không (tín hiệu 0 chỉ kiểm tra, không gửi gì). EPERM nghĩa là còn nhưng không có quyền. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

export interface ParentWatch {
  stop(): void;
}

/**
 * Launcher đặt APM_PARENT_PID cho server/worker. Nếu launcher chết đột ngột (đóng cửa sổ, kết thúc tiến trình), Windows không tự dừng tiến
 * trình con; hàm này khiến chúng tự dừng để không còn worker chạy ngầm nhận việc khi người dùng tưởng đã tắt ứng dụng.
 * Không đặt APM_PARENT_PID (chạy dev:server/dev:worker thủ công) thì không làm gì.
 */
export function watchParent(env: Record<string, string | undefined>, onGone: () => void, options: { intervalMs?: number; alive?: (pid: number) => boolean } = {}): ParentWatch | undefined {
  const raw = env.APM_PARENT_PID;
  if (!raw) return undefined;
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return undefined;
  const alive = options.alive ?? pidAlive;
  const timer = setInterval(() => { if (!alive(pid)) { clearInterval(timer); onGone(); } }, options.intervalMs ?? 2_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
