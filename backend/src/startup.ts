type DatabaseWaitOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function waitForDatabase(
  check: () => Promise<unknown>,
  options: DatabaseWaitOptions = {},
): Promise<void> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 30));
  const delayMs = Math.max(0, options.delayMs ?? 1_000);
  const wait = options.sleep ?? sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }

  throw lastError;
}
