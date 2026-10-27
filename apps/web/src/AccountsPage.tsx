import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { AccountSummary, HealthResponse, SessionStatus } from '#domain';
import { apiFetch } from './api.ts';
import { describeCommand } from './browser-labels.ts';
import { networkMessage, readError } from './http.ts';

const SESSION_LABEL: Record<SessionStatus, string> = {
  unknown: 'Chưa kiểm tra',
  logged_in: 'Đã đăng nhập',
  login_required: 'Cần đăng nhập',
  verification_required: 'Cần xác minh',
  network_error: 'Mất kết nối mạng',
};

interface AccountList {
  items: AccountSummary[];
  limit: number;
}

const formatTime = (ms: number) => new Date(ms).toLocaleString('vi-VN');

export function AccountsPage() {
  const [data, setData] = useState<AccountList | null>(null);
  const [worker, setWorker] = useState<HealthResponse['worker'] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiFetch('/api/accounts');
    if (!response.ok) throw new Error(await readError(response));
    setData((await response.json()) as AccountList);
    const health = await apiFetch('/api/health');
    if (health.ok) setWorker(((await health.json()) as HealthResponse).worker);
  }, []);

  const anyActive = (data?.items ?? []).some((account) => describeCommand(account.browser).active);
  useEffect(() => {
    load().catch((e) => setMessage(networkMessage(e)));
    // Tự cập nhật: nhanh khi có lệnh trình duyệt đang chạy, chậm khi rảnh.
    const timer = setInterval(() => { load().catch(() => undefined); }, anyActive ? 2_000 : 10_000);
    return () => clearInterval(timer);
  }, [load, anyActive]);

  /** Mỗi thao tác gửi đúng một lần; lỗi thì báo, không tự gửi lại. */
  async function act(path: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    setMessage('');
    try {
      const response = await apiFetch(path, init);
      if (!response.ok) {
        setMessage(await readError(response));
        return false;
      }
      await load();
      setMessage(done);
      return true;
    } catch (e) {
      setMessage(networkMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Báo rõ nhãn trùng (không phân biệt hoa/thường); server vẫn kiểm tra lại. */
  const labelTaken = (label: string, exceptId?: string) =>
    (data?.items ?? []).some((account) => account.id !== exceptId && account.label.toLocaleLowerCase('vi') === label.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('vi'));

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!newLabel.trim()) {
      setMessage('Nhập nhãn cho tài khoản.');
      return;
    }
    if (labelTaken(newLabel)) {
      setMessage('Nhãn này đã được dùng cho tài khoản khác.');
      return;
    }
    if (await act('/api/accounts', { method: 'POST', body: JSON.stringify({ label: newLabel }) }, 'Đã thêm tài khoản.')) setNewLabel('');
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (!editing.label.trim()) {
      setMessage('Nhập nhãn cho tài khoản.');
      return;
    }
    if (labelTaken(editing.label, editing.id)) {
      setMessage('Nhãn này đã được dùng cho tài khoản khác.');
      return;
    }
    if (await act(`/api/accounts/${editing.id}`, { method: 'PUT', body: JSON.stringify({ label: editing.label }) }, 'Đã đổi nhãn.')) setEditing(null);
  }

  const items = data?.items ?? [];
  const limit = data?.limit ?? 2;
  const full = items.length >= limit;
  const allPaused = items.length > 0 && items.every((account) => account.paused);

  return (
    <section>
      <header className="page-header">
        <h1>Quản lý tài khoản</h1>
        <span className="tag">P03 · đăng nhập tay qua worker</span>
      </header>
      <p className="muted">
        Tối đa {limit} tài khoản. Bấm "Đăng nhập" để mở cửa sổ trình duyệt riêng của tài khoản và <strong>tự đăng nhập</strong> (kể cả
        2FA); ứng dụng không thấy và không lưu mật khẩu hay mã 2FA. Danh tính được so khớp mỗi lần "Kiểm tra phiên".
      </p>
      {worker && (!worker.alive || worker.browser !== 'real') && (
        <p className="notice" role="status">
          {!worker.alive
            ? 'Worker chưa chạy nên chưa đăng nhập/kiểm tra phiên được. Chạy "npm run dev:worker" với APM_BROWSER=real.'
            : 'Worker đang chạy nhưng chưa được phép mở trình duyệt. Đặt APM_BROWSER=real trong .env rồi khởi động lại worker.'}
        </p>
      )}

      <form className="actions" onSubmit={add}>
        <input
          className="inline-input"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          maxLength={100}
          placeholder="Nhãn tài khoản (ví dụ: Bán hàng 1)"
          disabled={full || busy}
          aria-label="Nhãn tài khoản mới"
        />
        <button type="submit" className="primary" disabled={full || busy}>Thêm tài khoản</button>
        {items.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act('/api/accounts/pause-all', { method: 'POST', body: JSON.stringify({ paused: !allPaused }) }, allPaused ? 'Đã tiếp tục tất cả.' : 'Đã tạm dừng tất cả.')}
          >
            {allPaused ? 'Tiếp tục tất cả' : 'Tạm dừng tất cả'}
          </button>
        )}
      </form>
      {full && <p className="notice">Đã đủ {limit} tài khoản. Gỡ một tài khoản trước khi thêm.</p>}
      {message && <p className="notice" role="status">{message}</p>}

      {data && items.length === 0 && <p className="muted">Chưa có tài khoản nào. Nhập nhãn rồi bấm "Thêm tài khoản".</p>}
      {items.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Nhãn</th><th>Danh tính Facebook</th><th>Phiên</th><th>Proxy</th><th>Tác vụ</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {items.map((account) => (
              <tr key={account.id}>
                <td>
                  {editing?.id === account.id ? (
                    <form className="inline-form" onSubmit={rename}>
                      <input
                        className="inline-input"
                        value={editing.label}
                        onChange={(event) => setEditing({ id: account.id, label: event.target.value })}
                        maxLength={100}
                        aria-label="Nhãn mới"
                      />
                      <button type="submit" disabled={busy}>Lưu</button>
                      <button type="button" onClick={() => setEditing(null)}>Hủy</button>
                    </form>
                  ) : (
                    <>
                      {account.label} <span className="muted">· chỗ {account.slot}</span>
                    </>
                  )}
                </td>
                <td>
                  {account.identity ? (
                    <>
                      {account.identity.displayName ?? account.identity.remoteId}
                      <span className="muted"> · xác nhận {formatTime(account.identity.confirmedAt)}</span>
                    </>
                  ) : (
                    <span className="muted">Chưa xác nhận</span>
                  )}
                </td>
                <td>
                  {SESSION_LABEL[account.sessionStatus]}
                  {account.browser?.finishedAt != null && (
                    <div className="muted">kiểm tra lúc {formatTime(account.browser.finishedAt)}</div>
                  )}
                  {(() => {
                    const view = describeCommand(account.browser);
                    return view.text ? <div className={view.tone === 'warn' ? 'field-error' : view.tone === 'ok' ? 'ok-text' : 'muted'}>{view.text}</div> : null;
                  })()}
                </td>
                <td>{account.proxy ? account.proxy.label : <span className="muted">Không dùng</span>}</td>
                <td>
                  {account.runningJobs + account.queuedJobs === 0
                    ? <span className="muted">Không có</span>
                    : `Đang chạy ${account.runningJobs} · chờ ${account.queuedJobs}`}
                </td>
                <td>{account.paused ? 'Tạm dừng' : 'Hoạt động'}</td>
                <td className="row-actions">
                  {confirmRemove === account.id ? (
                    <>
                      <span className="field-warning">
                        Gỡ tài khoản này? Tác vụ chờ sẽ bị hủy, tác vụ đang chạy được yêu cầu dừng và không chuyển sang tài khoản khác.
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (await act(`/api/accounts/${account.id}/remove`, { method: 'POST', body: '{}' }, 'Đã gỡ tài khoản.')) setConfirmRemove(null);
                        }}
                      >
                        Xác nhận gỡ
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(null)}>Hủy</button>
                    </>
                  ) : (
                    <>
                      {describeCommand(account.browser).active ? (
                        <button
                          type="button"
                          disabled={busy || account.browser?.cancelRequestedAt != null}
                          onClick={() => account.browser && act(`/api/browser-commands/${account.browser.id}/cancel`, { method: 'POST', body: '{}' }, 'Đã gửi yêu cầu hủy.')}
                        >
                          Hủy lệnh
                        </button>
                      ) : (
                        <>
                          <button type="button" disabled={busy} onClick={() => act(`/api/accounts/${account.id}/browser`, { method: 'POST', body: JSON.stringify({ kind: 'login' }) }, 'Đã gửi lệnh đăng nhập. Cửa sổ trình duyệt sẽ mở ra.')}>
                            Đăng nhập
                          </button>
                          <button type="button" disabled={busy || !account.identity} title={account.identity ? '' : 'Cần đăng nhập ít nhất một lần'} onClick={() => act(`/api/accounts/${account.id}/browser`, { method: 'POST', body: JSON.stringify({ kind: 'verify' }) }, 'Đã gửi lệnh kiểm tra phiên.')}>
                            Kiểm tra phiên
                          </button>
                        </>
                      )}
                      <button type="button" disabled={busy} onClick={() => setEditing({ id: account.id, label: account.label })}>Đổi nhãn</button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => act(`/api/accounts/${account.id}/pause`, { method: 'POST', body: JSON.stringify({ paused: !account.paused }) }, account.paused ? 'Đã tiếp tục.' : 'Đã tạm dừng.')}
                      >
                        {account.paused ? 'Tiếp tục' : 'Tạm dừng'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setConfirmRemove(account.id)}>Gỡ</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
