import cron from 'node-cron';
import mongoose from 'mongoose';
import { JobName, PAYROLL_TIMEZONE, runScheduledJob } from '../services/scheduledJobs.js';

/*
 * node-cron schedules inside the app. They are a backup: the host can pause the app when it is idle,
 * so the same jobs are also called by cPanel cron jobs over HTTP (POST /api/cron/<job>, see DEPLOY.md).
 * Both go through runScheduledJob, which lets only one run at a time and is safe to repeat.
 */
const fire = (name: JobName) => async () => {
    try {
        const outcome = await runScheduledJob(name, 'node-cron');
        if (!outcome.ran && name !== 'chat-reminders') console.log(`[jobs] ${name}: skipped, already running`);
    } catch (error) {
        console.error(`[jobs] ${name} failed:`, error);
    }
};

// 00:00 on the 1st of every month, in the payroll timezone (not the server's timezone).
export const createSalaryDocuments = cron.schedule('0 0 1 * *', fire('payroll'), { timezone: PAYROLL_TIMEZONE() });

// Catch-up: if the server was down at midnight on the 1st, create any missing records on the next start.
mongoose.connection.once('open', () => {
    void fire('payroll')();
});

// Every hour: chat attachments older than 48 hours.
export const cleanupMedia = cron.schedule('0 * * * *', fire('media-cleanup'));

// Every day at 00:30 Dubai: the owner's daily report (sent once per day, whichever run comes first).
export const ownerDailyReport = cron.schedule('30 0 * * *', fire('owner-report'), { timezone: 'Asia/Dubai' });

// Every minute: reminder emails for unread chat messages.
export const unreadChatReminders = cron.schedule('* * * * *', fire('chat-reminders'));
