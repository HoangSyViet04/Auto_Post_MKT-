// Explicit child target for runner-safety.test.ts, not discovered by the full suite.
import assert from 'node:assert/strict';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { getAppEnv, getDataDir, getIntegrationMode } from '#config';

assert.equal(getAppEnv(), 'test');
assert.equal(getIntegrationMode(), 'fake');
assert.equal(dirname(getDataDir()), tmpdir());
assert.ok(basename(getDataDir()).startsWith('apm test run '));
