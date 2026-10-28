/**
 * Cập nhật ứng dụng an toàn (P12.5). Thứ tự cố định và dừng ngay khi có gì bất thường; KHÔNG BAO GIỜ xóa dữ liệu vận hành, hồ sơ trình duyệt
 * hay ảnh, và không chạy lệnh phá hủy của git (reset/clean/checkout -f). Sao lưu đã kiểm tra mã băm được tạo TRƯỚC khi đổi bất cứ thứ gì.
 */
export interface CommandResult { code: number; out: string }

export interface UpdateDeps {
  /** true nếu worker hoặc server đang chạy với thư mục dữ liệu này. */
  isRunning(): Promise<boolean>;
  git(args: string[]): Promise<CommandResult>;
  /** Chạy một bước (npm ci, migrate, build); trả mã thoát. */
  run(step: 'install' | 'migrate' | 'build'): Promise<number>;
  /** Băm nội dung package-lock.json để biết có cần cài lại thư viện. */
  lockfileHash(): string;
  /** Tạo bản sao lưu vào thư mục `dir` rồi kiểm tra; trả danh sách vấn đề (rỗng = đạt). */
  backupAndVerify(dir: string): Promise<string[]>;
  backupDir(): string;
  log(message: string): void;
}

export type UpdateFailure = 'running' | 'dirty' | 'git_unavailable' | 'backup_failed' | 'pull_failed' | 'install_failed' | 'migrate_failed' | 'build_failed';

export interface UpdateResult {
  ok: boolean;
  failure?: UpdateFailure;
  previousCommit?: string;
  backupDir?: string;
  message: string;
}

/** Hướng dẫn quay về bản cũ: mã nguồn bằng git, dữ liệu bằng bản sao lưu đã kiểm tra (bản mới có thể đã nâng schema, bản cũ sẽ từ chối DB mới hơn). */
export function rollbackHelp(previousCommit: string | undefined, backupDir: string | undefined): string {
  const lines = ['Để quay về bản trước khi cập nhật:'];
  if (previousCommit) lines.push(`  1. git checkout ${previousCommit}`, '  2. npm ci');
  if (backupDir) lines.push(`  ${previousCommit ? '3' : '1'}. npm run restore -- "${backupDir}" --replace   (dữ liệu hiện tại được đổi tên, không bị xóa)`);
  return lines.join('\n');
}

export async function runUpdate(deps: UpdateDeps): Promise<UpdateResult> {
  const stop = (failure: UpdateFailure, message: string, extra: Partial<UpdateResult> = {}): UpdateResult => ({ ok: false, failure, message, ...extra });

  if (await deps.isRunning()) return stop('running', 'Ứng dụng đang chạy. Đóng cửa sổ Auto Post MKT (server và worker) rồi chạy lại cập nhật.');

  const status = await deps.git(['status', '--porcelain']);
  if (status.code !== 0) return stop('git_unavailable', 'Không chạy được git. Cài Git for Windows và chạy trong thư mục dự án.');
  if (status.out.trim() !== '') return stop('dirty', 'Mã nguồn có thay đổi chưa commit; cập nhật dừng để không ghi đè. Commit hoặc cất thay đổi trước.');
  const head = await deps.git(['rev-parse', 'HEAD']);
  if (head.code !== 0) return stop('git_unavailable', 'Không đọc được phiên bản hiện tại của mã nguồn.');
  const previousCommit = head.out.trim();

  const backupDir = deps.backupDir();
  deps.log(`Sao lưu trước khi cập nhật → ${backupDir}`);
  let problems: string[];
  try {
    problems = await deps.backupAndVerify(backupDir);
  } catch (error) {
    problems = [error instanceof Error ? error.message : 'lỗi không rõ'];
  }
  if (problems.length > 0) return stop('backup_failed', `Sao lưu không đạt nên CHƯA cập nhật gì: ${problems.join(' | ')}`, { previousCommit });
  deps.log('Sao lưu đạt (đã kiểm tra mã băm).');

  const failWith = (failure: UpdateFailure, what: string): UpdateResult =>
    stop(failure, `${what}\nDữ liệu của bạn vẫn còn nguyên; bản sao lưu: ${backupDir}\n${rollbackHelp(previousCommit, backupDir)}`, { previousCommit, backupDir });

  const lockBefore = deps.lockfileHash();
  deps.log('Tải bản mới (git pull --ff-only)…');
  const pull = await deps.git(['pull', '--ff-only']);
  if (pull.code !== 0) return stop('pull_failed', `Không tải được bản mới (${pull.out.trim().split('\n').pop() ?? 'lỗi git'}). Mã nguồn chưa đổi.\nBản sao lưu: ${backupDir}`, { previousCommit, backupDir });
  const now = await deps.git(['rev-parse', 'HEAD']);
  if (now.code === 0 && now.out.trim() === previousCommit) deps.log('Đã ở bản mới nhất.');

  if (deps.lockfileHash() !== lockBefore) {
    deps.log('Thư viện thay đổi → npm ci…');
    if ((await deps.run('install')) !== 0) return failWith('install_failed', 'Cài thư viện không thành công.');
  }
  deps.log('Nâng cấp cơ sở dữ liệu (migration)…');
  if ((await deps.run('migrate')) !== 0) return failWith('migrate_failed', 'Nâng cấp cơ sở dữ liệu không thành công (migration lỗi được hoàn tác từng file).');
  deps.log('Build giao diện…');
  if ((await deps.run('build')) !== 0) return failWith('build_failed', 'Build giao diện không thành công.');

  return { ok: true, previousCommit, backupDir, message: `Cập nhật xong. Bản sao lưu trước khi cập nhật: ${backupDir}\nHồ sơ trình duyệt (đăng nhập), ảnh và dữ liệu giữ nguyên.` };
}
