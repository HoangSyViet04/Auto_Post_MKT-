import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createFakeScanner, type FakeScanObservation, type FakeScannerOptions } from './fake-scanner.ts';
import { assertScanRequest, type ScanRequest } from './scanner.ts';

const request: ScanRequest = { runId: 'run-1', accountId: 'account-a', expectedIdentityRemoteId: 'facebook-a',
  mode: 'joined', resultLimit: 10 };
const fixture: FakeScanObservation = { accountId: 'account-a', groupId: 'group-x',
  url: 'https://www.facebook.com/groups/group-x', name: 'Nhóm iPhone đã quan sát',
  observedAt: '2026-10-27T00:00:00.000Z',
};

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = () => { throw new Error('Fake scanner không được gọi mạng'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('fake scanner: dữ liệu quan sát có nguồn và giới hạn', () => {
  test('fixture status/reasonCode ngoài giao ước bị từ chối runtime', () => {
    assert.throws(() => createFakeScanner({ status: 'made-up' } as unknown as FakeScannerOptions), /status không hợp lệ/);
    assert.throws(() => createFakeScanner({ reasonCode: 'made-up' } as unknown as FakeScannerOptions), /reasonCode không hợp lệ/);
  });

  test('joined/keyword giữ account/source/time; không suy membership/quyền/duyệt bài', async () => {
    const scanner = createFakeScanner({ observations: [fixture] });
    assert.equal(scanner.capabilities.simulated, true);
    for (const scanRequest of [request, { ...request, mode: 'keyword', keyword: 'iPhone cũ' } as const]) {
      const result = await scanner.scan(scanRequest);
      assert.equal(result.status, 'completed');
      assert.equal(result.scopeComplete, true, 'chỉ hoàn tất scope fixture, không phải tất cả group Facebook');
      assert.equal(result.runId, request.runId);
      assert.equal(result.accountId, 'account-a');
      const item = result.results[0];
      assert.ok(item);
      assert.equal(item.source, 'simulated');
      assert.equal(item.observedAt, fixture.observedAt);
      assert.equal(item.accountId, 'account-a');
      assert.equal(item.visibility, 'unknown');
      assert.equal(item.membership, 'unknown');
      assert.equal(item.postingPermission, 'unknown');
      assert.equal(item.approvalRequired, 'unknown');
      assert.equal(item.memberCount, undefined);
    }
  });

  test('giữ quan sát rõ ràng, không biến tìm thấy thành quyền đăng hoặc không kiểm duyệt', async () => {
    const scanner = createFakeScanner({ observations: [{ ...fixture, membership: 'joined',
      postingPermission: 'denied', approvalRequired: 'yes', visibility: 'private', memberCount: 0 }] });
    const result = await scanner.scan({ ...request, mode: 'keyword', keyword: 'mua bán' });
    assert.equal(result.results[0]?.membership, 'joined');
    assert.equal(result.results[0]?.postingPermission, 'denied');
    assert.equal(result.results[0]?.approvalRequired, 'yes');
    assert.equal(result.results[0]?.memberCount, 0);
  });

  test('limit =>partial; fixture lỗi/checkpoint giữ phần đã đọc và nguồn dừng', async () => {
    const observations = [fixture, { ...fixture, groupId: 'group-y', url: 'https://www.facebook.com/groups/group-y' }];
    const limited = await createFakeScanner({ observations }).scan({ ...request, resultLimit: 1 });
    assert.equal(limited.status, 'partial');
    assert.equal(limited.reasonCode, 'result_limit');
    assert.equal(limited.scopeComplete, false);
    assert.equal(limited.observedCount, 1);
    const partial = await createFakeScanner({ observations, status: 'partial', reasonCode: 'checkpoint' }).scan(request);
    assert.equal(partial.scopeComplete, false);
    assert.equal(partial.reasonCode, 'checkpoint');
    assert.equal(partial.results.length, 2);
  });

  test('stop chặn scan sau, không xóa/thu hồi kết quả đã trả', async () => {
    const scanner = createFakeScanner({ observations: [fixture] });
    const previous = await scanner.scan(request);
    assert.deepEqual(await scanner.stop(), { requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false });
    const stopped = await scanner.scan({ ...request, runId: 'run-stopped' });
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.reasonCode, 'stopped');
    assert.equal(stopped.scopeComplete, false);
    assert.equal(stopped.results.length, 0);
    assert.equal(previous.results.length, 1);
  });

  test('snapshot fixture/result bất biến, không bị sửa input hoặc nhận source thật giả mạo', async () => {
    const input = { ...fixture, source: 'graph_api' };
    const observations = [input];
    const scanner = createFakeScanner({ observations });
    input.name = 'Đã thay đổi';
    observations.push({ ...fixture, source: 'joined_ui' });
    const result = await scanner.scan(request);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.name, fixture.name);
    assert.equal(result.results[0]?.source, 'simulated');
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.results));
    assert.ok(Object.isFrozen(result.results[0]));
  });

  test('không trộn membership/account giữa hai tài khoản', async () => {
    const scanner = createFakeScanner({ observations: [{ ...fixture, accountId: 'account-b', membership: 'joined' }] });
    await assert.rejects(scanner.scan(request), /tài khoản không khớp/);
  });

  test('request sai ID/keyword/limit bị từ chối trước đọc fixture', async () => {
    const scanner = createFakeScanner();
    for (const bad of [null, {}, { ...request, runId: '' }, { ...request, accountId: '' },
      { ...request, expectedIdentityRemoteId: '' }, { ...request, mode: 'keyword', keyword: ' ' },
      ...[0, -1, 1.5, 1001, Number.NaN, Number.POSITIVE_INFINITY].map((resultLimit) => ({ ...request, resultLimit })),
    ]) {
      assert.throws(() => assertScanRequest(bad), /Scan request/);
      await assert.rejects(scanner.scan(bad as ScanRequest), /Scan request/);
    }
  });

  test('fixture phải có account/link hợp lệ; không suy ID từ link hoặc member count chưa biết', () => {
    for (const bad of [{ ...fixture, accountId: '' }, { ...fixture, url: '' }, { ...fixture, url: 'file:///outside' },
      { ...fixture, url: 'https://user:password@facebook.invalid/groups/g' }, { ...fixture, groupId: '' },
      { ...fixture, memberCount: -1 }, { ...fixture, observedAt: 'not-a-time' },
    ]) assert.throws(() => createFakeScanner({ observations: [bad] }), /Fixture observation/);
  });
});
