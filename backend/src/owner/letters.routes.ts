import { Request, Router } from 'express'
import Certificate from '../model/certificate.model.js'
import User from '../model/user.model.js'
import { parseIssueInput } from '../controller/certificate.controller.js'
import {
    createIssueContext, issueCertificate, listAvailableTypes, previewCertificate, previewCertificatePdf, sendCertificateEmail,
} from '../services/certificate.service.js'
import { parseSignatureImage } from '../utils/signatureImage.js'
import { badRequest, conflict, isObjectId, notFound } from '../utils/http.js'
import { appendOwnerLog, wipeOwnerRequest } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner, signedAttachment } from './ownerHttp.js'
import { assertCanonical, setSealSeq } from './ownerRecords.js'
import { canonicalJson, certificateState, keyOf } from './ownerState.js'

/*
 * Letters and certificates from the Owner Console (signed, sealed). Saved texts (templates) stay on the website.
 *   GET  /letters/types?companyId=            texts to choose from
 *   GET  /letters                             issued letters (newest first)
 *   POST /letters/preview      { action: 'letter.preview', input, employeeIds }       the exact letters, as states to sign
 *   POST /letters/preview/pdf  { action: 'letter.preview-pdf', input, employeeId, signatureSha256? } (+ signature attachment)
 *   POST /letters/issue        { action: 'letter.issue', input, signatureSha256?, changes: [{ key: 'certificates/<new id>', state }] }
 *   POST /letters/:id/revoke   { action: 'letter.revoke', changes: [{ key, state }] }
 *   POST /letters/:id/resend   { action: 'letter.resend', signatureSha256?, changes: [{ key, state }] }   (+ signature attachment)
 *
 * The one-time signature image travels as the request's attachment: the signed body holds only its SHA-256
 * (signatureSha256), the image is checked against it, used in memory and wiped. It is never stored.
 */
const router = Router()
const MAX_BULK = 50

/** The owner's signature image of this request (validated PNG/JPEG), or undefined. */
const signatureOf = (req: Request, sha: unknown): Buffer | undefined => {
    const raw = signedAttachment(req, sha)
    if (!raw) return undefined
    const parsed = parseSignatureImage(raw.toString('base64'))
    raw.fill(0)
    return parsed?.image
}

/** Issue input from the console: same rules as the website, plus a fixed issue date (so the signed text is exact). */
const inputOf = (b: any) => {
    const input = parseIssueInput(b?.input ?? {})
    if (!input.issueDate) throw badRequest('input.issueDate is required')
    return input
}

/** The letter as it will be stored, in protected form (what the console signs). */
const stateFromPreview = (p: any, employeeId: string) => certificateState({
    employeeId, companyId: p.companyId, companyName: p.companyName, kind: p.kind, typeKey: p.typeKey, title: p.title, subject: p.subject,
    body: p.body, issueDate: p.issueDate, signatory: p.signatory, recipient: p.recipient, status: 'issued', revokeReason: null,
})

router.get('/letters/types', requireOwner, async (req, res) => {
    const companyId = typeof req.query.companyId === 'string' && isObjectId(req.query.companyId) ? req.query.companyId : undefined
    res.json({ success: true, data: await listAvailableTypes(companyId) })
})

router.get('/letters', requireOwner, async (_req, res) => {
    const rows = await Certificate.find().sort({ createdAt: -1 }).limit(300).lean()
    const data = rows.map(c => ({
        id: String(c._id), key: keyOf('certificates', c._id), referenceNo: c.referenceNo, state: certificateState(c), signed: !!c.signedAt,
        email: c.email?.status ?? 'not_sent', createdAt: c.createdAt,
    }))
    await appendOwnerLog({ action: 'read.letters', request: owner(res).request, result: { count: data.length } })
    res.json({ success: true, data })
})

router.post('/letters/preview', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'letter.preview' || !Array.isArray(b.employeeIds) || !b.employeeIds.length || b.employeeIds.length > MAX_BULK
        || !b.employeeIds.every((x: unknown) => isObjectId(x))) throw badRequest(`Send { action: 'letter.preview', input, employeeIds: [1 to ${MAX_BULK}] }`)
    const ctx = await createIssueContext(String(owner(res).key.ownerUserId), inputOf(b))
    const data = []
    for (const employeeId of b.employeeIds) {
        const p = await previewCertificate(ctx, employeeId)
        data.push({ employeeId, preview: p, state: stateFromPreview(p, employeeId) })
    }
    await appendOwnerLog({ action: 'read.letter-preview', request: owner(res).request, result: { count: data.length } })
    res.json({ success: true, data })
})

router.post('/letters/preview/pdf', requireOwner, async (req, res) => {
    let signature: Buffer | undefined
    try {
        const b = jsonBody(req)
        if (b.action !== 'letter.preview-pdf' || !isObjectId(b.employeeId)) throw badRequest("Send { action: 'letter.preview-pdf', input, employeeId }")
        signature = signatureOf(req, b.signatureSha256)
        const ctx = await createIssueContext(String(owner(res).key.ownerUserId), inputOf(b))
        ctx.signature = signature
        const pdf = await previewCertificatePdf(ctx, b.employeeId)
        await appendOwnerLog({ action: 'read.letter-preview-pdf', recordId: b.employeeId, request: owner(res).request, result: { signed: !!signature } })
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Cache-Control', 'private, no-store')
        res.status(200).end(pdf)
    } finally {
        signature?.fill(0)
        wipeOwnerRequest(req)
    }
})

