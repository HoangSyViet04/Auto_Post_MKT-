import sharp from 'sharp';
import { getAppEnv, getIntegrationMode } from '#config';
import type { createTestWorkspace } from '../helpers/workspace.ts';
import { publishingFixture } from './publishing-data.ts';

/** Small real image + fictitious account/group/product/approval, never a live integration. */
export async function seedOfflineScenario(workspace: ReturnType<typeof createTestWorkspace>) {
  if (getAppEnv() !== 'test' || getIntegrationMode() !== 'fake') throw new Error('Test fixtures require test/fake mode');
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer();
  const image = await workspace.media.importBytes(bytes);
  return { ...publishingFixture(workspace.db, { mediaIds: [image.id] }), image };
}
