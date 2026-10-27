/** Explicit offline CLI only. Never imported into server/worker startup. */
import { getAppEnv, getIntegrationMode } from '#config';
import { CHANNELS, type Channel } from '#domain';
import { createLogger } from '#logging';
import { runOfflineScenario, SCENARIOS, type Scenario } from './scenarios.ts';

const usage = 'node spikes/run.ts --scenario=<published|pending_approval|unknown|stop|expired|checkpoint|ambiguous_selector> [--channel=profile|group|page] [--mode=fake]';
let log = createLogger({ env: 'production', name: 'spike-offline' });
try {
  log = createLogger({ env: getAppEnv(), name: 'spike-offline' });
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    log.info({ usage, simulated: true, realCapability: 'not_tested' }, 'Công cụ mô phỏng chủ động; không gọi Facebook.');
  } else {
    const values = new Map<string, string>();
    for (const arg of args) {
      const match = /^--(scenario|channel|mode)=(.+)$/.exec(arg);
      if (!match?.[1] || !match[2] || values.has(match[1])) throw new Error('Đối số không hợp lệ; chạy --help.');
      values.set(match[1], match[2]);
    }
    if (getIntegrationMode() !== 'fake' || (values.has('mode') && values.get('mode') !== 'fake')) {
      throw new Error('Công cụ offline chỉ chấp nhận chế độ fake.');
    }
    const scenario = values.get('scenario');
    const channel = values.get('channel') ?? 'group';
    if (!SCENARIOS.some((value) => value === scenario)) throw new Error('Cần chọn scenario hợp lệ; chạy --help.');
    if (!CHANNELS.some((value) => value === channel)) throw new Error('Kênh không hợp lệ; chạy --help.');
    const evidence = await runOfflineScenario(scenario as Scenario, channel as Channel);
    log.info({ evidence }, 'Hoàn tất mô phỏng offline; chưa kiểm chứng khả năng Facebook thật.');
  }
} catch {
  // Do not echo argv, env or raw errors; input may contain credentials pasted accidentally.
  log.error({ usage }, 'Không chạy mô phỏng: kiểm tra scenario/kênh hợp lệ và chế độ fake; không có thao tác thật.');
  process.exitCode = 2;
}
