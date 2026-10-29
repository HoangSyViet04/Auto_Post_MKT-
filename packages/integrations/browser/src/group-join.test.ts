import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startMockFacebook } from '../../../../tests/fixtures/mock-facebook.ts';
import { createGroupJoiner, type GroupJoinInput } from './group-join.ts';

const ID = '100000000001';
const input = (overrides: Partial<GroupJoinInput> = {}): GroupJoinInput => ({ profileDir: 'unused', expectedIdentity: 'vanity:nick.a', externalId: ID,
  shouldCancel: () => false, onTick: () => undefined, beforeSend: () => true, ...overrides });

const header = `<a href="/groups/${ID}/">Nhóm thử</a>`;
const clickJs = "fetch('/__join',{method:'POST'})";
const pages: Record<string, string> = {
  plain: `<main>${header}<div id="b" role="button" aria-label="Tham gia nhóm" onclick="${clickJs};this.textContent='Hủy yêu cầu';this.setAttribute('aria-label','Hủy yêu cầu')">Tham gia nhóm</div></main>`,
  joinedAlready: `<main>${header}<div role="button">Đã tham gia</div></main>`,
  requestedAlready: `<main>${header}<div role="button">Hủy yêu cầu</div></main>`,
  twoButtons: `<main>${header}<div role="button">Tham gia nhóm</div><div role="button">Tham gia nhóm</div></main>`,
  noButton: `<main>${header}<p>Giao diện khác</p></main>`,
  questions: `<main>${header}<div role="button" aria-label="Tham gia nhóm" onclick="document.getElementById('d').hidden=false">Tham gia nhóm</div>
    <div id="d" role="dialog" hidden><p>Trả lời câu hỏi để tham gia</p><input type="text"><div role="button" aria-label="Gửi" onclick="${clickJs}">Gửi</div><div role="button" aria-label="Đóng" onclick="document.getElementById('d').hidden=true">Đóng</div></div></main>`,
  blocked: `<main>${header}<div role="button" aria-label="Tham gia nhóm" onclick="${clickJs};document.body.insertAdjacentHTML('beforeend','<div role=alert>Bạn tạm thời bị chặn tham gia nhóm</div>')">Tham gia nhóm</div></main>`,
  silent: `<main>${header}<div role="button" aria-label="Tham gia nhóm" onclick="${clickJs}">Tham gia nhóm</div></main>`,
  postWithWarning: `<main>${header}<article>không thể tham gia nhóm khác nếu bạn tạm thời bị chặn</article><div id="b" role="button" aria-label="Tham gia nhóm" onclick="${clickJs};this.textContent='Hủy yêu cầu';this.setAttribute('aria-label','Hủy yêu cầu')">Tham gia nhóm</div></main>`,
};

async function attempt(page: string, overrides: Partial<GroupJoinInput> = {}, mockOptions = {}) {
  const mock = await startMockFacebook(mockOptions);
  let joins = 0; let closed = 0;
  try {
    const join = createGroupJoiner({ settleMs: 0, confirmMs: 1500, launch: async (dir) => {
      const profile = await mock.launch(dir);
      await profile.context.route('**/__join', (route) => { joins += 1; return route.fulfill({ body: 'ok' }); });
      await profile.context.route(`**/groups/${ID}**`, (route) => page === 'wrongGroup'
        ? route.fulfill({ status: 302, headers: { location: 'https://www.facebook.com/groups/999999999999/' } }) // Facebook đưa sang nhóm khác
        : route.fulfill({ contentType: 'text/html; charset=utf-8', body: pages[page] ?? '' }));
      return { ...profile, close: async () => { closed += 1; await profile.close(); } };
    } });
    const result = await join(input(overrides));
    return { result, joins, closed, submits: mock.submits };
  } finally { await mock.close(); }
}

test('Facebook giả: gửi yêu cầu thành công đúng một lần, ghi mốc trước khi bấm, đóng profile', async () => {
  const order: string[] = [];
  const done = await attempt('plain', { beforeSend: () => { order.push('mốc'); return true; } });
  assert.deepEqual(done.result, { status: 'requested', reason: null, clicked: true });
  assert.equal(done.joins, 1); assert.equal(done.closed, 1); assert.equal(done.submits, 0);
  assert.deepEqual(order, ['mốc']);
});

test('Facebook giả: đã là thành viên/đã gửi yêu cầu → không bấm', async () => {
  for (const [page, reason] of [['joinedAlready', 'already_joined'], ['requestedAlready', 'already_requested']] as const) {
    const done = await attempt(page);
    assert.deepEqual([done.result.status, done.result.reason, done.result.clicked, done.joins], ['skipped', reason, false, 0]);
  }
});

test('Facebook giả: giao diện lạ, hai nút, sai nhóm → dừng trước khi bấm, không đoán', async () => {
  for (const [page, reason] of [['twoButtons', 'ui_changed'], ['noButton', 'ui_changed'], ['wrongGroup', 'wrong_group']] as const) {
    const done = await attempt(page);
    assert.deepEqual([done.result.status, done.result.reason, done.result.clicked, done.joins], ['failed', reason, false, 0]);
  }
});

test('Facebook giả: nhóm có câu hỏi → đóng hộp thoại, không gửi, báo cần làm tay', async () => {
  const done = await attempt('questions');
  assert.deepEqual([done.result.status, done.result.reason], ['skipped', 'needs_answers']);
  assert.equal(done.joins, 0); // không bấm "Gửi" trong hộp thoại
});

test('Facebook giả: Facebook báo hạn chế → action_blocked; chữ cảnh báo nằm trong bài của nhóm không bị coi là hạn chế', async () => {
  const blocked = await attempt('blocked');
  assert.deepEqual([blocked.result.status, blocked.result.reason, blocked.result.clicked], ['failed', 'action_blocked', true]);
  const post = await attempt('postWithWarning');
  assert.equal(post.result.status, 'requested');
});

test('Facebook giả: bấm mà không thấy xác nhận → unknown, không bấm lần hai', async () => {
  const done = await attempt('silent');
  assert.deepEqual([done.result.status, done.result.reason, done.result.clicked, done.joins], ['unknown', 'unconfirmed', true, 1]);
});

test('hết hạn mức ngay trước khi bấm hoặc bị hủy → không bấm', async () => {
  const capped = await attempt('plain', { beforeSend: () => false });
  assert.deepEqual([capped.result.status, capped.result.reason, capped.result.clicked, capped.joins], ['skipped', 'daily_cap', false, 0]);
  const cancelled = await attempt('plain', { shouldCancel: () => true });
  assert.deepEqual([cancelled.result.status, cancelled.joins, cancelled.closed], ['cancelled', 0, 0]);
});

test('sai danh tính/checkpoint chặn trước khi mở nhóm; ID không phải số bị từ chối', async () => {
  for (const options of [{ vanity: 'wrong' }, { checkpoint: true }]) {
    const done = await attempt('plain', {}, options);
    assert.equal(done.result.reason, 'checkpoint' in options ? 'checkpoint' : 'identity_mismatch');
    assert.equal(done.joins, 0); assert.equal(done.closed, 1);
  }
  await assert.rejects(createGroupJoiner()(input({ externalId: 'abc' })));
});
