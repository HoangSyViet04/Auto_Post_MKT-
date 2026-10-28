import { randomUUID } from 'node:crypto';
import { BusinessError, captionTemplateProblems, type PresetItem, type PresetSchedule, type PresetTarget } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, objectInput, one, type RepositoryOptions, text, timestamp } from './repository-common.ts';

export interface PresetInput {
  label: string;
  captionTemplate?: string | null;
  schedule: PresetSchedule;
  /** Cặp tài khoản–đích do người dùng chọn rõ. Không bao giờ tự nhân cặp: hai tài khoản không tự đăng cùng một nhóm. */
  targets: ReadonlyArray<{ accountId: string; destinationId: string }>;
}

const MAX_TARGETS = 100;
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function schedule(value: unknown): PresetSchedule {
  objectInput(value);
  const input = value as { startMode?: unknown; timeOfDay?: unknown };
  if (input.startMode === 'now') {
    if (input.timeOfDay !== undefined) throw new BusinessError('invalid_input');
    return { startMode: 'now' };
  }
  if (input.startMode === 'daily' && typeof input.timeOfDay === 'string' && TIME_OF_DAY.test(input.timeOfDay)) return { startMode: 'daily', timeOfDay: input.timeOfDay };
  throw new BusinessError('invalid_input');
}

/**
 * Lưu cấu hình đăng thường dùng (P10.5). Chỉ là dữ liệu để điền sẵn form: lưu hay áp dụng cấu hình KHÔNG tạo job và không gửi gì.
 * Mỗi lần đăng vẫn đi qua duyệt đầy đủ (nhóm bị chặn/tài khoản chưa đăng nhập vẫn bị chặn như thường).
 */
export function createPresetRepository(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());

  function parse(input: PresetInput) {
    objectInput(input);
    text(input.label, 200);
    const captionTemplate = input.captionTemplate ?? null;
    if (captionTemplate !== null) {
      text(captionTemplate);
      if (captionTemplateProblems(captionTemplate).length > 0) throw new BusinessError('invalid_input');
    }
    if (!Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > MAX_TARGETS) throw new BusinessError('invalid_input');
    const seen = new Set<string>();
    const targets = input.targets.map((target) => {
      objectInput(target);
      identifier(target.accountId);
      identifier(target.destinationId);
      const key = `${target.accountId}:${target.destinationId}`;
      if (seen.has(key)) throw new BusinessError('invalid_input');
      seen.add(key);
      const destination = one<{ channel: string }>(db, 'SELECT channel FROM destinations WHERE id=? AND archived_at IS NULL', target.destinationId);
      if (!destination) throw new BusinessError('not_found');
      if (destination.channel === 'page') throw new BusinessError('invalid_input'); // fanpage dùng kết nối Page, chưa hỗ trợ ở cấu hình này
      if (!one(db, 'SELECT id FROM accounts WHERE id=? AND archived_at IS NULL', target.accountId)) throw new BusinessError('not_found');
      // Đích của cấu hình phải là đích mà chính tài khoản này có quan hệ (đã tham gia/đã lưu); không tạo cặp mới ở đây.
      if (!one(db, 'SELECT 1 FROM account_destinations WHERE account_id=? AND destination_id=?', target.accountId, target.destinationId)) throw new BusinessError('not_found');
      return { accountId: target.accountId, destinationId: target.destinationId, channel: destination.channel as 'profile' | 'group' };
    });
    return { label: input.label.trim(), captionTemplate, schedule: schedule(input.schedule), targets };
  }

  function writeTargets(presetId: string, targets: ReturnType<typeof parse>['targets']): void {
    db.prepare('DELETE FROM preset_targets WHERE preset_id=?').run(presetId);
    for (const target of targets) {
      db.prepare('INSERT INTO preset_targets(id,preset_id,destination_id,channel,account_id) VALUES(?,?,?,?,?)')
        .run(randomUUID(), presetId, target.destinationId, target.channel, target.accountId);
    }
  }

  function targetsOf(presetId: string): PresetTarget[] {
    return (db.prepare(`SELECT t.account_id,t.destination_id,t.channel,d.name,d.external_id FROM preset_targets t
      JOIN destinations d ON d.id=t.destination_id WHERE t.preset_id=? ORDER BY d.name,d.id`).all(presetId) as Array<Record<string, unknown>>).map((row) => ({
      accountId: String(row.account_id), destinationId: String(row.destination_id), channel: row.channel as 'profile' | 'group',
      name: row.name === null ? null : String(row.name), externalId: row.external_id === null ? null : String(row.external_id),
    }));
  }

  function item(row: Record<string, unknown>): PresetItem {
    return { id: String(row.id), label: String(row.label), captionTemplate: row.caption_template === null ? null : String(row.caption_template),
      schedule: JSON.parse(String(row.schedule_policy_json ?? '{"startMode":"now"}')) as PresetSchedule, targets: targetsOf(String(row.id)), createdAt: Number(row.created_at) };
  }

  return {
    list(): PresetItem[] {
      return (db.prepare('SELECT * FROM posting_presets WHERE archived_at IS NULL ORDER BY label COLLATE NOCASE,created_at').all() as Array<Record<string, unknown>>).map(item);
    },

    create(input: PresetInput): PresetItem {
      const parsed = parse(input);
      return atomic(db, () => {
        const id = randomUUID();
        db.prepare('INSERT INTO posting_presets(id,label,caption_template,schedule_policy_json,created_at) VALUES(?,?,?,?,?)')
          .run(id, parsed.label, parsed.captionTemplate, JSON.stringify(parsed.schedule), clock());
        writeTargets(id, parsed.targets);
        return item(db.prepare('SELECT * FROM posting_presets WHERE id=?').get(id) as Record<string, unknown>);
      });
    },

    update(id: string, input: PresetInput): PresetItem {
      identifier(id);
      const parsed = parse(input);
      return atomic(db, () => {
        if (!one(db, 'SELECT id FROM posting_presets WHERE id=? AND archived_at IS NULL', id)) throw new BusinessError('not_found');
        db.prepare('UPDATE posting_presets SET label=?,caption_template=?,schedule_policy_json=? WHERE id=?')
          .run(parsed.label, parsed.captionTemplate, JSON.stringify(parsed.schedule), id);
        writeTargets(id, parsed.targets);
        return item(db.prepare('SELECT * FROM posting_presets WHERE id=?').get(id) as Record<string, unknown>);
      });
    },

    /** Ngừng dùng (không xóa hẳn, giữ lịch sử). */
    archive(id: string): void {
      identifier(id);
      atomic(db, () => {
        if (!one(db, 'SELECT id FROM posting_presets WHERE id=? AND archived_at IS NULL', id)) throw new BusinessError('not_found');
        db.prepare('UPDATE posting_presets SET archived_at=? WHERE id=?').run(clock(), id);
      });
    },
  };
}
