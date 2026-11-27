import mongoose from 'mongoose'
import OwnerLog from '../model/ownerLog.model.js'
import { AppError } from '../utils/http.js'

/*
 * The owner history is a hash chain numbered 1, 2, 3, ... Two requests at the same moment must never both get the same
 * number, or the chain forks and "Verify everything" reports it as broken. MongoDB's unique index on `seq` is what makes
 * the second insert fail (and retry with the next number), so it must exist before anything is appended:
 *   - it is created explicitly at startup (not left to Mongoose's background auto-indexing), and
 *   - it is checked before every owner request; without it every owner action is refused with 503.
 * If it is ever missing (dropped, or a restore without indexes), restarting the backend creates it again.
 */
const KEY = { seq: 1 } as const
const NAME = 'seq_1'

export const OWNER_LOG_UNPROTECTED =
    'The owner history is not protected right now (its unique index is missing), so owner actions are paused. ' +
    'The server administrator must restore it: restarting the backend creates it again.'

/** Creates the unique index on ownerlogs.seq. Called once the database is connected. Never throws. */
export const ensureOwnerLogIndex = async (): Promise<boolean> => {
    try {
        await OwnerLog.collection.createIndex(KEY, { unique: true, name: NAME })
        if (!(await hasUniqueSeqIndex())) throw new Error('the index was not found after creating it')
        console.log('[owner] owner history index (unique seq) confirmed')
        return true
    } catch (error) {
        console.error('[owner] ERROR: could not create the unique index on ownerlogs.seq. Owner actions are refused until it exists.', error)
        return false
    }
}

const hasUniqueSeqIndex = async (): Promise<boolean> => {
    try {
        const indexes = await OwnerLog.collection.indexes()
        return indexes.some(i => i.unique === true && JSON.stringify(i.key) === JSON.stringify(KEY))
    } catch (error) {
        if ((error as { codeName?: string })?.codeName === 'NamespaceNotFound') return false   // the collection itself is gone
        throw error
    }
}

/** Throws 503 (and logs an error) unless the unique index on ownerlogs.seq is confirmed right now. */
export const assertOwnerLogProtected = async (): Promise<void> => {
    let ok = false
    try {
        ok = await hasUniqueSeqIndex()
    } catch (error) {
        console.error('[owner] ERROR: could not read the indexes of ownerlogs.', error)
    }
    if (!ok) {
        console.error('[owner] ERROR: the unique index on ownerlogs.seq is missing. Owner action refused (503).')
        throw new AppError(503, OWNER_LOG_UNPROTECTED)
    }
}

// Create it as soon as the database is connected (the app connects once at startup).
if (mongoose.connection.readyState === 1) void ensureOwnerLogIndex()
else mongoose.connection.once('open', () => { void ensureOwnerLogIndex() })
