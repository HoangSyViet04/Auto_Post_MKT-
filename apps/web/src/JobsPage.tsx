import { useCallback, useEffect, useState } from 'react';
import {
  type AccountSummary,
  type HealthResponse,
  JOB_STATUSES,
  type JobDetail,
  type JobListItem,
  type JobListResponse,
  type JobStatus,
  type ProductListItem,
  type ProductListResponse,
} from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';
import {
  describeJobResult,
  formatVn,
  JOB_STATUS_LABEL,
  type JobAction,
  jobActions,
  OBSERVATION_SOURCE_LABEL,
  parseVnLocal,
  type Resolution,
  reconcileChoices,
  revisionNotice,
} from './job-view.ts';

const PAGE_SIZE = 20;
const ACTION_LABEL: Record<JobAction, string> = {
  pause: 'Tạm dừng', resume: 'Tiếp tục', cancel: 'Hủy', stop: 'Yêu cầu dừng', run_now: 'Chạy ngay', skip: 'Bỏ',
};
const CHANNEL_LABEL = { profile: 'Trang cá nhân', group: 'Nhóm', page: 'Fanpage' } as const;

export function JobsPage() {
  const [data, setData] = useState<JobListResponse | null>(null);
  const [worker, setWorker] = useState<HealthResponse['worker'] | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [accountId, setAccountId] = useState('');
  const [productId, setProductId] = useState('');
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [confirm, setConfirm] = useState<Resolution | null>(null);
  const [remoteUrl, setRemoteUrl] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (status) params.set('status', status);
    if (accountId) params.set('accountId', accountId);
    if (productId) params.set('productId', productId);
    const from = fromLocal ? parseVnLocal(fromLocal) : null;
    const to = toLocal ? parseVnLocal(toLocal) : null;
    if (from !== null) params.set('from', String(from));
    if (to !== null) params.set('to', String(to));
    const response = await apiFetch(`/api/jobs?${params}`);
    if (!response.ok) throw new Error(await readError(response));
    setData((await response.json()) as JobListResponse);
    const health = await apiFetch('/api/health');
    if (health.ok) setWorker(((await health.json()) as HealthResponse).worker);
  }, [page, status, accountId, productId, fromLocal, toLocal]);

  useEffect(() => {
    (async () => {
      const [accountResponse, productResponse] = await Promise.all([apiFetch('/api/accounts'), apiFetch('/api/products?pageSize=100')]);
      if (accountResponse.ok) setAccounts(((await accountResponse.json()) as { items: AccountSummary[] }).items);
      if (productResponse.ok) setProducts(((await productResponse.json()) as ProductListResponse).items);
    })().catch(() => undefined);
  }, []);

  // Trạng thái đọc từ dữ liệu bền; tự cập nhật, nhanh hơn khi có job đang chạy hoặc sắp tới giờ.
  const hot = (data?.items ?? []).some((job) => job.status === 'running' || job.status === 'queued');
  useEffect(() => {
    load().catch((e) => setMessage(networkMessage(e)));
    const timer = setInterval(() => { load().catch(() => undefined); }, hot ? 3_000 : 10_000);
    return () => clearInterval(timer);
  }, [load, hot]);

  const openDetail = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/jobs/${id}`);
    if (!response.ok) throw new Error(await readError(response));
    setDetail((await response.json()) as JobDetail);
    setConfirm(null);
    setRemoteUrl('');
  }, []);

  /** Mỗi thao tác gửi đúng một lần; lỗi thì báo, không tự gửi lại. */
  async function act(job: JobListItem, action: JobAction) {
    setBusy(true);
    setMessage('');
    try {
      const path = action === 'run_now' ? `/api/jobs/${job.id}/reschedule` : `/api/jobs/${job.id}/${action === 'skip' ? 'cancel' : action}`;
      const body = action === 'run_now' ? JSON.stringify({ scheduledAt: Date.now() }) : '{}';
      const response = await apiFetch(path, { method: 'POST', body });
      if (!response.ok) setMessage(await readError(response));
      else { await load(); setMessage(`${ACTION_LABEL[action]}: đã ghi nhận.`); }
    } catch (e) {
      setMessage(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reconcile(resolution: Resolution) {
    if (!detail) return;
    setBusy(true);
    setMessage('');
    try {
      const body: { resolution: Resolution; remoteUrl?: string } = { resolution };
      if (resolution === 'published' && remoteUrl.trim()) body.remoteUrl = remoteUrl.trim();
      const response = await apiFetch(`/api/jobs/${detail.id}/reconcile`, { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) { setMessage(await readError(response)); return; }
      await Promise.all([load(), openDetail(detail.id)]);
      setMessage('Đã ghi nhận kết quả đối chiếu của bạn (nguồn: xác nhận thủ công).');
    } catch (e) {
      setMessage(networkMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const items = data?.items ?? [];
  const overdue = items.filter((job) => job.overdue);
  const unclear = items.filter((job) => job.status === 'unknown').length;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const reset = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };

  return (
    <section>
      <header className="page-header">
        <h1>Hàng chờ và lịch sử đăng</h1>
        <span className="tag">P07 · P11</span>
      </header>
      <p className="muted">
        Mỗi dòng là một đích của một bài. Giờ hiển thị theo giờ Việt Nam. Trạng thái đọc từ dữ liệu đã lưu nên vẫn đúng sau khi tắt/mở lại ứng dụng.
        Job đã gửi mà chưa rõ kết quả <strong>không bao giờ được tự gửi lại</strong>: bạn kiểm tra trên Facebook rồi ghi nhận kết quả ở phần chi tiết.
      </p>
      {worker && !worker.alive && <p className="notice" role="status">Worker chưa chạy nên job sẽ không được xử lý. Chạy "npm run dev:worker".</p>}
      {unclear > 0 && <p className="field-warning" role="status">Có {unclear} job chưa rõ kết quả. Bấm "Chi tiết" để kiểm tra và đối chiếu.</p>}
      {overdue.length > 0 && (
        <p className="field-warning" role="status">
          Có {overdue.length} job đã quá giờ hẹn (ví dụ do máy tắt). Chúng <strong>không tự chạy</strong> để tránh đăng dồn bài cũ; hãy chọn "Chạy ngay" hoặc "Bỏ" cho từng job.
        </p>
      )}

      <div className="actions">
        <select aria-label="Trạng thái" value={status} onChange={(event) => reset(setStatus)(event.target.value as JobStatus | '')}>
          <option value="">Mọi trạng thái</option>
          {JOB_STATUSES.map((value) => <option key={value} value={value}>{JOB_STATUS_LABEL[value]}</option>)}
        </select>
        <select aria-label="Tài khoản" value={accountId} onChange={(event) => reset(setAccountId)(event.target.value)}>
          <option value="">Mọi tài khoản</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
        <select aria-label="Máy" value={productId} onChange={(event) => reset(setProductId)(event.target.value)}>
          <option value="">Mọi máy</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <label className="check">Từ <input type="datetime-local" aria-label="Từ giờ" value={fromLocal} onChange={(event) => reset(setFromLocal)(event.target.value)} /></label>
        <label className="check">Đến <input type="datetime-local" aria-label="Đến giờ" value={toLocal} onChange={(event) => reset(setToLocal)(event.target.value)} /></label>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      {data && items.length === 0 && <p className="muted">Không có job nào khớp bộ lọc.</p>}
      {items.length > 0 && (
        <table className="table">
          <thead><tr><th>Giờ hẹn</th><th>Đích</th><th>Tài khoản</th><th>Máy</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {items.map((job) => {
              const notice = revisionNotice(job);
              return (
                <tr key={job.id}>
                  <td>{formatVn(job.scheduledAt)}</td>
                  <td>
                    {job.destination.name ?? job.destination.externalId ?? 'Chưa đặt tên'}
                    <div className="muted">{CHANNEL_LABEL[job.channel]}{job.mode === 'fake' ? ' · mô phỏng' : ''}</div>
                  </td>
                  <td>{job.account ? job.account.label : <span className="muted">Kết nối Page</span>}</td>
                  <td>{job.productName}{notice && <div className="field-warning">{notice}</div>}</td>
                  <td>
                    <strong>{JOB_STATUS_LABEL[job.status]}</strong>
                    {job.attempts > 1 && <span className="muted"> · {job.attempts} lần nhận</span>}
                    <div className={job.status === 'failed' || job.status === 'unknown' ? 'field-error' : 'muted'}>{describeJobResult(job)}</div>
                  </td>
                  <td className="row-actions">
                    <button type="button" onClick={() => openDetail(job.id).catch((e) => setMessage(networkMessage(e)))}>Chi tiết</button>
                    {jobActions(job).map((action) => (
                      <button key={action} type="button" disabled={busy} onClick={() => act(job, action)}>{ACTION_LABEL[action]}</button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {data && data.total > data.pageSize && (
        <div className="actions">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
          <span className="muted">Trang {page}/{pages} · {data.total} job</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
        </div>
      )}

      {detail && (
        <div className="result-panel">
          <h2>Chi tiết: {detail.destination.name ?? detail.destination.externalId} · {JOB_STATUS_LABEL[detail.status]}</h2>
          <p className="muted">
            {CHANNEL_LABEL[detail.channel]} · {detail.account?.label ?? 'Kết nối Page'} · {detail.productName} · {formatVn(detail.scheduledAt)}
            {detail.mode === 'fake' ? ' · mô phỏng' : ' · THẬT'}
          </p>
          {revisionNotice(detail) && <p className="field-warning">{revisionNotice(detail)}</p>}
          <h3>Nội dung đã duyệt (không đổi khi máy được sửa sau đó)</h3>
          <pre className="caption-box">{detail.caption}</pre>
          <ol className="images">
            {detail.mediaIds.map((id, index) => (
              <li key={id}><img className="thumb" src={`/api/media/${id}?size=thumb`} alt={`Ảnh ${index + 1}`} /> <span className="muted">Ảnh {index + 1}</span></li>
            ))}
          </ol>

          <h3>Các lần thử</h3>
          {detail.attemptsDetail.length === 0 && <p className="muted">Chưa có lần thử nào.</p>}
          {detail.attemptsDetail.map((attempt) => (
            <div key={attempt.attemptNo} className="preview-card">
              <strong>Lần {attempt.attemptNo}</strong>
              <div className="muted">
                nhận lúc {formatVn(attempt.startedAt)} · {attempt.sendStartedAt ? `bắt đầu gửi ${formatVn(attempt.sendStartedAt)}` : 'chưa bắt đầu gửi (dừng trước khi gửi)'}
                {attempt.finishedAt ? ` · kết thúc ${formatVn(attempt.finishedAt)}` : ''}
              </div>
              {attempt.observations.map((observation) => (
                <div key={`${observation.observedAt}-${observation.source}-${observation.outcome}`}>
                  {formatVn(observation.observedAt)} — <strong>{observation.outcome}</strong> ({OBSERVATION_SOURCE_LABEL[observation.source] ?? observation.source})
                  {observation.reasonCode ? ` · ${observation.reasonCode}` : ''}
                  {observation.remoteUrl && <> · <a href={observation.remoteUrl} target="_blank" rel="noreferrer noopener">mở bài</a></>}
                  {observation.remoteId && !observation.remoteUrl ? <span className="muted mono"> · {observation.remoteId}</span> : null}
                </div>
              ))}
            </div>
          ))}

          {reconcileChoices(detail).length > 0 && (
            <div className="preview-card">
              <strong>Đối chiếu kết quả</strong>
              <p className="muted">
                Job này đã gửi nhưng chưa chắc kết quả. Hãy mở Facebook kiểm tra thật rồi chọn kết quả đúng. Ứng dụng <strong>không tự gửi lại</strong>.
                Nếu bài chưa đăng và bạn muốn đăng lại, hãy tạo bài mới ở trang Đăng bài.
              </p>
              <input className="inline-input" aria-label="Liên kết bài (nếu có)" placeholder="Liên kết bài trên Facebook (không bắt buộc)" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} />
              <div className="actions">
                {reconcileChoices(detail).map((choice) => (
                  confirm === choice.resolution
                    ? <button key={choice.resolution} type="button" className="primary" disabled={busy} onClick={() => reconcile(choice.resolution)}>Xác nhận: {choice.label}</button>
                    : <button key={choice.resolution} type="button" disabled={busy} onClick={() => setConfirm(choice.resolution)}>{choice.label}</button>
                ))}
              </div>
            </div>
          )}

          <h3>Nhật ký hoạt động</h3>
          {detail.activity.length === 0 ? <p className="muted">Chưa có.</p> : (
            <ul className="versions">
              {detail.activity.map((entry) => (
                <li key={`${entry.occurredAt}-${entry.actionCode}`} className="muted">
                  {formatVn(entry.occurredAt)} · {entry.actionCode}{entry.reasonCode ? ` (${entry.reasonCode})` : ''}
                </li>
              ))}
            </ul>
          )}
          <div className="actions"><button type="button" onClick={() => setDetail(null)}>Đóng chi tiết</button></div>
        </div>
      )}
    </section>
  );
}
