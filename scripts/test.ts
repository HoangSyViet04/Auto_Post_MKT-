/** Force safe settings even if the parent shell has production/live/.env values. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'apm test run '));
if (dirname(dir) !== tmpdir()) throw new Error('Unsafe test cleanup path');
try {
  const targets = process.argv.slice(2);
  const child = spawn(process.execPath, ['--test', ...(targets.length ? targets : ['{apps,packages,tests}/**/*.test.ts'])], {
    env: { ...process.env, APM_ENV: 'test', APM_INTEGRATIONS: 'fake', APM_DATA_DIR: dir },
    stdio: 'inherit', windowsHide: true,
  });
  process.once('SIGINT', () => { child.kill(); });
  const [code] = await once(child, 'exit');
  process.exitCode = typeof code === 'number' ? code : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
