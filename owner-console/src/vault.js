/*
 * Locked values (Phase 2): field-level encryption with the owner's vault key. The server never has the key; it only
 * recognises the format (backend/src/owner/vault.ts): keep the two in step (the tests run the same examples).
 *
 * Format (version 1), one line of text:
 *   SMBV1.<IV>.<CIPHERTEXT>
 *     IV          12 random bytes, fresh for every value, base64url without padding (16 characters)
 *     CIPHERTEXT  AES-256-GCM output (ciphertext followed by the 16-byte tag), base64url without padding
 *   key        the vault key (created at setup, locked by the passphrase and by the recovery key)
 *   plaintext  canonical JSON of the value (numbers come back exactly; a history body is a JSON string)
 *   associated data, which binds the value to its place (moved anywhere else, it does not unlock):
 *     "SMB-VAULT-1\n<collection>\n<record id>\n<field>"
 *     record fields:   projects/<id>/budget, milestones/<id>/paymentPercentage, milestones/<id>/paymentAmount
 *     history bodies:  ownerlogs/<the entry's one-time request code (nonce)>/body
 */
import { randomBytes, toB64Url } from './crypto.js'

export const VAULT_VERSION = 1
export const VAULT_PREFIX = 'SMBV1.'
const LOCKED_RE = /^SMBV1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/
export const isLocked = v => typeof v === 'string' && LOCKED_RE.test(v)

/** The fields that hold locked values once locking has started. */
export const LOCKED_FIELDS = { projects: ['budget'], milestones: ['paymentPercentage', 'paymentAmount'] }
export const isLockedType = t => Object.prototype.hasOwnProperty.call(LOCKED_FIELDS, t)
/** Some locked field holds a plain number other than 0 (0 = "not set yet"). Same rule as the server. */
export const stateHasPlainMoney = (type, s) => LOCKED_FIELDS[type].some(f => typeof s?.[f] === 'number' && s[f] !== 0)

const vaultAad = ({ collection, id, field }) => new TextEncoder().encode(`SMB-VAULT-1\n${collection}\n${id}\n${field}`)
const vaultJson = v => (typeof v === 'number' ? JSON.stringify(v === 0 ? 0 : v) : JSON.stringify(v))
const b64UrlBytes = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

/** Locks one value for one place: { collection, id, field }. */
export const lockValue = async (vaultKey, place, value) => {
    if (!vaultKey) throw new Error('The vault key is not unlocked')
    const iv = randomBytes(12)
    const data = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: vaultAad(place) }, vaultKey, new TextEncoder().encode(vaultJson(value)))
    return `${VAULT_PREFIX}${toB64Url(iv)}.${toB64Url(data)}`
}

/** Unlocks one value. Throws VAULT_UNLOCK_FAILED when it was changed, moved to another place, or locked with another key. */
export const unlockValue = async (vaultKey, place, text) => {
    if (!isLocked(text)) throw new Error(/^SMBV\d+\./.test(String(text)) ? 'VAULT_UNKNOWN_VERSION' : 'VAULT_NOT_LOCKED')
    const [, iv, data] = text.split('.')
    let plain
    try {
        plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64UrlBytes(iv), additionalData: vaultAad(place) }, vaultKey, b64UrlBytes(data))
    } catch {
        throw new Error('VAULT_UNLOCK_FAILED')
    }
    return JSON.parse(new TextDecoder().decode(plain))
}

const placeOf = (key, field) => { const [collection, id] = key.split('/'); return { collection, id, field } }

/** A record state with its money fields locked (fields already locked stay as they are). */
export const lockState = async (vaultKey, key, state) => {
    const type = key.split('/')[0]
    if (!state || !isLockedType(type)) return state
    const out = { ...state }
    for (const f of LOCKED_FIELDS[type]) if (!isLocked(out[f])) out[f] = await lockValue(vaultKey, placeOf(key, f), out[f] ?? 0)
    return out
}

/** A record state with its money fields unlocked (plain fields stay as they are). Throws VAULT_UNLOCK_FAILED. */
export const unlockState = async (vaultKey, key, state) => {
    const type = key.split('/')[0]
    if (!state || !isLockedType(type)) return state
    const out = { ...state }
    for (const f of LOCKED_FIELDS[type]) if (isLocked(out[f])) out[f] = await unlockValue(vaultKey, placeOf(key, f), out[f])
    return out
}

/** Where a history entry's locked body belongs. */
export const bodyPlace = nonce => ({ collection: 'ownerlogs', id: nonce, field: 'body' })
