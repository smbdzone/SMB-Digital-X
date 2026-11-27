import { Request } from 'express'
import OwnerKey, { IOwnerKey, OWNER_KEY_ID } from '../model/ownerKey.model.js'
import OwnerLog from '../model/ownerLog.model.js'
import OwnerNonce from '../model/ownerNonce.model.js'
import { sendSystemMail } from '../email/email.js'
import { unauthorized } from '../utils/http.js'
import { assertOwnerLogProtected } from './ownerLogIndex.js'
import { GENESIS, OwnerLogEntryData, SignedRequest, entryHash, sha256Hex, verifyRequestSignature } from './signing.js'

export const MAX_CLOCK_SKEW_MS = 2 * 60_000
const NONCE_KEEP_MS = 5 * 60_000      // longer than the whole ±2 minute window
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/

/* ------------------------------------------------------------------ */
/* Signed requests                                                     */
/* ------------------------------------------------------------------ */

/** The exact bytes the console sent (owner routes keep the raw body; see owner.routes.ts). */
export const rawBodyOf = (req: Request): Buffer => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))

/*
 * Extra parts next to the signed text, sent with the header "X-Owner-Parts: 1" (or the older "X-Owner-Attachment: 1")
 * and the body
 *   { "signed": "<the exact signed JSON text>", "attachment"?: "<base64>", "inner"?: "<text>", "locked"?: ["<locked value>", ...] }
 * Only `signed` is hashed, checked against the signature and kept in the history. Each other part is covered by a
 * SHA-256 inside the signed text, which is compared before the part is used:
 *   attachment  the one-time signature image or a company logo (attachmentSha256 / signatureSha256); never stored
 *   inner       the plain request body of a Phase 2 request (inner.sha256 of the outer body, see ownerHttp.ts); not stored
 *   locked      locked history bodies being moved (lockedSha256 of each entry, see vault.routes.ts)
 */
interface OwnerParts { signed: Buffer; attachment?: Buffer; inner?: Buffer; locked?: string[] }
const partsOf = (req: Request): OwnerParts => {
    const cached = (req as any).ownerParts as OwnerParts | undefined
    if (cached) return cached
    const raw = rawBodyOf(req)
    let parts: OwnerParts = { signed: raw }
    if (req.get('x-owner-attachment') === '1' || req.get('x-owner-parts') === '1') {
        let outer: any
        try { outer = JSON.parse(raw.toString('utf8')) } catch { throw unauthorized('Malformed owner request') }
        const bad = typeof outer?.signed !== 'string'
            || (outer.attachment !== undefined && (typeof outer.attachment !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(outer.attachment)))
            || (outer.inner !== undefined && typeof outer.inner !== 'string')
            || (outer.locked !== undefined && (!Array.isArray(outer.locked) || outer.locked.some((x: unknown) => typeof x !== 'string')))
        if (bad) throw unauthorized('Malformed owner request')
        parts = {
            signed: Buffer.from(outer.signed, 'utf8'),
            ...(typeof outer.attachment === 'string' ? { attachment: Buffer.from(outer.attachment, 'base64') } : {}),
            ...(typeof outer.inner === 'string' ? { inner: Buffer.from(outer.inner, 'utf8') } : {}),
            ...(Array.isArray(outer.locked) ? { locked: outer.locked } : {}),
        }
        outer.attachment = ''; outer.inner = ''
    }
    ;(req as any).ownerParts = parts
    return parts
}
/** The signed body text (without any attachment). */
export const signedBodyOf = (req: Request): Buffer => partsOf(req).signed
/** The attachment, if one was sent. The caller checks it against attachmentSha256 in the signed body and wipes it. */
export const attachmentOf = (req: Request): Buffer | undefined => partsOf(req).attachment
/** The plain inner body of a Phase 2 request (checked in requireOwner before any route sees it). */
export const innerOf = (req: Request): Buffer | undefined => partsOf(req).inner
/** Locked history bodies sent with a "move old history" batch. */
export const lockedPartsOf = (req: Request): string[] => partsOf(req).locked ?? []
/** Overwrites the raw request body and the attachment (signature images must not stay in memory longer than needed). */
export const wipeOwnerRequest = (req: Request) => {
    const parts = (req as any).ownerParts as OwnerParts | undefined
    parts?.attachment?.fill(0)
    if (Buffer.isBuffer(req.body)) req.body.fill(0)
}

/**
 * Checks one signed owner request against `publicKeySpki` and uses up its nonce. No cookie, no session:
 * every request stands on its own. Throws 401 with the reason.
 */
