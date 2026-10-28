import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountSummary, HealthResponse, JobListItem, JobListResponse, ProductDetail, ProductListItem, ProductListResponse } from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';
import { describeJobResult, formatVn, JOB_STATUS_LABEL, parseVnLocal } from './job-view.ts';
import { duplicateWarning, planSignature } from './post-plan.ts';
import { formFromDetail, previewCaption } from './product-form.ts';

const FINAL = new Set(['published', 'pending_approval', 'failed', 'unknown', 'cancelled']);

interface Outcome { accountId: string; jobId?: string; error?: string }
/** Bản nháp đang soạn được giữ khi chuyển trang (chỉ trong phiên của tab). */
let remembered: { productId: string; caption: string; overrides: Record<string, string>; selected: string[] } | null = null;

export function PostProfilePage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [productId, setProductId] = useState(remembered?.productId ?? '');
  const [caption, setCaption] = useState(remembered?.caption ?? '');
  const [overrides, setOverrides] = useState<Record<string, string>>(remembered?.overrides ?? {});
  const [selected, setSelected] = useState<string[]>(remembered?.selected ?? []);
  const [startMode, setStartMode] = useState<'now' | 'later'>('now');
  const [startLocal, setStartLocal] = useState('');
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [liveConfirm, setLiveConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [jobs, setJobs] = useState<Map<string, JobListItem>>(new Map());
  /** Mã yêu cầu theo từng tài khoản; giữ nguyên khi nội dung không đổi nên bấm lại không tạo job trùng. */
  const attempts = useRef(new Map<string, { signature: string; key: string; startAt: number }>());
  const lastTemplate = useRef('');

  useEffect(() => { remembered = { productId, caption, overrides, selected }; }, [productId, caption, overrides, selected]);

  useEffect(() => {
    (async () => {
      const [accountResponse, productResponse, healthResponse] = await Promise.all([apiFetch('/api/accounts'), apiFetch('/api/products?pageSize=100'), apiFetch('/api/health')]);
      if (accountResponse.ok) setAccounts(((await accountResponse.json()) as { items: AccountSummary[] }).items);
      if (productResponse.ok) setProducts(((await productResponse.json()) as ProductListResponse).items.filter((item) => item.status === 'selling'));
      if (healthResponse.ok) setHealth((await healthResponse.json()) as HealthResponse);
    })().catch((e) => setMessage(networkMessage(e)));
  }, []);

  useEffect(() => {
    if (!productId) { setDetail(null); return; }
    (async () => {
      const response = await apiFetch(`/api/products/${productId}`);
      if (!response.ok) throw new Error(await readError(response));
      const loaded = (await response.json()) as ProductDetail;
      setDetail(loaded);
      const template = previewCaption(formFromDetail(loaded));
      setCaption((current) => (current.trim() === '' || current === lastTemplate.current ? template : current));
      lastTemplate.current = template;
    })().catch((e) => setMessage(networkMessage(e)));
  }, [productId]);

  const poll = useCallback(async () => {
    const response = await apiFetch('/api/jobs?pageSize=100');
    if (!response.ok) return;
    setJobs(new Map(((await response.json()) as JobListResponse).items.map((job) => [job.id, job])));
  }, []);
  const active = outcomes.some((outcome) => outcome.jobId && !FINAL.has(jobs.get(outcome.jobId)?.status ?? 'queued'));
  useEffect(() => {
    if (outcomes.length === 0) return;
    poll().catch(() => undefined);
    const timer = setInterval(() => { poll().catch(() => undefined); }, active ? 2_000 : 10_000);
    return () => clearInterval(timer);
  }, [outcomes, active, poll]);

  const live = health?.integrations === 'live';
  const template = detail ? previewCaption(formFromDetail(detail)) : '';
  const eligibility = (account: AccountSummary): string | null => {
    if (account.paused) return 'đang tạm dừng';
    if (!account.identity) return 'chưa xác nhận danh tính (đăng nhập ở trang Quản lý tài khoản)';
    if (account.sessionStatus !== 'logged_in') return 'chưa đăng nhập hoặc cần kiểm tra phiên';
    return null;
  };
  const captionOf = (accountId: string) => (overrides[accountId]?.trim() ? overrides[accountId]?.trim() : caption.trim()) ?? '';
  const items = selected.map((accountId) => ({ destinationId: accountId, caption: captionOf(accountId), source: (captionOf(accountId) === template.trim() ? 'template' : 'manual') as 'template' | 'manual' }));
  const startAt = startMode === 'now' ? Date.now() : parseVnLocal(startLocal);
  const problems: string[] = [];
  if (selected.length === 0) problems.push('Chọn ít nhất một tài khoản.');
  if (!productId) problems.push('Chọn máy.');
  if (items.some((item) => !item.caption)) problems.push('Có tài khoản chưa có caption.');
  if (startMode === 'later' && (startAt === null || startAt < Date.now() - 15 * 60_000)) problems.push('Giờ hẹn không hợp lệ hoặc đã qua quá lâu (nhập theo giờ Việt Nam).');
  const duplicate = duplicateWarning(items);
  const ready = problems.length === 0 && (!live || liveConfirm) && !busy;
  const labelOf = (accountId: string) => accounts.find((account) => account.id === accountId)?.label ?? accountId;

  async function submit() {
    if (!ready || startAt === null) return;
    setBusy(true);
    setMessage('');
    const results: Outcome[] = [];
    try {
      for (const item of items) {
        const accountId = item.destinationId;
        try {
          // Đích là trang cá nhân CỦA CHÍNH tài khoản này (không lấy từ danh sách nhóm).
          const destination = await apiFetch(`/api/accounts/${accountId}/profile-destination`, { method: 'POST', body: '{}' });
          if (!destination.ok) { results.push({ accountId, error: await readError(destination) }); continue; }
          const { id: destinationId } = (await destination.json()) as { id: string };
          const signature = planSignature(accountId, productId, startMode === 'now' ? 'now' : startAt, [item]);
          const previous = attempts.current.get(accountId);
          const attempt = previous?.signature === signature ? previous : { signature, key: crypto.randomUUID(), startAt };
          attempts.current.set(accountId, attempt);
          const response = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({
            requestKey: attempt.key, accountId, productId, scheduledAt: attempt.startAt,
            items: [{ destinationId, caption: item.caption, source: item.source }],
          }) });
          const body = (await response.json()) as { jobs?: Array<{ jobId: string }>; failures?: Array<{ code: string }>; message?: string };
          if (response.ok && body.jobs?.[0]) results.push({ accountId, jobId: body.jobs[0].jobId });
          else results.push({ accountId, error: body.failures?.[0] ? `Chưa đủ điều kiện (${body.failures[0].code}).` : (body.message ?? `HTTP ${response.status}`) });
        } catch (e) {
          results.push({ accountId, error: `${networkMessage(e)} Bấm lại dùng cùng mã yêu cầu, không tạo job trùng.` });
        }
      }
      setOutcomes(results);
      const ok = results.filter((result) => result.jobId).length;
      setMessage(ok === results.length ? `Đã duyệt và xếp ${ok} job.` : `${ok}/${results.length} tài khoản đã xếp; xem lỗi bên dưới. Bấm lại chỉ gửi lại phần chưa xếp (cùng mã yêu cầu).`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>Đăng bài viết cá nhân</h1>
        <span className="tag">P10 · {live ? 'THẬT' : 'mô phỏng'}</span>
      </header>
      <p className="muted">Đăng lên trang cá nhân của chính từng tài khoản đã chọn. Đích luôn là trang cá nhân của tài khoản đó, không lấy từ danh sách nhóm.</p>
      {health && !health.worker.alive && <p className="notice" role="status">Worker chưa chạy nên bài sẽ không được xử lý. Chạy "npm run dev:worker".</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <div className="product-form">
        <fieldset>
          <legend>1. Tài khoản (một hoặc hai)</legend>
          {accounts.length === 0 && <span className="muted">Chưa có tài khoản. Thêm ở trang Quản lý tài khoản.</span>}
          {accounts.map((account) => {
            const reason = eligibility(account);
            return (
              <label key={account.id} className="check">
                <input type="checkbox" aria-label={`Chọn ${account.label}`} disabled={reason !== null} checked={selected.includes(account.id)}
                  onChange={(event) => { setSelected(event.target.checked ? [...selected, account.id] : selected.filter((id) => id !== account.id)); setOutcomes([]); }} />
                <span><strong>{account.label}</strong>{account.identity ? <span className="muted mono"> {account.identity.remoteId}</span> : null}
                  {reason && <span className="muted"> — chưa đăng được: {reason}</span>}</span>
              </label>
            );
          })}
        </fieldset>

        <fieldset>
          <legend>2. Máy</legend>
          <select aria-label="Máy" value={productId} onChange={(event) => { setProductId(event.target.value); setOutcomes([]); }}>
            <option value="">— chọn máy đang bán —</option>
            {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.mediaCount} ảnh</option>)}
          </select>
          {detail && (
            <ol className="images">
              {detail.mediaIds.map((id, index) => <li key={id}><img className="thumb" src={`/api/media/${id}?size=thumb`} alt={`Ảnh ${index + 1}`} /> <span className="muted">Ảnh {index + 1} (thứ tự đăng)</span></li>)}
            </ol>
          )}
        </fieldset>

        <fieldset>
          <legend>3. Caption chung</legend>
          <textarea aria-label="Caption" rows={6} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Chọn máy để có caption mẫu" />
          {detail && caption !== template && <button type="button" onClick={() => setCaption(template)}>Dùng lại caption mẫu</button>}
        </fieldset>

        <fieldset>
          <legend>4. Lịch</legend>
          <label className="check"><input type="radio" name="start" checked={startMode === 'now'} onChange={() => setStartMode('now')} /> Bắt đầu ngay</label>
          <label className="check"><input type="radio" name="start" checked={startMode === 'later'} onChange={() => setStartMode('later')} /> Hẹn giờ (giờ Việt Nam)
            <input type="datetime-local" aria-label="Giờ hẹn" disabled={startMode !== 'later'} value={startLocal} onChange={(event) => setStartLocal(event.target.value)} />
          </label>
        </fieldset>

        <fieldset>
          <legend>5. Xem trước từng tài khoản</legend>
          {items.length === 0 && <span className="muted">Chọn tài khoản để xem trước.</span>}
          {duplicate && <span className="field-warning">Hai tài khoản đang dùng cùng một caption. Nên sửa riêng từng tài khoản để tránh lặp nội dung giữa hai trang.</span>}
          {items.map((item) => {
            const account = accounts.find((entry) => entry.id === item.destinationId);
            return (
              <div key={item.destinationId} className="preview-card">
                <strong>Trang cá nhân của {account?.label}</strong> <span className="muted mono">{account?.identity?.remoteId}</span>
                <div className="muted">
                  {detail?.mediaIds.length ?? 0} ảnh theo thứ tự đã chọn · {startMode === 'now' ? 'bắt đầu ngay' : startAt === null ? 'giờ hẹn chưa hợp lệ' : formatVn(startAt)} · {live ? 'ĐĂNG THẬT' : 'mô phỏng'}
                </div>
                <textarea aria-label={`Caption cho ${account?.label}`} rows={4} value={overrides[item.destinationId] ?? item.caption}
                  onChange={(event) => setOverrides({ ...overrides, [item.destinationId]: event.target.value })} />
              </div>
            );
          })}
          <p className="notice">Đối tượng của bài (công khai, bạn bè…) lấy theo cài đặt Facebook của tài khoản. Nếu cấu hình worker có APM_PROFILE_AUDIENCE, bài sẽ dừng khi đối tượng khác cấu hình.</p>
        </fieldset>

        {problems.length > 0 && <ul className="field-error" aria-label="Chưa gửi được">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        {live && (
          <label className="check live-confirm">
            <input type="checkbox" checked={liveConfirm} onChange={(event) => setLiveConfirm(event.target.checked)} />
            Tôi xác nhận ĐĂNG THẬT {items.length} bài lên trang cá nhân: {selected.map(labelOf).join(', ') || '…'}.
          </label>
        )}
        <div className="actions">
          <button type="button" className="primary" disabled={!ready} onClick={submit}>Duyệt và xếp lịch ({items.length} tài khoản)</button>
        </div>
      </div>

      {outcomes.length > 0 && (
        <div className="result-panel">
          <h2>Kết quả từng tài khoản</h2>
          <table className="table">
            <thead><tr><th>Tài khoản</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {outcomes.map((outcome) => {
                const job = outcome.jobId ? jobs.get(outcome.jobId) : undefined;
                return (
                  <tr key={outcome.accountId}>
                    <td>{labelOf(outcome.accountId)}</td>
                    <td>
                      {outcome.error ? <span className="field-error">{outcome.error}</span> : (
                        <>
                          <strong>{job ? JOB_STATUS_LABEL[job.status] : 'Đang tải…'}</strong>
                          {job && <div className={job.status === 'failed' || job.status === 'unknown' ? 'field-error' : 'muted'}>{describeJobResult(job)}</div>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">Tạm dừng, hủy hoặc chạy ngay ở trang <a href="#/queue">Hàng chờ đăng</a>.</p>
        </div>
      )}
    </section>
  );
}
