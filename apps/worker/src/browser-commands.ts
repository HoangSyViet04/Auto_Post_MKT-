import { join } from 'node:path';
import type { BrowserDriver, DriverResult } from '#browser';
import { BusinessError, type SessionStatus } from '#domain';
import {
  type ClaimedBrowserCommand,
  createAccountRepository,
  createBrowserCommandRepository,
  createLeaseRepository,
  type Database,
  type LeaseHandle,
} from '#storage';

export interface BrowserCommandRunnerDeps {
  db: Database;
  driver: BrowserDriver;
  workerId: string;
  /** Thư mục dữ liệu; hồ sơ trình duyệt nằm ở <dataDir>/profiles/<khóa ngẫu nhiên>. */
  dataDir: string;
  /** Ghi log đã lọc bí mật; chỉ truyền mã cố định, không truyền URL hay nội dung trang. */
  log?: { info(fields: Record<string, unknown>, message: string): void; error(fields: Record<string, unknown>, message: string): void };
  loginTimeoutMs?: number;
  leaseMs?: number;
  clock?: () => number;
}

const SESSION_BY_FAILURE: Partial<Record<string, SessionStatus>> = {
  login_required: 'login_required',
  verification_required: 'verification_required',
  network_error: 'network_error',
};

/**
 * Chạy lệnh trình duyệt do server ghi vào DB (đăng nhập tay, kiểm tra phiên). Mỗi lệnh: nhận có điều kiện → giữ khóa trình duyệt của
 * tài khoản → driver → ghi phiên/danh tính → kết thúc đúng một lần → nhả khóa. Danh tính đã xác nhận không bao giờ tự đổi.
 */
export function createBrowserCommandRunner(deps: BrowserCommandRunnerDeps) {
  const clockOptions = deps.clock ? { clock: deps.clock } : {};
  const commands = createBrowserCommandRepository(deps.db, clockOptions);
  const accounts = createAccountRepository(deps.db, clockOptions);
  const leases = createLeaseRepository(deps.db, clockOptions);
  const leaseMs = deps.leaseMs ?? 180_000;
  const loginTimeoutMs = deps.loginTimeoutMs ?? 15 * 60_000;
  const info = (fields: Record<string, unknown>, message: string) => deps.log?.info(fields, message);

  /** Trả (trạng thái, mã kết quả) cho lệnh vừa chạy xong; đồng thời cập nhật phiên/danh tính của tài khoản. */
  function apply(command: ClaimedBrowserCommand, result: DriverResult): { status: 'succeeded' | 'failed' | 'cancelled'; code: string } {
    if (!result.ok) {
      if (result.code === 'cancelled') return { status: 'cancelled', code: 'cancelled' };
      const session = SESSION_BY_FAILURE[result.code];
      if (session) accounts.recordSession(command.accountId, session);
      return { status: 'failed', code: result.code };
    }
    if (command.kind === 'login') {
      const outcome = accounts.recordIdentity(command.accountId, result.identityRef);
      if (outcome === 'different') return { status: 'failed', code: 'identity_mismatch' }; // đăng nhập nhầm nick: không đổi danh tính đã lưu
      accounts.recordSession(command.accountId, 'logged_in');
      return { status: 'succeeded', code: outcome === 'created' ? 'identity_saved' : 'identity_confirmed' };
    }
    // verify: chỉ đối chiếu với danh tính đã lưu, không tạo danh tính mới.
    const expected = accounts.identityRef(command.accountId);
    if (expected === null) return { status: 'failed', code: 'no_identity_baseline' };
    if (expected !== result.identityRef) {
      accounts.recordSession(command.accountId, 'unknown');
      return { status: 'failed', code: 'identity_mismatch' };
    }
    accounts.recordSession(command.accountId, 'logged_in');
    return { status: 'succeeded', code: 'match' };
  }

  return {
    /** Xử lý tối đa một lệnh. Trả 'idle' nếu không có lệnh. */
    async processNext(): Promise<'idle' | 'processed'> {
      const command = commands.claimNext(deps.workerId);
      if (!command) return 'idle';
      let lease: LeaseHandle | undefined;
      let finished = false;
      const finish = (status: 'succeeded' | 'failed' | 'cancelled', code: string) => {
        commands.finish(command.id, deps.workerId, status, code);
        finished = true;
        info({ kind: command.kind, status, code }, 'Lệnh trình duyệt kết thúc');
      };
      try {
        try {
          lease = leases.acquireBrowser(command.accountId, deps.workerId, leaseMs);
        } catch (error) {
          if (error instanceof BusinessError && error.code === 'conflict') { finish('failed', 'profile_in_use'); return 'processed'; }
          throw error;
        }
        let profileDir: string;
        try {
          profileDir = join(deps.dataDir, 'profiles', accounts.profileKey(command.accountId));
          accounts.get(command.accountId); // tài khoản đã gỡ thì không mở trình duyệt
        } catch (error) {
          if (error instanceof BusinessError && error.code === 'not_found') { finish('cancelled', 'account_removed'); return 'processed'; }
          throw error;
        }
        const held = lease;
        const common = {
          profileDir,
          shouldCancel: () => commands.isCancelRequested(command.id),
          onTick: () => {
            commands.heartbeat(command.id, deps.workerId);
            lease = leases.renew(lease ?? held, leaseMs); // mất quyền thì ném claim_lost → driver dừng
          },
        };
        const result = command.kind === 'login'
          ? await deps.driver.login({ ...common, timeoutMs: loginTimeoutMs })
          : await deps.driver.verify(common);
        const outcome = apply(command, result);
        finish(outcome.status, outcome.code);
      } catch (error) {
        if (!finished) {
          const lost = error instanceof BusinessError && error.code === 'claim_lost';
          // Mất quyền (lệnh bị dọn vì worker chậm) thì không ghi đè; lỗi khác ghi mã cố định, không ghi thông điệp lỗi.
          if (!lost) {
            try { finish('failed', 'driver_error'); } catch { /* lệnh đã bị đổi trạng thái bởi bên khác */ }
          }
          deps.log?.error({ kind: command.kind, errorName: error instanceof Error ? error.name : 'unknown', lost }, 'Lệnh trình duyệt lỗi');
        }
      } finally {
        if (lease) {
          try { leases.release(lease); } catch { /* khóa đã hết hạn hoặc đổi chủ */ }
        }
      }
      return 'processed';
    },
  };
}
