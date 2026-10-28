/**
 * Small in-memory rate limiter (no extra npm package needed).
 *
 * It counts per email address rather than per IP on purpose: behind a proxy / load balancer
 * every visitor can share one IP, and an IP-based limit would then lock everybody out.
 * If you run several server instances, replace the Map with Redis.
 */
export const rateLimit = (options) => {
    const hits = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits)
            if (v.resetAt <= now)
                hits.delete(k);
    }, 60_000);
    timer.unref();
    const keyOf = options.key ?? ((req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email || req.ip || 'unknown';
    });
    return (req, res, next) => {
        const key = keyOf(req);
        const now = Date.now();
        const entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + options.windowMs });
            next();
            return;
        }
        entry.count += 1;
        if (entry.count > options.max) {
            res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            res.status(429).json({
                success: false,
                message: options.message ?? 'Too many requests. Please try again later.',
            });
            return;
        }
        next();
    };
};
