import { useCallback, useEffect, useState } from 'react';
import { type AccountSummary, type HealthResponse, JOINED_SCAN_REASON, type JoinedScanSummary } from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';

export function JoinedScanPanel({ account, onRefresh }: { account: AccountSummary | undefined; onRefresh(): Promise<void> }) {
  const [scan, setScan] = useState<JoinedScanSummary | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [limit, setLimit] = useState('200');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = scan?.status === 'queued' || scan?.status === 'running';
  const accountId = account?.id ?? '';
  const poll = useCallback(async () => {
    if (!accountId) return;
    const [response, status] = await Promise.all([apiFetch(`/api/accounts/${accountId}/joined-scan`), apiFetch('/api/health')]);
    if (!response.ok) throw new Error(await readError(response));
    const next = ((await response.json()) as { scan: JoinedScanSummary | null }).scan;
    setScan(next);
    if (status.ok) setHealth(await status.json() as HealthResponse);
  }, [accountId]);
  useEffect(() => {
    setScan(null); setMessage(''); setHealth(null);
    let disposed = false;
    const refresh = async () => { if (!disposed) await poll(); };
    refresh().catch((e) => { if (!disposed) setMessage(networkMessage(e)); });
    const timer = setInterval(() => { refresh().catch(() => undefined); }, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [poll]);
  // Each progress update reloads the current list without moving the user's filters or selections.
  useEffect(() => { if (scan) onRefresh().catch(() => undefined); }, [scan, onRefresh]);
  const available = health?.integrations === 'live' && health.worker.alive && health.worker.browser === 'real';
  async function mutate(path: string, body: object) {
    setBusy(true); setMessage('');
    try {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response));
      await poll();
    } catch (error) { setMessage(networkMessage(error)); }
    finally { setBusy(false); }
  }
  return <fieldset>
    <legend>Quét nhóm đã tham gia từ Facebook</legend>
    <p className="notice">Chọn một tài khoản rồi bấm quét. Ứng dụng chỉ đọc nhóm đã tham gia và lưu kết quả tìm được; không tự tham gia hoặc đăng bài. Danh sách có thể chưa đầy đủ; nhóm vắng trong lần quét vẫn được giữ.</p>
    {!account && <p>Chọn một tài khoản ở bộ lọc phía trên để quét.</p>}
    {account && <>
      {!available && <p className="notice">Cần mở ứng dụng ở chế độ THẬT và worker bật trình duyệt để đọc Facebook.</p>}
      {(account.sessionStatus !== 'logged_in' || !account.identity || account.paused) && <p className="notice">Tài khoản cần đăng nhập, xác nhận danh tính và bỏ tạm dừng trước khi quét.</p>}
      <div className="actions">
        <label>Giới hạn số nhóm đọc <input type="number" aria-label="Giới hạn quét nhóm" min={1} max={1000} disabled={active || busy} value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
        <button type="button" disabled={!available || active || busy || account.paused || account.sessionStatus !== 'logged_in' || !account.identity}
          onClick={() => {
            const count = Number(limit);
            if (!Number.isInteger(count) || count < 1 || count > 1000) { setMessage('Nhập giới hạn từ 1 đến 1000 nhóm.'); return; }
            void mutate(`/api/accounts/${account.id}/joined-scan`, { limit: count });
          }}>Quét nhóm đã tham gia</button>
        {active && <button type="button" disabled={busy || !!scan?.cancelRequested} onClick={() => { if (scan) void mutate(`/api/joined-scans/${scan.id}/cancel`, {}); }}>Dừng quét</button>}
      </div>
      {scan && <p role="status">{active ? scan.cancelRequested ? 'Đang dừng quét…' : scan.status === 'queued' ? 'Đang chờ trình duyệt rảnh…' : 'Đang quét…' : 'Lần quét đã kết thúc.'} Đã lưu {scan.observedCount} nhóm có ID số; bỏ qua {scan.withoutIdCount} nhóm chỉ có tên rút gọn. {scan.reasonCode ? JOINED_SCAN_REASON[scan.reasonCode] ?? 'Quét đã dừng.' : ''} Kết quả một phần.</p>}
      <p className="muted">Nhóm mới đọc chưa có quyền đăng được xác nhận. Hãy kiểm tra nội quy và đặt “Được đăng” ở từng nhóm phù hợp, rồi sang Đăng nhóm để chọn theo số lượng.</p>
    </>}
    {message && <p className="field-error" role="alert">{message}</p>}
  </fieldset>;
}
