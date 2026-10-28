/**
 * Kết nối một fanpage qua Graph API: npm run page:connect [-- --dry-run] [--page-id <ID>] [--app-id <ID>]
 *
 * Bạn nhập App Secret và token NGAY TRONG cửa sổ lệnh này (ký tự không hiện, không vào lịch sử, không qua chat/Git/file .env).
 * Lệnh chỉ ĐỌC từ Meta, không đăng gì. App Secret và token người dùng không được lưu; chỉ Page token của Page bạn chọn được mã hóa
 * theo Windows và lưu vào kho bí mật. `--dry-run`: liệt kê và kiểm tra nhưng không lưu gì.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { getDataDir, getDatabasePath } from '#config';
import { type ConnectPrompt, connectPageFlow, createGraphClient } from '#fb-page';
import { createPageRepository, createSecretStore, openDatabase } from '#storage';

const root = resolve(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const say = (message: string) => process.stdout.write(`${message}\n`);

/** Đọc một dòng bí mật: không hiện ký tự. Chỉ chạy trong cửa sổ lệnh thật (không nhận từ tham số, biến môi trường hay đường ống). */
function readHidden(label: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Cần chạy lệnh này trong cửa sổ lệnh (terminal) để nhập bí mật; không nhận bí mật qua tham số hay đường ống.');
  stdout.write(`${label}: `);
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
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Đã hủy.'));
        if (char === '\u007f' || char === '\b') buffer = buffer.slice(0, -1);
        else if (char >= ' ') buffer += char;
      }
    };
    stdin.on('data', onData);
  });
}

const terminal: ConnectPrompt = {
  async text(label, defaultValue) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(`${label}${defaultValue ? ` [${defaultValue}]` : ''}: `)).trim() || defaultValue || ''; } finally { rl.close(); }
  },
  secret: readHidden,
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
  const outcome = await connectPageFlow({
    graph: createGraphClient(),
    prompt: terminal,
    say,
    ...(repository ? { save: async (page) => {
      // Xác nhận nơi lưu trước khi ghi (ví dụ lúc đang chuyển thư mục dữ liệu, tránh ghi nhầm chỗ).
      if ((await terminal.text(`Sẽ lưu token của "${page.name}" vào ${dataDir}. Gõ "co" để tiếp tục`)).toLowerCase() !== 'co') throw new Error('cancelled');
      const connected = await repository.connect({ pageId: page.id, name: page.name, token: page.accessToken, tasks: page.tasks });
      return { id: connected.pageId, name: connected.name ?? page.name, canPost: connected.canPost };
    } } : {}),
  }, { ...(appId ? { appId } : {}), ...(flag('--page-id') ? { pageId: flag('--page-id') as string } : {}) });
  db?.close();

  if (!outcome.ok) { say(`\nChưa hoàn tất: ${outcome.message}`); process.exitCode = 1; }
  else if (outcome.saved) say(outcome.saved.canPost ? '\nXong. Page sẵn sàng cho bước đăng (chưa đăng gì).' : '\nĐã lưu nhưng Page này chưa có quyền đăng.');
} catch (error) {
  say(`Lỗi: ${error instanceof Error ? error.message : 'không rõ'}`);
  process.exitCode = 1;
}
