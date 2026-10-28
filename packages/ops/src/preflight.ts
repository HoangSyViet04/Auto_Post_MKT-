import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** Kết quả một lần kiểm tra trước khi chạy. `error` chặn việc khởi động; `warn` chỉ báo. */
export interface Check {
  id: string;
  ok: boolean;
  severity: 'error' | 'warn';
  message: string;
  /** Cách khắc phục, viết cho người vận hành. */
  fix?: string;
}

const pass = (id: string, message: string): Check => ({ id, ok: true, severity: 'warn', message });
const failed = (id: string, severity: Check['severity'], message: string, fix?: string): Check => ({ id, ok: false, severity, message, ...(fix ? { fix } : {}) });

const parseVersion = (text: string): [number, number, number] | null => {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
};
const compare = (a: readonly number[], b: readonly number[]): number => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);

/** Hỗ trợ đúng dạng của `engines.node` trong package.json: ">=24.11.0 <25". Dạng lạ thì coi là không thỏa (an toàn). */
export function satisfiesNodeRange(version: string, range: string): boolean {
  const current = parseVersion(version);
  if (!current) return false;
  const parts = range.trim().split(/\s+/u);
  if (parts.length === 0 || parts.some((part) => !/^(>=|<)\d+(\.\d+){0,2}$/u.test(part))) return false;
  return parts.every((part) => {
    const bound = parseVersion(part.replace(/^(>=|<)/u, ''));
    if (!bound) return false;
    return part.startsWith('>=') ? compare(current, bound) >= 0 : compare(current, bound) < 0;
  });
}

export function checkNode(version: string, range: string): Check {
  return satisfiesNodeRange(version, range)
    ? pass('node', `Node ${version} phù hợp (yêu cầu ${range}).`)
    : failed('node', 'error', `Node ${version} không phù hợp (yêu cầu ${range}).`, 'Cài Node 24 LTS từ nodejs.org rồi mở lại cửa sổ này.');
}

export function checkDependencies(rootDir: string): Check {
  return existsSync(join(rootDir, 'node_modules', 'fastify', 'package.json'))
    ? pass('dependencies', 'Đã cài thư viện.')
    : failed('dependencies', 'error', 'Chưa cài thư viện (thiếu thư mục node_modules).', 'Mở cửa sổ lệnh tại thư mục dự án và chạy: npm ci');
}

export function checkWebBuilt(distDir: string): Check {
  return existsSync(join(distDir, 'index.html'))
    ? pass('web', 'Đã có bản build giao diện.')
    : failed('web', 'warn', 'Chưa có bản build giao diện.', 'Sẽ tự build khi khởi động (mất vài giây).');
}

/** Thư mục dữ liệu phải tạo/ghi được. Thử ghi một file tạm thật thay vì chỉ kiểm quyền. */
export function checkDataDir(dir: string): Check {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.ghi-thu-${process.pid}`);
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    return pass('data-dir', 'Thư mục dữ liệu ghi được.');
  } catch {
    return failed('data-dir', 'error', 'Không tạo/ghi được thư mục dữ liệu.', 'Kiểm tra quyền ghi và đường dẫn (APM_DATA_DIR hoặc %LOCALAPPDATA%\\AutoPostMKT), ổ đĩa còn chỗ trống.');
  }
}

/** Cổng có đang bị chiếm không; nếu là chính Auto Post MKT thì nói rõ. `probe` để test thay việc hỏi /api/health. */
export async function checkPort(port: number, probeHealth: (port: number) => Promise<boolean> = defaultProbe): Promise<Check> {
  const free = await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)));
  });
  if (free) return pass('port', `Cổng ${port} còn trống.`);
  return (await probeHealth(port))
    ? failed('port', 'error', `Auto Post MKT đã đang chạy ở cổng ${port}.`, `Mở http://127.0.0.1:${port}/ trên trình duyệt, hoặc đóng cửa sổ đang chạy rồi khởi động lại.`)
    : failed('port', 'error', `Cổng ${port} đang bị chương trình khác dùng.`, 'Đóng chương trình đó, hoặc đặt APM_SERVER_PORT sang cổng khác (ví dụ 4318) trong file .env.');
}

async function defaultProbe(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok && ((await response.json()) as { status?: string }).status === 'ok';
  } catch {
    return false;
  }
}

/** Các vị trí cài Edge thông thường trên Windows, suy từ biến môi trường (không đường dẫn cứng). */
export function edgeCandidates(env: Record<string, string | undefined>): string[] {
  return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
    .filter((base): base is string => Boolean(base))
    .map((base) => join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
}

export function checkEdge(env: Record<string, string | undefined>, exists: (path: string) => boolean = existsSync): Check {
  return edgeCandidates(env).some(exists)
    ? pass('browser', 'Đã có trình duyệt Microsoft Edge.')
    : failed('browser', 'warn', 'Không tìm thấy Microsoft Edge.', 'Cài Microsoft Edge để dùng đăng nhập/đăng bài; ứng dụng vẫn mở được nhưng không điều khiển trình duyệt.');
}

export interface PreflightInput {
  rootDir: string;
  distDir: string;
  dataDir: string;
  port: number;
  nodeVersion: string;
  nodeRange: string;
  env: Record<string, string | undefined>;
  /** true khi worker sẽ mở trình duyệt (APM_BROWSER=real). */
  wantBrowser: boolean;
  workerRunning: () => boolean;
  probeHealth?: (port: number) => Promise<boolean>;
}

export async function runPreflight(input: PreflightInput): Promise<Check[]> {
  const checks: Check[] = [checkNode(input.nodeVersion, input.nodeRange), checkDependencies(input.rootDir), checkWebBuilt(input.distDir), checkDataDir(input.dataDir)];
  if (input.wantBrowser) checks.push(checkEdge(input.env));
  checks.push(await checkPort(input.port, input.probeHealth));
  checks.push(input.workerRunning()
    ? failed('worker', 'error', 'Đã có một worker đang chạy với thư mục dữ liệu này.', 'Đóng cửa sổ Auto Post MKT đang mở trước khi khởi động bản mới.')
    : pass('worker', 'Chưa có worker nào đang chạy.'));
  return checks;
}
