/** Thin fetch wrapper that turns non-2xx responses into readable errors. */
export const requestJson = async (url, { method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const detail = typeof data === 'string' ? data : JSON.stringify(data);
      throw new Error(`${method} ${url} failed (${response.status}): ${String(detail).slice(0, 500)}`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${method} ${url} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `check` until it reports done. Replaces the workflow's fixed "Wait" nodes,
 * which assumed every render finished in exactly 20 seconds.
 */
export const pollUntil = async (check, { initialDelayMs, intervalMs, timeoutMs, onTick }) => {
  const deadline = Date.now() + timeoutMs;
  await sleep(initialDelayMs);

  for (let attempt = 1; ; attempt += 1) {
    const result = await check(attempt);
    if (result.done) return result.value;
    if (result.failed) throw new Error(result.error || 'Remote job failed');
    if (Date.now() > deadline) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the render`);
    onTick?.(attempt, result);
    await sleep(intervalMs);
  }
};
