import mongoose, { Schema, Types } from 'mongoose'

/**
 * The Owner Console's keys, LOCKED. One document, _id 'owner'. Created once by the console's first-login setup
 * and never created again (the fixed _id makes a second setup a duplicate key: 409).
 *
 * Holds no secret the server could use: the passphrase, the recovery key and the unlocked keys never leave
 * the owner's laptop. What is here can only be unlocked with one of those two.
 */
export interface ILockedPair { iv: string; data: string }
export interface ILockedKeys { vault: ILockedPair; signing: ILockedPair }

export interface IOwnerKey {
    _id: string
    ownerUserId: Types.ObjectId
    salt: string                 // PBKDF2 salt (base64)
    iterations: number           // PBKDF2-SHA256 iterations
    byPassphrase: ILockedKeys    // keys locked by the passphrase-derived key
    recoverySalt: string         // HKDF salt for the recovery key (base64)
    byRecovery: ILockedKeys      // the same keys locked by the recovery-key-derived key
    publicKey: string            // ECDSA P-256 public key, SPKI (base64)
    fingerprint: string
    setupAt: Date
    passphraseChangedAt?: Date
}

const pair = { iv: { type: String, required: true }, data: { type: String, required: true } }
const locked = { vault: pair, signing: pair }

const ownerKeySchema = new Schema<IOwnerKey>({
    _id: { type: String },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'users', required: true },
    salt: { type: String, required: true },
    iterations: { type: Number, required: true },
    byPassphrase: locked,
    recoverySalt: { type: String, required: true },
    byRecovery: locked,
    publicKey: { type: String, required: true },
    fingerprint: { type: String, required: true },
    setupAt: { type: Date, required: true },
    passphraseChangedAt: Date,
}, { versionKey: false, collection: 'ownerkeys' })

export const OWNER_KEY_ID = 'owner'
export default mongoose.model<IOwnerKey>('OwnerKey', ownerKeySchema)