export const checkSignedRequest = async (req: Request, publicKeySpki: string): Promise<SignedRequest> => {
    const tsText = req.get('x-owner-ts') ?? ''
    const nonce = req.get('x-owner-nonce') ?? ''
    const sig = req.get('x-owner-sig') ?? ''
    if (!tsText || !nonce || !sig) throw unauthorized('Missing owner signature')
    const ts = Number(tsText)
    if (!Number.isSafeInteger(ts) || !NONCE_RE.test(nonce) || sig.length > 200) throw unauthorized('Malformed owner signature')
    if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) throw unauthorized('The request time is more than 2 minutes off. Check the laptop clock and try again.')

    const request: SignedRequest = { method: req.method, path: req.originalUrl, bodyHash: sha256Hex(signedBodyOf(req)), ts, nonce, sig }
    if (!(await verifyRequestSignature(publicKeySpki, request))) throw unauthorized('The owner signature does not match')

    // Only now (signature good) is the nonce stored; storing it fails if it was used before.
    try {
        await OwnerNonce.create({ _id: nonce, kind: 'nonce', expiresAt: new Date(Date.now() + NONCE_KEEP_MS) })
    } catch (error) {
        if ((error as { code?: number })?.code === 11000) throw unauthorized('This request was already used')
        throw error
    }
    return request
}

export const getOwnerKey = () => OwnerKey.findById(OWNER_KEY_ID).lean<IOwnerKey>()

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/**
 * Appends one entry to the owner history (hash-chained). The unique index on `seq` (checked here, see ownerLogIndex.ts) makes a
 * concurrent writer that took the same number fail; it then reads the new head and takes the next number.
 */
const APPEND_ATTEMPTS = 50
export const appendOwnerLog = async (input: { action: string; recordId?: string | null; request: SignedRequest; result?: unknown; body?: string | null }): Promise<OwnerLogEntryData> => {
    await assertOwnerLogProtected()
    for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, Math.random() * Math.min(5 * attempt, 50)))   // spread out the retries
        const last = await OwnerLog.findOne().sort({ seq: -1 }).select('seq hash').lean()
        const entry: OwnerLogEntryData = {
            seq: (last?.seq ?? 0) + 1,
            at: new Date().toISOString(),
            action: input.action,
            recordId: input.recordId ?? null,
            request: input.request,
            result: input.result === undefined ? null : JSON.stringify(input.result),
            prevHash: last?.hash ?? GENESIS,
        }
        entry.hash = entryHash(entry)
        try {
            await OwnerLog.create({ ...entry, body: input.body ?? null })
            return entry
        } catch (error) {
            // Someone else took this number: read the new head and take the next one.
            if ((error as { code?: number; keyPattern?: Record<string, unknown> })?.code === 11000 && 'seq' in ((error as any).keyPattern ?? { seq: 1 })) continue
            throw error
        }
    }
    throw new Error('Could not append to the owner history')
}

export const ownerLogEntries = () =>
    OwnerLog.find().sort({ seq: 1 }).select('-_id').lean<OwnerLogEntryData[]>()

export const ownerLogHead = async () => {
    const last = await OwnerLog.findOne().sort({ seq: -1 }).select('seq hash').lean()
    return { count: last?.seq ?? 0, head: last?.hash ?? GENESIS }
}

/* ------------------------------------------------------------------ */
/* The owner's private email                                           */
/* ------------------------------------------------------------------ */

export const ownerReportAddress = () => (process.env.OWNER_REPORT_EMAIL ?? '').trim()

export const maskEmail = (email: string) => {
    const [user, domain = ''] = email.split('@')
    const [host, ...rest] = domain.split('.')
    const m = (s: string) => (s.length <= 1 ? s : `${s[0]}${'*'.repeat(Math.min(6, s.length - 1))}`)
    return `${m(user)}@${m(host)}${rest.length ? '.' + rest.join('.') : ''}`
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Plain report-style email to OWNER_REPORT_EMAIL. Throws when the address is not set or sending fails. */
export const sendOwnerMail = async (subject: string, lines: string[]) => {
    const to = ownerReportAddress()
    if (!to) throw new Error('OWNER_REPORT_EMAIL is not set')
    const text = lines.join('\n')
    const html = `<pre style="font:14px/1.5 Consolas,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`
    await sendSystemMail({ to, subject, html, text })
}

/* ------------------------------------------------------------------ */
/* Setup window                                                        */
/* ------------------------------------------------------------------ */

/** Setup is possible only until OWNER_SETUP_WINDOW_UNTIL (an ISO time a developer sets just before). */
export const setupWindow = () => {
    const raw = (process.env.OWNER_SETUP_WINDOW_UNTIL ?? '').trim()
    const until = raw ? new Date(raw) : null
    const open = !!until && !Number.isNaN(until.getTime()) && until.getTime() > Date.now()
    return { open, until: open ? until : null }
}
