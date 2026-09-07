/**
 * The crude per-instance throttle the LINE webhook introduced (M6), lifted
 * into one place so the Arrival form (M7.8) can reuse it. Deliberately
 * simple: a Map of windows per key, per server instance, never persisted.
 * It blunts a flood; it is not a security boundary — the webhook's HMAC and
 * the Arrival form's token, cap and write-only rule are.
 */
export function createRateLimiter(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function rateLimited(key: string, now = Date.now()): boolean {
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      // Opportunistic sweep so a long-running instance does not grow without
      // bound on one-off keys (every client address is one).
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
      }
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > options.max;
  };
}
