import { NextFunction, Request, RequestHandler, Response } from 'express'

interface Options {
    windowMs: number
    max: number
    message?: string
    // What to count requests by. Default: the email in the body, else the IP address.
    key?: (req: Request) => string
}

/**
 * Small in-memory rate limiter (no extra npm package needed).
 *
 * It counts per email address rather than per IP on purpose: behind a proxy / load balancer
 * every visitor can share one IP, and an IP-based limit would then lock everybody out.
 * If you run several server instances, replace the Map with Redis.
 */
export const rateLimit = (options: Options): RequestHandler => {
    const hits = new Map<string, { count: number; resetAt: number }>()

    const timer = setInterval(() => {
        const now = Date.now()
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    }, 60_000)
    timer.unref()

    const keyOf = options.key ?? ((req: Request) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
        return email || req.ip || 'unknown'
    })

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = keyOf(req)
        const now = Date.now()
        const entry = hits.get(key)

        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + options.windowMs })
            next()
            return
        }

        entry.count += 1
        if (entry.count > options.max) {
            res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
            res.status(429).json({
                success: false,
                message: options.message ?? 'Too many requests. Please try again later.',
            })
            return
        }
        next()
    }
}

interface FailureOptions {
    windowMs: number
    max: number
    message?: string
}

/**
 * Limits FAILED attempts only (used for login). Keyed by email + IP together, so one person
 * mistyping on their phone does not lock the same email out on another network.
 *
 * - A request that ends in 4xx (wrong password, inactive account) counts as a failure.
 *   The first failure starts the window.
 * - 400 (missing or malformed body) never counts, and neither does a request without an email:
 *   it tested no password, so it must not move any email + IP counter or lock anyone out.
 * - A successful (2xx) request clears the counter for that email + IP.
 * - Server errors (5xx) and the limiter's own 429s do not count.
 * - After `max` failures inside the window, requests get 429 until the window ends.
 *
 * In memory like rateLimit above. Behind a reverse proxy, req.ip is the proxy's address unless
 * Express "trust proxy" is configured, and then this is effectively keyed by email alone.
 */
export const failedAttemptLimit = (options: FailureOptions): RequestHandler => {
    const failures = new Map<string, { count: number; resetAt: number }>()

    const timer = setInterval(() => {
        const now = Date.now()
        for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k)
    }, 60_000)
    timer.unref()

    const emailOf = (req: Request) => typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''

    return (req: Request, res: Response, next: NextFunction): void => {
        const email = emailOf(req)
        if (!email) {
            next()
            return
        }
        const key = `${email}|${req.ip ?? 'unknown'}`
        const now = Date.now()
        const entry = failures.get(key)
        if (entry && entry.resetAt <= now) failures.delete(key)

        const current = failures.get(key)
        if (current && current.count >= options.max) {
            res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)))
            res.status(429).json({
                success: false,
                message: options.message ?? 'Too many failed attempts. Please try again later.',
            })
            return
        }

        res.on('finish', () => {
            const status = res.statusCode
            if (status >= 200 && status < 300) {
                failures.delete(key)
            } else if (status > 400 && status < 500 && status !== 429) {
                const at = Date.now()
                const existing = failures.get(key)
                if (!existing || existing.resetAt <= at) failures.set(key, { count: 1, resetAt: at + options.windowMs })
                else existing.count += 1
            }
        })
        next()
    }
}
