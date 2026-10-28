import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AccountSummary,
  type ContentVersionItem,
  type GroupBlocker,
  type GroupItem,
  type GroupListResponse,
  type HealthResponse,
  type JobListItem,
  type JobListResponse,
  type PresetItem,
  type ProductDetail,
  type ProductListItem,
  type ProductListResponse,
  renderCaptionTemplate,
} from '#domain';
import { apiFetch } from './api.ts';
import { clearHandoff, getHandoff } from './handoff.ts';
import { networkMessage, readError } from './http.ts';
import { describeJobResult, formatVn, JOB_STATUS_LABEL } from './job-view.ts';
import {
  duplicateWarning,
  emptyDraft,
  nextDailyStart,
  planItems,
  planProblems,
  planSignature,
  type PostDraft,
  presetSelection,
  resolveStart,
  similarToHistory,
  toVnLocal,
} from './post-plan.ts';
import { PresetPanel } from './PresetPanel.tsx';
import { formFromDetail, previewCaption } from './product-form.ts';

const BLOCKER_LABEL: Record<GroupBlocker, string> = {
  no_external_id: 'chưa có ID số của nhóm',
  not_joined: 'chưa tham gia',
  no_permission: 'chưa xác nhận được phép đăng',
  unsuitable: 'đã đánh dấu không phù hợp',
  archived: 'đã ngừng dùng',
  account_paused: 'tài khoản đang tạm dừng',
};
const APPROVAL_LABEL = { unknown: 'duyệt bài: chưa rõ', required: 'có duyệt bài', not_required: 'không duyệt bài' } as const;
const FINAL = new Set(['published', 'pending_approval', 'failed', 'unknown', 'cancelled']);

interface Failure { destinationId: string; code: string }
interface Batch { jobs: Array<{ jobId: string; destinationId: string }>; replayed: boolean }

/** Caption mẫu: theo mẫu của cấu hình nếu có (dòng thiếu dữ kiện tự bỏ), nếu không thì caption mặc định của máy. */
const defaultCaption = (detail: ProductDetail, templateText: string): string => (templateText.trim() ? renderCaptionTemplate(templateText, detail) : previewCaption(formFromDetail(detail)));

/** Bản nháp đang soạn được giữ khi chuyển sang trang khác rồi quay lại (chỉ trong phiên của tab, không lưu đĩa). */
let remembered: PostDraft | null = null;

async function fetchAll<T>(path: string, pick: (page: unknown) => { items: T[]; total: number }): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await apiFetch(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    if (!response.ok) throw new Error(await readError(response));
    const { items, total } = pick(await response.json());
    all.push(...items);
    if (all.length >= total || items.length === 0) break;
  }
  return all;
}

