import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ConnectPrompt, connectPageFlow, type SavedPage } from './connect-flow.ts';
import type { GraphClient, GraphResult, PageInfo } from './graph-client.ts';

const APP_SECRET = 'bi-mat-ung-dung-0123456789abcdef';
const USER_TOKEN = 'EAAUSERTOKEN-1111111111111111111111111';
const LONG_TOKEN = 'EAALONGLIVED-3333333333333333333333';
const PAGE_TOKEN = 'EAAPAGETOKEN-2222222222222222222222222';
const SECRETS = [APP_SECRET, USER_TOKEN, LONG_TOKEN, PAGE_TOKEN];

const page = (id: string, name: string, tasks: string[], token = PAGE_TOKEN): PageInfo => ({ id, name, category: null, accessToken: token, tasks });
const ok = <T,>(value: T): GraphResult<T> => ({ ok: true, value });

interface Setup { graph: GraphClient; calls: string[] }
function graph(options: { exchange?: GraphResult<{ accessToken: string; expiresInSec: number | null }>; pages?: GraphResult<PageInfo[]>; check?: GraphResult<{ id: string; name: string }> } = {}): Setup {
  const calls: string[] = [];
  const client = {
    version: 'v23.0',
    exchangeUserToken: async (input: { appSecret: string; shortLivedToken: string }) => { calls.push(`exchange:${input.shortLivedToken === USER_TOKEN && input.appSecret === APP_SECRET}`); return options.exchange ?? ok({ accessToken: LONG_TOKEN, expiresInSec: 5_000_000 }); },
    listPages: async (token: string) => { calls.push(`list:${token === LONG_TOKEN}`); return options.pages ?? ok([page('107892312229541', 'Góc Nghiện Đồ Hay', ['CREATE_CONTENT', 'MANAGE'])]); },
    checkPage: async (id: string, token: string) => { calls.push(`check:${id}:${token === PAGE_TOKEN}`); return options.check ?? ok({ id, name: 'Góc Nghiện Đồ Hay' }); },
  } as unknown as GraphClient;
  return { graph: client, calls };
}

function prompt(choice = 0): { prompt: ConnectPrompt; asked: string[] } {
  const asked: string[] = [];
  return { asked, prompt: {
    text: async (label) => { asked.push(`text:${label}`); return '1472561554750532'; },
    secret: async (label) => { asked.push(`secret:${label}`); return label.startsWith('App Secret') ? APP_SECRET : USER_TOKEN; },
    choose: async (label) => { asked.push(`choose:${label}`); return choice; },
  } };
}

async function run(setup: Setup, options: { save?: (page: PageInfo) => Promise<SavedPage>; choice?: number; pageId?: string } = {}) {
  const said: string[] = [];
  const { prompt: input, asked } = prompt(options.choice);
  const outcome = await connectPageFlow({ graph: setup.graph, prompt: input, say: (m) => said.push(m), ...(options.save ? { save: options.save } : {}) }, options.pageId ? { pageId: options.pageId } : {});
  const everything = JSON.stringify({ outcome, said, asked, calls: setup.calls });
  for (const secret of SECRETS) assert.equal(everything.includes(secret), false, 'không được lộ bí mật ra màn hình/kết quả');
  return { outcome, said, asked, calls: setup.calls };
}

test('một Page có quyền đăng: đổi token → liệt kê → kiểm tra chỉ-đọc → lưu đúng Page token; không lộ bí mật ở đầu ra', async () => {
  let saved: PageInfo | undefined;
  const result = await run(graph(), { save: async (chosen) => { saved = chosen; return { id: chosen.id, name: chosen.name, canPost: true }; } });
  assert.deepEqual(result.outcome, { ok: true, saved: { id: '107892312229541', name: 'Góc Nghiện Đồ Hay', canPost: true }, pages: [{ id: '107892312229541', name: 'Góc Nghiện Đồ Hay', canPost: true }] });
  assert.equal(saved?.accessToken, PAGE_TOKEN); // đúng Page token được đưa vào kho
  assert.deepEqual(result.calls, ['exchange:true', 'list:true', 'check:107892312229541:true']); // token dài hạn dùng để liệt kê; Page token dùng để kiểm tra
  assert.ok(result.said.some((line) => line.includes('Chưa đăng gì lên Page')));
});

test('--dry-run (không có save): liệt kê và kiểm tra nhưng KHÔNG lưu gì', async () => {
  const result = await run(graph());
  assert.deepEqual(result.outcome.ok && result.outcome.saved, null);
  assert.ok(result.said.some((line) => line.includes('KHÔNG lưu gì')));
});

