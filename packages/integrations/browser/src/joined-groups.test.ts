import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startMockFacebook } from '../../../../tests/fixtures/mock-facebook.ts';
import { createJoinedGroupScanner, type JoinedGroupObservation, type JoinedGroupScanInput } from './joined-groups.ts';

const input = (overrides: Partial<JoinedGroupScanInput> = {}): JoinedGroupScanInput => ({ profileDir: 'unused',
  expectedIdentity: 'vanity:nick.a', limit: 30, shouldCancel: () => false, onTick: () => undefined, onBatch: () => undefined, ...overrides });

test('Facebook giả: đọc ID số và slug, loại trùng, đọc thêm sau cuộn, đóng profile, không bấm/đăng gì', async () => {
  const mock = await startMockFacebook();
  let closed = 0; let batch: readonly JoinedGroupObservation[] = [];
  try {
    const scan = createJoinedGroupScanner({ settleMs: 0, scrollMs: 40, maxRounds: 8, launch: async (dir) => {
      const profile = await mock.launch(dir);
      await profile.context.route('https://www.facebook.com/groups/joins/', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <main role="main"><a href="/groups/123456789012">Nhóm A</a><a href="/groups/123456789012?ref=x">Nhóm A</a>
        <a href="/groups/slug-only">Nhóm chưa có ID</a><a href="/groups/discover">Khám phá</a>
        <a href="https://example.com/groups/998877665544">Không phải FB</a></main>
        <script>setTimeout(() => document.querySelector('main').insertAdjacentHTML('beforeend','<a href="/groups/112233445566">Nhóm B</a>'), 60)</script>` }));
      return { ...profile, close: async () => { closed += 1; await profile.close(); } };
    } });
    const result = await scan(input({ onBatch: (items) => { batch = items; } }));
    assert.deepEqual(result, { status: 'partial', reason: 'no_more_results_seen' });
    assert.equal(batch.length, 3); assert.ok(batch.some((item) => item.name === 'Nhóm B'));
    assert.equal(closed, 1); assert.equal(mock.submits, 0); assert.equal(mock.composerClicks, 0);
  } finally { await mock.close(); }
});
test('Facebook giả: sai danh tính/checkpoint chặn trước đọc nhóm; luôn đóng profile', async () => {
  for (const options of [{ vanity: 'wrong' }, { checkpoint: true }]) {
    const mock = await startMockFacebook(options); let visited = 0; let closed = 0;
    try {
      const scan = createJoinedGroupScanner({ settleMs: 0, launch: async (dir) => {
        const profile = await mock.launch(dir);
        await profile.context.route('**/groups/joins/**', (route) => { visited += 1; return route.abort(); });
        return { ...profile, close: async () => { closed += 1; await profile.close(); } };
      } });
      const result = await scan(input());
      assert.equal(result.reason, 'checkpoint' in options ? 'checkpoint' : 'identity_mismatch');
      assert.equal(visited, 0); assert.equal(closed, 1);
    } finally { await mock.close(); }
  }
});
test('Facebook giả: giới hạn chính xác, dừng sau tiến độ; giao diện đổi không báo đọc hết', async () => {
  const mock = await startMockFacebook();
  try {
    let empty = false;
    const scan = createJoinedGroupScanner({ settleMs: 0, scrollMs: 0, launch: async (dir) => {
      const profile = await mock.launch(dir);
      await profile.context.route('https://www.facebook.com/groups/joins/', (route) => route.fulfill({ contentType: 'text/html',
        body: empty ? '<p>Changed UI</p>' : '<main role="main"><a href="/groups/123456789012">A</a><a href="/groups/112233445566">B</a></main>' }));
      return profile;
    } });
    let count = 0;
    assert.equal((await scan(input({ limit: 1, onBatch: (items) => { count = items.length; } }))).reason, 'result_limit');
    assert.equal(count, 1);
    let cancel = false;
    assert.equal((await scan(input({ shouldCancel: () => cancel, onBatch: () => { cancel = true; } }))).status, 'stopped');
    empty = true;
    assert.equal((await scan(input())).reason, 'ui_changed');
    assert.equal(mock.submits, 0);
  } finally { await mock.close(); }
});
