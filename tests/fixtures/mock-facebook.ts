/**
 * Facebook GIẢ để kiểm thử adapter đăng bài offline: Edge chạy ngầm, mọi yêu cầu tới www.facebook.com bị chặn và trả trang HTML giả.
 * Không có kết nối mạng thật nào tới Facebook. Mô phỏng: đăng nhập/checkpoint/danh tính, trang nhóm và trang cá nhân với ô soạn bài,
 * hộp thoại, đính ảnh, nút Đăng (và "Tiếp" cho trang cá nhân), bài hiện trong feed sau khi đăng.
 */
import { chromium, type Browser, type Route } from 'playwright-core';
import type { LaunchedProfile } from '#browser';

export interface MockFacebookOptions {
  vanity?: string;
  loggedIn?: boolean;
  checkpoint?: boolean;
  /** ID nhóm mà trang nhóm thật sự phục vụ; khác ID được yêu cầu thì giả lập "sai nhóm". */
  groupId?: string;
  redirectGroupTo?: string;
  composer?: boolean;
  /** Bấm Đăng nhưng bài không hiện (giả lập kết quả không rõ). */
  swallowPost?: boolean;
  /** Bỏ qua ảnh đính kèm (giả lập upload lỗi). */
  dropUploads?: boolean;
  audience?: string;
  /** Bài đã có sẵn trong feed. */
  existingPosts?: string[];
}

export interface MockFacebook {
  launch(profileDir: string): Promise<LaunchedProfile>;
  /** Các bài đã đăng (văn bản và số ảnh) theo thứ tự. */
  readonly posts: Array<{ text: string; images: number }>;
  /** Số lần trang gửi yêu cầu "đăng" (bấm nút Đăng). */
  readonly submits: number;
  /** Số lần mở ô soạn bài. */
  readonly composerClicks: number;
  close(): Promise<void>;
}

const escapeHtml = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

export async function startMockFacebook(options: MockFacebookOptions = {}): Promise<MockFacebook> {
  const opts: Required<Omit<MockFacebookOptions, 'redirectGroupTo' | 'existingPosts'>> & Pick<MockFacebookOptions, 'redirectGroupTo'> = {
    vanity: 'nick.a', loggedIn: true, checkpoint: false, groupId: '123456789012', composer: true, swallowPost: false, dropUploads: false,
    audience: 'Công khai', ...options,
  };
  const posts: Array<{ text: string; images: number }> = (options.existingPosts ?? []).map((text) => ({ text, images: 0 }));
  const state = { submits: 0, composerClicks: 0 };
  const browser: Browser = await chromium.launch({ channel: 'msedge', headless: true });

  function page(kind: 'group' | 'profile', ownerId: string): string {
    const feed = posts.map((post, index) => `<div class="post"><p>${escapeHtml(post.text)}</p><a href="/groups/${ownerId}/post_insights/${1_000_000 + index}/">x</a></div>`).join('');
    const composer = opts.composer ? '<div id="composer" role="button" aria-label="Bạn viết gì đi...">Bạn viết gì đi...</div>' : '<div>(giao diện khác)</div>';
    const profile = kind === 'profile';
    return `<!doctype html><html><body><h1>Mock</h1>${composer}
<div id="dlg" role="dialog" hidden>
  <div id="box" role="textbox" contenteditable="true"></div>
  <input id="file" type="file" multiple>
  <div id="previews"></div>
  ${profile ? `<div role="button" aria-label="Chỉnh sửa quyền riêng tư. Đang chia sẻ với ${opts.audience}.">${opts.audience}</div><div id="next" role="button" aria-label="Tiếp">Tiếp</div>` : '<div id="post" role="button" aria-label="Đăng">Đăng</div>'}
</div>
<div id="dlg2" role="dialog" hidden><div>Đối tượng: ${opts.audience}</div><div id="post2" role="button" aria-label="Đăng">Đăng</div></div>
<div id="feed">${feed}</div>
<script>
  const $ = (id) => document.getElementById(id);
  let images = 0;
  if ($('composer')) $('composer').onclick = () => { $('dlg').hidden = false; fetch('/__composer', { method: 'POST' }); };
  $('file').onchange = () => {
    if (${opts.dropUploads}) return;
    for (const _ of $('file').files) {
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200;
      const image = document.createElement('img'); image.src = canvas.toDataURL(); $('previews').appendChild(image); images += 1;
    }
  };
  const send = () => fetch('/__post', { method: 'POST', body: JSON.stringify({ text: $('box').textContent, images }) }).then(() => { $('dlg').hidden = true; $('dlg2').hidden = true; });
  if ($('post')) $('post').onclick = send;
  if ($('next')) $('next').onclick = () => { $('dlg').hidden = true; $('dlg2').hidden = false; };
  $('post2').onclick = send;
</script></body></html>`;
  }

  async function handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const html = (body: string) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    // Chuyển hướng bằng JavaScript (điều hướng mới vẫn đi qua bộ chặn). KHÔNG dùng 302: yêu cầu sau chuyển hướng có thể lọt ra mạng thật.
    const redirect = (to: string) => html(`<script>location.replace(${JSON.stringify(to)})</script>`);
    if (url.pathname === '/__composer') { state.composerClicks += 1; return route.fulfill({ status: 204 }); }
    if (url.pathname === '/__post') {
      state.submits += 1;
      const body = JSON.parse(request.postData() ?? '{}') as { text: string; images: number };
      if (!opts.swallowPost) posts.push({ text: body.text, images: body.images });
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/') {
      if (opts.checkpoint) return redirect('/checkpoint/1501092823525282/');
      return html(opts.loggedIn ? '<h1>Trang chủ</h1>' : '<form><input name="email"><input name="pass"></form>');
    }
    if (url.pathname.startsWith('/checkpoint')) return html('<h1>Xác minh</h1>');
    if (url.pathname === '/me') return opts.loggedIn ? redirect(`/${opts.vanity}`) : redirect('/');
    if (url.pathname === `/${opts.vanity}`) return html(page('profile', opts.vanity));
    const group = /^\/groups\/(\d+)\/?$/u.exec(url.pathname);
    if (group) {
      // Giả lập sai nhóm: yêu cầu nhóm khác bị chuyển sang một nhóm khác (trang đó là nhóm thật khác, không chứa ID được yêu cầu).
      if (opts.redirectGroupTo && group[1] !== opts.redirectGroupTo) return redirect(`/groups/${opts.redirectGroupTo}`);
      return html(page('group', opts.redirectGroupTo ?? opts.groupId));
    }
    return route.fulfill({ status: 404, body: 'not found' });
  }

  return {
    async launch() {
      const context = await browser.newContext();
      if (opts.loggedIn) await context.addCookies([{ name: 'c_user', value: '1', url: 'https://www.facebook.com' }]);
      // Chặn mọi yêu cầu ra ngoài (route đăng ký sau được ưu tiên): không có kết nối mạng thật nào tới Facebook hay nơi khác.
      await context.route('**/*', (route) => route.abort());
      await context.route('https://www.facebook.com/**', handle);
      const newPage = await context.newPage();
      let closed = false;
      return { context, page: newPage, close: async () => { if (!closed) { closed = true; await context.close().catch(() => undefined); } } };
    },
    posts,
    get submits() { return state.submits; },
    get composerClicks() { return state.composerClicks; },
    close: () => browser.close(),
  };
}
