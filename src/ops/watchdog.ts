import { writeFile } from 'node:fs/promises';
import type { Logger } from '../logger.js';

const HEARTBEAT_PATH = '/tmp/podders-heartbeat';
const INTERVAL_MS = 60_000;

export function createWatchdog(log: Logger) {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function writeHeartbeat(): Promise<void> {
    try {
      await writeFile(HEARTBEAT_PATH, String(Date.now()));
    } catch (err: unknown) {
      log.error({ err }, 'watchdog: failed to write heartbeat');
    }
  }

  function start(): void {
    if (timer !== null) return;

    void writeHeartbeat();

    timer = setInterval(() => {
      void writeHeartbeat();
    }, INTERVAL_MS);
    timer.unref();

    log.info('watchdog: heartbeat started');
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      log.info('watchdog: heartbeat stopped');
    }
  }

  return { start, stop };
}
