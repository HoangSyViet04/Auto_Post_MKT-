/**
 * Hỗ trợ nhập bí mật trong terminal và dọn .env. Logic thuần (không đụng terminal/đĩa) để kiểm thử được.
 * Không hàm nào ở đây ghi log hay in giá trị bí mật.
 */

// Chuỗi điều khiển terminal, ví dụ đánh dấu dán "\x1b[200~ ... \x1b[201~" của VS Code/Windows Terminal.
const ESCAPE_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'gu');

export type SecretKey = 'enter' | 'cancel' | null;

/**
 * Áp một đợt ký tự (từ chế độ raw của terminal) vào bộ đệm bí mật: bỏ chuỗi điều khiển, xử lý xóa lùi, Enter kết thúc, Ctrl+C hủy.
 * Ký tự điều khiển khác bị bỏ; không bao giờ để chuỗi điều khiển lọt vào bí mật.
 */
export function applySecretChunk(buffer: string, chunk: string): { buffer: string; done: SecretKey } {
  let next = buffer;
  for (const char of chunk.replace(ESCAPE_SEQUENCE, '')) {
    if (char === '\r' || char === '\n') return { buffer: next, done: 'enter' };
    if (char === '\u0003') return { buffer: next, done: 'cancel' };
    if (char === '\u007f' || char === '\b') next = next.slice(0, -1);
    else if (char >= ' ' && char !== '\u007f') next += char;
  }
  return { buffer: next, done: null };
}

/**
 * Bỏ các dòng `KHÓA=...` khỏi nội dung .env, giữ nguyên mọi dòng khác (kể cả chú thích và kiểu xuống dòng).
 * Trả số dòng đã bỏ để báo người dùng; không trả giá trị đã bỏ.
 */
export function removeEnvKeys(content: string, keys: readonly string[]): { content: string; removed: number } {
  const matchers = keys.map((key) => new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*=`, 'u'));
  let removed = 0;
  const kept = content.split(/(?<=\n)/u).filter((line) => {
    if (matchers.some((matcher) => matcher.test(line))) { removed += 1; return false; }
    return true;
  });
  return { content: kept.join(''), removed };
}
