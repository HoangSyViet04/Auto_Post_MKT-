import { type ReactNode, useState } from 'react';
import type { AccountSummary, GroupItem, HealthResponse, JobListItem, ProductDetail, ProductListItem } from '#domain';
import { Icon } from './Icon.tsx';
import { JoinedScanPanel } from './JoinedScanPanel.tsx';
import type { PostDraft, PlanItem } from './post-plan.ts';
import { describeJobResult, formatVn, JOB_STATUS_LABEL } from './job-view.ts';

export interface GroupComposerViewProps {
  accounts: AccountSummary[]; products: ProductListItem[]; detail: ProductDetail | null; account: AccountSummary | undefined;
  draft: PostDraft; groups: GroupItem[]; visible: GroupItem[]; filter: string; wantedCount: string;
  live: boolean; health: HealthResponse | null; template: string; items: PlanItem[]; startAt: number | null;
  duplicate: string | null; similar: Map<string, number>; problems: string[]; ready: boolean; busy: boolean;
  message: string; liveConfirm: boolean;
  batch: { jobs: Array<{ jobId: string; destinationId: string }>; replayed: boolean } | null;
  jobs: Map<string, JobListItem>;
  onChange(patch: Partial<PostDraft>): void; onFilter(value: string): void; onWantedCount(value: string): void;
  onChooseCount(): void; onLiveConfirm(value: boolean): void; onSubmit(): void; onRefreshGroups(): Promise<void>;
  onRetryGroups(): void;
  failureFor(id: string): string | undefined; presets: ReactNode;
}

const BLOCKERS = { no_external_id: 'Chưa có ID số', not_joined: 'Chưa tham gia', no_permission: 'Chưa xác nhận quyền đăng', unsuitable: 'Không phù hợp', archived: 'Đã ngừng dùng', account_paused: 'Tài khoản tạm dừng' } as const;

