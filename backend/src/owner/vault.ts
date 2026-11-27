import OwnerLog from '../model/ownerLog.model.js'

/*
 * Locked values (Phase 2). The server never has the vault key: it only recognises the format, checks the version, and
 * refuses plain values where a locked one is required. The console (owner-console/src/vault.js) locks and unlocks.
 * Keep the two in step; the tests run the same examples through both.
 *
 * Format (version 1), one line of text:
 *   SMBV1.<IV>.<CIPHERTEXT>
 *     IV          12 random bytes, fresh for every value, base64url without padding (16 characters)
 *     CIPHERTEXT  AES-256-GCM output (ciphertext followed by the 16-byte tag), base64url without padding
 *   key        the owner's vault key (created at setup, locked by the passphrase and by the recovery key)
 *   plaintext  canonical JSON of the value (numbers come back exactly)
 *   associated data (binds the value to its place; a value moved anywhere else fails to unlock):
 *     "SMB-VAULT-1\n<collection>\n<record id>\n<field>"
 *     record fields:   projects/<id>/budget, milestones/<id>/paymentPercentage, milestones/<id>/paymentAmount
 *     history bodies:  ownerlogs/<the entry's one-time request code (nonce)>/body
 */
export const VAULT_PREFIX = 'SMBV1.'
const LOCKED_RE = /^SMBV1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/
export const MAX_LOCKED_LENGTH = 8 * 1024 * 1024

export const isLocked = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_LOCKED_LENGTH && LOCKED_RE.test(v)
/** Looks like a locked value of any version (used to give a clear "unknown version" message). */
export const looksLocked = (v: unknown) => typeof v === 'string' && /^SMBV\d+\./.test(v)

/** The fields that hold locked values once locking has started. */
export const LOCKED_FIELDS = { projects: ['budget'], milestones: ['paymentPercentage', 'paymentAmount'] } as const
export type LockedType = keyof typeof LOCKED_FIELDS
export const isLockedType = (t: string): t is LockedType => t in LOCKED_FIELDS

/** True when every locked field of the state holds a locked value. */
export const stateIsLocked = (type: LockedType, state: any) => LOCKED_FIELDS[type].every(f => isLocked(state?.[f]))
/** True when some locked field holds a plain number other than 0 (0 = "not set yet", allowed and revealing nothing). */
export const stateHasPlainMoney = (type: LockedType, state: any) => LOCKED_FIELDS[type].some(f => typeof state?.[f] === 'number' && state[f] !== 0)

/* ------------------------------------------------------------------ */
/* Has locking started / finished? Read from the signed history only.  */
/* ------------------------------------------------------------------ */

// Not a setting in the database (someone could flip it back): the history entry of the signed start request.
// Removing the entry would break the chain, which "Verify everything" and the daily report catch; the console also
// remembers on the laptop that locking started and never sends plain bodies again.
export const VAULT_START_PATH = '/api/owner/vault/start'
export const VAULT_FINISH_PATH = '/api/owner/vault/finish'

export const vaultStarted = async () =>
    !!(await OwnerLog.exists({ action: 'vault.start', 'request.path': VAULT_START_PATH, 'request.method': 'POST' }))
export const vaultFinished = async () =>
    !!(await OwnerLog.exists({ action: 'vault.finish', 'request.path': VAULT_FINISH_PATH, 'request.method': 'POST' }))
