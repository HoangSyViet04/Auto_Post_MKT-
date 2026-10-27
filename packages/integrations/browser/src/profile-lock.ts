import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ProfileLock {
  release(): void;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * Khóa độc quyền một thư mục profile: một thư mục chỉ được một tiến trình mở. Khóa của tiến trình đã chết
 * được dọn; khóa của tiến trình còn sống thì từ chối. Trả về lỗi có mã `profile_in_use`.
 */
export function acquireProfileLock(lockPath: string): ProfileLock {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return { release: () => rmSync(lockPath, { force: true }) };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const owner = Number.parseInt(readFileSync(lockPath, 'utf8'), 10);
      if (Number.isInteger(owner) && owner !== process.pid && alive(owner)) throw new Error('profile_in_use');
      rmSync(lockPath, { force: true }); // khóa mồ côi
    }
  }
  throw new Error('profile_in_use');
}
