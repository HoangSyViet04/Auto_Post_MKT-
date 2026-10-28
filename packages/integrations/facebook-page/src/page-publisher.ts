import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  type ApprovedPublishRequest,
  assertApprovedPublishRequest,
  type IntegrationEvidence,
  type OperationReasonCode,
  type PrepareResult,
  type Publisher,
  type PublishRequest,
  type StopResult,
  type SubmitResult,
  type VerifyResult,
} from '#contracts';
import type { GraphClient, GraphErrorCode, PhotoUpload } from './graph-client.ts';

export interface PagePublisherDeps {
  graph: GraphClient;
  /** Page token theo mã kết nối (chỉ worker được gọi). Ném lỗi nếu token mất/đã thu hồi. */
  tokenFor(connectionId: string): Promise<{ pageId: string; token: string }>;
  /** Meta từ chối token/quyền: báo để kết nối bị đánh dấu và các job sau bị chặn, thay vì cứ thử tiếp. */
  onConnectionProblem?(connectionId: string, status: 'expired' | 'denied'): void;
  readFile?: (path: string) => Promise<Buffer>;
  /** Giới hạn thận trọng số ảnh mỗi bài. CHƯA đối chiếu với giới hạn hiện hành của Meta (P09.8). */
  maxPhotos?: number;
}

interface Session {
  connectionId: string;
  pageId: string;
  token: string;
  caption: string;
  photoIds: string[];
  submitting: boolean;
}

/** Mã lý do dùng chung của hàng chờ; chưa có mã riêng cho giới hạn tần suất nên gộp vào lỗi mạng (câu chữ báo rõ hơn). */
export function reasonFor(code: GraphErrorCode): OperationReasonCode {
  switch (code) {
    case 'token_expired': return 'session_expired';
    case 'permission_denied': return 'destination_not_allowed';
    case 'rate_limited':
    case 'temporary':
    case 'network':
    case 'bad_response': return 'network_error';
    default: return 'unknown';
  }
}

const MESSAGE: Record<GraphErrorCode, string> = {
  token_expired: 'Token Page đã hết hạn hoặc bị thu hồi; kết nối lại Page (npm run page:connect).',
  permission_denied: 'Meta từ chối quyền đăng lên Page này.',
  rate_limited: 'Meta đang giới hạn tần suất; thử lại sau.',
  temporary: 'Meta đang lỗi tạm thời.',
  network: 'Không kết nối được tới Meta.',
  bad_response: 'Phản hồi từ Meta không đúng định dạng.',
  invalid_request: 'Meta từ chối yêu cầu (dữ liệu hoặc phiên bản API).',
  exchange_failed: 'Không xác thực được với Meta.',
};

/** Nhận dạng ảnh bằng chữ ký file (không tin tên file/đuôi: ảnh trong kho ứng dụng có đuôi .blob). */
export function sniffImage(bytes: Uint8Array): PhotoUpload['mimeType'] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  const riff = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return riff ? 'image/webp' : null;
}

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
/** Mặc định thận trọng: nhiều bài nhiều ảnh dễ bị Meta từ chối. */
const DEFAULT_MAX_PHOTOS = 10;

/**
 * Đăng bài có ảnh lên fanpage qua Graph API (P09.3–P09.6). Cùng hợp đồng với adapter trình duyệt:
 *  - prepare: kiểm tra Page + token (chỉ đọc), đọc và kiểm tra từng ảnh, tải ảnh lên ở trạng thái CHƯA xuất bản (chưa ai thấy). Chưa có bài nào.
 *  - submit: tạo bài ĐÚNG MỘT LẦN. Lỗi mạng/quá giờ/phản hồi lạ sau khi gửi → `unknown`, KHÔNG tự gửi lại. Meta trả lỗi rõ ràng → `failed`.
 *  - verify: chỉ đọc các bài gần đây của Page; không thấy KHÔNG có nghĩa được phép gửi lại.
 * Token chỉ nằm trong bộ nhớ trong lúc đăng và không bao giờ vào log, thông báo hay bằng chứng.
 */
