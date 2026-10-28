import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pidAlive, watchParent } from './parent.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('pidAlive: tiến trình hiện tại còn sống; pid không tồn tại thì không', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(2_147_000_000), false);
});

test('watchParent: gọi onGone đúng một lần khi tiến trình cha biến mất; không đặt/giá trị sai thì không theo dõi', async () => {
  let alive = true;
  let gone = 0;
  const watch = watchParent({ APM_PARENT_PID: '4242' }, () => { gone += 1; }, { intervalMs: 10, alive: () => alive });
  assert.ok(watch);
  await wait(40);
  assert.equal(gone, 0); // cha còn sống
  alive = false;
  await wait(60);
  assert.equal(gone, 1); // chỉ một lần dù còn nhiều lượt kiểm tra
  for (const env of [{}, { APM_PARENT_PID: '' }, { APM_PARENT_PID: 'abc' }, { APM_PARENT_PID: '-5' }, { APM_PARENT_PID: String(process.pid) }]) {
    assert.equal(watchParent(env, () => { gone += 100; }), undefined);
  }
  const stopped = watchParent({ APM_PARENT_PID: '4242' }, () => { gone += 100; }, { intervalMs: 10, alive: () => false });
  stopped?.stop();
  await wait(40);
  assert.equal(gone, 1);
});
