import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type {
  AccountSummary,
  GroupApproval,
  GroupBlocker,
  GroupCuration,
  GroupItem,
  GroupListResponse,
  GroupMembership,
  GroupPermission,
} from '#domain';
import { normalizeGroupReference } from '#domain';
import { apiFetch } from './api.ts';
import { setHandoff } from './handoff.ts';
import { networkMessage, readError } from './http.ts';

const PAGE_SIZE = 20;
const MEMBERSHIP: Record<GroupMembership, string> = { unknown: 'Chưa rõ', joined: 'Đã tham gia', not_joined: 'Chưa tham gia' };
const PERMISSION: Record<GroupPermission, string> = { unknown: 'Chưa rõ quyền đăng', allowed: 'Được đăng', denied: 'Không được đăng' };
const APPROVAL: Record<GroupApproval, string> = { unknown: 'Duyệt bài: chưa rõ', required: 'Có duyệt bài', not_required: 'Không duyệt bài' };
const CURATION: Record<GroupCuration, string> = { normal: 'Bình thường', preferred: 'Ưu tiên', unsuitable: 'Không phù hợp' };
const BLOCKER: Record<GroupBlocker, string> = {
  no_external_id: 'chưa có ID số của nhóm',
  not_joined: 'chưa tham gia',
  no_permission: 'chưa được phép đăng',
  unsuitable: 'đã đánh dấu không phù hợp',
  archived: 'đã ngừng dùng',
  account_paused: 'tài khoản đang tạm dừng',
};

const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((key) => <option key={key} value={key}>{labels[key]}</option>);

interface Draft {
  reference: string;
  accountId: string;
  name: string;
  region: string;
  rulesNote: string;
  membership: GroupMembership;
  permission: GroupPermission;
}
const emptyDraft = (accountId: string): Draft => ({ reference: '', accountId, name: '', region: '', rulesNote: '', membership: 'unknown', permission: 'unknown' });

