import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { BusinessError } from '#domain';
import { createContentRepository, type createMediaStore, type Database, DEFAULT_MEDIA_MAX_BYTES, type ProductRevisionInput } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const ids = { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', pattern: UUID } };
const THUMB_PX = 320;
const optionalInt = { anyOf: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: 'null' }] };
const revisionProperties = {
  name: { type: 'string', minLength: 1, maxLength: 500 }, condition: { type: 'string', minLength: 1, maxLength: 10_000 },
  mediaIds: ids, priceVnd: optionalInt,
  capacityText: { anyOf: [{ type: 'string', maxLength: 10_000 }, { type: 'null' }] },
  batteryText: { anyOf: [{ type: 'string', maxLength: 10_000 }, { type: 'null' }] },
  warrantyText: { anyOf: [{ type: 'string', maxLength: 10_000 }, { type: 'null' }] },
  locationText: { anyOf: [{ type: 'string', maxLength: 10_000 }, { type: 'null' }] },
} as const;
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: UUID } } } as const;

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
  // Ngưỡng cố định 24 giờ; client không chọn được đường dẫn hay ảnh cụ thể để xóa.
  app.post('/api/media/cleanup', async () => media.purgeUnreferenced());
  app.get<{ Params: { id: string }; Querystring: { size?: 'thumb' } }>('/api/media/:id', {
    schema: {
      params: idParams,
      querystring: { type: 'object', additionalProperties: false, properties: { size: { type: 'string', enum: ['thumb'] } } },
    },
  }, async (request, reply) => {
    const saved = await media.verify(request.params.id);
    if (request.query.size === 'thumb') {
      // Ảnh thu nhỏ tạo theo yêu cầu, không lưu thêm file; ảnh gốc trong kho giữ nguyên.
      const thumb = await sharp(await readFile(saved.path), { failOn: 'warning' }).rotate()
        .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      return reply.type('image/jpeg').header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'no-store').send(thumb);
    }
    return reply.type(saved.media.mime_type).header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store').send(await readFile(saved.path));
  });

  app.post<{ Body: ProductRevisionInput }>('/api/products', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'condition', 'mediaIds'],
      properties: revisionProperties } },
  }, async (request, reply) => {
    await media.resolveForPublish(request.body.mediaIds);
    return reply.code(201).send(products.createProduct(request.body));
  });
  app.get<{ Params: { id: string } }>('/api/products/:id', { schema: { params: idParams } },
    async (request) => products.getProduct(request.params.id));
  app.put<{ Params: { id: string }; Body: ProductRevisionInput & { expectedRevisionId: string } }>('/api/products/:id', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false,
      required: ['expectedRevisionId', 'name', 'condition', 'mediaIds'],
      properties: { ...revisionProperties, expectedRevisionId: { type: 'string', pattern: UUID } } } },
  }, async (request) => {
    const { expectedRevisionId, ...revision } = request.body;
    await media.resolveForPublish(revision.mediaIds);
    products.reviseProduct(request.params.id, expectedRevisionId, revision);
    return products.getProduct(request.params.id);
  });
  app.post<{ Params: { id: string }; Body: { status: 'selling' | 'sold' | 'archived' } }>('/api/products/:id/status', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['status'],
      properties: { status: { type: 'string', enum: ['selling', 'sold', 'archived'] } } } },
  }, async (request) => {
    products.setProductStatus(request.params.id, request.body.status);
    return products.getProduct(request.params.id);
  });
  app.get<{ Params: { id: string } }>('/api/products/:id/content-versions', { schema: { params: idParams } },
    async (request) => ({ items: products.listVersions(request.params.id) }));
  app.post<{ Params: { id: string }; Body: { revisionId: string; caption: string; source: 'template' | 'manual'; destinationId?: string } }>(
    '/api/products/:id/content-versions', {
      schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['revisionId', 'caption', 'source'],
        properties: { revisionId: { type: 'string', pattern: UUID }, caption: { type: 'string', minLength: 1, maxLength: 10_000 },
          source: { type: 'string', enum: ['template', 'manual'] }, destinationId: { type: 'string', pattern: UUID } } } },
    }, async (request, reply) => {
      // Bản caption luôn mang ảnh của đúng phiên bản máy, theo thứ tự đã lưu; chưa gắn đích nên chưa thể duyệt.
      const product = products.getProduct(request.params.id);
      if (product.revisionId !== request.body.revisionId) throw new BusinessError('stale_approval');
      const id = products.createVersion({ productRevisionId: product.revisionId, caption: request.body.caption,
        mediaIds: product.mediaIds, source: request.body.source,
        ...(request.body.destinationId ? { destinationId: request.body.destinationId } : {}) });
      return reply.code(201).send({ id });
    });
  app.get<{ Querystring: { page?: number; pageSize?: number } }>('/api/products', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      page: { type: 'integer', minimum: 1, maximum: 1_000_000, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    } } },
  }, async (request) => products.listProducts(request.query.page, request.query.pageSize));
}
