/*
 * Owner Console cryptography. Browser WebCrypto only (no libraries); the same file runs in Node 20+ for the tests,
 * and the backend implements the same request format (backend/src/owner/signing.ts): keep the two in step.
 *
 * Keys
 *   passphrase --PBKDF2-SHA256 (random 16-byte salt, 3,000,000 iterations)--> key-encryption key (AES-256-GCM)
 *   recovery key (160 random bits) --HKDF-SHA256 (own random salt)--> a second key-encryption key
 *   Each key-encryption key separately locks (AES-256-GCM, fresh 12-byte IV each time):
 *     - the vault key: random AES-256-GCM key for Phase 2 data
 *     - the signing key: ECDSA P-256 private key (PKCS#8)
 *   The server stores only salts, iteration count, the locked keys and the public key (SPKI).
 *
 * Requests
 *   Every owner request is signed (ECDSA P-256 / SHA-256, raw r||s signature) over
 *   "SMB-OWNER-1\n<METHOD>\n<path?query>\n<sha256 hex of the exact body bytes>\n<timestamp ms>\n<nonce>".
 */

export const VERSION_TAG = 'SMB-OWNER-1'
export const PBKDF2_ITERATIONS = 3_000_000
const subtle = globalThis.crypto.subtle
const enc = new TextEncoder()
const AAD_VAULT = enc.encode('SMB-OWNER vault key v1')
const AAD_SIGNING = enc.encode('SMB-OWNER signing key v1')
const HKDF_INFO = enc.encode('SMB-OWNER recovery v1')
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN = { name: 'ECDSA', hash: 'SHA-256' }

/* ------------------------------------------------------------------ */
/* Bytes and text                                                      */
/* ------------------------------------------------------------------ */

export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n))

export const toB64 = bytes => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    let s = ''
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
    return btoa(s)
}
export const fromB64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0))
export const toB64Url = bytes => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const toHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')

export const sha256 = async data => new Uint8Array(await subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data))
export const sha256Hex = async data => toHex(await sha256(data))

/** Overwrites a byte array (best effort: JavaScript cannot promise every copy is gone). */
export const wipe = bytes => { if (bytes && bytes.fill) bytes.fill(0) }

/* ------------------------------------------------------------------ */
/* Recovery key: 160 bits as 8 groups of 4 (Crockford base32)          */
/* ------------------------------------------------------------------ */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   // no I, L, O, U

export const makeRecoveryKey = () => {
    const bytes = randomBytes(20)
    let bits = 0, value = 0, out = ''
    for (const b of bytes) {
        value = (value << 8) | b
        bits += 8
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
    }
    return { bytes, text: out.match(/.{4}/g).join('-') }   // 32 characters = 160 bits exactly
}

/** Accepts the key as printed, with or without dashes or spaces, any case; O->0 and I/L->1 like Crockford. */
export const parseRecoveryKey = text => {
    const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
    if (!/^[0-9A-HJKMNP-TV-Z]{32}$/.test(clean)) throw new Error('A recovery key has 32 letters and digits (8 groups of 4).')
    const out = new Uint8Array(20)
    let bits = 0, value = 0, i = 0
    for (const ch of clean) {
        value = (value << 5) | B32.indexOf(ch)
        bits += 5
        if (bits >= 8) { out[i++] = (value >>> (bits - 8)) & 255; bits -= 8 }
    }
    return out
}
export const recoveryGroups = text => String(text).split('-')

/* ------------------------------------------------------------------ */
/* Key-encryption keys                                                 */
/* ------------------------------------------------------------------ */

export const kekFromPassphrase = async (passphrase, salt, iterations = PBKDF2_ITERATIONS) => {
    const material = await subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}

export const kekFromRecovery = async (recoveryBytes, salt) => {
    const material = await subtle.importKey('raw', recoveryBytes, 'HKDF', false, ['deriveKey'])
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO }, material, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}

/* ------------------------------------------------------------------ */
/* The owner's keys                                                    */
/* ------------------------------------------------------------------ */

/** New keys, extractable only so they can be locked right away. */
export const createKeys = async () => {
    const vaultKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const pair = await subtle.generateKey(ECDSA, true, ['sign', 'verify'])
    const publicKey = new Uint8Array(await subtle.exportKey('spki', pair.publicKey))
    return { vaultKey, signingKey: pair.privateKey, publicKey }
}