test('nhiều Page: người dùng chọn đúng một; hủy thì không lưu; --page-id chọn thẳng; ID không có trong danh sách bị từ chối', async () => {
  const pages = ok([page('107892312229541', 'Page A', ['CREATE_CONTENT']), page('200000000000001', 'Page B', ['CREATE_CONTENT'], 'EAAPAGETOKEN-2222222222222222222222222')]);
  const saves: string[] = [];
  const save = async (chosen: PageInfo) => { saves.push(chosen.id); return { id: chosen.id, name: chosen.name, canPost: true }; };
  const second = await run(graph({ pages }), { save, choice: 1 });
  assert.deepEqual(saves, ['200000000000001']);
  assert.ok(second.asked.some((entry) => entry.startsWith('choose:')));
  assert.equal((await run(graph({ pages }), { save, choice: -1 })).outcome.ok, false);
  assert.deepEqual(saves, ['200000000000001']); // hủy: không lưu thêm
  assert.equal((await run(graph({ pages }), { save, pageId: '107892312229541' })).outcome.ok, true);
  assert.deepEqual(saves, ['200000000000001', '107892312229541']);
  const missing = await run(graph({ pages }), { save, pageId: '999999999999' });
  assert.deepEqual([missing.outcome.ok, !missing.outcome.ok && missing.outcome.reason], [false, 'bad_input']);
});

test('Page không có CREATE_CONTENT bị từ chối trước khi lưu; không có Page nào thì báo cách khắc phục', async () => {
  const saves: string[] = [];
  const save = async (chosen: PageInfo) => { saves.push(chosen.id); return { id: chosen.id, name: chosen.name, canPost: false }; };
  const noPermission = await run(graph({ pages: ok([page('107892312229541', 'Page A', ['ANALYZE'])]) }), { save });
  assert.deepEqual([noPermission.outcome.ok, !noPermission.outcome.ok && noPermission.outcome.reason], [false, 'no_permission']);
  const none = await run(graph({ pages: ok([]) }), { save });
  assert.deepEqual([none.outcome.ok, !none.outcome.ok && none.outcome.reason], [false, 'no_pages']);
  assert.match(!none.outcome.ok ? none.outcome.message : '', /chọn đúng Page/u);
  assert.deepEqual(saves, []);
});

test('lỗi từ Meta ở từng bước được báo bằng tiếng Việt, dừng ngay và không lưu; lỗi khi lưu cũng không lộ chi tiết', async () => {
  const saves: string[] = [];
  const save = async (chosen: PageInfo) => { saves.push(chosen.id); return { id: chosen.id, name: chosen.name, canPost: true }; };
  const bad = { ok: false as const, code: 'token_expired' as const, status: 400, fbCode: 190 };
  const exchange = await run(graph({ exchange: { ok: false, code: 'exchange_failed', status: 400, fbCode: 1 } }), { save });
  assert.deepEqual([exchange.outcome.ok, !exchange.outcome.ok && exchange.outcome.reason], [false, 'exchange_failed']);
  const listing = await run(graph({ pages: bad }), { save });
  assert.deepEqual([listing.outcome.ok, !listing.outcome.ok && listing.outcome.reason], [false, 'token_expired']);
  const check = await run(graph({ check: { ok: false, code: 'permission_denied', status: 403, fbCode: 200 } }), { save });
  assert.deepEqual([check.outcome.ok, !check.outcome.ok && check.outcome.reason], [false, 'permission_denied']);
  assert.deepEqual(saves, []);
  const crashed = await run(graph(), { save: async () => { throw new Error(`lỗi chứa ${PAGE_TOKEN}`); } });
  assert.deepEqual([crashed.outcome.ok, !crashed.outcome.ok && crashed.outcome.reason], [false, 'save_failed']); // run() đã khẳng định không lộ PAGE_TOKEN
});

test('đầu vào sai: App ID không phải số hoặc thiếu bí mật thì dừng trước khi gọi Meta', async () => {
  const setup = graph();
  const said: string[] = [];
  const badId = await connectPageFlow({ graph: setup.graph, say: (m) => said.push(m), prompt: { text: async () => 'abc', secret: async () => 'x', choose: async () => 0 } });
  assert.deepEqual([badId.ok, !badId.ok && badId.reason], [false, 'bad_input']);
  const noSecret = await connectPageFlow({ graph: setup.graph, say: (m) => said.push(m), prompt: { text: async () => '1472561554750532', secret: async () => '  ', choose: async () => 0 } });
  assert.deepEqual([noSecret.ok, !noSecret.ok && noSecret.reason], [false, 'bad_input']);
  assert.deepEqual(setup.calls, []); // chưa gọi Meta lần nào
});
