import { useCallback, useEffect, useState } from 'react';
import { type AccountSummary, GROUP_JOIN_REASON, GROUP_JOIN_STATUS_LABEL, type GroupJoinQuota, type GroupJoinRequestItem, type GroupJoinSettings, type GroupSearchResultItem,
  type GroupSearchSummary, type HealthResponse, JOINED_SCAN_REASON, SEARCH_LIMIT_MAX } from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';
import { formatCount, joinable, joinProblems, pickJoinable } from './join-plan.ts';
import { formatVn } from './job-view.ts';

const STATE_LABEL = { can_join: 'Có thể tham gia', joined: 'Đã là thành viên', requested: 'Đã gửi yêu cầu', unknown: 'Chưa rõ' } as const;
const PRIVACY_LABEL = { public: 'Công khai', private: 'Riêng tư', unknown: 'Chưa rõ' } as const;

interface JoinsView { requests: GroupJoinRequestItem[]; quota: GroupJoinQuota; settings: GroupJoinSettings }

export function GroupSearchPanel({ account }: { account: AccountSummary | undefined }) {
  const [scan, setScan] = useState<GroupSearchSummary | null>(null);
  const [results, setResults] = useState<GroupSearchResultItem[]>([]);
  const [joins, setJoins] = useState<JoinsView | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [keyword, setKeyword] = useState('');
  const [limit, setLimit] = useState('30');
  const [maxCount, setMaxCount] = useState('3');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [rule, setRule] = useState({ dailyCap: '5', minMinutes: '3', maxMinutes: '6' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const accountId = account?.id ?? '';
  const searching = scan?.status === 'queued' || scan?.status === 'running';
  const queuedRequests = joins?.requests.filter((row) => row.status === 'queued' || row.status === 'running').length ?? 0;

  const poll = useCallback(async () => {
    if (!accountId) return;
    const [searchResponse, joinResponse, status] = await Promise.all([apiFetch(`/api/accounts/${accountId}/group-search`), apiFetch(`/api/accounts/${accountId}/group-joins`), apiFetch('/api/health')]);
    if (!searchResponse.ok) throw new Error(await readError(searchResponse));
    if (!joinResponse.ok) throw new Error(await readError(joinResponse));
    const search = await searchResponse.json() as { scan: GroupSearchSummary | null; results: GroupSearchResultItem[] };
    setScan(search.scan); setResults(search.results);
    setJoins(await joinResponse.json() as JoinsView);
    if (status.ok) setHealth(await status.json() as HealthResponse);
  }, [accountId]);
  useEffect(() => {
    setScan(null); setResults([]); setJoins(null); setHealth(null); setPicked(new Set()); setConfirmed(false); setMessage('');
    let disposed = false;
    const refresh = async () => { if (!disposed) await poll(); };
    refresh().catch((e) => { if (!disposed) setMessage(networkMessage(e)); });
    const timer = setInterval(() => { refresh().catch(() => undefined); }, 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, [poll]);
  // Chỉ giữ tick cho nhóm vẫn xếp được (kết quả mới hoặc trạng thái đổi thì bỏ tick cũ).
  useEffect(() => { setPicked((prev) => { const ok = new Set(results.filter(joinable).map((row) => row.id)); const next = new Set([...prev].filter((id) => ok.has(id))); return next.size === prev.size ? prev : next; }); }, [results]);
  const saved = joins?.settings;
  const savedCap = saved?.dailyCap;
  const savedMin = saved?.minGapSeconds;
  const savedMax = saved?.maxGapSeconds;
  useEffect(() => {
    if (savedCap !== undefined && savedMin !== undefined && savedMax !== undefined) setRule({ dailyCap: String(savedCap), minMinutes: String(savedMin / 60), maxMinutes: String(savedMax / 60) });
  }, [savedCap, savedMin, savedMax]);

  const live = health?.integrations === 'live';
  const available = live && health.worker.alive && health.worker.browser === 'real';
  const ready = !!account && account.sessionStatus === 'logged_in' && !!account.identity && !account.paused;
  const count = Number(maxCount);
  const problems = joinProblems({ selected: picked.size, maxCount: count, quota: joins?.quota ?? null, confirmed });

  async function send(path: string, body: object, method = 'POST', after?: () => void) {
    setBusy(true); setMessage('');
    try {
      const response = await apiFetch(path, { method, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response));
      after?.();
      await poll();
    } catch (error) { setMessage(networkMessage(error)); }
    finally { setBusy(false); }
  }
  function saveRule() {
    const body = { dailyCap: Number(rule.dailyCap), minGapSeconds: Math.round(Number(rule.minMinutes) * 60), maxGapSeconds: Math.round(Number(rule.maxMinutes) * 60) };
    void send('/api/group-join-settings', body, 'PUT');
  }

  return <fieldset>
    <legend>Tìm nhóm theo từ khóa và gửi yêu cầu tham gia</legend>
    <p className="notice">Tìm chỉ đọc kết quả trên Facebook. Gửi yêu cầu tham gia là thao tác THẬT bằng tài khoản bạn chọn. Tham gia nhiều nhóm trong thời gian ngắn có thể khiến Facebook hạn chế tài khoản:
      ứng dụng giới hạn số yêu cầu trong 24 giờ và giãn cách ngẫu nhiên giữa các lần, nhưng không bảo đảm tránh bị hạn chế. Nhóm có câu hỏi bắt buộc sẽ bị bỏ qua để bạn tự làm tay.
      Tham gia xong chưa có nghĩa được đăng: quét lại “Nhóm đã tham gia” rồi tự đặt quyền đăng.</p>
    {!account && <p>Chọn một tài khoản ở bộ lọc phía trên để tìm nhóm.</p>}
    {account && <>
      {!available && <p className="notice">Cần mở ứng dụng ở chế độ THẬT và worker bật trình duyệt để tìm nhóm và gửi yêu cầu.</p>}
      {!ready && <p className="notice">Tài khoản cần đăng nhập, xác nhận danh tính và bỏ tạm dừng trước.</p>}
      <div className="actions">
        <label>Từ khóa <input aria-label="Từ khóa tìm nhóm" maxLength={100} disabled={searching || busy} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ví dụ: mua bán điện thoại" /></label>
        <label>Số kết quả tối đa <input type="number" aria-label="Số kết quả tìm tối đa" min={1} max={SEARCH_LIMIT_MAX} disabled={searching || busy} value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
        <button type="button" disabled={!available || !ready || searching || busy}
          onClick={() => {
            const found = Number(limit);
            if (keyword.trim().length < 2) { setMessage('Nhập từ khóa ít nhất 2 ký tự.'); return; }
            if (!Number.isInteger(found) || found < 1 || found > SEARCH_LIMIT_MAX) { setMessage(`Nhập số kết quả từ 1 đến ${SEARCH_LIMIT_MAX}.`); return; }
            void send(`/api/accounts/${account.id}/group-search`, { keyword: keyword.trim(), limit: found });
          }}>Tìm nhóm</button>
        {searching && <button type="button" disabled={busy || !!scan?.cancelRequested} onClick={() => { if (scan) void send(`/api/group-searches/${scan.id}/cancel`, {}); }}>Dừng tìm</button>}
      </div>
      {scan && <p role="status">Từ khóa “{scan.keyword}”: {searching ? scan.cancelRequested ? 'đang dừng…' : scan.status === 'queued' ? 'đang chờ trình duyệt rảnh…' : 'đang tìm…' : 'đã kết thúc.'} Thấy {scan.observedCount} nhóm có ID số. {scan.reasonCode ? JOINED_SCAN_REASON[scan.reasonCode] ?? 'Tìm đã dừng.' : ''} Kết quả một phần; “Có thể tham gia” chỉ tham khảo, sẽ được kiểm tra lại trên trang nhóm trước khi gửi.</p>}

      {results.length > 0 && <>
        <div className="actions">
          <label>Số nhóm muốn gửi yêu cầu <input type="number" aria-label="Số nhóm muốn gửi yêu cầu tham gia" min={1} max={30} value={maxCount} onChange={(e) => setMaxCount(e.target.value)} /></label>
          <button type="button" onClick={() => setPicked(new Set(pickJoinable(results, count)))}>Chọn tự động {Number.isInteger(count) && count > 0 ? count : '…'} nhóm đầu</button>
          <button type="button" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>Bỏ chọn</button>
        </div>
        <table className="table">
          <thead><tr><th /><th>Nhóm</th><th>Loại</th><th>Thành viên</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {results.map((row) => <tr key={row.id}>
              <td><input type="checkbox" aria-label={`Chọn ${row.name ?? row.externalId}`} checked={picked.has(row.id)} disabled={!joinable(row) || busy}
                onChange={(e) => setPicked((prev) => { const next = new Set(prev); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /></td>
              <td><a href={row.canonicalUrl} target="_blank" rel="noreferrer">{row.name ?? row.externalId}</a></td>
              <td>{PRIVACY_LABEL[row.privacy]}</td>
              <td>{formatCount(row.memberCount)}</td>
              <td>{row.request ? <>{GROUP_JOIN_STATUS_LABEL[row.request.status]}{row.request.reasonCode ? ` · ${GROUP_JOIN_REASON[row.request.reasonCode] ?? ''}` : ''}</> : STATE_LABEL[row.joinState]}</td>
            </tr>)}
          </tbody>
        </table>
      </>}

      {joins && <p role="status">Hạn mức 24 giờ của tài khoản này: đã dùng {joins.quota.used}/{joins.quota.cap}, đang chờ gửi {joins.quota.pending}, còn xếp thêm được {Math.max(0, joins.quota.remaining - joins.quota.pending)}.
        {joins.quota.nextFreeAt ? ` Có chỗ trống lại lúc ${formatVn(joins.quota.nextFreeAt)}.` : ''}</p>}
      {results.length > 0 && <>
        <label className="check live-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Tôi xác nhận GỬI THẬT {picked.size} yêu cầu tham gia nhóm bằng tài khoản {account.label}.</label>
        {problems.length > 0 && picked.size > 0 && <ul className="field-error">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        <div className="actions">
          <button type="button" className="primary" disabled={!available || !ready || busy || problems.length > 0}
            onClick={() => void send(`/api/accounts/${account.id}/group-joins`, { searchResultIds: [...picked], maxCount: count, confirmReal: true }, 'POST', () => { setPicked(new Set()); setConfirmed(false); })}>
            Gửi yêu cầu tham gia ({picked.size})
          </button>
          {queuedRequests > 0 && <button type="button" disabled={busy} onClick={() => void send(`/api/accounts/${account.id}/group-joins/cancel-queued`, {})}>Hủy các yêu cầu đang chờ ({queuedRequests})</button>}
        </div>
      </>}

      {joins && joins.requests.length > 0 && <>
        <h3>Yêu cầu tham gia gần đây</h3>
        <table className="table">
          <thead><tr><th>Nhóm</th><th>Kết quả</th><th>Giờ gửi dự kiến / đã gửi</th><th /></tr></thead>
          <tbody>
            {joins.requests.slice(0, 20).map((row) => <tr key={row.id}>
              <td><a href={row.canonicalUrl} target="_blank" rel="noreferrer">{row.name ?? row.externalId}</a></td>
              <td>{GROUP_JOIN_STATUS_LABEL[row.status]}{row.reasonCode ? ` · ${GROUP_JOIN_REASON[row.reasonCode] ?? ''}` : ''}</td>
              <td>{formatVn(row.sentAt ?? row.notBefore)}</td>
              <td>{row.status === 'queued' && <button type="button" disabled={busy} onClick={() => void send(`/api/group-joins/${row.id}/cancel`, {})}>Hủy</button>}</td>
            </tr>)}
          </tbody>
        </table>
      </>}

      <details>
        <summary>Hạn mức và khoảng cách giữa các lần gửi</summary>
        <div className="actions">
          <label>Số yêu cầu tối đa mỗi 24 giờ (mỗi tài khoản) <input type="number" aria-label="Hạn mức yêu cầu mỗi ngày" min={1} max={30} value={rule.dailyCap} onChange={(e) => setRule({ ...rule, dailyCap: e.target.value })} /></label>
          <label>Cách nhau tối thiểu (phút) <input type="number" aria-label="Khoảng cách tối thiểu phút" min={1} max={60} value={rule.minMinutes} onChange={(e) => setRule({ ...rule, minMinutes: e.target.value })} /></label>
          <label>Tối đa (phút) <input type="number" aria-label="Khoảng cách tối đa phút" min={1} max={120} value={rule.maxMinutes} onChange={(e) => setRule({ ...rule, maxMinutes: e.target.value })} /></label>
          <button type="button" disabled={busy} onClick={saveRule}>Lưu</button>
        </div>
        <p className="muted">Mỗi yêu cầu cách yêu cầu trước một khoảng ngẫu nhiên trong khoảng này. Hạn mức tính theo 24 giờ gần nhất, không theo ngày lịch. Ứng dụng từ chối xếp vượt hạn mức và kiểm tra lại ngay trước khi bấm.</p>
      </details>
    </>}
    {message && <p className="field-error" role="alert">{message}</p>}
  </fieldset>;
}
