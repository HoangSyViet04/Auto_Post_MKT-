import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { getDataDir } from '#config';
import { BusinessError } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, one } from './repository-common.ts';

const PROVIDER = 'windows-dpapi-v1';
const SCRIPT = readFileSync(new URL('./windows-secrets.ps1', import.meta.url), 'utf8');
const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64');
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
interface SecretReference { id: string; provider: string; reference_id: string; status: string }
function within(parent: string, child: string) {
  const part = relative(parent, child);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..\\') && !part.startsWith('../'));
}

/** Constant trusted script in argv; all values travel via stdin, never shell interpolation. */
async function windows(input: Record<string, string>): Promise<{ protected?: boolean; value?: string }> {
  if (process.platform !== 'win32') throw new BusinessError('secret_unavailable');
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolveResult, reject) => {
    const child = execFile(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT],
      { windowsHide: true, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) { reject(new BusinessError('secret_unavailable')); return; }
        try {
          const result = JSON.parse(stdout);
          if (result.ok !== true) throw new Error('Protection failed');
          resolveResult(result);
        } catch { reject(new BusinessError('secret_unavailable')); }
      });
    child.stdin?.on('error', () => { /* Process callback supplies a sanitized error. */ });
    child.stdin?.end(JSON.stringify(input));
  });
}

/** Only internal consumers can reveal plaintext. Never expose get() through HTTP or logs. */
export function createSecretStore(db: Database, options: { dataDir?: string } = {}) {
  const dataDir = resolve(options.dataDir ?? getDataDir());
  if (within(REPO_ROOT, dataDir)) throw new BusinessError('invalid_input');
  let initialized: Promise<string> | undefined;
  async function directory(): Promise<string> {
    if (!initialized) {
      initialized = (async () => {
        await mkdir(dataDir, { recursive: true });
        const base = await realpath(dataDir);
        if (within(REPO_ROOT, base)) throw new BusinessError('invalid_input');
        const dir = join(base, 'secrets');
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const info = await lstat(dir);
        if (!info.isDirectory() || info.isSymbolicLink() || relative(dir, await realpath(dir)) !== '') throw new BusinessError('invalid_input');
        if ((await windows({ operation: 'secure_directory', path: dir })).protected !== true) throw new BusinessError('secret_unavailable');
        return dir;
      })().catch(() => { initialized = undefined; throw new BusinessError('secret_unavailable'); });
    }
    const dir = await initialized;
    if ((await lstat(dir)).isSymbolicLink() || relative(dir, await realpath(dir)) !== '') throw new BusinessError('secret_unavailable');
    return dir;
  }
  function reference(id: string): SecretReference {
    identifier(id);
    const row = one<SecretReference>(db, 'SELECT id,provider,reference_id,status FROM secret_refs WHERE id=?', id);
    if (!row) throw new BusinessError('not_found');
    identifier(row.reference_id);
    if (row.provider !== PROVIDER) throw new BusinessError('secret_unavailable');
    return row;
  }
  return {
    async put(value: string): Promise<{ id: string; status: 'available' }> {
      if (db.isTransaction || typeof value !== 'string' || !value.length || Buffer.byteLength(value, 'utf8') > 65_536) {
        throw new BusinessError('invalid_input');
      }
      const dir = await directory(); const id = randomUUID(); const key = randomUUID();
      const encrypted = await windows({ operation: 'protect', context: key, value: Buffer.from(value, 'utf8').toString('base64') });
      if (!encrypted.value) throw new BusinessError('secret_unavailable');
      const path = join(dir, `${key}.dpapi`);
      let created = false;
      try {
        const file = await open(path, 'wx', 0o600); created = true;
        try { await file.writeFile(JSON.stringify({ version: 1, ciphertext: encrypted.value })); await file.sync(); }
        finally { await file.close(); }
        atomic(db, () => {
          db.prepare("INSERT INTO secret_refs(id,provider,reference_id,status,created_at) VALUES(?,?,?,'available',?)")
            .run(id, PROVIDER, key, Date.now());
        });
        return { id, status: 'available' };
      } catch {
        if (created && relative(dir, await realpath(dir)) === '') await unlink(path).catch(() => {});
        throw new BusinessError('secret_unavailable');
      }
    },

    async get(id: string): Promise<string> {
      const ref = reference(id);
      if (ref.status === 'lost') throw new BusinessError('secret_lost');
      if (ref.status !== 'available') throw new BusinessError('secret_unavailable');
      const dir = await directory();
      try {
        const path = join(dir, `${ref.reference_id}.dpapi`); const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 256 * 1024) throw new Error('Invalid secret file');
        const stored = JSON.parse(await readFile(path, 'utf8'));
        if (stored.version !== 1 || typeof stored.ciphertext !== 'string') throw new Error('Invalid secret format');
        const result = await windows({ operation: 'unprotect', context: ref.reference_id, value: stored.ciphertext });
        if (!result.value) throw new Error('Secret decode failed');
        return Buffer.from(result.value, 'base64').toString('utf8');
      } catch {
        db.prepare("UPDATE secret_refs SET status='lost' WHERE id=? AND status='available'").run(id);
        throw new BusinessError('secret_lost');
      }
    },

    async revoke(id: string): Promise<void> {
      const ref = reference(id); const dir = await directory();
      db.prepare("UPDATE secret_refs SET status='revoked' WHERE id=?").run(id);
      try { await unlink(join(dir, `${ref.reference_id}.dpapi`)); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new BusinessError('secret_unavailable');
      }
    },
  };
}
