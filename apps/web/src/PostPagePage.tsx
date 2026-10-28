import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthResponse, JobListItem, JobListResponse, PageConnectionItem, PageListResponse, ProductDetail, ProductListItem, ProductListResponse } from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';
import { describeJobResult, formatVn, JOB_STATUS_LABEL } from './job-view.ts';
import { PAGE_MAX_PHOTOS, pageBlocker, pagePlanProblems, pagePlanSignature } from './page-plan.ts';
import { resolveStart } from './post-plan.ts';
import { emptyDraft } from './post-plan.ts';
import { formFromDetail, previewCaption } from './product-form.ts';

const FINAL = new Set(['published', 'pending_approval', 'failed', 'unknown', 'cancelled', 'blocked']);

async function loadProducts(): Promise<ProductListItem[]> {
  const response = await apiFetch('/api/products?page=1&pageSize=100');
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as ProductListResponse).items.filter((item) => item.status === 'selling');
}

/**
 * Đăng bài (chữ + ảnh) lên MỘT fanpage qua Graph API (P09). Trang chỉ xếp job vào hàng chờ; worker mới gọi Meta, đúng một lần, và kết quả chưa rõ
 * sẽ hiện "Chưa rõ kết quả" để bạn tự kiểm tra, không bao giờ tự gửi lại. Bài đăng lên fanpage là CÔNG KHAI.
 */
