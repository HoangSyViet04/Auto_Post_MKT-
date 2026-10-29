import { INTERVAL_ERROR, type PostDraft, resolvePostingInterval } from './post-plan.ts';

export function PostingIntervalFields({ draft, onChange }: { draft: PostDraft; onChange(patch: Partial<PostDraft>): void }) {
  const invalid = resolvePostingInterval(draft) === null;
  return <fieldset className="posting-interval">
    <legend>Khoảng nghỉ giữa các nhóm</legend>
    <div className="interval-fields">
      <label>Tối thiểu (giây)<input aria-label="Nghỉ tối thiểu (giây)" type="number" min={0} max={86400} step={1}
        aria-invalid={invalid} aria-describedby="interval-help" value={draft.intervalMin} onChange={(e) => onChange({ intervalMin: e.target.value })} /></label>
      <label>Tối đa (giây)<input aria-label="Nghỉ tối đa (giây)" type="number" min={0} max={86400} step={1}
        aria-invalid={invalid} aria-describedby="interval-help" value={draft.intervalMax} onChange={(e) => onChange({ intervalMax: e.target.value })} /></label>
    </div>
    <p id="interval-help" className={invalid ? 'field-error' : 'muted'} role={invalid ? 'alert' : undefined}>
      {invalid ? INTERVAL_ERROR : `Sau mỗi lần gửi, nghỉ ngẫu nhiên ${draft.intervalMin}–${draft.intervalMax} giây rồi mới xử lý nhóm tiếp. Nhập hai số bằng nhau để nghỉ cố định.`}
    </p>
    <p className="muted">Áp dụng cho lượt duyệt mới; bài đã xếp giữ cấu hình cũ. Bài đầu chạy theo giờ bắt đầu và hàng chờ của tài khoản.</p>
  </fieldset>;
}
