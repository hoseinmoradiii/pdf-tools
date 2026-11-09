/**
 * Simple async semaphore: limits how many heavy tasks (PDF conversions,
 * watermark removal) run at once so concurrent uploads can't exhaust CPU
 * and memory by spawning unbounded Python/LibreOffice processes.
 */
export function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      // Wait for a slot; the slot is handed off without decrementing.
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
