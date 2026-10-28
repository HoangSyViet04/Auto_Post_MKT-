import { useCallback, useEffect, useState } from 'react';
import type { JobListItem, JobListResponse, ProductListItem, ProductListResponse, SalesEventItem, SalesEventListResponse, SalesKind, SalesSummary } from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';
import { formatVn, parseVnLocal } from './job-view.ts';
import { emptySalesDraft, KIND_LABEL, SOURCE_JOB_STATUSES, type SalesDraft, salesBody, sourceLabel } from './sales-form.ts';

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} đ`;

async function loadProducts(): Promise<ProductListItem[]> {
  const all: ProductListItem[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await apiFetch(`/api/products?page=${page}&pageSize=100`);
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as ProductListResponse;
    all.push(...body.items);
    if (all.length >= body.total || body.items.length === 0) break;
  }
  return all;
}

/**
 * Khách hỏi và đơn hàng (P11.9): người dùng TỰ GHI NHẬN. Ứng dụng không đọc tin nhắn, bình luận hay tương tác từ Facebook,
 * nên số liệu ở đây chỉ phản ánh những gì bạn nhập.
 */
export function SalesPage() {
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [draft, setDraft] = useState<SalesDraft>(() => emptySalesDraft(Date.now()));
  const [sources, setSources] = useState<JobListItem[]>([]);
  const [events, setEvents] = useState<SalesEventListResponse | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [kindFilter, setKindFilter] = useState<'' | SalesKind>('');
  const [productFilter, setProductFilter] = useState('');
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [page, setPage] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState('');

  const from = fromLocal ? parseVnLocal(fromLocal) : null;
  const to = toLocal ? parseVnLocal(toLocal) : null;
  const rangeInvalid = (fromLocal !== '' && from === null) || (toLocal !== '' && to === null);

  const reload = useCallback(async () => {
    if (rangeInvalid) return;
    const range = `${from !== null ? `&from=${from}` : ''}${to !== null ? `&to=${to}` : ''}`;
    const filters = `${kindFilter ? `&kind=${kindFilter}` : ''}${productFilter ? `&productId=${productFilter}` : ''}${showVoided ? '&includeVoided=true' : ''}`;
    const [list, totals] = await Promise.all([apiFetch(`/api/sales-events?page=${page}&pageSize=20${range}${filters}`), apiFetch(`/api/sales-events/summary?${range.slice(1)}`)]);
    if (!list.ok) throw new Error(await readError(list));
    setEvents((await list.json()) as SalesEventListResponse);
    if (totals.ok) setSummary((await totals.json()) as SalesSummary);
  }, [from, to, rangeInvalid, kindFilter, productFilter, showVoided, page]);

  useEffect(() => { loadProducts().then(setProducts).catch((e) => setMessage(networkMessage(e))); }, []);
  useEffect(() => { reload().catch((e) => setMessage(networkMessage(e))); }, [reload]);

  // Bài nguồn gợi ý: các bài ĐÃ gửi đi của máy đang chọn.
  useEffect(() => {
    if (!draft.productId) { setSources([]); return; }
    apiFetch(`/api/jobs?productId=${draft.productId}&pageSize=100`)
      .then(async (response) => { if (response.ok) setSources(((await response.json()) as JobListResponse).items.filter((job) => SOURCE_JOB_STATUSES.has(job.status))); })
      .catch(() => setSources([]));
  }, [draft.productId]);

  const set = (patch: Partial<SalesDraft>) => { setDraft((current) => ({ ...current, ...patch })); setErrors([]); };

  async function submit() {
    const result = salesBody(draft, Date.now());
    if (!result.ok) { setErrors(result.errors); return; }
    setBusy(true);
    setMessage('');
    try {
      // Gửi đúng một lần mỗi lần bấm; lỗi thì báo, không tự gửi lại (tránh ghi trùng).
      const response = await apiFetch('/api/sales-events', { method: 'POST', body: JSON.stringify(result.body) });
      if (!response.ok) { setMessage(await readError(response)); return; }
      setMessage(`Đã ghi nhận ${KIND_LABEL[draft.kind].toLowerCase()}.`);
      setDraft((current) => ({ ...emptySalesDraft(Date.now()), kind: current.kind, productId: current.productId, jobId: current.jobId }));
      setPage(1);
      await reload();
    } catch (e) {
      setMessage(`${networkMessage(e)} Kiểm tra danh sách bên dưới trước khi nhập lại để không ghi trùng.`);
    } finally {
      setBusy(false);
    }
  }

  async function voidEvent(id: string) {
    setBusy(true);
    setConfirmVoid('');
    try {
      const response = await apiFetch(`/api/sales-events/${id}/void`, { method: 'POST', body: '{}' });
      setMessage(response.ok ? 'Đã đánh dấu hủy (dòng vẫn được giữ lại để đối chiếu).' : await readError(response));
      await reload();
    } catch (e) {
      setMessage(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const pages = events ? Math.max(1, Math.ceil(events.total / events.pageSize)) : 1;

  return (
    <section>
      <header className="page-header">
        <h1>Khách hỏi và đơn hàng</h1>
        <span className="tag">P11</span>
      </header>
      <p className="muted">Bạn tự ghi nhận khách hỏi và đơn hàng từ bài đã đăng. Ứng dụng <strong>không tự đọc</strong> tin nhắn, bình luận hay tương tác từ Facebook, nên số liệu chỉ phản ánh những gì bạn nhập.</p>
      {message && <p className="notice" role="status">{message}</p>}

      <div className="product-form">
        <fieldset>
          <legend>Ghi nhận mới</legend>
          <div className="actions">
            {(['inquiry', 'order'] as const).map((kind) => (
              <label key={kind} className="check"><input type="radio" name="sales-kind" checked={draft.kind === kind} onChange={() => set({ kind })} /> {KIND_LABEL[kind]}</label>
            ))}
          </div>
          <label>
            Máy *
            <select aria-label="Máy" value={draft.productId} onChange={(event) => set({ productId: event.target.value, jobId: '' })}>
              <option value="">— chọn máy —</option>
              {products.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === 'selling' ? '' : ' (không còn bán)'}</option>)}
            </select>
          </label>
          <label>
            Từ bài đăng nào (không bắt buộc)
            <select aria-label="Bài nguồn" value={draft.jobId} disabled={!draft.productId} onChange={(event) => set({ jobId: event.target.value })}>
              <option value="">Không rõ nguồn</option>
              {sources.map((job) => <option key={job.id} value={job.id}>{job.destination.name ?? job.destination.externalId ?? 'chưa đặt tên'} · {formatVn(job.scheduledAt)}</option>)}
            </select>
          </label>
          {draft.productId && sources.length === 0 && <span className="muted">Máy này chưa có bài nào đã gửi đi để chọn làm nguồn.</span>}
          <label>
            Thời điểm (giờ Việt Nam) *
            <input type="datetime-local" aria-label="Thời điểm" value={draft.occurredLocal} onChange={(event) => set({ occurredLocal: event.target.value })} />
          </label>
          <label>
            Tên/biệt danh khách (không bắt buộc)
            <input aria-label="Tên khách" value={draft.customerLabel} maxLength={200} onChange={(event) => set({ customerLabel: event.target.value })} />
          </label>
          {draft.kind === 'order' && (
            <label>
              Giá trị đơn (VND, không bắt buộc)
              <input aria-label="Giá trị đơn" inputMode="numeric" value={draft.amount} placeholder="9.500.000" onChange={(event) => set({ amount: event.target.value })} />
            </label>
          )}
          <label>
            Ghi chú (không bắt buộc)
            <textarea aria-label="Ghi chú" rows={3} value={draft.note} maxLength={2000} onChange={(event) => set({ note: event.target.value })} />
          </label>
          <span className="muted">Tên khách và ghi chú nằm trong bản sao lưu dữ liệu. Không nhập mật khẩu, mã xác minh hay thông tin thanh toán.</span>
          {errors.length > 0 && <ul className="field-error" aria-label="Chưa ghi nhận được">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={submit}>Ghi nhận {KIND_LABEL[draft.kind].toLowerCase()}</button>
          </div>
        </fieldset>
      </div>

      <h2>Tổng hợp</h2>
      <div className="actions">
        <label className="check">Từ <input type="datetime-local" aria-label="Từ giờ" value={fromLocal} onChange={(event) => { setFromLocal(event.target.value); setPage(1); }} /></label>
        <label className="check">Đến <input type="datetime-local" aria-label="Đến giờ" value={toLocal} onChange={(event) => { setToLocal(event.target.value); setPage(1); }} /></label>
        {rangeInvalid && <span className="field-error">Khoảng giờ không hợp lệ.</span>}
      </div>
      {summary && (
        <>
          <p><strong>{summary.total.inquiries}</strong> khách hỏi · <strong>{summary.total.orders}</strong> đơn hàng · giá trị đơn đã nhập {money(summary.total.orderAmountVnd)}</p>
          <table className="table">
            <thead><tr><th>Theo máy</th><th>Khách hỏi</th><th>Đơn</th><th>Giá trị đơn</th></tr></thead>
            <tbody>
              {summary.byProduct.map((row) => <tr key={row.productId}><td>{row.productName}</td><td>{row.inquiries}</td><td>{row.orders}</td><td>{money(row.orderAmountVnd)}</td></tr>)}
              {summary.byProduct.length === 0 && <tr><td colSpan={4} className="muted">Chưa có ghi nhận.</td></tr>}
            </tbody>
          </table>
          <table className="table">
            <thead><tr><th>Theo nơi đăng</th><th>Khách hỏi</th><th>Đơn</th><th>Giá trị đơn</th></tr></thead>
            <tbody>
              {summary.bySource.map((row) => (
                <tr key={row.destination?.id ?? 'none'}><td>{sourceLabel(row.destination ? { channel: row.destination.channel, destinationId: row.destination.id, name: row.destination.name, externalId: row.destination.externalId } : null)}</td>
                  <td>{row.inquiries}</td><td>{row.orders}</td><td>{money(row.orderAmountVnd)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Đã ghi nhận</h2>
      <div className="actions">
        <select aria-label="Lọc loại" value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as '' | SalesKind); setPage(1); }}>
          <option value="">Cả hai loại</option>
          <option value="inquiry">Khách hỏi</option>
          <option value="order">Đơn hàng</option>
        </select>
        <select aria-label="Lọc máy" value={productFilter} onChange={(event) => { setProductFilter(event.target.value); setPage(1); }}>
          <option value="">Mọi máy</option>
          {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={showVoided} onChange={(event) => { setShowVoided(event.target.checked); setPage(1); }} /> Hiện cả dòng đã hủy</label>
      </div>
      <table className="table">
        <thead><tr><th>Thời điểm</th><th>Loại</th><th>Máy</th><th>Nguồn</th><th>Khách / ghi chú</th><th>Giá trị</th><th /></tr></thead>
        <tbody>
          {events?.items.map((entry: SalesEventItem) => (
            <tr key={entry.id} className={entry.voided ? 'archived' : undefined}>
              <td>{formatVn(entry.occurredAt)}</td>
              <td>{KIND_LABEL[entry.kind]}{entry.voided ? ' (đã hủy)' : ''}</td>
              <td>{entry.productName}</td>
              <td>{sourceLabel(entry.source)}</td>
              <td>{entry.customerLabel ?? <span className="muted">—</span>}{entry.note && <div className="muted">{entry.note}</div>}</td>
              <td>{entry.amountVnd === null ? '' : money(entry.amountVnd)}</td>
              <td>
                {!entry.voided && (confirmVoid === entry.id
                  ? <><button type="button" disabled={busy} onClick={() => voidEvent(entry.id)}>Xác nhận hủy</button> <button type="button" onClick={() => setConfirmVoid('')}>Không</button></>
                  : <button type="button" disabled={busy} onClick={() => setConfirmVoid(entry.id)}>Hủy ghi nhận</button>)}
              </td>
            </tr>
          ))}
          {events && events.items.length === 0 && <tr><td colSpan={7} className="muted">Chưa có ghi nhận nào.</td></tr>}
        </tbody>
      </table>
      {events && events.total > events.pageSize && (
        <div className="actions">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Trước</button>
          <span className="muted">Trang {page}/{pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau →</button>
        </div>
      )}
    </section>
  );
}
