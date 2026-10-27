import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getAppEnv, getIntegrationMode } from '#config';
import { createMediaStore, migrate, openDatabase } from '#storage';

/** No production seeds. Every test gets a fresh managed directory and database. */
export function createTestWorkspace() {
  if (getAppEnv() !== 'test' || getIntegrationMode() !== 'fake') throw new Error('Test fixtures require test/fake mode');
  const dataDir = mkdtempSync(join(tmpdir(), 'apm thử nghiệm '));
  const db = openDatabase(join(dataDir, 'db/test.sqlite')); migrate(db);
  return {
    dataDir, db, media: createMediaStore(db, { dataDir }),
    dispose() {
      if (db.isOpen) db.close();
      if (dirname(dataDir) !== tmpdir()) throw new Error('Unsafe test cleanup path');
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
