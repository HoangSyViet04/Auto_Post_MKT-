import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
import { type ApiError, type ContentVersionItem, findSimilarCaptions, type ProductDetail, type ProductListResponse, type ProductStatus } from '#domain';
import { apiFetch } from './api.ts';
import {
  emptyForm,
  type FormErrors,
  formFromDetail,
  type ImageItem,
  isDirty,
  MAX_IMAGES,
  moveImage,
  type ProductFormState,
  previewCaption,
  validateForm,
} from './product-form.ts';

const PAGE_SIZE = 20;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const STATUS_LABEL: Record<ProductStatus, string> = { selling: 'Đang bán', sold: 'Đã bán', archived: 'Ngừng bán' };

type View = { kind: 'list' } | { kind: 'form'; productId: string | null };

const thumbUrl = (id: string) => `/api/media/${id}?size=thumb`;

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Không đọc được nội dung lỗi: dùng thông báo chung bên dưới.
  }
  return `Yêu cầu không thành công (HTTP ${response.status}).`;
}

const networkMessage = (error: unknown) => (error instanceof Error ? error.message : 'Không kết nối được server cục bộ.');

export function ProductsPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  return (
    <section>
      <header className="page-header">
        <h1>Quản lý máy</h1>
        <span className="tag">P05 · chưa đăng bài</span>
      </header>
      <p className="muted">
        Nhập máy với ảnh, tên và tình trạng; xem trước caption mẫu. Trang này không gửi gì tới Facebook.
      </p>
      {view.kind === 'list' ? (
        <ProductList onOpen={(productId) => setView({ kind: 'form', productId })} />
      ) : (
        <ProductForm key={view.productId ?? 'new'} productId={view.productId} onClose={() => setView({ kind: 'list' })} />
      )}
    </section>
  );
}