export function createPagePublisher(deps: PagePublisherDeps): Publisher {
  const { graph } = deps;
  const read = deps.readFile ?? ((path: string) => readFile(path));
  const maxPhotos = deps.maxPhotos ?? DEFAULT_MAX_PHOTOS;
  const sessions = new Map<string, Session>();
  let stopped = false;

  const fail = (reasonCode: OperationReasonCode, reason: string): PrepareResult => ({ ok: false, reasonCode, reason });

  function evidence(request: ApprovedPublishRequest, remoteUrl?: string): IntegrationEvidence {
    return Object.freeze({ source: 'graph_api' as const, observedAt: new Date().toISOString(), identityRemoteId: request.context.expectedIdentity.remoteId,
      destinationRemoteId: request.context.destination.remoteId, ...(remoteUrl ? { remoteUrl } : {}) });
  }

  function reportProblem(connectionId: string, code: GraphErrorCode): void {
    if (code === 'token_expired') deps.onConnectionProblem?.(connectionId, 'expired');
    else if (code === 'permission_denied') deps.onConnectionProblem?.(connectionId, 'denied');
  }

  async function discard(session: Session): Promise<void> {
    for (const id of session.photoIds) await graph.deletePhoto(id, session.token).catch(() => undefined); // ảnh chưa xuất bản, dọn cho gọn
  }

  /** Bài trên Page: ID dạng "<pageId>_<postId>"; đường dẫn công khai dựng từ chính ID đó (không chứa token). */
  function permalink(pageId: string, postId: string): string | undefined {
    const tail = postId.includes('_') ? postId.split('_')[1] : postId;
    return tail && /^\d+$/u.test(tail) ? `https://www.facebook.com/${pageId}/posts/${tail}` : undefined;
  }

  async function prepare(request: PublishRequest): Promise<PrepareResult> {
    if (stopped) return fail('stopped', 'Đã dừng.');
    try { assertApprovedPublishRequest(request); } catch { return fail('invalid_request', 'Yêu cầu đã duyệt không hợp lệ.'); }
    const approved: ApprovedPublishRequest = request;
    const { expectedIdentity, destination } = approved.context;
    if (destination.channel !== 'page' || expectedIdentity.kind !== 'page') return fail('destination_not_allowed', 'Kênh đích không phải fanpage.');
    if (sessions.has(approved.jobId)) return fail('invalid_request', 'Job này đã có phiên chuẩn bị.');
    if (approved.mediaPaths.length > maxPhotos) return fail('media_invalid', `Tối đa ${maxPhotos} ảnh cho một bài fanpage; bài này có ${approved.mediaPaths.length}.`);

    let credentials: { pageId: string; token: string };
    try {
      credentials = await deps.tokenFor(expectedIdentity.localId);
    } catch {
      return fail('session_expired', 'Không lấy được token Page (mất hoặc đã thu hồi); kết nối lại Page.');
    }
    if (credentials.pageId !== destination.remoteId) return fail('identity_mismatch', 'Token thuộc Page khác với Page đã duyệt.');

    const checked = await graph.checkPage(credentials.pageId, credentials.token);
    if (!checked.ok) {
      reportProblem(expectedIdentity.localId, checked.code);
      return fail(reasonFor(checked.code), MESSAGE[checked.code]);
    }

    // Đọc và kiểm tra TẤT CẢ ảnh trước khi tải bất cứ ảnh nào: ảnh hỏng thì dừng, không đăng thiếu ảnh.
    const photos: PhotoUpload[] = [];
    for (const [index, path] of approved.mediaPaths.entries()) {
      let bytes: Buffer;
      try { bytes = await read(path); } catch { return fail('media_invalid', `Không đọc được ảnh số ${index + 1}; dừng trước khi gửi.`); }
      const mimeType = sniffImage(bytes);
      if (!mimeType) return fail('media_invalid', `File thứ ${index + 1} không phải ảnh JPEG/PNG/WebP hợp lệ; dừng trước khi gửi.`);
      photos.push({ bytes, mimeType, filename: `${String(index + 1).padStart(2, '0')}-${basename(path).replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 40)}.${EXTENSION[mimeType]}` });
    }

    const session: Session = { connectionId: expectedIdentity.localId, pageId: credentials.pageId, token: credentials.token, caption: approved.caption, photoIds: [], submitting: false };
    for (const [index, photo] of photos.entries()) {
      if (stopped) { await discard(session); return fail('stopped', 'Đã dừng.'); }
      const uploaded = await graph.uploadUnpublishedPhoto(session.pageId, session.token, photo);
      if (!uploaded.ok) {
        await discard(session); // ảnh đã tải ở các lượt trước (chưa xuất bản) được dọn đi
        reportProblem(expectedIdentity.localId, uploaded.code);
        const reason = uploaded.code === 'invalid_request' ? 'media_invalid' : reasonFor(uploaded.code);
        return fail(reason, `Tải ảnh số ${index + 1} không thành công (${MESSAGE[uploaded.code]}); dừng trước khi gửi, chưa có bài nào được đăng.`);
      }
      session.photoIds.push(uploaded.value.id); // đúng thứ tự đã duyệt
    }
    sessions.set(approved.jobId, session);
    return { ok: true };
  }

  return {
    capabilities: Object.freeze({ channel: 'page' as const, level: 'automatic' as const, simulated: false }),
    prepare,

    async submit(request: PublishRequest): Promise<SubmitResult> {
      const session = sessions.get(request.jobId);
      if (!session) return { status: 'failed', reasonCode: 'unknown', reason: 'Chưa có phiên đã chuẩn bị cho job này.' };
      if (stopped) { sessions.delete(request.jobId); await discard(session); return { status: 'failed', reasonCode: 'unknown', reason: 'Đã dừng trước khi gửi.' }; }
      session.submitting = true;
      try {
        const approved = request as ApprovedPublishRequest;
        const created = await graph.createFeedPost(session.pageId, session.token, { message: session.caption, photoIds: session.photoIds }); // ĐÚNG MỘT LẦN
        if (created.ok) {
          return { status: 'published', remoteId: created.value.id, evidence: evidence(approved, permalink(session.pageId, created.value.id)) };
        }
        // Chưa biết bài đã tạo hay chưa (mạng đứt, quá giờ, lỗi tạm thời, phản hồi lạ): KHÔNG gửi lại, chờ đối chiếu.
        if (created.code === 'network' || created.code === 'temporary' || created.code === 'bad_response') {
          return { status: 'unknown', reasonCode: 'network_error', evidence: evidence(approved), reason: 'Đã gửi yêu cầu đăng nhưng chưa nhận được xác nhận từ Meta; bài có thể đã đăng. Kiểm tra trên Page trước khi làm gì tiếp.' };
        }
        reportProblem(session.connectionId, created.code);
        return { status: 'failed', reasonCode: reasonFor(created.code), reason: MESSAGE[created.code] };
      } finally {
        sessions.delete(request.jobId);
      }
    },

    /** Chỉ đọc: có thấy bài mang đúng caption này trong các bài gần đây của Page không. Không thấy KHÔNG có nghĩa được gửi lại. */
    async verify(request: PublishRequest): Promise<VerifyResult> {
      try { assertApprovedPublishRequest(request); } catch { return { status: 'unknown', reasonCode: 'invalid_request' }; }
      const { expectedIdentity, destination } = request.context;
      if (destination.channel !== 'page') return { status: 'unknown', reasonCode: 'destination_not_allowed' };
      let credentials: { pageId: string; token: string };
      try { credentials = await deps.tokenFor(expectedIdentity.localId); } catch { return { status: 'unknown', reasonCode: 'session_expired' }; }
      if (credentials.pageId !== destination.remoteId) return { status: 'unknown', reasonCode: 'identity_mismatch' };
      const posts = await graph.listRecentPosts(credentials.pageId, credentials.token, 50);
      if (!posts.ok) { reportProblem(expectedIdentity.localId, posts.code); return { status: 'unknown', reasonCode: reasonFor(posts.code) }; }
      const wanted = request.caption.trim();
      const found = posts.value.find((post) => post.message?.trim() === wanted);
      return found ? { status: 'published', evidence: evidence(request, found.permalinkUrl ?? permalink(credentials.pageId, found.id)) } : { status: 'not_found' };
    },

    /** Chặn việc chưa làm và dọn ảnh đã tải của các bài chưa gửi. Bài đã gửi đi không thu hồi được. */
    async stop(): Promise<StopResult> {
      stopped = true;
      const inFlight = [...sessions.values()].some((session) => session.submitting);
      for (const [jobId, session] of [...sessions]) {
        if (session.submitting) continue;
        sessions.delete(jobId);
        await discard(session);
      }
      return { requested: true, futureSubmissionsBlocked: true, inFlight: inFlight ? 'unknown' : 'none', remoteRecall: false };
    },
  };
}
