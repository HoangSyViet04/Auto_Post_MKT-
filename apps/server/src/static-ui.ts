import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

/** Chỉ các loại file mà bản build giao diện thật sự tạo ra. Cố ý KHÔNG có `.map` (bản đồ nguồn) hay bất kỳ loại nào khác. */
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/u;
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function hardening(reply: FastifyReply): void {
  reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cross-Origin-Resource-Policy', 'same-origin');
}

/**
 * Phục vụ giao diện đã build cho người vận hành (P12.4). Danh sách cho phép chặt: đúng `/` (index.html) và các file phẳng trong `/assets/`
 * có đuôi nằm trong danh sách. Không liệt kê thư mục, không phục vụ đường dẫn tùy ý, không `.map`, không theo liên kết ra ngoài thư mục
 * build, nên `.env`, dữ liệu vận hành, mã nguồn không thể bị tải về. Mọi route vẫn đi qua kiểm tra Host/Origin cục bộ.
 * Trả false (và không cài gì) nếu chưa build.
 */
export function installStaticUi(app: FastifyInstance, distDir: string): boolean {
  const root = resolve(distDir);
  let indexHtml: Buffer;
  try {
    indexHtml = readFileSync(join(root, 'index.html'));
  } catch {
    return false;
  }
  const assetsDir = join(root, 'assets');

  app.get('/', async (_request, reply) => {
    hardening(reply);
    return reply.header('Content-Security-Policy', CSP).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(indexHtml);
  });

  // Tên file có băm nội dung nên cache lâu được; cập nhật ứng dụng đổi tên file.
  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => {
    const name = request.params['*'];
    const type = TYPES[name.slice(name.lastIndexOf('.')).toLowerCase()];
    if (!ASSET_NAME.test(name) || !type) return reply.callNotFound();
    try {
      const real = realpathSync(join(assetsDir, name));
      if (!real.startsWith(`${realpathSync(assetsDir)}${sep}`) || !statSync(real).isFile()) return reply.callNotFound();
      hardening(reply);
      return reply.header('Cache-Control', 'public, max-age=31536000, immutable').type(type).send(readFileSync(real));
    } catch {
      return reply.callNotFound();
    }
  });
  return true;
}
