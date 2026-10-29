import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AccountSummary,
  type ContentVersionItem,
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
  resolvePostingInterval,
  similarToHistory,
  toVnLocal,
} from './post-plan.ts';
import { PresetPanel } from './PresetPanel.tsx';
import { formFromDetail, previewCaption } from './product-form.ts';
import { selectGroupCount } from './group-selection.ts';
import { GroupComposerView } from './GroupComposerView.tsx';

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
  const [groupError, setGroupError] = useState('');
  const [groupsLoading, setGroupsLoading] = useState(false);
  const groupRequest = useRef(0);
  const [filter, setFilter] = useState('');
  const [wantedCount, setWantedCount] = useState('30');
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

  const currentAccount = useRef(draft.accountId);
  currentAccount.current = draft.accountId;
  const set = (patch: Partial<PostDraft>) => {
    setDraft((current) => ({ ...current, ...patch })); setFailures([]); setLiveConfirm(false);
    if (patch.productId !== undefined) { setDetail(null); setVersions([]); }
    if (patch.accountId !== undefined) { setGroups([]); setGroupError(''); }
  };

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

  const reloadGroups = useCallback(async () => {
    const accountId = draft.accountId;
    const request = ++groupRequest.current;
    if (!accountId) { setGroups([]); setGroupsLoading(false); return; }
    setGroupsLoading(true);
    let list: GroupItem[];
    try { list = await fetchAll<GroupItem>(`/api/groups?accountId=${accountId}`, (body) => body as GroupListResponse); }
    catch (error) { if (currentAccount.current === accountId && groupRequest.current === request) setGroupError(networkMessage(error)); throw error; }
    finally { if (currentAccount.current === accountId && groupRequest.current === request) setGroupsLoading(false); }
    if (currentAccount.current !== accountId || groupRequest.current !== request) return;
    setGroupError('');
    setGroups(list);
    const preset = pendingPreset.current;
    if (preset) { pendingPreset.current = null; selectRef.current(preset, accountId, list); }
  }, [draft.accountId]);
  useEffect(() => { reloadGroups().catch(() => undefined); }, [reloadGroups]);

  useEffect(() => {
    if (!draft.productId) { setDetail(null); setVersions([]); return; }
    let disposed = false;
    (async () => {
      const response = await apiFetch(`/api/products/${draft.productId}`);
      if (!response.ok) throw new Error(await readError(response));
      const loaded = (await response.json()) as ProductDetail;
      if (disposed) return;
      setDetail(loaded);
      const history = await apiFetch(`/api/products/${draft.productId}/content-versions`);
      if (history.ok) { const body = (await history.json()) as { items: ContentVersionItem[] }; if (!disposed) setVersions(body.items); }
    })().catch((e) => setMessage(networkMessage(e)));
    return () => { disposed = true; };
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
  const reviewableGroups = new Set(groups.filter((group) => group.accounts.some((relation) => relation.accountId === draft.accountId && relation.eligible)).map((group) => group.id));
  if (draft.selected.some((id) => !reviewableGroups.has(id))) problems.push('Chưa xem lại được đủ nhóm đã chọn hoặc có nhóm không còn đủ điều kiện. Tải lại danh sách trước khi duyệt.');
  const needle = filter.trim().toLowerCase();
  const visible = groups.filter((group) => !needle || `${group.name ?? ''} ${group.externalId ?? ''} ${group.region ?? ''} ${group.rulesNote ?? ''}`.toLowerCase().includes(needle));
  const duplicate = duplicateWarning(items);
  const similar = new Map(similarToHistory(items, versions).map((hit) => [hit.destinationId, hit.score]));
  const startAt = resolveStart(draft, Date.now());
  const ready = health !== null && problems.length === 0 && account?.paused === false && (!live || liveConfirm) && !busy;

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
    setLiveConfirm(false);
    setTemplateText(preset.captionTemplate ?? '');
    const start = preset.schedule.startMode === 'daily' && preset.schedule.timeOfDay ? nextDailyStart(preset.schedule.timeOfDay, Date.now()) : null;
    setDraft((current) => ({ ...current, startMode: start === null ? 'now' : 'later', startLocal: start === null ? '' : toVnLocal(start),
      intervalMin: String(preset.schedule.postingInterval?.minSeconds ?? 60), intervalMax: String(preset.schedule.postingInterval?.maxSeconds ?? 120) }));
    const accountIds = [...new Set(preset.targets.map((target) => target.accountId))];
    const accountId = accountIds.includes(draft.accountId) ? draft.accountId : (accountIds[0] ?? '');
    if (!accounts.some((item) => item.id === accountId)) { setMessage('Tài khoản của cấu hình này không còn dùng nữa.'); return; }
    setFailures([]);
    if (accountId === draft.accountId) { selectFromPreset(preset, accountId, groups); return; }
    pendingPreset.current = preset; // nhóm của tài khoản mới chưa tải; áp dụng khi tải xong
    setDraft((current) => ({ ...current, accountId, selected: [], overrides: {} }));
  }

  async function submit() {
    const postingInterval = resolvePostingInterval(draft);
    if (!ready || startAt === null || !postingInterval) return;
    const signature = planSignature(draft.accountId, draft.productId, draft.startMode === 'now' ? 'now' : startAt, items, postingInterval);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID(), startAt };
    const current = attempt.current;
    setBusy(true);
    setMessage('');
    setFailures([]);
    try {
      // Gửi đúng một lần; mất phản hồi thì bấm lại dùng cùng mã yêu cầu nên không tạo job trùng.
      const response = await apiFetch('/api/posts', { method: 'POST', body: JSON.stringify({
        requestKey: current.key, accountId: draft.accountId, productId: draft.productId, scheduledAt: current.startAt, postingInterval,
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

  return <GroupComposerView accounts={accounts} products={products} detail={detail} account={account}
    draft={draft} groups={groups} visible={visible} filter={filter} wantedCount={wantedCount}
    live={live} health={health} template={template} items={items} startAt={startAt} duplicate={duplicate}
    similar={similar} problems={problems} ready={ready} busy={busy} message={groupError || message} liveConfirm={liveConfirm} groupsLoading={groupsLoading}
    batch={batch} jobs={jobs} onChange={set} onFilter={setFilter} onWantedCount={setWantedCount}
    onChooseCount={() => {
      try {
        const result = selectGroupCount(visible, draft.accountId, Number(wantedCount));
        set({ selected: result.selected });
        setMessage(`Đã chọn ${result.selected.length}/${Number(wantedCount)} nhóm trong bộ lọc hiện tại (${result.available} nhóm đủ điều kiện). Ưu tiên nhóm đánh dấu ưu tiên, sau đó theo tên. Xem trước rồi duyệt để xếp lịch. Chưa tạo tác vụ nào.`);
      } catch (error) { setMessage(networkMessage(error)); }
    }} onLiveConfirm={setLiveConfirm} onSubmit={submit} onRefreshGroups={reloadGroups}
    onRetryGroups={() => { setLiveConfirm(false); reloadGroups().catch(() => undefined); }}
    failureFor={(id) => failures.find((failure) => failure.destinationId === id)?.code}
    presets={<PresetPanel accountId={draft.accountId} selected={draft.selected} startMode={draft.startMode} startLocal={draft.startLocal}
      postingInterval={resolvePostingInterval(draft)}
      templateText={templateText} onTemplateText={(value) => { setTemplateText(value); setLiveConfirm(false); }} onApply={applyPreset} notify={setMessage} />} />;
}
