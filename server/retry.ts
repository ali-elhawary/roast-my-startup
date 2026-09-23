// Small exponential-backoff helper for the cloud delivery pipeline (GCS uploads,
// signed-URL builds, SMTP sends). Retries a flaky async op a few times before
// giving up, so a transient network blip doesn't drop a founder's video.

export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  label?: string;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 30_000;
  const label = opts.label ?? 'retry';

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts) break;
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      console.error(
        `[${label}] attempt ${attempt}/${attempts} failed, retrying in ${delay}ms:`,
        err,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
