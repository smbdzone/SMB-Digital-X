/**
 * Server side of the Owner Console signatures. Same formats as owner-console/src/crypto.js (keep in step):
 * - request: "SMB-OWNER-1\n<METHOD>\n<path?query>\n<sha256 hex of the body bytes>\n<ts ms>\n<nonce>", ECDSA P-256 / SHA-256, raw r||s
 * - history entry hash: SHA-256 over the fields joined by "\n" in a fixed order (entryHashInput)
 * The server never holds the owner's private key; it only checks signatures against the stored public key.
 */
import crypto from 'node:crypto'

export const VERSION_TAG = 'SMB-OWNER-1'
export const GENESIS = '0'.repeat(64)
const subtle = crypto.webcrypto.subtle
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

export interface SignedRequest {
    method: string
    path: string
    bodyHash: string
    ts: number
    nonce: string
    sig: string
}

export interface OwnerLogEntryData {
    seq: number
    at: string
    action: string
    recordId?: string | null
    request: SignedRequest
    result?: string | null
    prevHash: string
    hash?: string
    body?: string | null      // exact signed body (owner actions); verified against request.bodyHash, not part of the entry hash
}

export const sha256Hex = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex')

export const canonicalRequest = (r: Omit<SignedRequest, 'sig'>) =>
    [VERSION_TAG, r.method.toUpperCase(), r.path, r.bodyHash, String(r.ts), r.nonce].join('\n')

type PublicKey = crypto.webcrypto.CryptoKey
const keyCache = new Map<string, PublicKey>()
export const importPublicKey = async (spkiB64: string): Promise<PublicKey> => {
    let key = keyCache.get(spkiB64)
    if (!key) {
        key = await subtle.importKey('spki', Buffer.from(spkiB64, 'base64'), ECDSA, false, ['verify'])
        keyCache.set(spkiB64, key)
    }
    return key
}

export const verifyRequestSignature = async (publicKeySpkiB64: string, r: SignedRequest): Promise<boolean> => {
    try {
        const key = await importPublicKey(publicKeySpkiB64)
        return await subtle.verify(SIGN, key, Buffer.from(r.sig, 'base64'), Buffer.from(canonicalRequest(r), 'utf8'))
    } catch {
        return false
    }
}

/** First 16 bytes of SHA-256 of the public key, as 8 groups of 4 hex digits (as the console shows it). */
export const fingerprint = (publicKeySpkiB64: string) =>
    crypto.createHash('sha256').update(Buffer.from(publicKeySpkiB64, 'base64')).digest('hex').slice(0, 32).toUpperCase().match(/.{4}/g)!.join(' ')

export const shortHash = (hex: string) => hex.slice(0, 16).toUpperCase().match(/.{4}/g)!.join(' ')

export const entryHashInput = (e: OwnerLogEntryData) => [
    VERSION_TAG, String(e.seq), e.at, e.action, e.recordId ?? '',
    e.request.method, e.request.path, e.request.bodyHash, String(e.request.ts), e.request.nonce, e.request.sig,
    e.result ?? '', e.prevHash,
].join('\n')

export const entryHash = (e: OwnerLogEntryData) => sha256Hex(entryHashInput(e))

export interface ChainCheck {
    ok: boolean
    count: number
    head: string
    problems: { seq: number; problem: string }[]
}

/** The same check the console's "Verify everything" runs, for the daily report. */
export const verifyChain = async (entries: OwnerLogEntryData[], publicKeySpkiB64: string): Promise<ChainCheck> => {
    const problems: ChainCheck['problems'] = []
    const nonces = new Set<string>()
    let prev = GENESIS
    const sorted = [...entries].sort((a, b) => a.seq - b.seq)
    for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i]
        if (e.seq !== i + 1) problems.push({ seq: e.seq, problem: `entry number ${e.seq} found where ${i + 1} was expected (an entry is missing or was added)` })
        if (e.prevHash !== prev) problems.push({ seq: e.seq, problem: 'does not link to the entry before it (an earlier entry was changed, removed or reordered)' })
        if (entryHash(e) !== e.hash) problems.push({ seq: e.seq, problem: 'its content was changed after it was written (hash mismatch)' })
        if (!(await verifyRequestSignature(publicKeySpkiB64, e.request))) problems.push({ seq: e.seq, problem: 'the owner signature does not match (forged or edited)' })
        if (nonces.has(e.request.nonce)) problems.push({ seq: e.seq, problem: 'repeats the one-time code of another entry (replayed)' })
        nonces.add(e.request.nonce)
        prev = e.hash ?? ''
    }
    return { ok: problems.length === 0, count: sorted.length, head: prev, problems }
}
