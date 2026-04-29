/**
 * Retry helper: exponential backoff with optional Retry-After honoring.
 *
 * Callers wrap an async fn that performs a single attempt. When the fn throws,
 * we decide whether to retry based on `shouldRetry`. If the thrown error has
 * a numeric `retryAfterMs` (parsed by the caller from a Retry-After header),
 * we wait at least that long before the next attempt; otherwise we use
 * exponential backoff with jitter, capped at `maxDelayMs`.
 *
 * Errors intended for retry-control should carry the HTTP status code on
 * `err.statusCode` so the default policy can distinguish transient (429, 5xx,
 * network) from permanent (4xx other than 429).
 */

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

function defaultShouldRetry(err) {
  if (!err) return false;
  if (err.code && RETRYABLE_NETWORK_CODES.has(err.code)) return true;
  if (typeof err.statusCode === 'number') {
    if (err.statusCode === 408 || err.statusCode === 429) return true;
    if (err.statusCode >= 500 && err.statusCode <= 599) return true;
    return false;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {(attempt: number) => Promise<any>} fn — one attempt
 * @param {object} opts
 * @param {number} [opts.maxAttempts=5]
 * @param {number} [opts.baseDelayMs=500]
 * @param {number} [opts.maxDelayMs=30000]
 * @param {(err: Error, attempt: number) => boolean} [opts.shouldRetry]
 * @param {(info: {attempt: number, delayMs: number, err: Error}) => void} [opts.onRetry]
 * @param {string} [opts.label] — prefix for default-onRetry log output
 */
async function retry(fn, opts = {}) {
  const {
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 30000,
    shouldRetry = defaultShouldRetry,
    onRetry,
    label = 'retry',
  } = opts;

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const backoffMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter = Math.floor(Math.random() * backoffMs * 0.25);
      const retryAfterMs = Number.isFinite(err && err.retryAfterMs) ? err.retryAfterMs : 0;
      const delayMs = Math.min(maxDelayMs, Math.max(retryAfterMs, backoffMs + jitter));
      if (onRetry) {
        onRetry({ attempt, delayMs, err });
      } else {
        const reason = err && (err.code || err.statusCode || err.message);
        console.warn(`  [${label}] attempt ${attempt}/${maxAttempts} failed (${reason}); retrying in ${delayMs}ms`);
      }
      await sleep(delayMs);
    }
  }
}

/**
 * Parse Retry-After (seconds or HTTP date) to milliseconds. Returns 0 if
 * missing or unparseable.
 */
function parseRetryAfter(headerValue) {
  if (!headerValue) return 0;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000);
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return 0;
}

module.exports = { retry, defaultShouldRetry, parseRetryAfter };
