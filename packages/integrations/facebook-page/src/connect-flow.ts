import { GRAPH_ERROR_MESSAGE, type GraphClient, type GraphErrorCode, type PageInfo } from './graph-client.ts';

/** Giao diện nhập liệu. Bản thật nằm ở scripts/page-connect.ts (ẩn ký tự bí mật); test dùng bản giả. */
export interface ConnectPrompt {
  text(label: string, defaultValue?: string): Promise<string>;
  /** Nhập bí mật: không hiện ký tự, không ghi lịch sử. */
  secret(label: string): Promise<string>;
  /** Trả chỉ số lựa chọn (0..n-1) hoặc -1 nếu người dùng hủy. */
  choose(label: string, options: string[]): Promise<number>;
}

export interface SavedPage {
  id: string;
  name: string;
  canPost: boolean;
}

export interface ConnectDeps {
  graph: GraphClient;
  prompt: ConnectPrompt;
  /** Lưu Page đã chọn (kho bí mật + DB). Không truyền khi chỉ chạy thử (--dry-run). */
  save?: (page: PageInfo) => Promise<SavedPage>;
  say(message: string): void;
}

export type ConnectOutcome =
  | { ok: true; saved: SavedPage | null; pages: Array<{ id: string; name: string; canPost: boolean }> }
  | { ok: false; reason: GraphErrorCode | 'cancelled' | 'no_pages' | 'no_permission' | 'bad_input' | 'save_failed'; message: string };

const CAN_CREATE = 'CREATE_CONTENT';
const fail = (reason: Extract<ConnectOutcome, { ok: false }>['reason'], message: string): ConnectOutcome => ({ ok: false, reason, message });

/**
 * Luồng kết nối Page: nhập App ID/App Secret/token (ẩn) → đổi sang token dài hạn → liệt kê Page → chọn → kiểm tra token chỉ-đọc → lưu.
 * Chỉ đọc: KHÔNG đăng gì lên Page. Bí mật ứng dụng và token người dùng không được lưu ở đâu cả; chỉ Page token được chọn đi vào kho bí mật.
 * Không bao giờ in token ra màn hình hay thông báo.
 */
export async function connectPageFlow(deps: ConnectDeps, options: { appId?: string; pageId?: string } = {}): Promise<ConnectOutcome> {
  const { graph, prompt, say } = deps;
  const appId = (options.appId ?? (await prompt.text('App ID (xem ở Cài đặt ứng dụng → Cơ bản; không phải bí mật)'))).trim();
  if (!/^\d{5,25}$/u.test(appId)) return fail('bad_input', 'App ID phải là dãy số.');
  const appSecret = (await prompt.secret('App Secret (Khóa bí mật của ứng dụng; gõ/dán sẽ không hiện)')).trim();
  const userToken = (await prompt.secret('Token người dùng từ Graph API Explorer (gõ/dán sẽ không hiện)')).trim();
  if (!appSecret || !userToken) return fail('bad_input', 'Thiếu App Secret hoặc token.');

  say('Đang đổi sang token dài hạn…');
  const exchanged = await graph.exchangeUserToken({ appId, appSecret, shortLivedToken: userToken });
  if (!exchanged.ok) return fail(exchanged.code, GRAPH_ERROR_MESSAGE[exchanged.code]);

  say('Đang đọc danh sách Page bạn quản lý (chỉ đọc)…');
  const listed = await graph.listPages(exchanged.value.accessToken);
  if (!listed.ok) return fail(listed.code, GRAPH_ERROR_MESSAGE[listed.code]);
  const pages = listed.value;
  const summary = pages.map((page) => ({ id: page.id, name: page.name, canPost: page.tasks.includes(CAN_CREATE) }));
  if (pages.length === 0) return fail('no_pages', 'Meta không trả Page nào. Thường do chưa chọn Page ở cửa sổ cấp quyền: tạo lại token và chọn đúng Page.');

  say('');
  for (const page of summary) say(`  • ${page.name} (ID ${page.id}) — ${page.canPost ? 'có quyền đăng (CREATE_CONTENT)' : 'KHÔNG có quyền đăng'}`);

  let chosen: PageInfo | undefined;
  if (options.pageId) chosen = pages.find((page) => page.id === options.pageId);
  else if (pages.length === 1) chosen = pages[0];
  else {
    const index = await prompt.choose('Chọn Page để kết nối', pages.map((page) => `${page.name} (ID ${page.id})`));
    chosen = index >= 0 ? pages[index] : undefined;
    if (!chosen) return fail('cancelled', 'Đã hủy, chưa lưu gì.');
  }
  if (!chosen) return fail('bad_input', 'Không tìm thấy Page với ID đã chỉ định trong danh sách.');
  if (!chosen.tasks.includes(CAN_CREATE)) return fail('no_permission', `Tài khoản không có quyền tạo nội dung (CREATE_CONTENT) trên "${chosen.name}". Kiểm tra quyền của bạn trên Page.`);

  say(`Đang kiểm tra token của "${chosen.name}" (chỉ đọc)…`);
  const verified = await graph.checkPage(chosen.id, chosen.accessToken);
  if (!verified.ok) return fail(verified.code, GRAPH_ERROR_MESSAGE[verified.code]);

  if (!deps.save) {
    say('Chạy thử (--dry-run): KHÔNG lưu gì.');
    return { ok: true, saved: null, pages: summary };
  }
  try {
    const saved = await deps.save(chosen);
    say(`Đã kết nối "${saved.name}" (ID ${saved.id}). Token được mã hóa theo Windows. Chưa đăng gì lên Page.`);
    return { ok: true, saved, pages: summary };
  } catch {
    return fail('save_failed', 'Không lưu được kết nối (kho bí mật hoặc cơ sở dữ liệu). Chưa có gì được lưu.');
  }
}