router.post('/letters/issue', requireOwner, async (req, res) => {
    let signature: Buffer | undefined
    try {
        const b = jsonBody(req)
        if (b.action !== 'letter.issue' || !Array.isArray(b.changes) || !b.changes.length || b.changes.length > MAX_BULK) throw badRequest(`Send { action: 'letter.issue', input, changes: [1 to ${MAX_BULK}] }`)
        const input = inputOf(b)
        signature = signatureOf(req, b.signatureSha256)
        if (signature && !input.sendEmail) throw badRequest('A signed letter has to be emailed: the email is the only copy with the signature.')
        const ctx = await createIssueContext(String(owner(res).key.ownerUserId), input)
        ctx.signature = signature

        // 1. Every letter must be exactly what the console signed (same text, recipient, company, date...).
        const plan: { key: string; id: string; employeeId: string; hash: string }[] = []
        for (const c of b.changes) {
            const { type, id, hash } = assertCanonical(c?.key, c?.state)
            if (type !== 'certificates') throw badRequest('Not a letter')
            if (await Certificate.exists({ _id: id })) throw conflict('This letter id is already used')
            const employeeId = c.state.employeeId
            if (!isObjectId(employeeId) || plan.some(p => p.employeeId === employeeId)) throw badRequest('One letter per employee')
            const p = await previewCertificate(ctx, employeeId)
            if (canonicalJson(stateFromPreview(p, employeeId)) !== canonicalJson(c.state)) {
                throw conflict(`The letter for ${p.recipient.name} is not what you previewed (text, details or date changed). Preview again.`)
            }
            plan.push({ key: c.key, id, employeeId, hash })
        }
        // 2. Issue them (each gets its reference number; the emailed copy carries the signature).
        const results = []
        for (const p of plan) {
            const { certificate, email } = await issueCertificate(ctx, p.employeeId, p.id)
            await Certificate.updateOne({ _id: p.id }, { $set: { ownerSeal: { seq: null, hash: p.hash } } })
            results.push({ id: p.id, referenceNo: certificate.referenceNo, email: email?.status ?? 'not_sent' })
        }
        const entry = await appendOwnerLog({ action: 'letter.issue', recordId: plan.length === 1 ? plan[0].id : `${plan.length} letters`, request: owner(res).request, body: bodyText(req),
            result: { ok: true, count: plan.length, signed: !!signature, emails: results.map(r => r.email) } })
        await setSealSeq(plan.map(p => p.key), entry.seq)
        res.status(201).json({ success: true, data: { letters: results, log: { seq: entry.seq, head: entry.hash } } })
    } finally {
        signature?.fill(0)
        wipeOwnerRequest(req)
    }
})

const oneLetter = async (req: Request, action: string) => {
    const b = jsonBody(req)
    if (b.action !== action || !Array.isArray(b.changes) || b.changes.length !== 1) throw badRequest(`Send { action: '${action}', changes: [the letter] }`)
    const c = b.changes[0]
    const { type, id, hash } = assertCanonical(c?.key, c?.state)
    if (type !== 'certificates' || id !== String(req.params.id)) throw badRequest('The change must be for this letter')
    const cert = await Certificate.findById(id)
    if (!cert) throw notFound('Letter not found')
    return { b, c, id, hash, cert, now: certificateState(cert.toObject()) }
}

router.post('/letters/:id/revoke', requireOwner, async (req, res) => {
    const { c, id, hash, cert, now } = await oneLetter(req, 'letter.revoke')
    if (now.status === 'revoked') throw conflict('This letter is already revoked')
    if (canonicalJson({ ...now, status: 'revoked', revokeReason: c.state.revokeReason }) !== canonicalJson(c.state) || c.state.status !== 'revoked') {
        throw badRequest('Revoking changes only the status and the reason')
    }
    cert.status = 'revoked'
    cert.revokedAt = new Date()
    cert.revokedBy = owner(res).key.ownerUserId as any
    cert.revokeReason = c.state.revokeReason ?? undefined
    cert.set('ownerSeal', { seq: null, hash })
    await cert.save()
    const entry = await appendOwnerLog({ action: 'letter.revoke', recordId: id, request: owner(res).request, body: bodyText(req), result: { ok: true } })
    await setSealSeq([c.key], entry.seq)
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

router.post('/letters/:id/resend', requireOwner, async (req, res) => {
    let signature: Buffer | undefined
    try {
        const { b, c, id, hash, cert, now } = await oneLetter(req, 'letter.resend')
        if (canonicalJson(now) !== canonicalJson(c.state)) throw conflict('The letter changed since you loaded it. Reload and try again.')
        if (now.status === 'revoked') throw badRequest('A revoked letter cannot be emailed')
        signature = signatureOf(req, b.signatureSha256)
        const employee = await User.findById(cert.employeeId).select('email').lean()
        const outcome = await sendCertificateEmail(cert, employee?.email || cert.recipient.email, undefined,
            signature ? { image: signature, signerId: String(owner(res).key.ownerUserId) } : undefined)
        await Certificate.updateOne({ _id: id }, { $set: { ownerSeal: { seq: null, hash } } })
        const entry = await appendOwnerLog({ action: 'letter.resend', recordId: id, request: owner(res).request, body: bodyText(req), result: { ok: outcome.status === 'sent', email: outcome.status, signed: !!signature } })
        await setSealSeq([c.key], entry.seq)
        res.json({ success: true, data: { email: outcome.status, log: { seq: entry.seq, head: entry.hash } } })
    } finally {
        signature?.fill(0)
        wipeOwnerRequest(req)
    }
})

export default router
