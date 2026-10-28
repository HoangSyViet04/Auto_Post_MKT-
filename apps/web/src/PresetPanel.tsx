import { useCallback, useEffect, useState } from 'react';
import { CAPTION_PLACEHOLDERS, captionTemplateProblems, type PresetItem, type PresetListResponse, type PresetSchedule } from '#domain';
import { apiFetch } from './api.ts';
import { networkMessage, readError } from './http.ts';

interface Props {
  accountId: string;
  /** Nhóm đang chọn trong form (sẽ được lưu thành cặp tài khoản–nhóm). */
  selected: string[];
  startMode: 'now' | 'later';
  startLocal: string;
  templateText: string;
  onTemplateText: (value: string) => void;
  onApply: (preset: PresetItem) => void;
  notify: (message: string) => void;
}

/**
 * Cấu hình đăng thường dùng (P10.5): lưu/áp dụng chỉ điền sẵn form, không tạo job và không gửi gì tới Facebook.
 * Mỗi cặp tài khoản–nhóm do bạn chọn rõ; không có cách nào tự nhân một nhóm sang tài khoản khác.
 */
export function PresetPanel({ accountId, selected, startMode, startLocal, templateText, onTemplateText, onApply, notify }: Props) {
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [label, setLabel] = useState('');
  const [repeatDaily, setRepeatDaily] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const response = await apiFetch('/api/presets');
    if (response.ok) setPresets(((await response.json()) as PresetListResponse).items);
  }, []);
  useEffect(() => { reload().catch((e) => notify(networkMessage(e))); }, [reload, notify]);

  const active = presets.find((preset) => preset.id === activeId);
  const templateProblems = templateText.trim() ? captionTemplateProblems(templateText) : [];
  const dailyTime = startMode === 'later' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(startLocal) ? startLocal.slice(11, 16) : null;
  const schedule: PresetSchedule = repeatDaily && dailyTime ? { startMode: 'daily', timeOfDay: dailyTime } : { startMode: 'now' };
  const canSave = accountId !== '' && selected.length > 0 && templateProblems.length === 0 && !busy;

  const body = (name: string) => JSON.stringify({
    label: name, captionTemplate: templateText.trim() ? templateText : null, schedule,
    targets: selected.map((destinationId) => ({ accountId, destinationId })),
  });

  async function send(path: string, method: 'POST' | 'PUT', payload: string, done: string) {
    setBusy(true);
    try {
      const response = await apiFetch(path, { method, body: payload });
      if (!response.ok) { notify(await readError(response)); return; }
      const saved = (await response.json()) as PresetItem;
      await reload();
      setActiveId(saved.id);
      notify(done);
    } catch (e) {
      notify(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!active) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/api/presets/${active.id}/archive`, { method: 'POST', body: '{}' });
      if (!response.ok) { notify(await readError(response)); return; }
      setActiveId('');
      await reload();
      notify('Đã ngừng dùng cấu hình.');
    } catch (e) {
      notify(networkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function choose(id: string) {
    setActiveId(id);
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setLabel(preset.label);
    setRepeatDaily(preset.schedule.startMode === 'daily');
    onApply(preset);
  }

  return (
    <fieldset>
      <legend>Cấu hình thường dùng</legend>
      <div className="actions">
        <select aria-label="Cấu hình đã lưu" value={activeId} onChange={(event) => choose(event.target.value)}>
          <option value="">— chọn cấu hình đã lưu —</option>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.targets.length} nhóm</option>)}
        </select>
        {active && <button type="button" disabled={busy} onClick={archive}>Ngừng dùng cấu hình này</button>}
      </div>
      {active && <p className="muted">Áp dụng cấu hình chỉ điền sẵn form: nhóm nào không còn đủ điều kiện sẽ bị bỏ qua và báo rõ. Chưa có job nào được tạo.</p>}

      <label>
        Mẫu caption (tùy chọn) — dòng có chỗ trống mà máy chưa có dữ kiện sẽ tự bỏ cả dòng
        <textarea aria-label="Mẫu caption" rows={4} value={templateText} onChange={(event) => onTemplateText(event.target.value)}
          placeholder={'{ten}\nTình trạng: {tinh_trang}\nGiá: {gia}\nLiên hệ inbox nhé!'} />
      </label>
      <span className="muted">Chỗ trống dùng được: {Object.keys(CAPTION_PLACEHOLDERS).map((name) => `{${name}}`).join(' ')}</span>
      {templateProblems.length > 0 && <ul className="field-error">{templateProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}

      <div className="actions">
        <input className="inline-input" aria-label="Tên cấu hình" placeholder="Tên cấu hình, ví dụ: Máy mới buổi sáng" value={label} onChange={(event) => setLabel(event.target.value)} />
        <label className="check">
          <input type="checkbox" checked={repeatDaily} disabled={!dailyTime} onChange={(event) => setRepeatDaily(event.target.checked)} />
          Lặp hằng ngày theo giờ hẹn đã nhập{dailyTime ? ` (${dailyTime})` : ' (chọn "Hẹn giờ" ở mục Lịch trước)'}
        </label>
      </div>
      <div className="actions">
        <button type="button" disabled={!canSave || label.trim() === ''} onClick={() => send('/api/presets', 'POST', body(label.trim()), 'Đã lưu cấu hình mới.')}>
          Lưu thành cấu hình mới ({selected.length} nhóm)
        </button>
        {active && (
          <button type="button" disabled={!canSave || label.trim() === ''} onClick={() => send(`/api/presets/${active.id}`, 'PUT', body(label.trim()), 'Đã cập nhật cấu hình.')}>
            Cập nhật cấu hình đang chọn
          </button>
        )}
      </div>
      {accountId === '' && <span className="muted">Chọn tài khoản và nhóm trước khi lưu.</span>}
    </fieldset>
  );
}
