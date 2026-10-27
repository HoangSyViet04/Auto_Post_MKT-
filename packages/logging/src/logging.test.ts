import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pretty from 'pino-pretty';
import { createLogger, redactSecrets, REDACTED } from '#logging';

const secrets = ['cookie-value-123', 'token-value-456', 'auth-value-789', 'proxy-pass-123', 'api-value-456'];
const fixture = {
  jobId: 'job-safe',
  nested: [{ Cookie: secrets[0], refreshToken: secrets[1], AUTHORIZATION: secrets[2],
    proxy_password: secrets[3], 'X-Api-Key': secrets[4] }],
  body: `unstructured ${secrets.join(' ')}`,
};
function assertSafe(output: string) {
  for (const secret of secrets) assert.ok(!output.includes(secret), `Secret leaked: ${secret}`);
  assert.match(output, /REDACTED/);
}

describe('secret-safe logging', () => {
  test('lỗi khởi động server/worker/migration đi qua lọc bí mật', () => {
    for (const entry of ['apps/server/src/index.ts', 'apps/worker/src/index.ts', 'scripts/db-migrate.ts']) {
      const path = fileURLToPath(new URL(`../../../${entry}`, import.meta.url));
      const result = spawnSync(process.execPath, [path], {
        encoding: 'utf8', env: { ...process.env, APM_ENV: 'password=startup-sentinel' },
      });
      assert.equal(result.status, 1);
      assert.equal(result.stderr, '');
      assert.ok(!result.stdout.includes('startup-sentinel'));
      assert.match(result.stdout, /REDACTED/);
    }
  });
  test('lọc đệ quy, array, biến thể key; giữ metadata và không sửa input', () => {
    const before = JSON.stringify(fixture);
    const safe = redactSecrets(fixture) as typeof fixture;
    assertSafe(JSON.stringify(safe));
    assert.equal(safe.jobId, 'job-safe');
    assert.equal(JSON.stringify(fixture), before);
    for (const key of ['cookie', 'set-cookie', 'access_token', 'pageToken', 'proxyPassword', 'password',
      'pass', 'proxyPass', 'auth', 'passwd', 'pwd', 'apiKey', 'api_key', 'x-api-key', 'clientSecret', 'credentials', 'sessionId']) {
      assertSafe(JSON.stringify(redactSecrets({ nested: { [key]: secrets[0] } })));
    }
  });

  test('che toàn bộ body/payload, Error cause, chuỗi JSON/form, bearer và proxy URL', () => {
    const inputs = [
      { body: { arbitraryName: secrets[0] } }, { payload: [secrets[1]] },
      new Error(`Authorization: ${secrets[2]}`, { cause: { password: secrets[3] } }),
      `request failed: {"api_key":"${secrets[4]}"}`,
      `access_token=${secrets[1]}&ok=1`, `Bearer ${secrets[2]}`,
      `socks5://user:${secrets[3]}@localhost:1080`,
      { headers: [{ name: 'X-Api-Key', value: secrets[4] }] },
      { form: [{ key: 'password', value: secrets[3] }] },
      `https://example.invalid/?%61%70%69%5f%6b%65%79=${secrets[4]}`,
    ];
    for (const input of inputs) assertSafe(JSON.stringify(redactSecrets(input)));
  });

  test('cycle/getter/depth không làm lộ dữ liệu hoặc gọi getter', () => {
    const value: Record<string, unknown> = { jobId: 'job-safe' };
    value.self = value;
    Object.defineProperty(value, 'extra', { get() { throw new Error('must not run'); } });
    const safe = JSON.stringify(redactSecrets(value));
    assert.match(safe, /Circular/);
    assert.match(safe, /Accessor/);
    assert.equal(redactSecrets('normal message'), 'normal message');
  });

  test('đầu ra JSON thật: bindings/child, format args, serializer/toJSON và Error đã lọc', () => {
    let output = '';
    const log = createLogger({ env: 'production', name: 'test', destination: { write(line) { output += line; } } });
    log.info(fixture, 'publish prepared');
    log.child({ auth: { authorization: secrets[2] } }).info({ body: secrets[0] }, 'child');
    log.info('response %j', { token: secrets[1] });
    log.info({ result: { toJSON: () => ({ api_key: secrets[4] }) } }, 'serialized');
    log.error(new Error(`proxy http://user:${secrets[3]}@host/`));
    assertSafe(output);
    const lines = output.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines[0].jobId, 'job-safe');
    assert.equal(lines[0].msg, 'publish prepared');
    assert.equal(lines[0].body, REDACTED);
    assert.equal(lines.length, 5);
  });

  test('đầu ra dev pretty thật vẫn có metadata và không lộ bí mật', async () => {
    let output = '';
    const sink = new Writable({ write(line, _encoding, done) { output += line.toString(); done(); } });
    const destination = pretty({ colorize: false, sync: true, destination: sink });
    const log = createLogger({ env: 'development', name: 'dev', destination });
    log.info(fixture, 'publish prepared');
    const completed = once(sink, 'finish');
    destination.end();
    await completed;
    assertSafe(output);
    assert.match(output, /INFO/);
    assert.match(output, /publish prepared/);
    assert.match(output, /job-safe/);
  });
});
