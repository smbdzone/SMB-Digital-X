import mongoose, { Schema } from 'mongoose'
import { OwnerLogEntryData } from '../owner/signing.js'

/**
 * The owner's append-only history. Each entry holds the owner's complete signed request (so the server cannot
 * invent or edit an entry: the signature would not match), the time, what was done, a short result written by
 * the server, the hash of the previous entry and its own hash. The app only ever inserts; "Verify everything"
 * in the console and the daily report re-check the whole chain.
 */
const ownerLogSchema = new Schema<OwnerLogEntryData>({
    seq: { type: Number, required: true, unique: true },
    at: { type: String, required: true },          // ISO time, kept as the exact string that was hashed
    action: { type: String, required: true },
    recordId: { type: String, default: null },
    request: {
        method: { type: String, required: true },
        path: { type: String, required: true },
        bodyHash: { type: String, required: true },
        ts: { type: Number, required: true },
        nonce: { type: String, required: true },
        sig: { type: String, required: true },
    },
    result: { type: String, default: null },        // JSON text written by the server (a claim, not signed)
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
}, { versionKey: false, collection: 'ownerlogs' })

export default mongoose.model<OwnerLogEntryData>('OwnerLog', ownerLogSchema)