export function GroupsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [data, setData] = useState<GroupListResponse | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [accountId, setAccountId] = useState('');
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [membership, setMembership] = useState('');
  const [curation, setCuration] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft(''));
  const [editing, setEditing] = useState<{ id: string; name: string; region: string; rulesNote: string; userNote: string; approvalRequired: GroupApproval } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (accountId) params.set('accountId', accountId);
    if (q.trim()) params.set('q', q.trim());
    if (region.trim()) params.set('region', region.trim());
    if (membership) params.set('membership', membership);
    if (curation) params.set('curation', curation);
    if (includeArchived) params.set('includeArchived', 'true');
    const response = await apiFetch(`/api/groups?${params}`);
    if (!response.ok) throw new Error(await readError(response));
    setData((await response.json()) as GroupListResponse);
  }, [page, accountId, q, region, membership, curation, includeArchived]);

  useEffect(() => {
    (async () => {
      const response = await apiFetch('/api/accounts');
      if (response.ok) setAccounts(((await response.json()) as { items: AccountSummary[] }).items);
    })().catch(() => undefined);
  }, []);

  useEffect(() => {
    load().catch((e) => setMessage(networkMessage(e)));
  }, [load]);

  /** Mỗi thao tác gửi đúng một lần; lỗi thì báo, không tự gửi lại. */
  async function act(path: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    setMessage('');
    try {
      const response = await apiFetch(path, init);
      if (!response.ok) {
        setMessage(await readError(response));
        return false;
      }
      await load();
      setMessage(done);
      return true;
    } catch (e) {
      setMessage(networkMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!draft.reference.trim()) return setMessage('Nhập link hoặc ID nhóm.');
    if (!normalizeGroupReference(draft.reference)) {
      return setMessage('Không nhận ra link hoặc ID nhóm Facebook. Dùng dạng https://www.facebook.com/groups/<số hoặc tên> hoặc chỉ ID số.');
    }
    if (!draft.accountId) return setMessage('Chọn tài khoản. Cần thêm tài khoản ở trang Quản lý tài khoản trước.');
    const body = { reference: draft.reference.trim(), accountId: draft.accountId, membership: draft.membership, permission: draft.permission,
      ...(draft.name.trim() ? { name: draft.name } : {}), ...(draft.region.trim() ? { region: draft.region } : {}),
      ...(draft.rulesNote.trim() ? { rulesNote: draft.rulesNote } : {}) };
    if (await act('/api/groups', { method: 'POST', body: JSON.stringify(body) }, 'Đã lưu nhóm.')) {
      setDraft(emptyDraft(draft.accountId));
      setAdding(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const { id, ...fields } = editing;
    if (await act(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(fields) }, 'Đã lưu thông tin nhóm.')) setEditing(null);
  }

  const chosenAccount = accounts.find((account) => account.id === accountId);
  const eligibleFor = (group: GroupItem) => group.accounts.find((relation) => relation.accountId === accountId)?.eligible === true;
  const picked = (data?.items ?? []).filter((group) => selected.has(group.id) && eligibleFor(group));

  function transfer() {
    if (!chosenAccount || picked.length === 0) return;
    setHandoff({ accountId: chosenAccount.id, accountLabel: chosenAccount.label, groups: picked.map((group) => ({ id: group.id, name: group.name ?? group.canonicalUrl ?? group.id })) });
    window.location.hash = '#/post-group';
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const reset = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
    setSelected(new Set());
  };

  return (
    <section>
      <header className="page-header">
        <h1>Nhóm đã tham gia</h1>
        <span className="tag">P06 · nhập tay</span>
      </header>
      <p className="notice">
        Đọc danh sách nhóm tự động từ Facebook <strong>chưa hỗ trợ</strong> (cần kiểm chứng ở P01). Trang này lưu nhóm bạn nhập tay;
        "đã tham gia" và "được đăng" là do bạn khai báo, chưa được ứng dụng kiểm chứng. Không có thao tác nào gửi tới Facebook.
      </p>

      <div className="actions">
        <button type="button" className="primary" onClick={() => { setAdding(!adding); setDraft((d) => ({ ...d, accountId: d.accountId || accountId || accounts[0]?.id || '' })); }}>
          {adding ? 'Đóng form' : 'Thêm nhóm'}
        </button>
        <select aria-label="Tài khoản" value={accountId} onChange={(event) => reset(setAccountId)(event.target.value)}>
          <option value="">Tất cả tài khoản</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
        <button type="button" disabled={picked.length === 0} onClick={transfer}
          title={accountId ? 'Chỉ nhóm đủ điều kiện của tài khoản đang chọn' : 'Chọn một tài khoản để chuyển'}>
          Chuyển sang Đăng nhóm ({picked.length})
        </button>
      </div>

      {adding && (
        <form className="product-form" onSubmit={add} noValidate>
          <label>Link hoặc ID nhóm *<input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="https://www.facebook.com/groups/123456789012" /></label>
          <label>Tài khoản *
            <select value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}>
              <option value="">— chọn —</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </label>
          <label>Tên nhóm<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>Khu vực<input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} /></label>
          <label>Tài khoản này đã tham gia nhóm?
            <select value={draft.membership} onChange={(e) => setDraft({ ...draft, membership: e.target.value as GroupMembership })}>{options(MEMBERSHIP)}</select>
          </label>
          <label>Được phép đăng bán hàng?
            <select value={draft.permission} onChange={(e) => setDraft({ ...draft, permission: e.target.value as GroupPermission })}>{options(PERMISSION)}</select>
          </label>
          <label>Nội quy / điều kiện bán hàng (bạn tự ghi)<textarea rows={3} value={draft.rulesNote} onChange={(e) => setDraft({ ...draft, rulesNote: e.target.value })} /></label>
          <p className="notice">Link chỉ có tên rút gọn (không có ID số) vẫn lưu được nhưng chưa thể đăng. Dán link dạng .../groups/&lt;số&gt; nếu có.</p>
          <div className="actions"><button type="submit" className="primary" disabled={busy}>Lưu nhóm</button></div>
        </form>
      )}

      <div className="actions">
        <input className="inline-input" aria-label="Tìm nhóm" placeholder="Tìm theo tên, link, nội quy…" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <input className="inline-input" aria-label="Khu vực" placeholder="Khu vực" value={region} onChange={(e) => reset(setRegion)(e.target.value)} />
        <select aria-label="Tham gia" value={membership} onChange={(e) => reset(setMembership)(e.target.value)}>
          <option value="">Mọi trạng thái tham gia</option>{options(MEMBERSHIP)}
        </select>
        <select aria-label="Ưu tiên" value={curation} onChange={(e) => reset(setCuration)(e.target.value)}>
          <option value="">Mọi mức ưu tiên</option>{options(CURATION)}
        </select>
        <label className="check"><input type="checkbox" checked={includeArchived} onChange={(e) => reset(setIncludeArchived)(e.target.checked)} /> Cả nhóm đã ngừng dùng</label>
      </div>
      {message && <p className="notice" role="status">{message}</p>}

      {data && data.items.length === 0 && <p className="muted">Chưa có nhóm nào khớp. Bấm "Thêm nhóm" để nhập link hoặc ID.</p>}
      {data && data.items.length > 0 && (
        <table className="table">
          <thead><tr><th /><th>Nhóm</th><th>Khu vực · nội quy</th><th>Ưu tiên</th><th>Theo tài khoản (bạn khai báo)</th><th /></tr></thead>
          <tbody>
            {data.items.map((group) => (
              <tr key={group.id} className={group.archived ? 'archived' : undefined}>
                <td>
                  <input type="checkbox" aria-label="Chọn nhóm" checked={selected.has(group.id) && eligibleFor(group)} disabled={!eligibleFor(group)}
                    title={accountId ? (eligibleFor(group) ? '' : 'Nhóm chưa đủ điều kiện với tài khoản đang chọn') : 'Chọn một tài khoản để chọn nhóm'}
                    onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(group.id); else next.delete(group.id); return next; })} />
                </td>
                <td>
                  <strong>{group.name ?? 'Chưa đặt tên'}</strong>{group.archived && <span className="muted"> · đã ngừng dùng</span>}
                  <div className="muted mono">{group.externalId ?? 'chưa có ID số'}</div>
                  {group.canonicalUrl && <div className="muted clip">{group.canonicalUrl}</div>}
                </td>
                <td>
                  {group.region ?? <span className="muted">Chưa rõ khu vực</span>}
                  <div className="muted">{APPROVAL[group.approvalRequired]}</div>
                  {group.rulesNote && <div className="clip" title={group.rulesNote}>{group.rulesNote}</div>}
                  {group.userNote && <div className="muted clip" title={group.userNote}>Ghi chú: {group.userNote}</div>}
                </td>
                <td>
                  <select aria-label="Mức ưu tiên" value={group.curation} disabled={busy}
                    onChange={(e) => act(`/api/groups/${group.id}`, { method: 'PUT', body: JSON.stringify({ curation: e.target.value }) }, 'Đã đổi mức ưu tiên.')}>
                    {options(CURATION)}
                  </select>
                </td>
                <td>
                  {group.accounts.length === 0 && <span className="muted">Chưa gắn tài khoản nào</span>}
                  {group.accounts.map((relation) => (
                    <div key={relation.accountId} className="relation">
                      <strong>{relation.accountLabel}</strong>
                      <select aria-label="Tham gia" value={relation.membership} disabled={busy}
                        onChange={(e) => act(`/api/groups/${group.id}/accounts/${relation.accountId}`, { method: 'PUT', body: JSON.stringify({ membership: e.target.value }) }, 'Đã cập nhật.')}>
                        {options(MEMBERSHIP)}
                      </select>
                      <select aria-label="Quyền đăng" value={relation.permission} disabled={busy}
                        onChange={(e) => act(`/api/groups/${group.id}/accounts/${relation.accountId}`, { method: 'PUT', body: JSON.stringify({ permission: e.target.value }) }, 'Đã cập nhật.')}>
                        {options(PERMISSION)}
                      </select>
                      {relation.eligible
                        ? <span className="ok-text">Đủ điều kiện</span>
                        : <span className="muted">Chưa đăng được: {relation.blockedBy.map((b) => BLOCKER[b]).join(', ')}</span>}
                    </div>
                  ))}
                </td>
                <td className="row-actions">
                  {editing?.id === group.id ? (
                    <form className="product-form" onSubmit={saveEdit}>
                      <label>Tên<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
                      <label>Khu vực<input value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value })} /></label>
                      <label>Duyệt bài
                        <select value={editing.approvalRequired} onChange={(e) => setEditing({ ...editing, approvalRequired: e.target.value as GroupApproval })}>{options(APPROVAL)}</select>
                      </label>
                      <label>Nội quy<textarea rows={3} value={editing.rulesNote} onChange={(e) => setEditing({ ...editing, rulesNote: e.target.value })} /></label>
                      <label>Ghi chú<textarea rows={2} value={editing.userNote} onChange={(e) => setEditing({ ...editing, userNote: e.target.value })} /></label>
                      <div><button type="submit" disabled={busy}>Lưu</button> <button type="button" onClick={() => setEditing(null)}>Hủy</button></div>
                    </form>
                  ) : (
                    <>
                      <button type="button" disabled={busy} onClick={() => setEditing({ id: group.id, name: group.name ?? '', region: group.region ?? '', rulesNote: group.rulesNote ?? '', userNote: group.userNote ?? '', approvalRequired: group.approvalRequired })}>Sửa</button>
                      <button type="button" disabled={busy} onClick={() => act(`/api/groups/${group.id}/archive`, { method: 'POST', body: JSON.stringify({ archived: !group.archived }) }, group.archived ? 'Đã dùng lại nhóm.' : 'Đã ngừng dùng nhóm.')}>
                        {group.archived ? 'Dùng lại' : 'Ngừng dùng'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.total > data.pageSize && (
        <div className="actions">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
          <span className="muted">Trang {page}/{pages} · {data.total} nhóm</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
        </div>
      )}
    </section>
  );
}
