import messageModel from '../model/message.model.js'
import { deleteFromCloudinary } from '../utils/cloudinary.js'
import { currentMonth, generateMonthlySalaries } from './salary.service.js'
import { sendUnreadChatReminders } from './chatReminder.service.js'
import { JobOutcome, runExclusive } from './jobRunner.js'

/**
 * The scheduled jobs. Each one can be started by node-cron inside the app (utils/cron-jobs.ts) and by a
 * cPanel cron job calling POST /api/cron/<job> (routes/cron.routes.ts), because the host may pause the
 * app when it is idle and node-cron then misses runs. Every job is safe to run twice, or at the same
 * moment from both places:
 * - a lock (services/jobRunner.ts) lets only one run at a time;
 * - and each job's writes are idempotent on their own as well (see each job).
 */

export const PAYROLL_TIMEZONE = () => process.env.PAYROLL_TIMEZONE || 'Asia/Dubai'
const MEDIA_MAX_AGE_MS = 48 * 60 * 60 * 1000

/** Salary records for the current month in the payroll timezone. Existing records are never touched. */
const payroll = async () => {
    const timeZone = PAYROLL_TIMEZONE()
    const month = currentMonth(timeZone)
    const result = await generateMonthlySalaries(month)
    const summary = { month, timeZone, created: result.created, alreadyExisted: result.alreadyExisted, skipped: result.skipped.length }
    console.log(`[payroll] ${month} (${timeZone}) -> created ${summary.created}, already existed ${summary.alreadyExisted}, skipped ${summary.skipped}`)
    return summary
}

/**
 * Deletes chat attachments older than 48 hours from Cloudinary and removes them from the messages.
 * Each message is claimed (its attachments emptied) in one atomic update before its files are deleted,
 * so two runs can never handle the same message.
 */
const mediaCleanup = async () => {
    const cutoff = new Date(Date.now() - MEDIA_MAX_AGE_MS)
    const filter = { 'attachments.0': { $exists: true }, createdAt: { $lt: cutoff } }
    let messages = 0, files = 0, failed = 0

    for await (const { _id } of messageModel.find(filter).select('_id').lean().cursor()) {
        const claimed = await messageModel.findOneAndUpdate(
            { _id, 'attachments.0': { $exists: true } },
            { $set: { attachments: [] } },
            { new: false, timestamps: false },   // must not move the chat in the list
        ).lean()
        if (!claimed) continue
        messages++
        for (const att of claimed.attachments ?? []) {
            try {
                await deleteFromCloudinary(att.public_id, att.resource_type as any)
                files++
            } catch (error) {
                failed++
                console.error(`[media-cleanup] could not delete ${att.public_id}:`, error instanceof Error ? error.message : error)
            }
        }
    }
    if (messages) console.log(`[media-cleanup] ${messages} message(s), ${files} file(s) deleted, ${failed} failed`)
    return { messages, files, failed }
}

export const JOBS = {
    payroll: { leaseMs: 15 * 60_000, run: (_previous: Date | null) => payroll() },
    'media-cleanup': { leaseMs: 30 * 60_000, run: (_previous: Date | null) => mediaCleanup() },
    // Catches up on every message that became due since the previous run (capped, see chatReminder.service.ts).
    'chat-reminders': { leaseMs: 10 * 60_000, run: (previous: Date | null) => sendUnreadChatReminders({ lastRunAt: previous }) },
} as const

export type JobName = keyof typeof JOBS
export const isJobName = (value: unknown): value is JobName => typeof value === 'string' && Object.hasOwn(JOBS, value)

export const runScheduledJob = (name: JobName, source: 'node-cron' | 'http'): Promise<JobOutcome<unknown>> =>
    runExclusive<unknown>(name, source, JOBS[name].leaseMs, previous => JOBS[name].run(previous))
