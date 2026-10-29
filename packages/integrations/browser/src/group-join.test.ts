import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startMockFacebook } from '../../../../tests/fixtures/mock-facebook.ts';
import { createGroupJoiner, type GroupJoinInput } from './group-join.ts';

const ID = '100000000001';
const input = (overrides: Partial<GroupJoinInput> = {}): GroupJoinInput => ({ profileDir: 'unused', expectedIdentity: 'vanity:nick.a', externalId: ID,
  shouldCancel: () => false, onTick: () => undefined, beforeSend: () => true, ...overrides });

const header = `<a href="/groups/${ID}/">Nhóm thử</a>`;
const clickJs = "fetch('/__join',{method:'POST'})";
/** Nhóm có biểu mẫu: bấm Tham gia chỉ mở biểu mẫu; chỉ nút Gửi mới gửi yêu cầu (và chỉ khi ô tick đồng ý, nếu có, đã được tick). */
const form = (fields: string): string => `<main>${header}<div id="j" role="button" aria-label="Tham gia nhóm" onclick="document.getElementById('d').hidden=false">Tham gia nhóm</div>
  <div id="d" role="dialog" hidden>${fields}<div id="s" role="button" aria-label="Gửi">Gửi</div><div role="button" aria-label="Đóng" onclick="document.getElementById('d').hidden=true">Đóng</div></div></main>
  <script>
    const c = document.getElementById('c'); const s = document.getElementById('s'); const j = document.getElementById('j');
    if (c) { s.setAttribute('aria-disabled', 'true'); c.onchange = () => s.setAttribute('aria-disabled', String(!c.checked)); }
    s.onclick = () => {
      if (c && !c.checked) return;
      fetch('/__join', { method: 'POST', body: JSON.stringify({ ticked: c ? c.checked : null, answers: Array.from(document.querySelectorAll('#d textarea')).map((t) => t.value) }) });
      j.textContent = 'Hủy yêu cầu'; j.setAttribute('aria-label', 'Hủy yêu cầu'); document.getElementById('d').hidden = true;
    };
  </script>`;
const pages: Record<string, string> = {
  plain: `<main>${header}<div id="b" role="button" aria-label="Tham gia nhóm" onclick="${clickJs};this.textContent='Hủy yêu cầu';this.setAttribute('aria-label','Hủy yêu cầu')">Tham gia nhóm</div></main>`,
  joinedAlready: `<main>${header}<div role="button">Đã tham gia</div></main>`,
  requestedAlready: `<main>${header}<div role="button">Hủy yêu cầu</div></main>`,
  twoButtons: `<main>${header}<div role="button">Tham gia nhóm</div><div role="button">Tham gia nhóm</div></main>`,
  noButton: `<main>${header}<p>Giao diện khác</p></main>`,
  questions: `<main>${header}<div role="button" aria-label="Tham gia nhóm" onclick="document.getElementById('d').hidden=false">Tham gia nhóm</div>
    <div id="d" role="dialog" hidden><p>Trả lời câu hỏi để tham gia</p><input type="text"><div role="button" aria-label="Gửi" onclick="${clickJs}">Gửi</div><div role="button" aria-label="Đóng" onclick="document.getElementById('d').hidden=true">Đóng</div></div></main>`,
  joinedWithWelcome: `<main>${header}<div role="button" aria-label="Tham gia nhóm" onclick="${clickJs};this.textContent='Đã tham gia';this.setAttribute('aria-label','Đã tham gia');document.getElementById('w').hidden=false">Tham gia nhóm</div>
    <div id="w" role="dialog" hidden><p>Chào mừng bạn đến với nhóm</p><div role="button" aria-label="Đóng" onclick="document.getElementById('w').hidden=true">Đóng</div></div></main>`,
  blocked: `<main>${header}<div role="button" aria-label="Tham gia nhóm" onclick="${clickJs};document.body.insertAdjacentHTML('beforeend','<div role=alert>Bạn tạm thời bị chặn tham gia nhóm</div>')">Tham gia nhóm</div></main>`,
  silent: `<main>${header}<div role="button" aria-label="Tham gia nhóm" onclick="${clickJs}">Tham gia nhóm</div></main>`,
  rulesCheckbox: form('<label><input id="c" type="checkbox" aria-label="Tôi đồng ý với nội quy nhóm"> Tôi đồng ý với nội quy nhóm</label>'),
  textQuestion: form('<p>Bạn tham gia nhóm để làm gì?</p><textarea aria-label="Câu hỏi 1"></textarea>'),
  rulesAndText: form('<label><input id="c" type="checkbox" aria-label="Tôi đồng ý với nội quy nhóm"> Tôi đồng ý với nội quy nhóm</label><textarea aria-label="Câu hỏi 1"></textarea>'),
  radioQuestion: form('<p>Bạn bán gì?</p><label><input type="radio" name="q" aria-label="Điện thoại"> Điện thoại</label><label><input type="radio" name="q" aria-label="Khác"> Khác</label>'),
  otherCheckbox: form('<label><input id="c" type="checkbox" aria-label="Tôi đang dùng iPhone"> Tôi đang dùng iPhone</label>'),
  // Bảng thông báo luôn hiện sẵn của Facebook (role=dialog, có chữ giống thông báo hạn chế); nhóm cho vào thẳng.
  notificationsPanel: `<main>${header}<div role="dialog"><div role="button">Tất cả</div><div role="button">Chưa đọc</div><p>Bạn không thể tham gia nhóm khác. Try again later</p></div>
    <div role="button" aria-label="Tham gia nhóm" onclick="${clickJs};this.textContent='Đã tham gia';this.setAttribute('aria-label','Đã tham gia')">Tham gia nhóm</div></main>`,
  postWithWarning: `<main>${header}<article>không thể tham gia nhóm khác nếu bạn tạm thời bị chặn</article><div id="b" role="button" aria-label="Tham gia nhóm" onclick="${clickJs};this.textContent='Hủy yêu cầu';this.setAttribute('aria-label','Hủy yêu cầu')">Tham gia nhóm</div></main>`,
};

