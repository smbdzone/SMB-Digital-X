import { Router } from 'express';
import { requireCronSecret } from '../middlewares/cronAuth.js';
import { isJobName, runScheduledJob } from '../services/scheduledJobs.js';
import { notFound } from '../utils/http.js';

/*
 * Scheduled jobs over HTTP, for cPanel cron jobs (the host may pause the app, so node-cron alone can miss runs).
 *   POST /api/cron/payroll | /api/cron/media-cleanup | /api/cron/chat-reminders   with header X-Cron-Secret
 * 200 { ran: true, result } when the job ran; 200 { ran: false, reason: 'already running' } when another run
 * holds the lock; 401 without the right secret; 404 for an unknown job; 500 if the job failed.
 * The cPanel lines are in DEPLOY.md.
 */
const router = Router();

router.post('/:job', requireCronSecret, async (req, res) => {
    const job = req.params.job;
    if (!isJobName(job)) throw notFound('Unknown job');
    const started = Date.now();
    const outcome = await runScheduledJob(job, 'http');
    res.status(200).json({ success: true, job, ...outcome, durationMs: Date.now() - started });
});

export default router;
