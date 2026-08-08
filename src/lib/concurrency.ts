/**
 * Run independent async work with a hard concurrency ceiling.
 *
 * The shared cursor is safe here because JavaScript advances it synchronously
 * before each worker awaits. Invalid limits degrade to one worker instead of
 * accidentally creating an unbounded fan-out.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const normalizedConcurrency = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 1;
  const workerCount = Math.min(items.length, normalizedConcurrency);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index]!, index);
      }
    }),
  );
}
