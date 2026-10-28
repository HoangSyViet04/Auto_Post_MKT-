/**
 * Kết nối một fanpage qua Graph API: npm run page:connect [-- --dry-run] [--page-id <ID>] [--app-id <ID>] [--yes]
 *
 * Bạn nhập App Secret và token NGAY TRONG cửa sổ lệnh này (không hiện ký tự, chỉ hiện dấu *; không vào lịch sử, không qua chat/Git).
 * Lệnh chỉ ĐỌC từ Meta, không đăng gì. App Secret và token người dùng không được lưu; chỉ Page token của Page bạn chọn được mã hóa
 * theo Windows và lưu vào kho bí mật. `--dry-run`: liệt kê và kiểm tra nhưng không lưu gì.
 *
 * Cách thay thế khi khó nhập trong terminal: đặt tạm APM_META_APP_SECRET và APM_META_USER_TOKEN trong file .env (đã nằm trong .gitignore).
 * Lệnh đọc hai giá trị đó, không in ra, và TỰ XÓA hai dòng khỏi .env sau khi lưu thành công. `--yes` bỏ bước hỏi xác nhận nơi lưu.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { getDataDir, getDatabasePath } from '#config';
import { applySecretChunk, type ConnectPrompt, connectPageFlow, createGraphClient, removeEnvKeys } from '#fb-page';
import { createPageRepository, createSecretStore, openDatabase } from '#storage';

const root = resolve(import.meta.dirname, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const ENV_SECRET_KEYS = ['APM_META_APP_SECRET', 'APM_META_USER_TOKEN'] as const;
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const say = (message: string) => process.stdout.write(`${message}\n`);
let usedEnv = false;

/** Đọc một dòng bí mật: chỉ hiện dấu *, không hiện nội dung. Chỉ chạy trong cửa sổ lệnh thật (không nhận từ tham số hay đường ống). */
function readHidden(label: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Cần chạy lệnh này trong cửa sổ lệnh (terminal) để nhập bí mật, hoặc đặt tạm APM_META_APP_SECRET và APM_META_USER_TOKEN trong .env.');
  }
  stdout.write(`${label}\n  (dán rồi nhấn Enter; mỗi ký tự hiện một dấu *): `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((done, cancel) => {
    let buffer = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) cancel(error);
      else { stdout.write(`  ✓ đã nhận ${buffer.length} ký tự (không hiển thị)\n`); done(buffer); }
    };
    const onData = (chunk: string) => {
      const before = buffer.length;
      const result = applySecretChunk(buffer, chunk);
      buffer = result.buffer;
      if (buffer.length > before) stdout.write('*'.repeat(buffer.length - before));
      else if (buffer.length < before) stdout.write('\b \b'.repeat(before - buffer.length));
      if (result.done === 'enter') finish();
      else if (result.done === 'cancel') finish(new Error('Đã hủy.'));
    };
    stdin.on('data', onData);
  });
}

const terminal: ConnectPrompt = {
  async text(label, defaultValue) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(`${label}${defaultValue ? ` [${defaultValue}]` : ''}: `)).trim() || defaultValue || ''; } finally { rl.close(); }
  },
  async secret(label) {
    const fromEnv = (label.startsWith('App Secret') ? process.env.APM_META_APP_SECRET : process.env.APM_META_USER_TOKEN)?.trim();
    if (fromEnv) {
      usedEnv = true;
      say(`${label.split(' (')[0]}: dùng giá trị trong .env (không hiển thị)`);
      return fromEnv;
    }
    return readHidden(label);
  },
  async choose(label, options) {
    for (const [position, option] of options.entries()) say(`  ${position + 1}. ${option}`);
    const answer = await terminal.text(`${label} (số, Enter để hủy)`);
    const index = Number(answer) - 1;
    return Number.isInteger(index) && index >= 0 && index < options.length ? index : -1;
  },
};

try {
  const dryRun = args.includes('--dry-run');
  const dataDir = getDataDir();
  say('Kết nối fanpage (chỉ đọc, không đăng gì).');
  say(dryRun ? 'Chế độ --dry-run: sẽ KHÔNG lưu gì.' : `Dữ liệu sẽ lưu trong: ${dataDir}`);

  let db: ReturnType<typeof openDatabase> | undefined;
  if (!dryRun) {
    if (!existsSync(getDatabasePath())) throw new Error('Chưa có cơ sở dữ liệu. Chạy ứng dụng một lần (Auto-Post-MKT.cmd) trước.');
    db = openDatabase(getDatabasePath());
  }
  const repository = db ? createPageRepository(db, { secrets: createSecretStore(db) }) : undefined;

  const appId = flag('--app-id') ?? process.env.APM_META_APP_ID;
  const pageId = flag('--page-id');
  const outcome = await connectPageFlow({
    graph: createGraphClient(),
    prompt: terminal,
    say,
    ...(repository ? { save: async (page) => {
      // Xác nhận nơi lưu trước khi ghi (tránh ghi nhầm chỗ). Bỏ bước này bằng --yes khi đã chắc chắn.
      if (!args.includes('--yes') && (await terminal.text(`Sẽ lưu token của "${page.name}" vào ${dataDir}. Gõ "co" để tiếp tục`)).toLowerCase() !== 'co') throw new Error('cancelled');
      const connected = await repository.connect({ pageId: page.id, name: page.name, token: page.accessToken, tasks: page.tasks });
      return { id: connected.pageId, name: connected.name ?? page.name, canPost: connected.canPost };
    } } : {}),
  }, { ...(appId ? { appId } : {}), ...(pageId ? { pageId } : {}) });
  db?.close();

  if (!outcome.ok) {
    say(`\nChưa hoàn tất: ${outcome.message}`);
    process.exitCode = 1;
  } else if (outcome.saved) {
    say(outcome.saved.canPost ? '\nXong. Page sẵn sàng cho bước đăng (chưa đăng gì).' : '\nĐã lưu nhưng Page này chưa có quyền đăng.');
    if (usedEnv && existsSync(envFile)) {
      const cleaned = removeEnvKeys(readFileSync(envFile, 'utf8'), ENV_SECRET_KEYS);
      writeFileSync(envFile, cleaned.content);
      say(`Đã xóa ${cleaned.removed} dòng bí mật khỏi .env (App Secret không còn nằm trên đĩa).`);
    }
  } else if (usedEnv) {
    say('\nChạy thử: các dòng bí mật vẫn còn trong .env. Xóa chúng sau khi xong việc.');
  }
} catch (error) {
  say(`Lỗi: ${error instanceof Error ? error.message : 'không rõ'}`);
  process.exitCode = 1;
}