export function PostGroupPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [draft, setDraft] = useState<PostDraft>(() => {
    const handoff = getHandoff();
    return handoff ? { ...emptyDraft(), accountId: handoff.accountId, selected: handoff.groups.map((group) => group.id) } : (remembered ?? emptyDraft());
  });
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [versions, setVersions] = useState<ContentVersionItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [filter, setFilter] = useState('');
  const [templateText, setTemplateText] = useState('');
  const [liveConfirm, setLiveConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<Map<string, JobListItem>>(new Map());
  /** Mã yêu cầu giữ nguyên khi nội dung không đổi: bấm lại (hoặc mất phản hồi) không tạo job trùng. */
  const attempt = useRef<{ signature: string; key: string; startAt: number } | null>(null);
  const lastTemplate = useRef('');
  /** Cấu hình cần áp dụng sau khi danh sách nhóm của tài khoản của nó tải xong. */
  const pendingPreset = useRef<PresetItem | null>(null);
  const selectRef = useRef<(preset: PresetItem, accountId: string, list: readonly GroupItem[]) => void>(() => undefined);

  useEffect(() => { remembered = draft; }, [draft]);

  const set = (patch: Partial<PostDraft>) => { setDraft((current) => ({ ...current, ...patch })); setFailures([]); };

  useEffect(() => {
    (async () => {
      const [accountResponse, productList, healthResponse] = await Promise.all([
        apiFetch('/api/accounts'),
        fetchAll<ProductListItem>('/api/products', (body) => body as ProductListResponse),
        apiFetch('/api/health'),
      ]);
      if (accountResponse.ok) setAccounts(((await accountResponse.json()) as { items: AccountSummary[] }).items);
      setProducts(productList.filter((product) => product.status === 'selling'));
      if (healthResponse.ok) setHealth((await healthResponse.json()) as HealthResponse);
    })().catch((e) => setMessage(networkMessage(e)));
  }, []);

  useEffect(() => {
    if (!draft.accountId) { setGroups([]); return; }
    fetchAll<GroupItem>(`/api/groups?accountId=${draft.accountId}`, (body) => body as GroupListResponse)
      .then((list) => {
        setGroups(list);
        const preset = pendingPreset.current;
        if (preset) { pendingPreset.current = null; selectRef.current(preset, draft.accountId, list); }
      })
      .catch((e) => setMessage(networkMessage(e)));
  }, [draft.accountId]);

  useEffect(() => {
    if (!draft.productId) { setDetail(null); setVersions([]); return; }
    (async () => {
      const response = await apiFetch(`/api/products/${draft.productId}`);
      if (!response.ok) throw new Error(await readError(response));
      const loaded = (await response.json()) as ProductDetail;
      setDetail(loaded);
      const history = await apiFetch(`/api/products/${draft.productId}/content-versions`);
      if (history.ok) setVersions(((await history.json()) as { items: ContentVersionItem[] }).items);
    })().catch((e) => setMessage(networkMessage(e)));
  }, [draft.productId]);

  // Điền caption mẫu khi chưa có hoặc người dùng chưa sửa gì khỏi caption mẫu trước đó (đổi máy hoặc đổi mẫu thì điền lại).
  useEffect(() => {
    if (!detail) return;
    const next = defaultCaption(detail, templateText);
    const previous = lastTemplate.current; // chốt trước: hàm cập nhật chạy muộn, lúc đó lastTemplate đã là giá trị mới
    setDraft((current) => (current.caption.trim() === '' || current.caption === previous ? { ...current, caption: next } : current));
    lastTemplate.current = next;
  }, [detail, templateText]);

  const poll = useCallback(async () => {
    const response = await apiFetch('/api/jobs?pageSize=100');
    if (!response.ok) return;
    const list = (await response.json()) as JobListResponse;
    setJobs(new Map(list.items.map((job) => [job.id, job])));
  }, []);
  const batchActive = batch?.jobs.some((entry) => !FINAL.has(jobs.get(entry.jobId)?.status ?? 'queued')) === true;
  useEffect(() => {
    if (!batch) return;
    poll().catch(() => undefined);
    const timer = setInterval(() => { poll().catch(() => undefined); }, batchActive ? 2_000 : 10_000);
    return () => clearInterval(timer);
  }, [batch, batchActive, poll]);

  const account = accounts.find((item) => item.id === draft.accountId);
  const live = health?.integrations === 'live';
  const template = detail ? defaultCaption(detail, templateText) : '';
  const items = planItems(draft, template);
  const problems = planProblems(draft, { accountSession: account?.sessionStatus ?? null, productSelling: detail?.status === 'selling', now: Date.now() });
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const relationOf = (group: GroupItem) => group.accounts.find((relation) => relation.accountId === draft.accountId);
  const needle = filter.trim().toLowerCase();
  const visible = groups.filter((group) => !needle || `${group.name ?? ''} ${group.externalId ?? ''} ${group.region ?? ''} ${group.rulesNote ?? ''}`.toLowerCase().includes(needle));
  const eligibleVisible = visible.filter((group) => relationOf(group)?.eligible);
  const duplicate = duplicateWarning(items);
  const similar = new Map(similarToHistory(items, versions).map((hit) => [hit.destinationId, hit.score]));
  const startAt = resolveStart(draft, Date.now());
  const ready = problems.length === 0 && (!live || liveConfirm) && !busy;

  /** Điền nhóm từ cấu hình: chỉ nhóm đã lưu cho đúng tài khoản này và còn đủ điều kiện; phần bị bỏ qua được báo rõ. */
  function selectFromPreset(preset: PresetItem, accountId: string, list: readonly GroupItem[]) {
    const { selected, skipped } = presetSelection(preset, accountId, list);
    setDraft((current) => ({ ...current, accountId, selected, overrides: {} }));
    const others = new Set(preset.targets.map((target) => target.accountId)).size > 1 ? ' Cấu hình có cả tài khoản khác; trang này chỉ đăng bằng một tài khoản.' : '';
    const skippedText = skipped.length
      ? ` Bỏ qua ${skipped.length} nhóm: ${skipped.map((entry) => `${entry.name} (${entry.reason === 'not_eligible' ? 'không còn đủ điều kiện' : 'không còn trong danh sách của tài khoản'})`).join(', ')}.`
      : '';
    setMessage(`Đã áp dụng cấu hình "${preset.label}": chọn ${selected.length} nhóm.${skippedText}${others} Chưa có job nào được tạo; kiểm tra rồi bấm Duyệt và xếp lịch.`);
  }

  selectRef.current = selectFromPreset; // effect tải nhóm luôn gọi bản mới nhất mà không phải thêm vào danh sách phụ thuộc

  function applyPreset(preset: PresetItem) {
    setTemplateText(preset.captionTemplate ?? '');
    const start = preset.schedule.startMode === 'daily' && preset.schedule.timeOfDay ? nextDailyStart(preset.schedule.timeOfDay, Date.now()) : null;
    setDraft((current) => ({ ...current, startMode: start === null ? 'now' : 'later', startLocal: start === null ? '' : toVnLocal(start) }));
    const accountIds = [...new Set(preset.targets.map((target) => target.accountId))];
    const accountId = accountIds.includes(draft.accountId) ? draft.accountId : (accountIds[0] ?? '');
    if (!accounts.some((item) => item.id === accountId)) { setMessage('Tài khoản của cấu hình này không còn dùng nữa.'); return; }
    setFailures([]);
    if (accountId === draft.accountId) { selectFromPreset(preset, accountId, groups); return; }
    pendingPreset.current = preset; // nhóm của tài khoản mới chưa tải; áp dụng khi tải xong
    setDraft((current) => ({ ...current, accountId, selected: [], overrides: {} }));
  }

  function toggle(group: GroupItem, checked: boolean) {
    set({ selected: checked ? [...draft.selected, group.id] : draft.selected.filter((id) => id !== group.id) });
  }

  async function submit() {
    if (!ready || startAt === null) return;
    const signature = planSignature(draft.accountId, draft.productId, draft.startMode === 'now' ? 'now' : startAt, items);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID(), startAt };
    const current = attempt.current;
    setBusy(true);
    setMessage('');
    setFailures([]);
    try {
      // Gửi đúng một lần; mất phản hồi thì bấm lại dùng cùng mã yêu cầu nên không tạo job trùng.
      const response = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({
        requestKey: current.key, accountId: draft.accountId, productId: draft.productId, scheduledAt: current.startAt,
        items: items.map((item) => ({ destinationId: item.destinationId, caption: item.caption, source: item.source })),
      }) });
      const body = (await response.json()) as { jobs?: Batch['jobs']; replayed?: boolean; failures?: Failure[]; message?: string };
      if (response.status === 409 && body.failures) {
        setFailures(body.failures);
        setMessage('Một số nhóm chưa đủ điều kiện nên chưa xếp job nào. Bỏ chọn các nhóm bị đánh dấu rồi bấm lại.');
      } else if (!response.ok || !body.jobs) {
        setMessage(body.message ?? `Yêu cầu không thành công (HTTP ${response.status}).`);
      } else {
        setBatch({ jobs: body.jobs, replayed: body.replayed === true });
        clearHandoff();
        setMessage(body.replayed ? 'Yêu cầu này đã được ghi nhận trước đó; không tạo thêm job.' : `Đã duyệt và xếp ${body.jobs.length} job.`);
      }
    } catch (e) {
      setMessage(`${networkMessage(e)} Bấm lại sẽ dùng cùng mã yêu cầu, không tạo job trùng.`);
    } finally {
      setBusy(false);
    }
  }

  const failureOf = (id: string) => failures.find((failure) => failure.destinationId === id);

  return (
    <section>
      <header className="page-header">
        <h1>Đăng bài viết nhóm</h1>
        <span className="tag">P10 · {live ? 'THẬT' : 'mô phỏng'}</span>
      </header>
      <p className="muted">Mỗi nhóm là một job riêng với kết quả riêng. Nhóm nào không đủ điều kiện sẽ không được xếp; bạn quyết định bỏ chọn.</p>
      {health && !health.worker.alive && <p className="notice" role="status">Worker chưa chạy nên bài sẽ không được xử lý. Chạy "npm run dev:worker".</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <div className="product-form">
        <PresetPanel accountId={draft.accountId} selected={draft.selected} startMode={draft.startMode} startLocal={draft.startLocal}
          templateText={templateText} onTemplateText={setTemplateText} onApply={applyPreset} notify={setMessage} />

        <fieldset>
          <legend>1. Tài khoản đăng</legend>
          <select aria-label="Tài khoản" value={draft.accountId} onChange={(event) => set({ accountId: event.target.value, selected: [], overrides: {} })}>
            <option value="">— chọn tài khoản —</option>
            {accounts.map((item) => <option key={item.id} value={item.id}>{item.label}{item.sessionStatus === 'logged_in' ? '' : ' (chưa đăng nhập)'}</option>)}
          </select>
          {account && account.sessionStatus !== 'logged_in' && <span className="field-error">Tài khoản này chưa đăng nhập: dùng "Đăng nhập"/"Kiểm tra phiên" ở trang Quản lý tài khoản.</span>}
        </fieldset>

        <fieldset>
          <legend>2. Máy</legend>
          <select aria-label="Máy" value={draft.productId} onChange={(event) => set({ productId: event.target.value })}>
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
        </fieldset>

        <fieldset>
          <legend>3. Caption chung</legend>
          <textarea aria-label="Caption" rows={6} value={draft.caption} onChange={(event) => set({ caption: event.target.value })} placeholder="Chọn máy để có caption mẫu" />
          {detail && draft.caption !== template && <button type="button" onClick={() => set({ caption: template })}>Dùng lại caption mẫu</button>}
          <p className="notice">Caption chỉ gồm dữ kiện bạn đã nhập cho máy. Có thể sửa riêng từng nhóm ở phần xem trước.</p>
        </fieldset>

        <fieldset>
          <legend>4. Nhóm ({draft.selected.length} đã chọn)</legend>
          {!draft.accountId && <span className="muted">Chọn tài khoản trước.</span>}
          {draft.accountId && (
            <>
              <div className="actions">
                <input className="inline-input" aria-label="Lọc nhóm" placeholder="Lọc theo tên, ID, khu vực, nội quy…" value={filter} onChange={(event) => setFilter(event.target.value)} />
                <button type="button" onClick={() => set({ selected: [...new Set([...draft.selected, ...eligibleVisible.map((group) => group.id)])] })}>Chọn tất cả đủ điều kiện ({eligibleVisible.length})</button>
                <button type="button" onClick={() => set({ selected: [] })}>Bỏ chọn hết</button>
              </div>
              {groups.length === 0 && <span className="muted">Tài khoản này chưa có nhóm nào. Thêm ở trang "Nhóm đã tham gia".</span>}
              <table className="table">
                <tbody>
                  {visible.map((group) => {
                    const relation = relationOf(group);
                    const eligible = relation?.eligible === true;
                    const failure = failureOf(group.id);
                    return (
                      <tr key={group.id} className={eligible ? undefined : 'archived'}>
                        <td><input type="checkbox" aria-label={`Chọn ${group.name ?? group.externalId}`} disabled={!eligible} checked={draft.selected.includes(group.id)} onChange={(event) => toggle(group, event.target.checked)} /></td>
                        <td>
                          <strong>{group.name ?? 'Chưa đặt tên'}</strong> <span className="muted mono">{group.externalId}</span>
                          <div className="muted">{group.region ?? 'chưa rõ khu vực'} · {APPROVAL_LABEL[group.approvalRequired]}</div>
                          {group.rulesNote && <div className="clip" title={group.rulesNote}>Nội quy: {group.rulesNote}</div>}
                        </td>
                        <td>
                          {eligible ? <span className="ok-text">Đủ điều kiện</span> : <span className="muted">Chưa đăng được: {(relation?.blockedBy ?? ['not_joined']).map((reason) => BLOCKER_LABEL[reason]).join(', ')}</span>}
                          {failure && <div className="field-error">Bị chặn khi duyệt ({failure.code}). Bỏ chọn nhóm này.</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>5. Lịch</legend>
          <label className="check"><input type="radio" name="start" checked={draft.startMode === 'now'} onChange={() => set({ startMode: 'now' })} /> Bắt đầu ngay (worker giãn cách các bài của cùng tài khoản)</label>
          <label className="check"><input type="radio" name="start" checked={draft.startMode === 'later'} onChange={() => set({ startMode: 'later' })} /> Hẹn giờ (giờ Việt Nam)
            <input type="datetime-local" aria-label="Giờ hẹn" disabled={draft.startMode !== 'later'} value={draft.startLocal} onChange={(event) => set({ startLocal: event.target.value })} />
          </label>
        </fieldset>

        <fieldset>
          <legend>6. Xem trước từng nhóm</legend>
          {items.length === 0 && <span className="muted">Chọn nhóm để xem trước.</span>}
          {duplicate && <span className="field-warning">{duplicate}</span>}
          {items.map((item) => {
            const group = groupById.get(item.destinationId);
            const score = similar.get(item.destinationId);
            return (
              <div key={item.destinationId} className="preview-card">
                <strong>{group?.name ?? item.destinationId}</strong> <span className="muted mono">{group?.externalId}</span>
                <div className="muted">
                  {detail?.mediaIds.length ?? 0} ảnh theo thứ tự đã chọn · {startAt === null ? 'giờ hẹn chưa hợp lệ' : draft.startMode === 'now' ? 'bắt đầu ngay' : formatVn(startAt)} · {live ? 'ĐĂNG THẬT' : 'mô phỏng'}
                </div>
                {group?.rulesNote && <div className="clip" title={group.rulesNote}>Nội quy: {group.rulesNote}</div>}
                <textarea aria-label={`Caption cho ${group?.name ?? item.destinationId}`} rows={4} value={draft.overrides[item.destinationId] ?? item.caption}
                  onChange={(event) => set({ overrides: { ...draft.overrides, [item.destinationId]: event.target.value } })} />
                {score !== undefined && <span className="field-warning">Giống {Math.round(score * 100)}% một bản đã lưu của máy này cho nhóm này.</span>}
              </div>
            );
          })}
        </fieldset>

        {problems.length > 0 && <ul className="field-error" aria-label="Chưa gửi được">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        {live && (
          <label className="check live-confirm">
            <input type="checkbox" checked={liveConfirm} onChange={(event) => setLiveConfirm(event.target.checked)} />
            Tôi xác nhận ĐĂNG THẬT {items.length} bài lên Facebook bằng tài khoản {account?.label ?? '…'}.
          </label>
        )}
        <div className="actions">
          <button type="button" className="primary" disabled={!ready} onClick={submit}>Duyệt và xếp lịch ({items.length} nhóm)</button>
        </div>
      </div>

      {batch && (
        <div className="result-panel">
          <h2>Kết quả từng nhóm{batch.replayed ? ' (yêu cầu đã ghi nhận trước đó)' : ''}</h2>
          <table className="table">
            <thead><tr><th>Nhóm</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {batch.jobs.map((entry) => {
                const job = jobs.get(entry.jobId);
                return (
                  <tr key={entry.jobId}>
                    <td>{groupById.get(entry.destinationId)?.name ?? entry.destinationId}</td>
                    <td>
                      <strong>{job ? JOB_STATUS_LABEL[job.status] : 'Đang tải…'}</strong>
                      {job && <div className={job.status === 'failed' || job.status === 'unknown' ? 'field-error' : 'muted'}>{describeJobResult(job)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">Tạm dừng, hủy hoặc chạy ngay từng job ở trang <a href="#/queue">Hàng chờ đăng</a>.</p>
        </div>
      )}
    </section>
  );
}