export function GroupComposerView(p: GroupComposerViewProps) {
  const [previewId, setPreviewId] = useState('');
  const [previewTab, setPreviewTab] = useState<'content' | 'photos'>('content');
  const [editing, setEditing] = useState(false);
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [sharedEditorOpen, setSharedEditorOpen] = useState(false);
  const relation = (group: GroupItem) => group.accounts.find((item) => item.accountId === p.draft.accountId);
  const shown = p.visible.filter((group) => !onlyEligible || relation(group)?.eligible).sort((a, b) =>
    Number(b.curation === 'preferred') - Number(a.curation === 'preferred') || (a.name ?? '').localeCompare(b.name ?? '', 'vi') || a.id.localeCompare(b.id));
  const available = p.visible.filter((group) => relation(group)?.eligible);
  const allEligible = p.groups.filter((group) => relation(group)?.eligible);
  const active = p.items.find((item) => item.destinationId === previewId) ?? p.items[0];
  const groupById = new Map(p.groups.map((group) => [group.id, group]));
  const activeGroup = active ? groupById.get(active.destinationId) : undefined;
  const caption = active?.caption ?? p.draft.caption;
  const stage = !p.detail || !p.account ? 0 : p.items.length === 0 ? 1 : p.live && !p.liveConfirm ? 2 : 3;
  const steps = [{ label: 'Chọn máy', target: 'machine-card' }, { label: 'Chọn nhóm', target: 'group-card' }, { label: 'Xem trước', target: 'post-preview' }, { label: 'Duyệt & xếp lịch', target: 'approval-bar' }];
  function editCaption(value: string) {
    p.onChange(active ? { overrides: { ...p.draft.overrides, [active.destinationId]: value } } : { caption: value });
  }
  function openPresets() {
    setPresetsOpen(true);
    requestAnimationFrame(() => document.getElementById('posting-presets')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  return <section className="group-composer">
    <header className="page-header composer-heading"><div><h1>Đăng bài viết nhóm</h1><p>Chọn máy, chọn nhóm, xem trước rồi duyệt đăng.</p></div><a className="text-link" href="#/queue"><Icon name="history" /> Xem hàng chờ</a></header>
    <ol className="composer-steps" aria-label="Tiến trình chuẩn bị bài">
      {steps.map((step, index) => <li key={step.target} className={index < stage ? 'complete' : index === stage ? 'current' : ''} aria-current={index === stage ? 'step' : undefined}>
        <button type="button" onClick={() => document.getElementById(step.target)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><span className="step-number">{index < stage ? <Icon name="check" /> : index + 1}</span><span>{step.label}</span></button>
      </li>)}
    </ol>
    {p.message && <p className="composer-message notice" role="status">{p.message}</p>}
    {p.health && !p.health.worker.alive && <p className="notice">Bộ chạy đang tắt. Bài đã xếp sẽ chờ cho tới khi bạn mở lại ứng dụng bằng Auto-Post-MKT.cmd.</p>}
    <div className="composer-grid">
      <div className="composer-workspace">
        <section id="machine-card" className="surface-card machine-card" aria-label="Máy và tài khoản">
          <div className="card-heading"><h2>Máy & tài khoản</h2><button type="button" className="subtle-action" aria-expanded={sharedEditorOpen} aria-controls="shared-caption" onClick={() => setSharedEditorOpen(!sharedEditorOpen)}><Icon name="edit" /> Caption chung</button></div>
          <div className="machine-account-grid">
            <div className="machine-picker">
              <div className="machine-photo">{p.detail?.mediaIds[0] ? <img src={`/api/media/${p.detail.mediaIds[0]}?size=thumb`} alt="Ảnh máy đang chọn" /> : <Icon name="phone" />}</div>
              <div className="machine-info"><label htmlFor="post-product">Máy đang đăng</label><select id="post-product" aria-label="Máy" value={p.draft.productId} onChange={(e) => p.onChange({ productId: e.target.value })}><option value="">Chọn máy đang bán…</option>{p.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <p className="muted">{p.detail ? `${p.detail.condition} · ${p.detail.mediaIds.length} ảnh` : 'Chọn máy để tự điền nội dung và ảnh.'}</p>
                {p.products.length === 0 && <a className="text-link" href="#/products">Thêm máy đầu tiên <Icon name="chevron" /></a>}
              </div>
            </div>
            <div className="account-picker"><label htmlFor="post-account">Tài khoản đăng</label><select id="post-account" aria-label="Tài khoản" value={p.draft.accountId} onChange={(e) => p.onChange({ accountId: e.target.value, selected: [], overrides: {} })}><option value="">Chọn tài khoản…</option>{p.accounts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
              {p.account && <span className={`status-badge ${p.account.sessionStatus === 'logged_in' && !p.account.paused ? 'success' : 'neutral'}`}><span className="status-dot" />{p.account.paused ? 'Đang tạm dừng' : p.account.sessionStatus === 'logged_in' ? 'Đã đăng nhập' : 'Cần kiểm tra phiên'}</span>}
              {p.account && p.account.sessionStatus !== 'logged_in' && <a className="text-link" href="#/accounts">Đăng nhập / kiểm tra phiên</a>}
            </div>
          </div>
          {sharedEditorOpen && <div id="shared-caption" className="caption-editor"><label>Caption chung<textarea aria-label="Caption" rows={4} value={p.draft.caption} onChange={(e) => p.onChange({ caption: e.target.value })} placeholder="Chọn máy để có caption mẫu" /></label>{p.detail && p.draft.caption !== p.template && <button type="button" onClick={() => p.onChange({ caption: p.template })}>Dùng lại caption mẫu</button>}<p className="muted">Nội dung chỉ gồm dữ kiện đã nhập. Có thể chỉnh riêng từng nhóm ở bản xem trước.</p></div>}
        </section>
        <section id="group-card" className="surface-card group-picker-card" aria-label="Chọn nhóm đăng">
          <div className="card-heading"><div><h2>Chọn nhóm đăng</h2><p className="muted">Lấy nhóm từ tài khoản đang chọn</p></div><button type="button" className="outline-accent" aria-label="Mở bảng quét nhóm" aria-expanded={scanOpen} onClick={() => setScanOpen(!scanOpen)}><Icon name="refresh" /> Quét nhóm đã tham gia</button></div>
          {scanOpen && <div className="inline-scan"><JoinedScanPanel key={p.draft.accountId} account={p.account} onRefresh={p.onRefreshGroups} /></div>}
          <div className="group-count-controls"><label htmlFor="group-count">Số nhóm muốn đăng</label><input id="group-count" type="number" aria-label="Số nhóm muốn đăng" min={1} max={100} value={p.wantedCount} onChange={(e) => p.onWantedCount(e.target.value)} /><button type="button" className="primary" aria-label="Chọn theo số lượng" disabled={!p.draft.accountId} onClick={p.onChooseCount}>Chọn {Number.isInteger(Number(p.wantedCount)) && Number(p.wantedCount) > 0 ? p.wantedCount : ''} nhóm</button><span className="status-badge success"><Icon name="check" /> {p.items.length} đã chọn / {allEligible.length} đủ điều kiện</span></div>
          <p className="group-selection-hint">Ưu tiên nhóm đã đánh dấu ưu tiên. Bạn có thể chỉnh lại danh sách.</p>
          <div className="group-filter"><label className="search-field"><Icon name="search" /><input aria-label="Lọc nhóm" placeholder="Tìm tên nhóm, khu vực, nội quy…" value={p.filter} onChange={(e) => p.onFilter(e.target.value)} /></label><button type="button" className={onlyEligible ? 'filter-button selected' : 'filter-button'} aria-pressed={onlyEligible} onClick={() => setOnlyEligible(!onlyEligible)}><Icon name="sliders" /> Đủ điều kiện</button></div>
          <div className="group-list-actions"><button type="button" className="link" disabled={!available.length} onClick={() => p.onChange({ selected: available.slice(0, 100).map((group) => group.id) })}>Chọn {Math.min(100, available.length)} nhóm trong bộ lọc</button><button type="button" className="link" disabled={!p.items.length} onClick={() => p.onChange({ selected: [] })}>Bỏ chọn hết</button><button type="button" className="link" disabled={!p.draft.accountId} onClick={p.onRetryGroups}>Tải lại danh sách</button><span>{shown.length} nhóm</span></div>
          <section className="group-table-scroll" aria-label="Danh sách nhóm có thể cuộn"><table className="table group-table"><thead><tr><th aria-label="Chọn" /><th>Tên nhóm</th><th>Quyền đăng</th><th className="priority-cell">Ưu tiên</th></tr></thead><tbody>
            {shown.map((group) => {
              const r = relation(group); const eligible = r?.eligible === true; const selected = p.draft.selected.includes(group.id); const failure = p.failureFor(group.id);
              return <tr key={group.id} className={`${selected ? 'is-selected' : ''}${!eligible ? ' is-blocked' : ''}`}><td><input type="checkbox" aria-label={`Chọn ${group.name ?? group.externalId}`} disabled={!eligible} checked={selected} onChange={(e) => p.onChange({ selected: e.target.checked ? [...p.draft.selected, group.id] : p.draft.selected.filter((id) => id !== group.id) })} /></td><td><div className="group-name"><span className="group-avatar"><Icon name="groups" /></span><div>{selected ? <button type="button" className="group-preview-link" onClick={() => { setPreviewId(group.id); setEditing(false); }}>{group.name ?? group.externalId ?? 'Chưa đặt tên'}</button> : <strong>{group.name ?? group.externalId ?? 'Chưa đặt tên'}</strong>}<small>{r?.membership === 'joined' ? 'Nhóm đã tham gia' : 'Chưa xác nhận tham gia'}{group.region ? ` · ${group.region}` : ''}</small>{group.rulesNote && <span className="group-rule" title={group.rulesNote}>{group.rulesNote}</span>}</div></div></td><td>{eligible ? <span className="status-badge success"><Icon name="check" /> Được đăng</span> : <span className="blocked-reason">{(r?.blockedBy ?? ['not_joined']).map((reason) => BLOCKERS[reason]).join(' · ')}</span>}{failure && <span className="field-error">Bị chặn: {failure}</span>}</td><td className="priority-cell"><span role="img" className={group.curation === 'preferred' ? 'priority-star preferred' : 'priority-star'} aria-label={group.curation === 'preferred' ? 'Nhóm ưu tiên' : 'Ưu tiên bình thường'}><Icon name="star" /></span></td></tr>;
            })}
          </tbody></table>{shown.length === 0 && <div className="empty-state"><Icon name="groups" /><strong>{!p.draft.accountId ? 'Chọn tài khoản để xem nhóm' : 'Chưa có nhóm khớp bộ lọc'}</strong><span>Quét nhóm đã tham gia hoặc thêm nhóm ở trang Nhóm đã tham gia.</span><a className="text-link" href="#/scan-joined">Quản lý danh sách nhóm <Icon name="chevron" /></a></div>}</section>
          <div className="group-list-footer"><strong>Đã chọn {p.items.length} nhóm</strong><span>Quét nhóm không tự xác nhận quyền đăng bán hàng.</span></div>
        </section>
        <details id="posting-presets" className="surface-card presets-drawer" open={presetsOpen} onToggle={(e) => setPresetsOpen(e.currentTarget.open)}><summary><Icon name="save" /> Cấu hình đăng thường dùng <Icon name="chevron" /></summary>{p.presets}</details>
      </div>
      <aside className="preview-stack" aria-label="Bản xem trước và lịch đăng">
        <section id="post-preview" className="surface-card post-preview"><h2>Xem trước bài đăng</h2><div className="preview-tabs"><button type="button" aria-pressed={previewTab === 'content'} className={previewTab === 'content' ? 'active' : ''} onClick={() => setPreviewTab('content')}>Nội dung</button><button type="button" aria-pressed={previewTab === 'photos'} className={previewTab === 'photos' ? 'active' : ''} onClick={() => setPreviewTab('photos')}>Ảnh <span>{p.detail?.mediaIds.length ?? 0}</span></button></div>
          {p.items.length > 0 && <label className="preview-target">Bản xem trước cho nhóm<select aria-label="Nhóm xem trước" value={active?.destinationId ?? ''} onChange={(e) => { setPreviewId(e.target.value); setEditing(false); }}>{p.items.map((item) => <option key={item.destinationId} value={item.destinationId}>{groupById.get(item.destinationId)?.name ?? item.destinationId}</option>)}</select></label>}
          <div className="social-preview"><div className="preview-author"><span className="author-avatar"><Icon name="profile" /></span><div><strong>{p.account?.label ?? 'Chưa chọn tài khoản'}</strong><small>{activeGroup?.name ?? 'Bản xem trước'}</small></div></div>
            {previewTab === 'content' && <>{editing ? <label className="preview-caption-edit">Nội dung {active ? 'riêng cho nhóm này' : 'chung'}<textarea aria-label={active ? `Caption cho ${activeGroup?.name ?? active.destinationId}` : 'Chỉnh caption bản xem trước'} rows={6} value={active ? p.draft.overrides[active.destinationId] ?? p.draft.caption : p.draft.caption} onChange={(e) => editCaption(e.target.value)} /></label> : <p className="preview-caption">{caption || 'Nội dung bài đăng sẽ xuất hiện ở đây sau khi bạn chọn máy.'}</p>}</>}
            {p.detail && p.detail.mediaIds.length > 0 ? <div className={`preview-photos${previewTab === 'photos' ? ' all-photos' : ''}`}>{p.detail.mediaIds.map((id, index) => <figure key={id}><img src={`/api/media/${id}?size=thumb`} alt={`Ảnh đăng thứ ${index + 1}`} /><figcaption>Ảnh {index + 1}</figcaption></figure>)}</div> : <div className="preview-photo-empty"><Icon name="image" /><span>Ảnh máy sẽ hiển thị tại đây</span></div>}
            <div className="preview-photo-note">{p.detail?.mediaIds.length ?? 0} ảnh · Giữ thứ tự đã chọn</div>
            <button type="button" className="outline-accent edit-preview" disabled={!p.detail} onClick={() => { setPreviewTab('content'); setEditing(!editing); }}><Icon name={editing ? 'check' : 'edit'} />{editing ? 'Xong chỉnh sửa' : 'Chỉnh sửa nội dung'}</button>
          </div>
          {activeGroup?.rulesNote && <p className="notice">Nội quy: {activeGroup.rulesNote}</p>}
          {active && p.similar.has(active.destinationId) && <p className="field-warning">Giống {Math.round((p.similar.get(active.destinationId) ?? 0) * 100)}% một bản đã lưu cho nhóm này.</p>}
          {p.duplicate && <p className="field-warning">{p.duplicate}</p>}
        </section>
        <section className="surface-card schedule-card" aria-label="Lịch đăng"><h2><Icon name="clock" /> Lịch đăng</h2><div className="schedule-options"><label className="check"><input type="radio" name="start" checked={p.draft.startMode === 'now'} onChange={() => p.onChange({ startMode: 'now' })} /> Bắt đầu ngay</label><label className="check"><input type="radio" name="start" checked={p.draft.startMode === 'later'} onChange={() => p.onChange({ startMode: 'later' })} /> Hẹn giờ</label></div>{p.draft.startMode === 'later' && <label>Giờ Việt Nam<input type="datetime-local" aria-label="Giờ hẹn" value={p.draft.startLocal} onChange={(e) => p.onChange({ startLocal: e.target.value })} /></label>}<p className="muted">{p.draft.startMode === 'later' && p.startAt !== null ? formatVn(p.startAt) : 'Các bài được đăng lần lượt.'}</p></section>
      </aside>
    </div>
    <div id="approval-bar" className="approval-area">
      {p.problems.length > 0 && <details className="approval-problems"><summary>{p.problems.length} việc cần hoàn tất trước khi xếp lịch</summary><ul className="field-error" aria-label="Chưa gửi được">{p.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></details>}
      {p.live && <label className="check live-confirm"><input type="checkbox" checked={p.liveConfirm} onChange={(e) => p.onLiveConfirm(e.target.checked)} />Tôi xác nhận ĐĂNG THẬT {p.items.length} bài lên Facebook bằng tài khoản {p.account?.label ?? '…'}.</label>}
      <div className="approval-bar"><div><strong>{p.items.length} nhóm · {p.items.length} tác vụ riêng</strong><span>{p.batch ? 'Đã có lượt xếp lịch. Kết quả từng nhóm ở phía dưới.' : 'Chưa có bài nào được gửi từ bản nháp này.'}</span></div><div className="approval-actions"><button type="button" onClick={openPresets}><Icon name="save" /> Lưu cấu hình</button><button type="button" className="primary" disabled={!p.ready} onClick={p.onSubmit}><Icon name="send" />{p.busy ? 'Đang xếp lịch…' : `Duyệt và xếp lịch (${p.items.length} nhóm)`}</button></div></div>
    </div>
    {p.batch && <section className="surface-card result-panel"><div className="card-heading"><h2>Kết quả từng nhóm{p.batch.replayed ? ' · Đã ghi nhận trước đó' : ''}</h2><a className="text-link" href="#/queue">Mở hàng chờ <Icon name="chevron" /></a></div><div className="table-scroll"><table className="table"><thead><tr><th>Nhóm</th><th>Trạng thái</th></tr></thead><tbody>{p.batch.jobs.map((entry) => { const job = p.jobs.get(entry.jobId); return <tr key={entry.jobId}><td>{groupById.get(entry.destinationId)?.name ?? entry.destinationId}</td><td><strong>{job ? JOB_STATUS_LABEL[job.status] : 'Đang tải…'}</strong>{job && <div className={job.status === 'failed' || job.status === 'unknown' ? 'field-error' : 'muted'}>{describeJobResult(job)}</div>}</td></tr>; })}</tbody></table></div></section>}
  </section>;
}
