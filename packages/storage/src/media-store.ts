import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { getDataDir } from '#config';
import { BusinessError } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, mediaIds as validateMediaIds, one, timestamp } from './repository-common.ts';

export interface MediaRecord {
  id: string; storage_key: string; sha256: string; mime_type: string; byte_size: number;
  state: 'staging' | 'ready' | 'missing' | 'failed'; created_at: number;
}
export interface MediaStoreOptions {
  dataDir?: string;
  maxBytes?: number;
  maxPixels?: number;
}
export const DEFAULT_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MEDIA_MAX_PIXELS = 25_000_000;
const REPO_ROOT = resolve(import.meta.dirname, '../../..');

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}
function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function imageType(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new BusinessError('media_invalid');
}

/** App-owned UUID paths only. Source filenames/extensions are never stored or trusted. */
export function createMediaStore(db: Database, options: MediaStoreOptions = {}) {
  const dataDir = resolve(options.dataDir ?? getDataDir());
  const maxBytes = options.maxBytes ?? DEFAULT_MEDIA_MAX_BYTES;
  const maxPixels = options.maxPixels ?? DEFAULT_MEDIA_MAX_PIXELS;
  if (inside(REPO_ROOT, dataDir) || !Number.isSafeInteger(maxBytes) || maxBytes < 1
    || !Number.isSafeInteger(maxPixels) || maxPixels < 1) throw new BusinessError('invalid_input');

  async function directories() {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const base = await realpath(dataDir);
    if (inside(REPO_ROOT, base)) throw new BusinessError('invalid_input');
    const root = join(base, 'media'); const staging = join(root, 'staging'); const objects = join(root, 'objects');
    for (const dir of [root, staging, objects]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const info = await lstat(dir);
      if (!info.isDirectory() || info.isSymbolicLink() || !inside(root, await realpath(dir))) throw new BusinessError('invalid_input');
    }
    return { staging, objects };
  }
  function record(mediaId: string): MediaRecord {
    identifier(mediaId);
    const media = one<MediaRecord>(db, 'SELECT * FROM media WHERE id=?', mediaId);
    if (!media) throw new BusinessError('not_found');
    identifier(media.storage_key);
    return media;
  }
  async function decode(bytes: Buffer): Promise<string> {
    const mime = imageType(bytes);
    try {
      // Read dimensions before the pixel limit can throw a decoder-specific error.
      const meta = await sharp(bytes, { failOn: 'warning', limitInputPixels: false }).metadata();
      if (!meta.width || !meta.height || meta.width * meta.height > maxPixels) throw new BusinessError('media_too_large');
      if ((meta.pages ?? 1) !== 1) throw new BusinessError('media_invalid');
      await sharp(bytes, { failOn: 'warning', limitInputPixels: maxPixels }).stats(); // Full pixel decode.
      return mime;
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      throw new BusinessError('media_invalid');
    }
  }
  async function boundedRead(path: string): Promise<Buffer> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new BusinessError('media_invalid');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw new BusinessError('media_invalid');
      if (stat.size < 1 || stat.size > maxBytes) throw new BusinessError('media_too_large');
      const chunks: Buffer[] = []; let count = 0;
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        count += chunk.length;
        if (count > maxBytes) throw new BusinessError('media_too_large');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, count);
    } finally { await file.close(); }
  }
  async function removeOwned(path: string, parent: string) {
    // Only exact generated leaf paths in the checked store may be removed.
    if (dirname(path) !== parent || !/^[a-f\d-]{36}\.(part|blob)$/.test(basename(path))) throw new BusinessError('invalid_input');
    const info = await lstat(parent);
    if (info.isSymbolicLink() || relative(parent, await realpath(parent)) !== '') throw new BusinessError('invalid_input');
    try { await unlink(path); } catch (error) { if (!isMissing(error)) throw error; }
  }

  async function verify(mediaId: string): Promise<{ media: MediaRecord; path: string }> {
    const media = record(mediaId);
    if (media.state !== 'ready') throw new BusinessError(media.state === 'missing' ? 'media_missing' : 'not_ready');
    let failure: 'media_missing' | 'media_invalid' | undefined;
    try {
      const { objects } = await directories(); const path = join(objects, `${media.storage_key}.blob`);
      const bytes = await boundedRead(path);
      if (bytes.length !== media.byte_size || digest(bytes) !== media.sha256) failure = 'media_invalid';
      else return { media, path };
    } catch (error) {
      if (isMissing(error)) failure = 'media_missing';
      else if (error instanceof BusinessError && error.code === 'media_too_large') throw error;
      else if (error instanceof BusinessError) failure = 'media_invalid';
      else throw new BusinessError('media_io');
    }
    db.prepare("UPDATE media SET state=? WHERE id=? AND state='ready'").run(failure === 'media_missing' ? 'missing' : 'failed', mediaId);
    throw new BusinessError(failure ?? 'media_invalid');
  }

  const store = {
    async importFile(sourcePath: string): Promise<MediaRecord> {
      if (db.isTransaction || typeof sourcePath !== 'string' || !sourcePath.trim()) throw new BusinessError('invalid_input');
      const id = randomUUID(); const key = randomUUID();
      let paths: Awaited<ReturnType<typeof directories>> | undefined;
      let staged = false; let inserted = false; let promoted = false;
      try {
        paths = await directories();
        const part = join(paths.staging, `${key}.part`);
        const blob = join(paths.objects, `${key}.blob`);
        const source = await lstat(sourcePath);
        if (!source.isFile() || source.isSymbolicLink()) throw new BusinessError('media_invalid');
        const file = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const stat = await file.stat();
          if (!stat.isFile()) throw new BusinessError('media_invalid');
          if (stat.size < 1 || stat.size > maxBytes) throw new BusinessError('media_too_large');
          const output = await open(part, 'wx', 0o600); staged = true;
          try {
            let count = 0;
            for await (const chunk of file.createReadStream({ autoClose: false })) {
              count += chunk.length;
              if (count > maxBytes) throw new BusinessError('media_too_large');
              await output.writeFile(chunk);
            }
            await output.sync();
          } finally { await output.close(); }
        } finally { await file.close(); }
        const bytes = await readFile(part);
        const mime = await decode(bytes);
        atomic(db, () => {
          db.prepare("INSERT INTO media(id,storage_key,sha256,mime_type,byte_size,state,created_at) VALUES(?,?,?,?,?,'staging',?)")
            .run(id, key, digest(bytes), mime, bytes.length, timestamp(Date.now()));
        }); inserted = true;
        await rename(part, blob); staged = false; promoted = true;
        atomic(db, () => {
          const result = db.prepare("UPDATE media SET state='ready' WHERE id=? AND state='staging'").run(id);
          if (result.changes !== 1) throw new BusinessError('conflict');
        });
        return record(id);
      } catch (error) {
        // A failed import is never advertised as ready; source is never moved/deleted.
        let cleanupFailed = false;
        try {
          if (inserted) db.prepare("UPDATE media SET state='failed' WHERE id=? AND state='staging'").run(id);
        } catch { cleanupFailed = true; }
        try {
          if (paths) {
            if (staged) await removeOwned(join(paths.staging, `${key}.part`), paths.staging);
            if (promoted) await removeOwned(join(paths.objects, `${key}.blob`), paths.objects);
          }
        } catch { cleanupFailed = true; }
        if (cleanupFailed) throw new BusinessError('media_io');
        if (error instanceof BusinessError) throw error;
        throw new BusinessError('media_io');
      }
    },

    verify,

    /** HTTP callers supply bytes, never an arbitrary local source path. */
    async importBytes(bytes: Buffer): Promise<MediaRecord> {
      if (!Buffer.isBuffer(bytes) || !bytes.length) throw new BusinessError('media_invalid');
      if (bytes.length > maxBytes) throw new BusinessError('media_too_large');
      const { staging } = await directories(); const path = join(staging, `${randomUUID()}.part`);
      const file = await open(path, 'wx', 0o600);
      try {
        try { await file.writeFile(bytes); } finally { await file.close(); }
        return await store.importFile(path);
      } finally { await removeOwned(path, staging); }
    },

    /**
     * Giải phóng file của ảnh không còn máy/bản caption nào tham chiếu và đã tải lên ít nhất `minAgeMs` (mặc định 24 giờ,
     * để không đụng form đang nhập). Dòng media được giữ (bảng cấm xóa) và chuyển thành 'missing'. Ảnh đã gắn với bất kỳ
     * phiên bản máy hay bản caption nào — kể cả bản cũ — không bao giờ bị dọn.
     */
    async purgeUnreferenced(minAgeMs = 24 * 60 * 60 * 1000): Promise<{ purged: number }> {
      if (!Number.isSafeInteger(minAgeMs) || minAgeMs < 0 || db.isTransaction) throw new BusinessError('invalid_input');
      const cutoff = timestamp(Date.now() - minAgeMs);
      const candidates = db.prepare(`SELECT id,storage_key FROM media m WHERE state='ready' AND created_at<=?
        AND NOT EXISTS (SELECT 1 FROM product_revision_media r WHERE r.media_id=m.id)
        AND NOT EXISTS (SELECT 1 FROM content_version_media c WHERE c.media_id=m.id)`).all(cutoff) as Array<{ id: string; storage_key: string }>;
      let purged = 0;
      for (const candidate of candidates) {
        // Đổi trạng thái trước (kiểm tra lại không có tham chiếu trong chính câu lệnh) rồi mới xóa file:
        // máy tạo đồng thời sẽ thấy ảnh không còn 'ready' và bị từ chối thay vì trỏ vào file đã mất.
        const claimed = atomic(db, () => db.prepare(`UPDATE media SET state='missing' WHERE id=? AND state='ready'
          AND NOT EXISTS (SELECT 1 FROM product_revision_media r WHERE r.media_id=media.id)
          AND NOT EXISTS (SELECT 1 FROM content_version_media c WHERE c.media_id=media.id)`).run(candidate.id).changes === 1);
        if (!claimed) continue;
        identifier(candidate.storage_key);
        const { objects } = await directories();
        await removeOwned(join(objects, `${candidate.storage_key}.blob`), objects);
        purged += 1;
      }
      return { purged };
    },

    async resolveForPublish(mediaIds: readonly string[]): Promise<string[]> {
      validateMediaIds(mediaIds);
      const paths: string[] = [];
      for (const id of mediaIds) paths.push((await verify(id)).path);
      return paths; // No partial list if any image is missing/corrupt.
    },
  };
  return store;
}