export function PostPagePage() {
  const [pages, setPages] = useState<PageConnectionItem[] | null>(null);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [pageId, setPageId] = useState('');
  const [productId, setProductId] = useState('');
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [caption, setCaption] = useState('');
  const [startMode, setStartMode] = useState<'now' | 'later'>('now');
  const [startLocal, setStartLocal] = useState('');
  const [liveConfirm, setLiveConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ jobId: string; replayed: boolean } | null>(null);
  const [job, setJob] = useState<JobListItem | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const attempt = useRef<{ signature: string; key: string; startAt: number } | null>(null);
  const lastTemplate = useRef('');

  const reloadPages = useCallback(async () => {
    const response = await apiFetch('/api/pages');
    if (!response.ok) throw new Error(await readError(response));
    const items = ((await response.json()) as PageListResponse).items;
    setPages(items);
    setPageId((current) => (items.some((item) => item.id === current) ? current : (items.length === 1 ? (items[0]?.id ?? '') : '')));
  }, []);

  useEffect(() => {
    (async () => {
      const [list, healthResponse] = await Promise.all([loadProducts(), apiFetch('/api/health')]);
      setProducts(list);
      if (healthResponse.ok) setHealth((await healthResponse.json()) as HealthResponse);
      await reloadPages();
    })().catch((e) => setMessage(networkMessage(e)));
  }, [reloadPages]);

  useEffect(() => {
    if (!productId) { setDetail(null); return; }
    (async () => {
      const response = await apiFetch(`/api/products/${productId}`);
      if (!response.ok) throw new Error(await readError(response));
      setDetail((await response.json()) as ProductDetail);
    })().catch((e) => setMessage(networkMessage(e)));
  }, [productId]);

  const template = detail ? previewCaption(formFromDetail(detail)) : '';
  // Điền caption mẫu khi chưa có hoặc người dùng chưa sửa gì khỏi caption mẫu trước đó.
  useEffect(() => {
    const previous = lastTemplate.current; // chốt trước: hàm cập nhật chạy muộn, lúc đó lastTemplate đã là giá trị mới
    setCaption((current) => (current.trim() === '' || current === previous ? template : current));
    lastTemplate.current = template;
  }, [template]);

  const poll = useCallback(async () => {
    if (!result) return;
    const response = await apiFetch('/api/jobs?pageSize=50');
    if (!response.ok) return;
    setJob(((await response.json()) as JobListResponse).items.find((item) => item.id === result.jobId) ?? null);
  }, [result]);
  const active = result !== null && !FINAL.has(job?.status ?? 'queued');
  useEffect(() => {
    if (!result) return;
    poll().catch(() => undefined);
    const timer = setInterval(() => { poll().catch(() => undefined); }, active ? 2_000 : 10_000);
    return () => clearInterval(timer);
  }, [result, active, poll]);

  const page = pages?.find((item) => item.id === pageId);
  const live = health?.integrations === 'live';
  const now = Date.now();
  const problems = pagePlanProblems({ page, productId, productSelling: detail?.status === 'selling', photoCount: detail?.mediaIds.length ?? 0, caption, startMode, startLocal, now });
  const startAt = resolveStart({ ...emptyDraft(), startMode, startLocal }, now);
  const ready = problems.length === 0 && (!live || liveConfirm) && !busy;

  async function submit() {
    if (!ready || startAt === null || !page) return;
    const signature = pagePlanSignature(page.id, productId, startMode === 'now' ? 'now' : startAt, caption);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID(), startAt };
    const current = attempt.current;
    setBusy(true);
    setMessage('');
    try {
      // Gửi đúng một lần; mất phản hồi thì bấm lại dùng cùng mã yêu cầu nên không tạo bài trùng.
      const response = await apiFetch('/api/page-posts', { method: 'POST', body: JSON.stringify({
        requestKey: current.key, pageConnectionId: page.id, productId, scheduledAt: current.startAt, caption: caption.trim(), source: caption.trim() === template.trim() ? 'template' : 'manual',
      }) });
      const body = (await response.json()) as { jobs?: Array<{ jobId: string }>; replayed?: boolean; message?: string };
      if (response.status === 409) setMessage('Page chưa đủ điều kiện nên chưa xếp job nào. Kiểm tra trạng thái Page ở trên.');
      else if (!response.ok || !body.jobs?.[0]) setMessage(body.message ?? `Yêu cầu không thành công (HTTP ${response.status}).`);
      else {
        setResult({ jobId: body.jobs[0].jobId, replayed: body.replayed === true });
        setMessage(body.replayed ? 'Yêu cầu này đã được ghi nhận trước đó; không tạo thêm job.' : 'Đã duyệt và xếp 1 job.');
      }
    } catch (e) {
      setMessage(`${networkMessage(e)} Bấm lại sẽ dùng cùng mã yêu cầu, không tạo bài trùng.`);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!page) return;
    setBusy(true);
    setConfirmDisconnect(false);
    try {
      const response = await apiFetch(`/api/pages/${page.id}/disconnect`, { method: 'POST', body: '{}' });
      if (!response.ok) { setMessage(await readError(response)); return; }
      const body = (await response.json()) as { cancelledJobs: number };
      setMessage(`Đã gỡ Page và thu hồi token. ${body.cancelledJobs} bài chưa gửi đã bị hủy.`);
      await reloadPages();
    } catch (e) {
      setMessage(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>Đăng bài fanpage</h1>
        <span className="tag">P09 · {live ? 'THẬT' : 'mô phỏng'}</span>
      </header>
      <p className="muted">Bài gồm caption và ảnh, đăng lên MỘT fanpage qua Graph API. Bài trên fanpage hiển thị <strong>công khai</strong>. Ứng dụng đăng đúng một lần; nếu kết quả chưa rõ, bạn kiểm tra trên Facebook rồi đối chiếu ở Hàng chờ đăng, ứng dụng không tự gửi lại.</p>
      {health && !health.worker.alive && <p className="notice" role="status">Worker chưa chạy nên bài sẽ không được xử lý. Chạy Auto-Post-MKT.cmd hoặc "npm run dev:worker".</p>}
      {message && <p className="notice" role="status">{message}</p>}

      {pages && pages.length === 0 && (
        <div className="notice" role="status">
          <strong>Chưa kết nối Page nào.</strong> Kết nối bằng lệnh <code>npm run page:connect</code> trên máy này (bạn tự nhập App Secret và token ngay trong cửa sổ lệnh; trang này không nhận bí mật).
          Hướng dẫn từng bước ở <code>docs/huong-dan.md</code>, mục fanpage.
        </div>
      )}

      <div className="product-form">
        <fieldset>
          <legend>1. Page</legend>
          <select aria-label="Page" value={pageId} onChange={(event) => { setPageId(event.target.value); setConfirmDisconnect(false); }}>
            <option value="">— chọn Page —</option>
            {pages?.map((item) => <option key={item.id} value={item.id}>{item.name ?? item.pageId}{item.canPost ? '' : ' (chưa đăng được)'}</option>)}
          </select>
          {page && (
            <div>
              <span className="muted mono">ID {page.pageId}</span>{' '}
              {page.canPost ? <span className="ok-text">Sẵn sàng đăng</span> : <span className="field-error">Chưa đăng được: {pageBlocker(page) ?? 'chưa rõ'}</span>}
              <div className="actions">
                {confirmDisconnect
                  ? <><button type="button" disabled={busy} onClick={disconnect}>Xác nhận gỡ</button> <button type="button" onClick={() => setConfirmDisconnect(false)}>Không</button>
                    <span className="muted">Gỡ sẽ thu hồi token và hủy các bài chưa gửi của Page này.</span></>
                  : <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Gỡ Page này</button>}
              </div>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>2. Máy</legend>
          <select aria-label="Máy" value={productId} onChange={(event) => { setProductId(event.target.value); setResult(null); setJob(null); }}>
            <option value="">— chọn máy đang bán —</option>
            {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.mediaCount} ảnh</option>)}
          </select>
          {products.length === 0 && <span className="muted">Chưa có máy đang bán. Thêm ở trang "Quản lý máy".</span>}
          {detail && (
            <ol className="images">
              {detail.mediaIds.map((id, index) => (
                <li key={id}><img className="thumb" src={`/api/media/${id}?size=thumb`} alt={`Ảnh ${index + 1}`} /> <span className="muted">Ảnh {index + 1} (thứ tự đăng)</span></li>
              ))}
            </ol>
          )}
          {detail && detail.mediaIds.length > PAGE_MAX_PHOTOS && <span className="field-error">Bài fanpage tối đa {PAGE_MAX_PHOTOS} ảnh; máy này có {detail.mediaIds.length}.</span>}
        </fieldset>

        <fieldset>
          <legend>3. Caption</legend>
          <textarea aria-label="Caption" rows={6} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Chọn máy để có caption mẫu" />
          {detail && caption !== template && <button type="button" onClick={() => setCaption(template)}>Dùng lại caption mẫu</button>}
          <p className="notice">Caption chỉ gồm dữ kiện bạn đã nhập cho máy. Bạn sửa được trước khi đăng.</p>
        </fieldset>

        <fieldset>
          <legend>4. Lịch</legend>
          <label className="check"><input type="radio" name="page-start" checked={startMode === 'now'} onChange={() => setStartMode('now')} /> Bắt đầu ngay</label>
          <label className="check"><input type="radio" name="page-start" checked={startMode === 'later'} onChange={() => setStartMode('later')} /> Hẹn giờ (giờ Việt Nam)
            <input type="datetime-local" aria-label="Giờ hẹn" disabled={startMode !== 'later'} value={startLocal} onChange={(event) => setStartLocal(event.target.value)} />
          </label>
        </fieldset>

        <fieldset>
          <legend>5. Xem trước</legend>
          {!page || !detail ? <span className="muted">Chọn Page và máy để xem trước.</span> : (
            <div className="preview-card">
              <strong>{page.name ?? page.pageId}</strong> <span className="muted mono">ID {page.pageId}</span>
              <div className="muted">{detail.mediaIds.length} ảnh theo thứ tự đã chọn · {startAt === null ? 'giờ hẹn chưa hợp lệ' : startMode === 'now' ? 'bắt đầu ngay' : formatVn(startAt)} · {live ? 'ĐĂNG THẬT, công khai' : 'mô phỏng'}</div>
              <pre className="caption-box">{caption || '(chưa có caption)'}</pre>
            </div>
          )}
        </fieldset>

        {problems.length > 0 && <ul className="field-error" aria-label="Chưa gửi được">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        {live && (
          <label className="check live-confirm">
            <input type="checkbox" checked={liveConfirm} onChange={(event) => setLiveConfirm(event.target.checked)} />
            Tôi xác nhận ĐĂNG THẬT 1 bài CÔNG KHAI lên fanpage {page?.name ?? '…'} trên Facebook.
          </label>
        )}
        <div className="actions">
          <button type="button" className="primary" disabled={!ready} onClick={submit}>Duyệt và xếp lịch</button>
        </div>
      </div>

      {result && (
        <div className="result-panel">
          <h2>Kết quả{result.replayed ? ' (yêu cầu đã ghi nhận trước đó)' : ''}</h2>
          <p><strong>{job ? JOB_STATUS_LABEL[job.status] : 'Đang tải…'}</strong></p>
          {job && <p className={job.status === 'failed' || job.status === 'unknown' ? 'field-error' : 'muted'}>{describeJobResult(job)}</p>}
          {job?.lastObservation?.remoteId && <p className="muted mono">ID bài: {job.lastObservation.remoteId}</p>}
          <p className="muted">Tạm dừng, hủy hoặc đối chiếu ở trang <a href="#/queue">Hàng chờ đăng</a>.</p>
        </div>
      )}
    </section>
  );
}