async function attempt(page: string, overrides: Partial<GroupJoinInput> = {}, mockOptions = {}) {
  const mock = await startMockFacebook(mockOptions);
  let joins = 0; let closed = 0; const bodies: string[] = [];
  try {
    const join = createGroupJoiner({ settleMs: 0, confirmMs: 1500, launch: async (dir) => {
      const profile = await mock.launch(dir);
      await profile.context.route('**/__join', (route) => { joins += 1; bodies.push(route.request().postData() ?? ''); return route.fulfill({ body: 'ok' }); });
      await profile.context.route(`**/groups/${ID}**`, (route) => page === 'wrongGroup'
        ? route.fulfill({ status: 302, headers: { location: 'https://www.facebook.com/groups/999999999999/' } }) // Facebook đưa sang nhóm khác
        : route.fulfill({ contentType: 'text/html; charset=utf-8', body: pages[page] ?? '' }));
      return { ...profile, close: async () => { closed += 1; await profile.close(); } };
    } });
    const result = await join(input(overrides));
    return { result, joins, closed, submits: mock.submits, bodies };
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

test('Facebook giả: vào nhóm ngay kèm hộp thoại chào → joined (không nhầm là câu hỏi)', async () => {
  const done = await attempt('joinedWithWelcome');
  assert.deepEqual([done.result.status, done.result.reason, done.result.clicked, done.joins], ['joined', null, true, 1]);
});

test('Facebook giả: nhóm có câu hỏi → đóng hộp thoại, không gửi, báo cần làm tay', async () => {
  const done = await attempt('questions');
  assert.deepEqual([done.result.status, done.result.reason], ['skipped', 'needs_answers']);
  assert.equal(done.joins, 0); // không bấm "Gửi" trong hộp thoại
});

const ANSWER = 'Mình muốn tham gia để mua bán điện thoại.';
test('Facebook giả: biểu mẫu chỉ có ô đồng ý nội quy → tick rồi gửi đúng một lần; tắt tự đồng ý thì bỏ qua, không tick', async () => {
  const done = await attempt('rulesCheckbox', { form: { agreeRules: true, defaultAnswer: '' } });
  assert.deepEqual([done.result.status, done.result.clicked, done.joins], ['requested', true, 1]);
  assert.deepEqual(JSON.parse(done.bodies[0] ?? '{}'), { ticked: true, answers: [] });
  const off = await attempt('rulesCheckbox', { form: { agreeRules: false, defaultAnswer: ANSWER } });
  assert.deepEqual([off.result.status, off.result.reason, off.joins], ['skipped', 'needs_answers', 0]);
  assert.deepEqual([(await attempt('rulesCheckbox')).result.reason, (await attempt('rulesCheckbox')).joins], ['needs_answers', 0]); // không có cấu hình = không tự làm gì
});

test('Facebook giả: câu hỏi viết tay → điền câu mặc định rồi gửi; chưa có câu mặc định thì bỏ qua; nội quy + chữ cùng lúc', async () => {
  const done = await attempt('textQuestion', { form: { agreeRules: true, defaultAnswer: ANSWER } });
  assert.deepEqual([done.result.status, done.joins], ['requested', 1]);
  assert.deepEqual(JSON.parse(done.bodies[0] ?? '{}'), { ticked: null, answers: [ANSWER] });
  const empty = await attempt('textQuestion', { form: { agreeRules: true, defaultAnswer: '  ' } });
  assert.deepEqual([empty.result.status, empty.result.reason, empty.joins], ['skipped', 'needs_answers', 0]);
  const both = await attempt('rulesAndText', { form: { agreeRules: true, defaultAnswer: ANSWER } });
  assert.deepEqual([both.result.status, JSON.parse(both.bodies[0] ?? '{}')], ['requested', { ticked: true, answers: [ANSWER] }]);
});

test('Facebook giả: câu chọn đáp án và ô tick không phải đồng ý nội quy không bao giờ được trả lời hộ', async () => {
  for (const page of ['radioQuestion', 'otherCheckbox']) {
    const done = await attempt(page, { form: { agreeRules: true, defaultAnswer: ANSWER } });
    assert.deepEqual([done.result.status, done.result.reason, done.joins], ['skipped', 'needs_answers', 0]);
  }
});

test('Facebook giả: bảng thông báo luôn hiện sẵn (có chữ giống cảnh báo) không bị nhầm là câu hỏi hay hạn chế', async () => {
  const done = await attempt('notificationsPanel', { form: { agreeRules: true, defaultAnswer: ANSWER } });
  assert.deepEqual([done.result.status, done.result.reason, done.joins], ['joined', null, 1]);
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
