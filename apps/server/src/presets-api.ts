import type { FastifyInstance } from 'fastify';
import { postingIntervalSchema } from './posting-interval-schema.ts';
import type { PresetListResponse } from '#domain';
import { createPresetRepository, type Database, type PresetInput } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const uuid = { type: 'string', pattern: UUID } as const;
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const presetBody = {
  type: 'object', additionalProperties: false, required: ['label', 'schedule', 'targets'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 200 },
    captionTemplate: { anyOf: [{ type: 'string', minLength: 1, maxLength: 10_000 }, { type: 'null' }] },
    schedule: { type: 'object', additionalProperties: false, required: ['startMode'], properties: {
      startMode: { type: 'string', enum: ['now', 'daily'] }, timeOfDay: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, postingInterval: postingIntervalSchema } },
    targets: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['accountId', 'destinationId'],
      properties: { accountId: uuid, destinationId: uuid } } },
  },
} as const;

/**
 * Cấu hình đăng thường dùng (P10.5). Lưu/sửa/ngừng dùng chỉ ghi dữ liệu điền sẵn: không tạo job, không gửi gì tới Facebook.
 * Đăng thật vẫn phải qua trang đăng (duyệt từng nhóm, xác nhận đăng thật).
 */
export function installPresetsApi(app: FastifyInstance, db: Database): void {
  const presets = createPresetRepository(db);

  app.get('/api/presets', async (): Promise<PresetListResponse> => ({ items: presets.list() }));

  app.post<{ Body: PresetInput }>('/api/presets', { schema: { body: presetBody } },
    async (request, reply) => reply.code(201).send(presets.create(request.body)));

  app.put<{ Params: { id: string }; Body: PresetInput }>('/api/presets/:id', { schema: { params: idParams, body: presetBody } },
    async (request) => presets.update(request.params.id, request.body));

  // POST (không phải DELETE): client luôn gửi JSON cho thao tác ghi, và DELETE không có body sẽ bị Fastify từ chối.
  app.post<{ Params: { id: string } }>('/api/presets/:id/archive', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request, reply) => {
    presets.archive(request.params.id);
    return reply.code(204).send();
  });
}