function ProductList({ onOpen }: { onOpen: (productId: string | null) => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProductListResponse | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function cleanup() {
    setNote('');
    try {
      const response = await apiFetch('/api/media/cleanup', { method: 'POST', body: '{}' });
      if (!response.ok) throw new Error(await readError(response));
      const { purged } = (await response.json()) as { purged: number };
      setNote(purged ? `Đã giải phóng ${purged} ảnh chưa dùng.` : 'Không có ảnh chưa dùng nào cần dọn.');
    } catch (e) {
      setNote(networkMessage(e));
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch(`/api/products?page=${page}&pageSize=${PAGE_SIZE}`);
        if (!response.ok) throw new Error(await readError(response));
        const body = (await response.json()) as ProductListResponse;
        if (!cancelled) {
          setData(body);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(networkMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => onOpen(null)}>
          Thêm máy
        </button>
        <button type="button" onClick={cleanup} title="Chỉ dọn ảnh đã tải lên trên 24 giờ và chưa gắn với máy hay bản caption nào">
          Dọn ảnh chưa dùng
        </button>
      </div>
      {note && <p className="notice" role="status">{note}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {data && data.items.length === 0 && <p className="muted">Chưa có máy nào. Bấm "Thêm máy" để nhập máy đầu tiên.</p>}
      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Ảnh</th><th>Mã</th><th>Tên máy</th><th>Tình trạng</th><th>Giá</th><th>Trạng thái</th></tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="row-link" onClick={() => onOpen(item.id)}>
                <td>{item.firstMediaId ? <img className="thumb" src={thumbUrl(item.firstMediaId)} alt="" /> : '—'}</td>
                <td className="mono">{item.code.slice(0, 12)}</td>
                <td>
                  <button type="button" className="link" onClick={() => onOpen(item.id)}>{item.name}</button>
                  <span className="muted"> · {item.mediaCount} ảnh</span>
                </td>
                <td className="clip">{item.condition}</td>
                <td>{item.priceVnd === null ? 'Chưa có giá' : `${new Intl.NumberFormat('vi-VN').format(item.priceVnd)} đ`}</td>
                <td>{STATUS_LABEL[item.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.total > data.pageSize && (
        <div className="actions">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
          <span className="muted">Trang {page}/{pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
        </div>
      )}
    </div>
  );
}

function ProductForm({ productId, onClose }: { productId: string | null; onClose: () => void }) {
  const [form, setForm] = useState<ProductFormState>(emptyForm);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState('');
  const [uploadNotes, setUploadNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(productId !== null);
  const [versions, setVersions] = useState<ContentVersionItem[]>([]);
  /** null: dùng caption mẫu tự sinh. Chuỗi: người dùng đã chỉnh tay (chưa lưu — thuộc P05.5). */
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/products/${id}`);
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as ProductDetail;
    setDetail(body);
    setForm(formFromDetail(body));
    setCaptionDraft(null);
  }, []);

  const loadVersions = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/products/${id}/content-versions`);
    if (!response.ok) throw new Error(await readError(response));
    setVersions(((await response.json()) as { items: ContentVersionItem[] }).items);
  }, []);

  useEffect(() => {
    if (!productId) return;
    Promise.all([load(productId), loadVersions(productId)])
      .catch((e) => setMessage(networkMessage(e)))
      .finally(() => setLoading(false));
  }, [productId, load, loadVersions]);

  const set = (field: keyof Omit<ProductFormState, 'images'>) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    // Sửa ô nào thì lỗi của ô đó biến mất; kiểm tra lại khi bấm lưu.
    if (field === 'name' || field === 'condition' || field === 'price') setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    const notes: string[] = [];
    const added: ImageItem[] = [];
    for (const file of files) {
      if (form.images.length + added.length >= MAX_IMAGES) {
        notes.push(`Tối đa ${MAX_IMAGES} ảnh mỗi máy.`);
        break;
      }
      if (!IMAGE_TYPES.includes(file.type)) {
        notes.push(`${file.name}: chỉ nhận JPEG, PNG hoặc WebP.`);
        continue;
      }
      try {
        // Mỗi ảnh gửi đúng một lần; lỗi thì báo, không tự gửi lại.
        const response = await apiFetch('/api/media', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        if (!response.ok) {
          notes.push(`${file.name}: ${await readError(response)}`);
          continue;
        }
        added.push({ id: ((await response.json()) as { id: string }).id, label: file.name });
      } catch (e) {
        notes.push(`${file.name}: ${networkMessage(e)}`);
      }
    }
    setForm((current) => ({ ...current, images: [...current.images, ...added] }));
    setErrors((current) => (added.length ? { ...current, images: undefined } : current));
    setUploadNotes(notes);
    setBusy(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    const { errors: found, facts } = validateForm(form);
    setErrors(found);
    if (!facts) return; // Giữ nguyên nội dung đang nhập
    setBusy(true);
    try {
      const response = detail
        ? await apiFetch(`/api/products/${detail.id}`, { method: 'PUT', body: JSON.stringify({ ...facts, expectedRevisionId: detail.revisionId }) })
        : await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(facts) });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      if (detail) {
        const body = (await response.json()) as ProductDetail;
        setDetail(body);
        setForm(formFromDetail(body));
        setMessage('Đã lưu phiên bản mới của máy.');
      } else {
        onClose();
      }
    } catch (e) {
      setMessage(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCaption() {
    if (!detail) return;
    setBusy(true);
    setMessage('');
    try {
      // Mỗi lần bấm lưu đúng một bản; không tự gửi lại khi lỗi.
      const response = await apiFetch(`/api/products/${detail.id}/content-versions`, {
        method: 'POST',
        body: JSON.stringify({ revisionId: detail.revisionId, caption, source: captionDraft === null || captionDraft === template ? 'template' : 'manual' }),
      });
      if (!response.ok) setMessage(await readError(response));
      else {
        await loadVersions(detail.id);
        setMessage('Đã lưu bản caption. Bản này chưa gắn đích nên chưa thể duyệt hoặc đăng.');
      }
    } catch (e) {
      setMessage(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: ProductStatus) {
    if (!detail) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await apiFetch(`/api/products/${detail.id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      if (!response.ok) setMessage(await readError(response));
      else {
        setDetail((await response.json()) as ProductDetail);
        setMessage(`Đã đổi trạng thái: ${STATUS_LABEL[status]}.`);
      }
    } catch (e) {
      setMessage(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Đang tải máy…</p>;
  const template = previewCaption(form);
  const caption = captionDraft ?? template;
  const dirty = detail ? isDirty(form, detail) : false;
  const similar = findSimilarCaptions(caption, versions);
  const canSaveCaption = !!detail && !dirty && detail.status === 'selling' && caption.trim() !== '';

  return (
    <form className="product-form" onSubmit={submit} noValidate>
      <div className="actions">
        <button type="button" onClick={onClose}>← Danh sách máy</button>
        {detail && (
          <>
            <span className="muted">{detail.code.slice(0, 12)} · phiên bản {detail.revisionNo} · {STATUS_LABEL[detail.status]}</span>
            {detail.status === 'selling' ? (
              <>
                <button type="button" disabled={busy} onClick={() => changeStatus('sold')}>Đánh dấu đã bán</button>
                <button type="button" disabled={busy} onClick={() => changeStatus('archived')}>Ngừng bán</button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => changeStatus('selling')}>Bán lại</button>
            )}
          </>
        )}
      </div>
      {detail && detail.status !== 'selling' && (
        <p className="notice">Máy không ở trạng thái đang bán: không thể tạo bài hoặc lịch mới cho máy này.</p>
      )}

      <label>
        Tên máy *
        <input value={form.name} onChange={set('name')} maxLength={500} placeholder="iPhone 13 128GB" />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>
      <label>
        Tình trạng *
        <textarea value={form.condition} onChange={set('condition')} rows={3} placeholder="Mô tả đúng tình trạng thực tế" />
        {errors.condition && <span className="field-error">{errors.condition}</span>}
      </label>

      <fieldset>
        <legend>Ảnh * ({form.images.length}/{MAX_IMAGES}) — thứ tự ảnh là thứ tự đăng</legend>
        <input type="file" accept={IMAGE_TYPES.join(',')} multiple disabled={busy} onChange={addFiles} />
        {errors.images && <span className="field-error">{errors.images}</span>}
        {uploadNotes.map((note) => <span key={note} className="field-error">{note}</span>)}
        <ol className="images">
          {form.images.map((image, index) => (
            <li key={image.id}>
              <img className="thumb" src={thumbUrl(image.id)} alt={image.label} />
              <span className="muted clip">{image.label}</span>
              <span className="image-tools">
                <button type="button" disabled={index === 0} onClick={() => setForm((c) => ({ ...c, images: moveImage(c.images, index, -1) }))} aria-label="Đưa lên">↑</button>
                <button type="button" disabled={index === form.images.length - 1} onClick={() => setForm((c) => ({ ...c, images: moveImage(c.images, index, 1) }))} aria-label="Đưa xuống">↓</button>
                <button type="button" onClick={() => setForm((c) => ({ ...c, images: c.images.filter((i) => i.id !== image.id) }))}>Bỏ</button>
              </span>
            </li>
          ))}
        </ol>
        <p className="notice">Ảnh được sao chép vào kho của ứng dụng; xóa hay di chuyển file gốc không ảnh hưởng. "Bỏ" chỉ gỡ ảnh khỏi máy này.</p>
      </fieldset>

      <fieldset>
        <legend>Thông tin thêm (không bắt buộc — để trống thì bài không có dòng đó)</legend>
        <label>Giá (đ)<input value={form.price} onChange={set('price')} inputMode="numeric" placeholder="9.500.000" />
          {errors.price && <span className="field-error">{errors.price}</span>}</label>
        <label>Dung lượng<input value={form.capacity} onChange={set('capacity')} placeholder="128GB" /></label>
        <label>Pin<input value={form.battery} onChange={set('battery')} placeholder="89%" /></label>
        <label>Bảo hành<input value={form.warranty} onChange={set('warranty')} /></label>
        <label>Khu vực<input value={form.location} onChange={set('location')} /></label>
      </fieldset>

      <fieldset>
        <legend>Xem trước caption mẫu</legend>
        <textarea
          value={caption}
          onChange={(event) => setCaptionDraft(event.target.value)}
          rows={7}
          placeholder="Nhập tên và tình trạng để xem caption mẫu"
        />
        {captionDraft !== null && (
          <button type="button" onClick={() => setCaptionDraft(null)}>Dùng lại caption mẫu</button>
        )}
        {detail && (
          <button type="button" disabled={busy || !canSaveCaption} onClick={saveCaption}>Lưu caption này</button>
        )}
        {detail && similar.length > 0 && (
          <span className="field-warning" role="status">
            Giống {Math.round((similar[0]?.score ?? 0) * 100)}% một bản đã lưu (phiên bản máy {similar[0]?.item.revisionNo}). Vẫn lưu được,
            nhưng nên đổi cách viết để tránh lặp nội dung.
          </span>
        )}
        {detail && dirty && <span className="muted">Lưu phiên bản máy trước để caption khớp dữ kiện và ảnh.</span>}
        <p className="notice">
          Caption chỉ gồm dữ kiện bạn đã nhập, không tự thêm giá, pin hay bảo hành. Caption chỉ được lưu khi bạn bấm "Lưu caption
          này" (máy phải đã lưu); duyệt cần tài khoản và đích nên chưa có ở đây.
        </p>
      </fieldset>

      {detail && versions.length > 0 && (
        <fieldset>
          <legend>Bản caption đã lưu ({versions.length})</legend>
          <ul className="versions">
            {versions.map((version) => (
              <li key={version.id}>
                <span className="muted">
                  Phiên bản máy {version.revisionNo}
                  {version.revisionId !== detail.revisionId ? ' (cũ — máy đã sửa sau đó)' : ''} ·{' '}
                  {version.source === 'template' ? 'caption mẫu' : 'chỉnh tay'} · {version.mediaIds.length} ảnh ·{' '}
                  {new Date(version.createdAt).toLocaleString('vi-VN')}
                </span>
                <pre>{version.caption}</pre>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {message && <p className="notice" role="status">{message}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {detail ? 'Lưu phiên bản mới' : 'Lưu máy'}
        </button>
      </div>
    </form>
  );
}
