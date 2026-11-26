import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const MIN_SECRET_LENGTH = 24;
let warnedWeak = false;

const digest = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * Lets a request through only with the header `X-Cron-Secret: <CRON_SECRET>`. Compared in constant time
 * (both sides are hashed first, so the length of the secret does not leak either). While CRON_SECRET is
 * unset or shorter than 24 characters, every request is refused: the endpoints are off.
 */
export const requireCronSecret = (req: Request, res: Response, next: NextFunction): void => {
    const secret = process.env.CRON_SECRET ?? '';
    const given = req.get('x-cron-secret') ?? '';

    if (secret.length < MIN_SECRET_LENGTH) {
        if (!warnedWeak) {
            console.warn(`[cron] CRON_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters: the /api/cron endpoints refuse every request`);
            warnedWeak = true;
        }
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }

    const matches = crypto.timingSafeEqual(digest(given), digest(secret));
    if (!given || !matches) {
        console.warn(`[cron] refused ${req.method} ${req.originalUrl} from ${req.ip ?? 'unknown'} (missing or wrong secret)`);
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }
    next();
};
