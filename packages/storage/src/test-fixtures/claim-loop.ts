/**
 * Tiến trình con cho db.test.ts: liên tục nhận job 'queued' bằng UPDATE có điều kiện.
 * Tham số: <dbPath> <workerId> <startAtEpochMs>. In ra JSON danh sách id đã nhận.
 */
import { openDatabase } from '../db.ts';

const [dbPath, workerId, startAt] = process.argv.slice(2);
if (!dbPath || !workerId || !startAt) throw new Error('Thiếu tham số');

const db = openDatabase(dbPath);
const next = db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1");
const claim = db.prepare("UPDATE jobs SET status = 'running', claimed_by = ? WHERE id = ? AND status = 'queued'");

// Các tiến trình bắt đầu cùng lúc để thật sự tranh nhau
while (Date.now() < Number(startAt));

const claimed: number[] = [];
for (let row = next.get(); row; row = next.get()) {
  const id = Number(row.id);
  if (Number(claim.run(workerId, id).changes) === 1) claimed.push(id);
}
db.close();
process.stdout.write(JSON.stringify(claimed));
