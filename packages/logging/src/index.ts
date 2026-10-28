import pino, { type DestinationStream } from 'pino';
import pretty from 'pino-pretty';
import { type AppEnv, getLogLevel } from '#config';
import { redactSecrets } from './redact.ts';

export { redactSecrets, REDACTED } from './redact.ts';

export interface LoggerOptions {
  env: AppEnv;
  name: string;
  /** Injectable final output for tests; development pretty-prints, other envs use JSON. */
  destination?: DestinationStream;
}

export function createLogger({ env, name, destination }: LoggerOptions) {
  const output = destination ?? (env === 'development'
    ? pretty({ colorize: process.stdout.isTTY === true, sync: true, translateTime: 'SYS:standard' })
    : process.stdout);
  // Filter AFTER Pino serializes requests, Errors, format args, bindings and toJSON.
  // Nothing unfiltered reaches stdout or the pretty formatter.
  const safeDestination: DestinationStream = {
    write(line) {
      try {
        output.write(`${JSON.stringify(redactSecrets(JSON.parse(line)))}\n`);
      } catch {
        // Fail closed; never include the original line or exception in this fallback.
        output.write('{"level":50,"msg":"Log omitted: sanitization failed"}\n');
      }
    },
  };
  return pino({ name, level: getLogLevel() ?? (env === 'production' ? 'info' : 'debug') }, safeDestination);
}
