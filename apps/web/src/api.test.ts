import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApiClient } from './api.ts';

interface Call { input: Parameters<typeof fetch>[0]; init: RequestInit | undefined }

function fixture(respond?: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const client = createApiClient(async (input, init) => {
    const call = { input, init };
    calls.push(call);
    return respond?.(call) ?? new Response(input === '/api/session' ? '{"token":"test-session-value"}' : '{}');
  });
  return { client, calls };
}

describe('local API client', () => {
  test('GET health không bootstrap hoặc gắn token, giữ chế độ same-origin và chặn redirect', async () => {
    const { client, calls } = fixture();
    const response = await client.fetch('/api/health');
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const init = calls[0]?.init;
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).has('X-APM-Token'), false);
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.mode, 'same-origin');
    assert.equal(init?.redirect, 'error');
  });

  test('mutation lấy phiên một lần trong bộ nhớ, gắn header JSON và không để caller bật redirect', async () => {
    const { client, calls } = fixture();
    for (const method of ['post', 'PATCH', 'DELETE']) {
      await client.fetch('/api/items', { method, body: '{}', redirect: 'follow', credentials: 'include' });
    }
    assert.equal(calls.filter((call) => call.input === '/api/session').length, 1);
    assert.equal(calls[0]?.init?.cache, 'no-store');
    for (const call of calls.slice(1)) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get('X-APM-Token'), 'test-session-value');
      assert.equal(headers.get('Content-Type'), 'application/json');
      assert.equal(headers.has('Origin'), false, 'browser tự gửi Origin');
      assert.equal(call.init?.redirect, 'error');
      assert.equal(call.init?.credentials, 'same-origin');
      assert.equal(call.init?.cache, 'no-store');
    }
  });

  test('mutation đồng thời dùng chung bootstrap promise', async () => {
    const { client, calls } = fixture(async (call) => {
      if (call.input === '/api/session') {
        await Promise.resolve();
        return new Response('{"token":"shared-session"}');
      }
      return new Response('{}');
    });
    await Promise.all([client.fetch('/api/one', { method: 'POST' }), client.fetch('/api/two', { method: 'POST' })]);
    assert.equal(calls.filter((call) => call.input === '/api/session').length, 1);
    assert.equal(calls.length, 3);
  });

  test('chặn URL tuyệt đối, protocol-relative, traversal và backslash trước mọi request', async () => {
    const { client, calls } = fixture();
    for (const path of ['https://evil.invalid/api/steal', '//evil.invalid/api/steal', '/api/../steal',
      '/api/%2e%2e/steal', '/api/..\\steal', '/api/x#fragment', '/api/health\n', 'api/health', '/other']) {
      await assert.rejects(client.fetch(path, { method: 'POST' }), /Đường dẫn API không hợp lệ/);
    }
    assert.equal(calls.length, 0);
  });

  test('bootstrap lỗi hoặc payload sai không gửi mutation và không cache phiên lỗi', async () => {
    for (const bootstrap of [new Response('{}'), new Response('{"token":123}'), new Response('{"token":""}'),
      new Response('not json'), new Response('{}', { status: 403 })]) {
      const { client, calls } = fixture((call) => call.input === '/api/session' ? bootstrap.clone() : new Response('{}'));
      await assert.rejects(client.fetch('/api/items', { method: 'POST' }), /phiên truy cập cục bộ/);
      await assert.rejects(client.fetch('/api/items', { method: 'POST' }), /phiên truy cập cục bộ/);
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.input === '/api/session'));
    }
  });

  test('403 không phát lại mutation; lần thao tác chủ động sau lấy phiên mới', async () => {
    const { client, calls } = fixture((call) => call.input === '/api/session'
      ? new Response('{"token":"test-session-value"}') : new Response('{}', { status: 403 }));
    assert.equal((await client.fetch('/api/items', { method: 'POST' })).status, 403);
    assert.equal(calls.length, 2);
    assert.equal((await client.fetch('/api/items', { method: 'POST' })).status, 403);
    assert.equal(calls.length, 4);
  });

  test('mất mạng khi mutation không tự gửi lại; clearSession không gây request', async () => {
    const { client, calls } = fixture((call) => {
      if (call.input === '/api/session') return new Response('{"token":"test-session-value"}');
      throw new Error('network unavailable');
    });
    await assert.rejects(client.fetch('/api/items', { method: 'POST' }), /network unavailable/);
    assert.equal(calls.length, 2);
    client.clearSession();
    assert.equal(calls.length, 2);
  });
});
