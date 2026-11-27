import mongoose, { Schema } from 'mongoose'

/**
 * One-time values for the Owner Console:
 * - kind 'nonce': every signed request's nonce, kept a little longer than the ±2 minute window, so a captured
 *   request cannot be sent again;
 * - kind 'challenge': a login challenge the server handed out, usable once within 2 minutes.
 * MongoDB deletes each document after expiresAt (TTL index).
 */
interface IOwnerNonce {
    _id: string
    kind: 'nonce' | 'challenge'
    expiresAt: Date
}

const ownerNonceSchema = new Schema<IOwnerNonce>({
    _id: { type: String },
    kind: { type: String, enum: ['nonce', 'challenge'], required: true },
    expiresAt: { type: Date, required: true },
}, { versionKey: false, collection: 'ownernonces' })

ownerNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model<IOwnerNonce>('OwnerNonce', ownerNonceSchema)