/** Locks both keys with one key-encryption key: { vault: {iv, data}, signing: {iv, data} } in base64. */
export const lockKeys = async (kek, keys) => {
    const vIv = randomBytes(12), sIv = randomBytes(12)
    const vault = await subtle.wrapKey('raw', keys.vaultKey, kek, { name: 'AES-GCM', iv: vIv, additionalData: AAD_VAULT })
    const signing = await subtle.wrapKey('pkcs8', keys.signingKey, kek, { name: 'AES-GCM', iv: sIv, additionalData: AAD_SIGNING })
    return { vault: { iv: toB64(vIv), data: toB64(vault) }, signing: { iv: toB64(sIv), data: toB64(signing) } }
}

/**
 * Unlocks both keys. A wrong passphrase or recovery key, or a changed blob, fails here (AES-GCM authentication).
 * extractable=false for normal use: page code can sign but can never read the keys out. Only "change passphrase"
 * asks for extractable copies, to lock them again, and drops them right after.
 */
export const unlockKeys = async (kek, locked, extractable = false) => {
    try {
        const vaultKey = await subtle.unwrapKey('raw', fromB64(locked.vault.data), kek,
            { name: 'AES-GCM', iv: fromB64(locked.vault.iv), additionalData: AAD_VAULT }, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt'])
        const signingKey = await subtle.unwrapKey('pkcs8', fromB64(locked.signing.data), kek,
            { name: 'AES-GCM', iv: fromB64(locked.signing.iv), additionalData: AAD_SIGNING }, ECDSA, extractable, ['sign'])
        return { vaultKey, signingKey }
    } catch {
        throw new Error('UNLOCK_FAILED')
    }
}

export const importPublicKey = spkiB64 => subtle.importKey('spki', fromB64(spkiB64), ECDSA, false, ['verify'])

/** Key fingerprint: first 16 bytes of SHA-256 of the public key, as 8 groups of 4 hex digits. */
export const fingerprint = async spki => {
    const digest = await sha256(typeof spki === 'string' ? fromB64(spki) : spki)
    return toHex(digest.subarray(0, 16)).toUpperCase().match(/.{4}/g).join(' ')
}

/** Checks that an unlocked signing key belongs to the given public key (sign + verify a test message). */
export const keyMatchesPublic = async (signingKey, spkiB64) => {
    const msg = enc.encode('key check ' + toHex(randomBytes(8)))
    const sig = await subtle.sign(SIGN, signingKey, msg)
    return subtle.verify(SIGN, await importPublicKey(spkiB64), sig, msg)
}

/* ------------------------------------------------------------------ */
/* Signed requests                                                     */
/* ------------------------------------------------------------------ */

export const canonicalRequest = ({ method, path, bodyHash, ts, nonce }) =>
    [VERSION_TAG, method.toUpperCase(), path, bodyHash, String(ts), nonce].join('\n')

/** Headers for one signed request. `body` is the exact string that will be sent ('' for none). */
export const signRequest = async (signingKey, { method, path, body = '', ts = Date.now(), nonce = toB64Url(randomBytes(16)) }) => {
    const bodyHash = await sha256Hex(body)
    const sig = await subtle.sign(SIGN, signingKey, enc.encode(canonicalRequest({ method, path, bodyHash, ts, nonce })))
    return { 'X-Owner-Ts': String(ts), 'X-Owner-Nonce': nonce, 'X-Owner-Sig': toB64(sig), bodyHash }
}

export const verifyRequestSignature = async (publicKey, { method, path, bodyHash, ts, nonce, sig }) => {
    try {
        return await subtle.verify(SIGN, publicKey, fromB64(sig), enc.encode(canonicalRequest({ method, path, bodyHash, ts, nonce })))
    } catch {
        return false
    }
}

/* ------------------------------------------------------------------ */
/* Owner history (hash chain)                                          */
/* ------------------------------------------------------------------ */

export const GENESIS = '0'.repeat(64)

/** What an entry's hash covers, in a fixed order. `result` is stored as a string, so its bytes never change. */
export const entryHashInput = e => [
    VERSION_TAG, String(e.seq), e.at, e.action, e.recordId ?? '',
    e.request.method, e.request.path, e.request.bodyHash, String(e.request.ts), e.request.nonce, e.request.sig,
    e.result ?? '', e.prevHash,
].join('\n')

export const entryHash = async e => sha256Hex(entryHashInput(e))

/**
 * Re-checks the whole history: numbering, every link, every hash, every owner signature, no nonce used twice.
 * Returns { ok, count, head, problems: [{ seq, problem }] }.
 */
export const verifyChain = async (entries, publicKeySpkiB64) => {
    const problems = []
    const publicKey = await importPublicKey(publicKeySpkiB64)
    const nonces = new Set()
    let prev = GENESIS
    const sorted = [...entries].sort((a, b) => a.seq - b.seq)
    for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i]
        if (e.seq !== i + 1) problems.push({ seq: e.seq, problem: `entry number ${e.seq} found where ${i + 1} was expected (an entry is missing or was added)` })
        if (e.prevHash !== prev) problems.push({ seq: e.seq, problem: 'does not link to the entry before it (an earlier entry was changed, removed or reordered)' })
        const h = await entryHash(e)
        if (h !== e.hash) problems.push({ seq: e.seq, problem: 'its content was changed after it was written (hash mismatch)' })
        if (!(await verifyRequestSignature(publicKey, e.request))) problems.push({ seq: e.seq, problem: 'the owner signature does not match (forged or edited)' })
        if (nonces.has(e.request.nonce)) problems.push({ seq: e.seq, problem: 'repeats the one-time code of another entry (replayed)' })
        nonces.add(e.request.nonce)
        prev = e.hash
    }
    return { ok: problems.length === 0, count: sorted.length, head: prev, problems }
}

