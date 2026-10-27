import { setTimeout } from 'node:timers/promises';
import { createJobRepository, openDatabase } from '#storage';

const [path, workerId, startAt] = process.argv.slice(2);
if (!path || !workerId || !startAt) throw new Error('Missing claim fixture arguments');
const db = openDatabase(path);
try {
  const repo = createJobRepository(db);
  await setTimeout(Math.max(0, Number(startAt) - Date.now()));
  const ids: string[] = [];
  for (let claim = repo.claimNext(workerId); claim; claim = repo.claimNext(workerId)) {
    ids.push(claim.jobId);
    repo.finish(claim, { outcome: 'failed', source: 'fake', reasonCode: 'media_invalid' });
    await setTimeout(2);
  }
  process.stdout.write(JSON.stringify(ids));
} finally { db.close(); }
