import { useCallback, useEffect, useState } from 'react';
import { type HealthResponse, JOB_STATUSES, type JobListItem, type JobListResponse, type JobStatus } from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';
import { describeJobResult, formatVn, JOB_STATUS_LABEL, type JobAction, jobActions } from './job-view.ts';

const PAGE_SIZE = 20;
const ACTION_LABEL: Record<JobAction, string> = {
  pause: 'Tạm dừng', resume: 'Tiếp tục', cancel: 'Hủy', stop: 'Yêu cầu dừng', run_now: 'Chạy ngay', skip: 'Bỏ',
};
const CHANNEL_LABEL = { profile: 'Trang cá nhân', group: 'Nhóm', page: 'Fanpage' } as const;

export function JobsPage() {
  const [data, setData] = useState<JobListResponse | null>(null);
  const [worker, setWorker] = useState<HealthResponse['worker'] | null>(null);
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (status) params.set('status', status);
    const response = await apiFetch(`/api/jobs?${params}`);
    if (!response.ok) throw new Error(await readError(response));
    setData((await response.json()) as JobListResponse);
    const health = await apiFetch('/api/health');
    if (health.ok) setWorker(((await health.json()) as HealthResponse).worker);
  }, [page, status]);

  // Trạng thái đọc từ dữ liệu bền; tự cập nhật, nhanh hơn khi có job đang chạy hoặc sắp tới giờ.
  const hot = (data?.items ?? []).some((job) => job.status === 'running' || job.status === 'queued');
  useEffect(() => {
    load().catch((e) => setMessage(networkMessage(e)));
    const timer = setInterval(() => { load().catch(() => undefined); }, hot ? 3_000 : 10_000);
    return () => clearInterval(timer);
  }, [load, hot]);

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

  const items = data?.items ?? [];
  const overdue = items.filter((job) => job.overdue);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section>
      <header className="page-header">
        <h1>Hàng chờ đăng</h1>
        <span className="tag">P07 · mô phỏng</span>
      </header>
      <p className="muted">
        Mỗi dòng là một đích của một bài. Giờ hẹn hiển thị theo giờ Việt Nam. Trạng thái đọc từ dữ liệu đã lưu, nên vẫn đúng sau khi tắt/mở
        lại ứng dụng. Job đã gửi mà chưa rõ kết quả không bao giờ được tự gửi lại.
      </p>
      {worker && !worker.alive && (
        <p className="notice" role="status">Worker chưa chạy nên job sẽ không được xử lý. Chạy "npm run dev:worker".</p>
      )}
      {overdue.length > 0 && (
        <p className="field-warning" role="status">
          Có {overdue.length} job đã quá giờ hẹn (ví dụ do máy tắt). Chúng <strong>không tự chạy</strong> để tránh đăng dồn bài cũ; hãy chọn "Chạy ngay" hoặc "Bỏ" cho từng job.
        </p>
      )}
      <div className="actions">
        <select aria-label="Trạng thái" value={status} onChange={(event) => { setStatus(event.target.value as JobStatus | ''); setPage(1); }}>
          <option value="">Mọi trạng thái</option>
          {JOB_STATUSES.map((value) => <option key={value} value={value}>{JOB_STATUS_LABEL[value]}</option>)}
        </select>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      {data && items.length === 0 && <p className="muted">Chưa có job nào.</p>}
      {items.length > 0 && (
        <table className="table">
          <thead><tr><th>Giờ hẹn</th><th>Đích</th><th>Tài khoản</th><th>Máy</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {items.map((job) => (
              <tr key={job.id}>
                <td>{formatVn(job.scheduledAt)}</td>
                <td>
                  {job.destination.name ?? job.destination.externalId ?? 'Chưa đặt tên'}
                  <div className="muted">{CHANNEL_LABEL[job.channel]}{job.mode === 'fake' ? ' · mô phỏng' : ''}</div>
                </td>
                <td>{job.account ? job.account.label : <span className="muted">Kết nối Page</span>}</td>
                <td>{job.productName}</td>
                <td>
                  <strong>{JOB_STATUS_LABEL[job.status]}</strong>
                  {job.attempts > 1 && <span className="muted"> · {job.attempts} lần nhận</span>}
                  <div className={job.status === 'failed' || job.status === 'unknown' ? 'field-error' : 'muted'}>{describeJobResult(job)}</div>
                </td>
                <td className="row-actions">
                  {jobActions(job).map((action) => (
                    <button key={action} type="button" disabled={busy} onClick={() => act(job, action)}>{ACTION_LABEL[action]}</button>
                  ))}
                </td>
              </tr>
            ))}
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
    </section>
  );
}
