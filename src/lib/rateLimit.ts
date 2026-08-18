// Fixed-window rate limiter, in-process.
//
// Scope note: state lives in this process's memory, so limits are per-instance
// and reset on restart. That is the right trade-off for the single-user,
// single-process deployment this app targets. If you ever run multiple
// instances, move this to Redis or the SQLite database.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map can't grow without bound.
function sweep(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimit = { limit: number; windowMs: number };

export const LIMITS = {
  sync: { limit: 20, windowMs: 60 * 60 * 1000 },
  classify: { limit: 100, windowMs: 60 * 60 * 1000 },
  draft: { limit: 60, windowMs: 60 * 60 * 1000 },
  saveDraft: { limit: 100, windowMs: 60 * 60 * 1000 },
  send: { limit: 20, windowMs: 60 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RateLimit>;

/** Returns null when allowed, or the seconds to wait when the limit is hit. */
export function checkRateLimit(key: string, rule: RateLimit): number | null {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return null;
  }

  if (bucket.count >= rule.limit) {
    return Math.ceil((bucket.resetAt - now) / 1000);
  }

  bucket.count += 1;
  return null;
}
