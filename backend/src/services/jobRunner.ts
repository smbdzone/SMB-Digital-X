import crypto from 'node:crypto'
import mongoose, { Schema } from 'mongoose'

/**
 * One document per scheduled job in the `jobruns` collection: a lease-style lock and the time of the last
 * successful run. The same job can be started by node-cron inside the app and by a cPanel cron job over
 * HTTP (see routes/cron.routes.ts); the lock makes sure only one of them runs it at a time, on one server
 * or several. A crashed run cannot block the job for ever: its lease simply expires.
 */
interface IJobRun {
    _id: string
    lockedUntil?: Date | null
    lockedBy?: string
    lastRunAt?: Date          // start time of the last run that finished without an error
    lastFinishedAt?: Date
    lastSource?: string       // 'node-cron' | 'http'
    lastResult?: unknown
    lastError?: string
}

const jobRunSchema = new Schema<IJobRun>({
    _id: { type: String },
    lockedUntil: { type: Date, default: null },
    lockedBy: String,
    lastRunAt: Date,
    lastFinishedAt: Date,
    lastSource: String,
    lastResult: Schema.Types.Mixed,
    lastError: String,
}, { versionKey: false, collection: 'jobruns' })

const JobRun = (mongoose.models.JobRun as mongoose.Model<IJobRun>) || mongoose.model<IJobRun>('JobRun', jobRunSchema)

export type JobOutcome<T> =
    | { ran: true; result: T; startedAt: Date; previousRunAt: Date | null }
    | { ran: false; reason: 'already running'; lockedUntil: Date | null }

/**
 * Runs `work` unless the same job is already running somewhere (then resolves with ran: false).
 * `work` receives the start time of the previous successful run, so a job can catch up on everything
 * that became due since then.
 */
export const runExclusive = async <T>(
    job: string,
    source: string,
    leaseMs: number,
    work: (previousRunAt: Date | null) => Promise<T>,
): Promise<JobOutcome<T>> => {
    const startedAt = new Date()
    const token = crypto.randomUUID()

    let previous: IJobRun | null
    try {
        // Take the lock in one atomic step: matches only when nobody holds a valid lease. When the document
        // exists and is locked, the upsert tries to insert the same _id and fails with a duplicate key error.
        previous = await JobRun.findOneAndUpdate(
            { _id: job, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: startedAt } }] },
            { $set: { lockedUntil: new Date(startedAt.getTime() + leaseMs), lockedBy: token } },
            { upsert: true, new: false },
        ).lean()
    } catch (error) {
        if ((error as { code?: number })?.code === 11000) {
            const current = await JobRun.findById(job).select('lockedUntil').lean()
            return { ran: false, reason: 'already running', lockedUntil: current?.lockedUntil ?? null }
        }
        throw error
    }

    try {
        const result = await work(previous?.lastRunAt ?? null)
        await JobRun.updateOne(
            { _id: job, lockedBy: token },
            { $set: { lockedUntil: null, lastRunAt: startedAt, lastFinishedAt: new Date(), lastSource: source, lastResult: result }, $unset: { lastError: '' } },
        )
        return { ran: true, result, startedAt, previousRunAt: previous?.lastRunAt ?? null }
    } catch (error) {
        // lastRunAt is NOT moved forward, so the next run catches up on this one too.
        await JobRun.updateOne(
            { _id: job, lockedBy: token },
            { $set: { lockedUntil: null, lastFinishedAt: new Date(), lastSource: source, lastError: error instanceof Error ? error.message : String(error) } },
        ).catch(() => undefined)
        throw error
    }
}
