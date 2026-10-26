import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { getAppEnv, getDatabasePath, getDataDir, getIntegrationMode } from './index.ts';

const KEYS = ['APM_ENV', 'APM_DATA_DIR', 'APM_INTEGRATIONS'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('config', () => {
  test('mặc định development và adapter giả', () => {
    assert.equal(getAppEnv(), 'development');
    assert.equal(getIntegrationMode(), 'fake');
  });

  test('APM_ENV và APM_INTEGRATIONS sai giá trị thì báo lỗi', () => {
    process.env.APM_ENV = 'prod';
    assert.throws(getAppEnv, /APM_ENV không hợp lệ/);
    process.env.APM_ENV = 'development';
    process.env.APM_INTEGRATIONS = 'real';
    assert.throws(getIntegrationMode, /APM_INTEGRATIONS không hợp lệ/);
  });

  test('live phải bật rõ ràng và bị cấm khi APM_ENV=test', () => {
    process.env.APM_INTEGRATIONS = 'live';
    assert.equal(getIntegrationMode(), 'live');
    process.env.APM_ENV = 'test';
    assert.throws(getIntegrationMode, /bị cấm/);
  });

  test('test không có APM_DATA_DIR thì dùng thư mục tạm, không dùng LOCALAPPDATA', () => {
    process.env.APM_ENV = 'test';
    assert.equal(getDataDir(), join(tmpdir(), 'AutoPostMKT-test'));
    assert.equal(getDatabasePath(), join(tmpdir(), 'AutoPostMKT-test', 'db', 'test.sqlite'));
  });

  test('APM_DATA_DIR ghi đè thư mục dữ liệu', () => {
    process.env.APM_DATA_DIR = join(tmpdir(), 'apm dữ liệu');
    assert.equal(getDatabasePath(), join(tmpdir(), 'apm dữ liệu', 'db', 'development.sqlite'));
  });
});
