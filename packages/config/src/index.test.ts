import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { getAppEnv, getDatabasePath, getDataDir, getDiagnosticCapture, getIntegrationMode, getLogLevel, getServeWeb } from './index.ts';

const KEYS = ['APM_ENV', 'APM_DATA_DIR', 'APM_INTEGRATIONS', 'APM_DIAG_CAPTURE', 'APM_DIAG_RETENTION_HOURS', 'APM_SERVE_WEB', 'APM_LOG_LEVEL'] as const;
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
  test('APM_SERVE_WEB và APM_LOG_LEVEL: mặc định tắt/không đặt, chỉ nhận giá trị hợp lệ', () => {
    assert.equal(getServeWeb(), false);
    assert.equal(getLogLevel(), undefined);
    process.env.APM_SERVE_WEB = 'ON';
    assert.equal(getServeWeb(), true);
    for (const bad of ['1', 'true', 'yes']) { process.env.APM_SERVE_WEB = bad; assert.throws(getServeWeb, /APM_SERVE_WEB không hợp lệ/u, bad); }
    process.env.APM_LOG_LEVEL = ' Warn ';
    assert.equal(getLogLevel(), 'warn');
    for (const bad of ['verbose', 'trace', '3']) { process.env.APM_LOG_LEVEL = bad; assert.throws(getLogLevel, /APM_LOG_LEVEL không hợp lệ/u, bad); }
  });

  test('ảnh chụp chẩn đoán: TẮT mặc định, chỉ bật khi đặt rõ "on", hạn lưu 1–168 giờ (mặc định 24), giá trị lạ bị từ chối', () => {
    assert.deepEqual(getDiagnosticCapture(), { enabled: false, retentionMs: 24 * 3_600_000 });
    for (const value of ['off', '', ' OFF ']) { process.env.APM_DIAG_CAPTURE = value; assert.equal(getDiagnosticCapture().enabled, false, value); }
    process.env.APM_DIAG_CAPTURE = 'On';
    assert.equal(getDiagnosticCapture().enabled, true);
    process.env.APM_DIAG_RETENTION_HOURS = '6';
    assert.equal(getDiagnosticCapture().retentionMs, 6 * 3_600_000);
    for (const bad of ['1', 'true', 'yes']) { process.env.APM_DIAG_CAPTURE = bad; assert.throws(getDiagnosticCapture, /APM_DIAG_CAPTURE không hợp lệ/u, bad); } // không đoán ý: "1/true" không bật
    process.env.APM_DIAG_CAPTURE = 'on';
    for (const bad of ['0', '169', '-1', 'abc', '1.5']) { process.env.APM_DIAG_RETENTION_HOURS = bad; assert.throws(getDiagnosticCapture, /APM_DIAG_RETENTION_HOURS/u, bad); }
  });

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
