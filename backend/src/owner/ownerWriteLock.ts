import crypto from 'node:crypto'
import os from 'node:os'
import { Response } from 'express'
import mongoose, { Schema } from 'mongoose'
import { AppError } from '../utils/http.js'

/*
 * State-changing owner requests run one at a time, across every backend process on this database (cPanel/Passenger
 * may run several). Each writes its records and then its history entry before the next one starts; otherwise two
 * signed edits of the same record could interleave (A writes, B writes, B logs, A logs) and the history's latest entry
 * would no longer match what is stored.
 *
 * Same pattern as the jobruns lock (services/jobRunner.ts): one document, taken in one atomic step only when nobody
 * holds a valid lease. The lease is short and renewed while the request runs, so a process that dies while holding it
 * blocks owner actions for at most LEASE_MS. Reads do not take it.
 */
interface IOwnerLock {
    _id: string
    lockedUntil: Date | null
    lockedBy?: string          // host:pid:random, so a stuck lock can be traced to its process
    lockedAt?: Date
    action?: string            // method and path, for the same reason
}

const ownerLockSchema = new Schema<IOwnerLock>({
    _id: { type: String },
    lockedUntil: { type: Date, default: null },
    lockedBy: String,
    lockedAt: Date,
    action: String,
}, { versionKey: false, collection: 'ownerlocks' })

const OwnerLock = (mongoose.models.OwnerLock as mongoose.Model<IOwnerLock>) || mongoose.model<IOwnerLock>('OwnerLock', ownerLockSchema)

const LOCK_ID = 'owner-write'
export const OWNER_LOCK_LEASE_MS = 30_000     // a dead process blocks owner actions for at most this long
const RENEW_MS = 10_000                        // renewed while the request runs (bulk letters may take a while)
export const OWNER_LOCK_WAIT_MS = 20_000      // how long a request waits for its turn before answering 503
export const OWNER_BUSY = 'Another owner action is in progress, try again'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** One atomic attempt: true when this token now holds the lock. */
const tryTake = async (token: string, action: string): Promise<boolean> => {
    const now = new Date()
    try {
        // Matches only when the lock is free or its lease ran out. When it is held, the upsert tries to insert the
        // same _id and fails with a duplicate key error.
        await OwnerLock.findOneAndUpdate(
            { _id: LOCK_ID, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
            { $set: { lockedUntil: new Date(now.getTime() + OWNER_LOCK_LEASE_MS), lockedBy: token, lockedAt: now, action } },
            { upsert: true },
        )
        return true
    } catch (error) {
        if ((error as { code?: number })?.code === 11000) return false
        throw error
    }
}

/**
 * Waits for the owner write lock (up to OWNER_LOCK_WAIT_MS, then 503) and holds it for this response.
 * Released as soon as the response is sent, which is after the history entry (and the seal numbers) are written.
 * If the client goes away before that, the handler may still be running: renewal stops and the lease runs out.
 */
export const takeOwnerWriteLock = async (res: Response, action: string): Promise<void> => {
    const token = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`
    const deadline = Date.now() + OWNER_LOCK_WAIT_MS
    let pause = 20
    while (!(await tryTake(token, action))) {
        const left = deadline - Date.now()
        if (left <= 0) throw new AppError(503, OWNER_BUSY)
        await sleep(Math.min(left, pause * (0.5 + Math.random())))
        pause = Math.min(pause * 2, 400)
    }

    const renew = setInterval(() => {
        OwnerLock.updateOne({ _id: LOCK_ID, lockedBy: token }, { $set: { lockedUntil: new Date(Date.now() + OWNER_LOCK_LEASE_MS) } })
            .catch(error => console.error('[owner] could not renew the owner write lock', error))
    }, RENEW_MS)
    renew.unref()

    let done = false
    const release = () => {
        if (done) return
        done = true
        clearInterval(renew)
        OwnerLock.updateOne({ _id: LOCK_ID, lockedBy: token }, { $set: { lockedUntil: null }, $unset: { lockedBy: '', lockedAt: '', action: '' } })
            .catch(error => console.error('[owner] could not release the owner write lock (its lease will expire)', error))
    }
    const abandon = () => { if (!done) { done = true; clearInterval(renew) } }
    res.once('finish', release)
    res.once('close', () => (res.writableFinished ? release() : abandon()))
}
