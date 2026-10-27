import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { BusinessError } from '#domain';
import { createContentRepository, type createMediaStore, type Database, DEFAULT_MEDIA_MAX_BYTES, type ProductRevisionInput } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const ids = { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', pattern: UUID } };
const optionalText = { anyOf: [{ type: 'string', maxLength: 10_000 }, { type: 'null' }] };

export function installDataApi(app: FastifyInstance, db: Database,
  media: ReturnType<typeof createMediaStore>, uploadLimitBytes = DEFAULT_MEDIA_MAX_BYTES): void {
  if (!Number.isInteger(uploadLimitBytes) || uploadLimitBytes < 1 || uploadLimitBytes > DEFAULT_MEDIA_MAX_BYTES) {
    throw new BusinessError('invalid_input');
  }
  const products = createContentRepository(db);
  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.post('/api/media', { bodyLimit: uploadLimitBytes }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) throw new BusinessError('invalid_input');
    const saved = await media.importBytes(request.body);
    return reply.code(201).send({ id: saved.id, mimeType: saved.mime_type, byteSize: saved.byte_size,
      sha256: saved.sha256, state: saved.state });
  });
  app.get<{ Params: { id: string } }>('/api/media/:id', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: UUID } } } },
  }, async (request, reply) => {
    const saved = await media.verify(request.params.id);
    return reply.type(saved.media.mime_type).header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store').send(await readFile(saved.path));
  });

  app.post<{ Body: ProductRevisionInput }>('/api/products', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'condition', 'mediaIds'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 500 }, condition: { type: 'string', minLength: 1, maxLength: 10_000 },
      mediaIds: ids, priceVnd: { anyOf: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: 'null' }] },
      capacityText: optionalText, batteryText: optionalText, warrantyText: optionalText, locationText: optionalText,
    } } },
  }, async (request, reply) => {
    await media.resolveForPublish(request.body.mediaIds);
    return reply.code(201).send(products.createProduct(request.body));
  });
  app.get<{ Querystring: { page?: number; pageSize?: number } }>('/api/products', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      page: { type: 'integer', minimum: 1, maximum: 1_000_000, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    } } },
  }, async (request) => products.listProducts(request.query.page, request.query.pageSize));
}
