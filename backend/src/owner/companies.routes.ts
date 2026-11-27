import { Router } from 'express'
import { Types } from 'mongoose'
import Company from '../model/company.model.js'
import { buildCompanyFields } from '../controller/company.controller.js'
import { uploadToCloudinary } from '../utils/cloudinary.js'
import { isLetterheadDesign } from '../utils/letterheadDesigns.js'
import { badRequest, conflict, notFound } from '../utils/http.js'
import { appendOwnerLog, wipeOwnerRequest } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner, signedAttachment } from './ownerHttp.js'
import { assertCanonical, setSealSeq } from './ownerRecords.js'
import { canonicalJson, companyState, keyOf } from './ownerState.js'

/*
 * Companies from the Owner Console (signed, sealed):
 *   GET  /companies                    every company (protected form)
 *   POST /companies    { action: 'company.create' | 'company.update', changes: [{ key: 'companies/<id>', state }] }
 *   POST /companies/logo   attachment = the image, signed { action: 'company.logo', attachmentSha256 }  -> { url }
 * The website's company create / edit / delete routes refuse everyone (routes/company.routes.ts).
 * There is no delete: a company is switched off with isActive = false (salaries and letters keep pointing to it).
 */
const router = Router()

router.get('/companies', requireOwner, async (_req, res) => {
    const rows = await Company.find().sort({ name: 1 }).lean()
    await appendOwnerLog({ action: 'read.companies', request: owner(res).request, result: { count: rows.length } })
    res.json({ success: true, data: rows.map(c => ({ id: String(c._id), key: keyOf('companies', c._id), state: companyState(c) })) })
})

/** The database fields for a company's protected state (validated with the website's own rules). */
const fieldsOf = (s: any, mode: 'create' | 'update') => {
    const body = {
        name: s.name, code: s.code, legalName: s.legalName ?? '', logo: s.logo ?? '', brandColor: s.brandColor, address: s.address ?? '',
        phone: s.phone ?? '', website: s.website ?? '', currency: s.currency, isActive: s.isActive,
        email: { fromName: s.email.fromName ?? '', fromEmail: s.email.fromEmail ?? '', replyTo: s.email.replyTo ?? '', footerNote: s.email.footerNote ?? '' },
        signatory: { name: s.signatory.name ?? '', title: s.signatory.title ?? '', signature: s.signatory.signature ?? '' },
    }
    const f: Record<string, unknown> = buildCompanyFields(body, mode)
    if (s.letterhead !== null && !isLetterheadDesign(s.letterhead)) throw badRequest('Unknown letterhead design')
    f.letterhead = s.letterhead
    // The website's rules may normalise a value (upper-case currency, lower-case email...). The signed state must
    // already be what gets stored, so compare before writing anything.
    const doc: any = { code: s.code }
    for (const [k, v] of Object.entries(f)) {
        const parts = k.split('.')
        let o = doc
        for (const p of parts.slice(0, -1)) o = o[p] ??= {}
        o[parts.at(-1)!] = v
    }
    if (canonicalJson(companyState(doc)) !== canonicalJson(s)) throw badRequest('The company state is not in canonical form (check upper/lower case and spaces)')
    return f
}

router.post('/companies', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if ((b.action !== 'company.create' && b.action !== 'company.update') || !Array.isArray(b.changes) || b.changes.length !== 1) {
        throw badRequest("Send { action: 'company.create' | 'company.update', changes: [one company] }")
    }
    const c = b.changes[0]
    const { type, id, hash } = assertCanonical(c?.key, c?.state)
    if (type !== 'companies') throw badRequest('Not a company')
    const s = c.state
    const existing = await Company.findById(id).lean()
    if (b.action === 'company.create') {
        if (existing) throw conflict('This id is already used')
        if (await Company.exists({ code: s.code })) throw conflict('A company with this code already exists')
        await Company.create({ _id: new Types.ObjectId(id), ...fieldsOf(s, 'create') })
    } else {
        if (!existing) throw notFound('Company not found')
        if (s.code !== existing.code) throw badRequest('The code of a company cannot change')
        const f = fieldsOf(s, 'update')
        delete f.code
        await Company.updateOne({ _id: id }, { $set: f })
    }
    await Company.updateOne({ _id: id }, { $set: { ownerSeal: { seq: null, hash } } })
    const after = companyState((await Company.findById(id).lean())!)
    if (canonicalJson(after) !== canonicalJson(s)) throw new Error(`Stored state of ${c.key} differs from the signed state`)
    const entry = await appendOwnerLog({ action: b.action, recordId: id, request: owner(res).request, body: bodyText(req), result: { ok: true } })
    await setSealSeq([c.key], entry.seq)
    res.json({ success: true, data: { id, log: { seq: entry.seq, head: entry.hash } } })
})

const IMAGE = (buf: Buffer) =>
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
        : buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'jpg' : null

router.post('/companies/logo', requireOwner, async (req, res) => {
    try {
        const b = jsonBody(req)
        if (b.action !== 'company.logo') throw badRequest("action must be 'company.logo'")
        const image = signedAttachment(req, b.attachmentSha256)
        if (!image) throw badRequest('Send the logo as the attachment')
        if (image.length > 2 * 1024 * 1024) throw badRequest('The logo must be at most 2 MB')
        const kind = IMAGE(image)
        if (!kind) throw badRequest('The logo must be a PNG or JPEG image')
        const up: any = await uploadToCloudinary(Buffer.from(image), { folder: 'company_logo', resource_type: 'image', filename: `logo.${kind}` })
        const url = up?.secure_url || up?.url
        const entry = await appendOwnerLog({ action: 'company.logo', recordId: null, request: owner(res).request, body: bodyText(req), result: { ok: true, url } })
        res.json({ success: true, data: { url, log: { seq: entry.seq, head: entry.hash } } })
    } finally {
        wipeOwnerRequest(req)
    }
})

export default router
