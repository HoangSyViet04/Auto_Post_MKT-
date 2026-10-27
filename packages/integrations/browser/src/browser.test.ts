import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquireProfileLock, classifySession, identityRefFromUrl, maskRef, refDigest } from './index.ts';

test('danh tính từ URL trang cá nhân; bỏ trang không phải hồ sơ và domain giả', () => {
  assert.equal(identityRefFromUrl('https://www.facebook.com/profile.php?id=100012345678901&sk=about'), 'id:100012345678901');
  assert.equal(identityRefFromUrl('https://m.facebook.com/Nguyen.Van.A/?ref=x'), 'vanity:nguyen.van.a');
  for (const bad of ['https://www.facebook.com/login/?next=%2Fme', 'https://www.facebook.com/checkpoint/1501092823525282/', 'https://www.facebook.com/',
    'https://www.facebook.com/groups/123456789', 'https://www.facebook.com/profile.php?id=abc', 'https://facebook.com.evil.com/nguyen.van.a',
    'http://www.facebook.com/nguyen.van.a', 'not a url']) {
    assert.equal(identityRefFromUrl(bad), null, bad);
  }
  assert.notEqual(refDigest('id:111'), refDigest('id:112'));
  const masked = maskRef('vanity:nguyen.van.a');
  assert.ok(masked.startsWith('vanity:ngu') && !masked.includes('nguyen') && masked.includes('(12 ký tự)'));
});

test('phân loại phiên: checkpoint/đăng nhập dừng lại, chỉ coi là đã đăng nhập khi có cookie phiên và không có form', () => {
  const fb = (path: string) => `https://www.facebook.com${path}`;
  assert.equal(classifySession({ url: fb('/checkpoint/123'), hasLoginForm: false, hasSessionCookie: true }), 'verification_required');
  assert.equal(classifySession({ url: fb('/two_step_verification/authentication/'), hasLoginForm: true, hasSessionCookie: false }), 'verification_required');
  assert.equal(classifySession({ url: fb('/login/?next=x'), hasLoginForm: true, hasSessionCookie: false }), 'login_required');
  assert.equal(classifySession({ url: fb('/'), hasLoginForm: true, hasSessionCookie: true }), 'login_required');
  assert.equal(classifySession({ url: fb('/me'), hasLoginForm: false, hasSessionCookie: true }), 'logged_in');
  assert.equal(classifySession({ url: fb('/me'), hasLoginForm: false, hasSessionCookie: false }), 'unknown');
  assert.equal(classifySession({ url: 'https://example.com/login', hasLoginForm: true, hasSessionCookie: true }), 'unknown');
});

test('khóa profile: tiến trình thứ hai bị từ chối khi tiến trình đầu còn sống; khóa mồ côi được dọn; release xóa khóa', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apm khóa '));
  const lockPath = join(dir, 'profile.lock');
  try {
    const first = acquireProfileLock(lockPath);
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `import { acquireProfileLock } from ${JSON.stringify(new URL('./profile-lock.ts', import.meta.url).href)};
       try { acquireProfileLock(${JSON.stringify(lockPath)}); process.exit(0); } catch (e) { process.exit(e.message === 'profile_in_use' ? 7 : 1); }`], { stdio: 'ignore' });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 7); // bị từ chối vì chủ khóa (tiến trình này) còn sống
    first.release();
    assert.equal(existsSync(lockPath), false);

    writeFileSync(lockPath, '2147483646'); // PID không tồn tại → khóa mồ côi
    const second = acquireProfileLock(lockPath);
    second.release();
    assert.equal(existsSync(lockPath), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
