import type { FastifyInstance } from 'fastify';
import type { GroupMembership } from '#domain';
import { type AddGroupInput, createGroupRepository, type Database, type GroupFilter, type GroupProfileInput } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const uuid = { type: 'string', pattern: UUID } as const;
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const nullableText = (max: number) => ({ anyOf: [{ type: 'string', maxLength: max }, { type: 'null' }] }) as const;
const membership = { type: 'string', enum: ['unknown', 'joined', 'not_joined'] } as const;
const permission = { type: 'string', enum: ['unknown', 'allowed', 'denied'] } as const;
const profile = {
  name: nullableText(500), region: nullableText(200), topic: nullableText(200), rulesNote: nullableText(10_000), userNote: nullableText(10_000),
  approvalRequired: { type: 'string', enum: ['unknown', 'required', 'not_required'] },
  curation: { type: 'string', enum: ['normal', 'preferred', 'unsuitable'] },
} as const;

/**
 * Danh sách nhóm đã lưu (P06.1/P06.5–P06.7). Dữ liệu do người dùng nhập tay; chưa có đọc tự động từ Facebook.
 * Không có thao tác nào ở đây gửi gì tới Facebook hay tạo hàng chờ.
 */
export function installGroupsApi(app: FastifyInstance, db: Database): void {
  const groups = createGroupRepository(db);

  app.get<{ Querystring: GroupFilter }>('/api/groups', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      accountId: uuid, q: { type: 'string', maxLength: 200 }, region: { type: 'string', maxLength: 200 }, membership, curation: profile.curation,
      includeArchived: { type: 'boolean' }, page: { type: 'integer', minimum: 1, maximum: 1_000_000 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async (request) => groups.list(request.query));

  app.post<{ Body: AddGroupInput }>('/api/groups', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['reference', 'accountId'],
      properties: { ...profile, reference: { type: 'string', minLength: 1, maxLength: 2000 }, accountId: uuid, membership, permission } } },
  }, async (request, reply) => reply.code(201).send(groups.add(request.body)));

  app.put<{ Params: { id: string }; Body: GroupProfileInput }>('/api/groups/:id', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: profile } },
  }, async (request, reply) => {
    groups.update(request.params.id, request.body);
    return reply.code(204).send();
  });

  app.put<{ Params: { id: string; accountId: string }; Body: { membership?: GroupMembership; permission?: 'unknown' | 'allowed' | 'denied' } }>(
    '/api/groups/:id/accounts/:accountId', {
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['id', 'accountId'], properties: { id: uuid, accountId: uuid } },
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { membership, permission } },
      },
    }, async (request, reply) => {
      groups.setRelation(request.params.id, request.params.accountId, request.body);
      return reply.code(204).send();
    });

  app.post<{ Params: { id: string }; Body: { archived: boolean } }>('/api/groups/:id/archive', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['archived'], properties: { archived: { type: 'boolean' } } } },
  }, async (request, reply) => {
    groups.setArchived(request.params.id, request.body.archived);
    return reply.code(204).send();
  });
}
