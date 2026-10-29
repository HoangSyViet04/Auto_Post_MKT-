import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startMockFacebook } from '../../../../tests/fixtures/mock-facebook.ts';
import { createGroupSearchScanner, joinStateOf, parseSearchCard, type SearchObservation } from './group-search.ts';

const input = (overrides: Partial<Parameters<ReturnType<typeof createGroupSearchScanner>>[0]> = {}) => ({ profileDir: 'unused',
  expectedIdentity: 'vanity:nick.a', keyword: 'mua bán điện thoại', limit: 30, shouldCancel: () => false, onTick: () => undefined, onBatch: () => undefined, ...overrides });

test('nhãn nút → trạng thái tham gia; thẻ dùng chung với nhóm khác thì không kết luận', () => {
  assert.equal(joinStateOf(['Tham gia nhóm'], false), 'can_join');
  assert.equal(joinStateOf(['Tham gia nhóm MUA BÁN ĐIỆN THOẠI CŨ HÀ NỘI'], false), 'can_join'); // nhãn thật có kèm tên nhóm
  assert.equal(joinStateOf(['Tham gia cuộc trò chuyện'], false), 'unknown');
  assert.equal(joinStateOf(['Đã tham gia nhóm X'], false), 'joined');
  assert.equal(joinStateOf(['Join'], false), 'can_join');
  assert.equal(joinStateOf(['Đã tham gia'], false), 'joined');
  assert.equal(joinStateOf(['Hủy yêu cầu'], false), 'requested');
  assert.equal(joinStateOf(['Cancel request'], false), 'requested');
  assert.equal(joinStateOf(['Chia sẻ'], false), 'unknown');
  assert.equal(joinStateOf(['Tham gia nhóm'], true), 'unknown');
});

test('đọc thẻ kết quả: tên, công khai/riêng tư, số thành viên; thiếu là null/unknown; link không phải nhóm bị bỏ', () => {
  const item = parseSearchCard({ href: '/groups/100000000001/', anchorText: 'Chợ điện thoại', lines: ['Chợ điện thoại', 'Công khai · 12K thành viên · 90+ bài viết/ngày', '4 người bạn là thành viên', 'Tham gia'], buttons: ['Tham gia nhóm Chợ điện thoại'], shared: false });
  assert.deepEqual(item, { reference: 'https://www.facebook.com/groups/100000000001', name: 'Chợ điện thoại', privacy: 'public', memberCount: 12000, joinState: 'can_join' });
  const bare = parseSearchCard({ href: '/groups/100000000002', anchorText: '', lines: [], buttons: [], shared: false });
  assert.deepEqual([bare?.name, bare?.privacy, bare?.memberCount, bare?.joinState], [null, 'unknown', null, 'unknown']);
  assert.equal(parseSearchCard({ href: '/groups/discover', anchorText: 'Khám phá', lines: [], buttons: [], shared: false }), null);
});

test('Facebook giả: đọc kết quả tìm, trạng thái từng nhóm, loại trùng; không bấm gì; đóng profile', async () => {
  const mock = await startMockFacebook();
  let closed = 0; let clicks = 0; let batch: readonly SearchObservation[] = []; let query = '';
  try {
    const scan = createGroupSearchScanner({ settleMs: 0, scrollMs: 30, maxRounds: 6, launch: async (dir) => {
      const profile = await mock.launch(dir);
      await profile.context.route('**/__click', (route) => { clicks += 1; return route.fulfill({ body: 'ok' }); });
      await profile.context.route('**/search/groups/**', (route) => { query = new URL(route.request().url()).searchParams.get('q') ?? ''; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <main role="main">
          <div><a href="/groups/100000000001/">Chợ điện thoại Hà Nội</a><div>Công khai · 12K thành viên · 90+ bài viết/ngày</div><div role="button" aria-label="Tham gia nhóm Chợ điện thoại Hà Nội" onclick="fetch('/__click',{method:'POST'})">Tham gia nhóm</div></div>
          <div><a href="/groups/100000000001/?ref=dup">Chợ điện thoại Hà Nội</a></div>
          <div><a href="/groups/100000000002/">Nhóm B</a><div>Riêng tư · 850 thành viên</div><div role="button">Đã tham gia</div></div>
          <div><a href="/groups/100000000003/">Nhóm C</a><div role="button">Hủy yêu cầu</div></div>
          <div><a href="/groups/100000000004/">Nhóm D không có nút</a></div>
          <div><a href="/groups/chi-ten-rut-gon">Chỉ có tên rút gọn</a><div role="button">Tham gia nhóm</div></div>
        </main>` }); });
      return { ...profile, close: async () => { closed += 1; await profile.close(); } };
    } });
    const result = await scan(input({ onBatch: (items) => { batch = items; } }));
    assert.deepEqual(result, { status: 'partial', reason: 'no_more_results_seen' });
    assert.equal(query, 'mua bán điện thoại');
    const byId = new Map(batch.map((item) => [item.reference.split('/').pop(), item]));
    assert.equal(byId.get('100000000001')?.joinState, 'can_join');
    assert.equal(byId.get('100000000001')?.memberCount, 12000);
    assert.equal(byId.get('100000000002')?.joinState, 'joined');
    assert.equal(byId.get('100000000002')?.privacy, 'private');
    assert.equal(byId.get('100000000003')?.joinState, 'requested');
    assert.equal(byId.get('100000000004')?.joinState, 'unknown'); // thẻ không có nút riêng: không mượn nút của nhóm khác
    assert.equal(closed, 1); assert.equal(clicks, 0); assert.equal(mock.submits, 0);
  } finally { await mock.close(); }
});

test('Facebook giả: giới hạn chính xác, hủy giữa chừng, giao diện đổi, sai danh tính/checkpoint chặn trước khi tìm', async () => {
  const mock = await startMockFacebook();
  try {
    let empty = false;
    const scan = createGroupSearchScanner({ settleMs: 0, scrollMs: 0, launch: async (dir) => {
      const profile = await mock.launch(dir);
      await profile.context.route('**/search/groups/**', (route) => route.fulfill({ contentType: 'text/html',
        body: empty ? '<p>Changed UI</p>' : '<main role="main"><div><a href="/groups/100000000001/">A</a></div><div><a href="/groups/100000000002/">B</a></div></main>' }));
      return profile;
    } });
    let count = 0;
    assert.equal((await scan(input({ limit: 1, onBatch: (items) => { count = items.length; } }))).reason, 'result_limit');
    assert.equal(count, 1);
    let cancel = false;
    assert.equal((await scan(input({ shouldCancel: () => cancel, onBatch: () => { cancel = true; } }))).status, 'stopped');
    empty = true;
    assert.equal((await scan(input())).reason, 'ui_changed');
    await assert.rejects(scan(input({ keyword: ' ' })));
    await assert.rejects(scan(input({ limit: 201 })));
  } finally { await mock.close(); }
  for (const options of [{ vanity: 'wrong' }, { checkpoint: true }]) {
    const other = await startMockFacebook(options); let visited = 0;
    try {
      const scan = createGroupSearchScanner({ settleMs: 0, launch: async (dir) => {
        const profile = await other.launch(dir);
        await profile.context.route('**/search/**', (route) => { visited += 1; return route.abort(); });
        return profile;
      } });
      assert.equal((await scan(input())).reason, 'checkpoint' in options ? 'checkpoint' : 'identity_mismatch');
      assert.equal(visited, 0);
    } finally { await other.close(); }
  }
});
