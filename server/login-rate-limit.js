export function createLoginRateLimiter({ limit = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const failures = new Map();
  function current(key) {
    const item = failures.get(key);
    if (item && item.resetAt > now()) return item;
    failures.delete(key);
    return null;
  }
  return {
    isBlocked(key) { return (current(key)?.count ?? 0) >= limit; },
    recordFailure(key) {
      const item = current(key) ?? { count: 0, resetAt: now() + windowMs };
      item.count += 1;
      failures.set(key, item);
    },
    clear(key) { failures.delete(key); },
  };
}
