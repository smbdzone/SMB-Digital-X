import { Request } from 'express'
import OwnerKey, { IOwnerKey, OWNER_KEY_ID } from '../model/ownerKey.model.js'
import OwnerLog from '../model/ownerLog.model.js'
import OwnerNonce from '../model/ownerNonce.model.js'
import { sendSystemMail } from '../email/email.js'
import { unauthorized } from '../utils/http.js'
import { GENESIS, OwnerLogEntryData, SignedRequest, entryHash, sha256Hex, verifyRequestSignature } from './signing.js'

export const MAX_CLOCK_SKEW_MS = 2 * 60_000
const NONCE_KEEP_MS = 5 * 60_000      // longer than the whole ±2 minute window
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/

/* ------------------------------------------------------------------ */
/* Signed requests                                                     */
/* ------------------------------------------------------------------ */

/** The exact bytes the console sent (owner routes keep the raw body; see owner.routes.ts). */
export const rawBodyOf = (req: Request): Buffer => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))

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

    const request: SignedRequest = { method: req.method, path: req.originalUrl, bodyHash: sha256Hex(rawBodyOf(req)), ts, nonce, sig }
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

/** Appends one entry to the owner history (hash-chained). Safe when two requests append at the same moment. */
export const appendOwnerLog = async (input: { action: string; recordId?: string | null; request: SignedRequest; result?: unknown; body?: string | null }): Promise<OwnerLogEntryData> => {
    for (let attempt = 0; attempt < 10; attempt++) {
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
            if ((error as { code?: number })?.code === 11000) continue   // someone else took this number: read again
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