/** Short form of the chain fingerprint for people to compare: "1A2B 3C4D 5E6F 7A8B". */
export const shortHash = hex => String(hex).slice(0, 16).toUpperCase().match(/.{4}/g).join(' ')

/* ------------------------------------------------------------------ */
/* Passphrase rules and suggestions                                    */
/* ------------------------------------------------------------------ */

export const MIN_CHARS = 20
export const MIN_WORDS = 5

const normalizePhrase = p => p.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** { ok, message, strength: 0-4 } for a typed passphrase. `common` = known phrases to refuse. */
export const checkPassphrase = (passphrase, common = []) => {
    const p = passphrase ?? ''
    const words = p.trim().split(/\s+/).filter(w => w.length >= 2)
    const long = p.length >= MIN_CHARS, manyWords = words.length >= MIN_WORDS
    const norm = normalizePhrase(p)
    const isCommon = norm && common.some(c => {
        const n = normalizePhrase(c)
        return n && (norm === n || norm.replace(/ /g, '') === n.replace(/ /g, '') || (n.length >= 12 && norm.includes(n)))
    })
    const unique = new Set(p.toLowerCase()).size
    const repetitive = p.length > 0 && (unique < 6 || /(.)\1{4,}/.test(p))
    let strength = 0
    if (p.length >= 12) strength++
    if (long || manyWords) strength++
    if (p.length >= 28 || words.length >= 6) strength++
    if (/[a-z]/i.test(p) && (/\d/.test(p) || /[^a-z0-9\s]/i.test(p) || words.length >= 5)) strength++
    if (isCommon || repetitive) strength = 0
    if (isCommon) return { ok: false, strength, message: 'This is a well-known phrase. Choose something nobody could guess.' }
    if (repetitive) return { ok: false, strength, message: 'Too repetitive. Use different words.' }
    if (!long && !manyWords) return { ok: false, strength, message: `Use at least ${MIN_CHARS} characters, or at least ${MIN_WORDS} words.` }
    return { ok: true, strength: Math.max(strength, 2), message: strength >= 3 ? 'Strong.' : 'Acceptable. Longer is stronger.' }
}

/** n words picked uniformly at random from `words` (rejection sampling, no bias). */
export const suggestPassphrase = (words, n = 5) => {
    const out = []
    const limit = Math.floor(0x100000000 / words.length) * words.length
    while (out.length < n) {
        const [x] = globalThis.crypto.getRandomValues(new Uint32Array(1))
        if (x < limit) out.push(words[x % words.length])
    }
    return out.join(' ')
}
