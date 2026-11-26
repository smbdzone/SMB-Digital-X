import crypto from 'node:crypto'
import { Router } from 'express'
import { Types } from 'mongoose'
import User from '../model/user.model.js'
import Company from '../model/company.model.js'
import EmployeeHistory, { HISTORY_TYPES } from '../model/employeeHistory.model.js'
import BankChangeRequest from '../model/bankChangeRequest.model.js'
import { sendSystemMail } from '../email/email.js'
import { generateWelcomeEmail } from '../email/authMessages.js'
import { badRequest, conflict, escapeRegex, isObjectId, notFound } from '../utils/http.js'
import { appendOwnerLog } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner } from './ownerHttp.js'
import { assertCanonical, setSealSeq } from './ownerRecords.js'
import { BANK_FIELDS, canonicalJson, historyHasSalary, historyState, keyOf, userState } from './ownerState.js'

/*
 * People from the Owner Console (all signed and recorded):
 *   GET  /people                                  everyone (protected form), companies, pending bank requests count
 *   POST /people            { action: 'user.create' | 'user.update', changes: [{ key: 'users/<id>', state }] }
 *   GET  /people/bank-requests                    pending requests: current and requested details
 *   POST /people/bank-requests/:id   { action: 'bank.approve', changes: [...] } | { action: 'bank.reject' }
 *   GET  /people/:id/salary-history               salary entries of one person
 *   POST /people/salary-history  { action: 'history.save', changes: [{ key: 'history/<id>', state | null }] }
 */
const router = Router()
const ROLES = ['employee', 'admin']
const STATUSES = ['active', 'inactive']

router.get('/people', requireOwner, async (_req, res) => {
    const users = await User.find().select('+bankDetails').sort({ name: 1 }).lean()
    const companies = (await Company.find().select('name isActive currency').sort({ name: 1 }).lean()).map(c => ({ id: String(c._id), name: c.name, isActive: c.isActive, currency: c.currency }))
    const pendingBank = await BankChangeRequest.countDocuments({ status: 'pending' })
    const data = users.map(u => ({ id: String(u._id), key: keyOf('users', u._id), state: userState(u), isOwner: String(u._id) === String(owner(res).key.ownerUserId) }))
    await appendOwnerLog({ action: 'read.people', request: owner(res).request, result: { count: data.length } })
    res.json({ success: true, data: { people: data, companies, pendingBank } })
})

/** Checks a person's state from the console (beyond canonical form). */
const checkPerson = async (id: string, s: any, isOwnerAccount: boolean) => {
    if (!s.name || s.name.length > 100) throw badRequest('Name is required (at most 100 characters)')
    if (!s.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) throw badRequest('A valid email is required')
    if (await User.exists({ email: new RegExp(`^${escapeRegex(s.email)}$`, 'i'), _id: { $ne: new Types.ObjectId(id) } })) throw conflict('This email is already used by another account')
    if (!ROLES.includes(s.role)) throw badRequest("role must be 'employee' or 'admin'")
    if (!STATUSES.includes(s.status)) throw badRequest("status must be 'active' or 'inactive'")
    if (isOwnerAccount && (s.role !== 'admin' || s.status !== 'active')) throw conflict('Your own account must stay an active admin')
    if (s.companyId !== null && (!isObjectId(s.companyId) || !(await Company.exists({ _id: s.companyId })))) throw badRequest('companyId must be a company')
    const sal = s.salary
    if (sal.amount !== null && !(sal.amount >= 0)) throw badRequest('The salary must be 0 or more')
    if (sal.currency !== null && !/^[A-Z]{3}$/.test(sal.currency)) throw badRequest('currency must be a 3-letter code')
    for (const a of sal.allowances) if (!a.name || !(a.amount >= 0)) throw badRequest('Each allowance needs a name and an amount of 0 or more')
    for (const f of BANK_FIELDS) if (s.bankDetails[f] !== null && String(s.bankDetails[f]).length > 100) throw badRequest(`bank ${f} is too long`)
}

/** The database update for a person's protected state. */
const personUpdate = (s: any, hash: string) => {
    const hasBank = BANK_FIELDS.some(f => s.bankDetails[f])
    return {
        $set: {
            name: s.name, email: s.email, position: s.position ?? '', role: s.role, status: s.status,
            companyId: s.companyId ? new Types.ObjectId(s.companyId) : null, canApproveDeliverables: s.canApproveDeliverables,
            'salary.amount': s.salary.amount, 'salary.currency': s.salary.currency, 'salary.allowances': s.salary.allowances,
            ...(hasBank ? { bankDetails: s.bankDetails } : {}),
            ownerSeal: { seq: null, hash },
        },
        ...(hasBank ? {} : { $unset: { bankDetails: '' } }),
    }
}

router.post('/people', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if ((b.action !== 'user.create' && b.action !== 'user.update') || !Array.isArray(b.changes) || b.changes.length !== 1) {
        throw badRequest("Send { action: 'user.create' | 'user.update', changes: [one person] }")
    }
    const o = owner(res)
    const c = b.changes[0]
    const { type, id, hash } = assertCanonical(c?.key, c?.state)
    if (type !== 'users') throw badRequest('Not a person')
    const s = c.state
    const existing = await User.findById(id).select('+bankDetails')
    const isOwnerAccount = id === String(o.key.ownerUserId)
    let welcome = false

    if (b.action === 'user.create') {
        if (existing) throw conflict('This id is already used')
        await checkPerson(id, s, false)
        // No password is ever sent through the console (it would be kept in the history). The account gets an
        // unusable random password; the person sets their own with "Forgot password".
        await User.create({
            _id: new Types.ObjectId(id), name: s.name, email: s.email, position: s.position ?? '', role: s.role, status: s.status,
            companyId: s.companyId ? new Types.ObjectId(s.companyId) : undefined, canApproveDeliverables: s.canApproveDeliverables,
            password: crypto.randomBytes(32).toString('base64url'),
            salary: { amount: s.salary.amount ?? 0, currency: s.salary.currency ?? 'AED', allowances: s.salary.allowances, effectiveFrom: new Date() },
            ...(BANK_FIELDS.some(f => s.bankDetails[f]) ? { bankDetails: s.bankDetails } : {}),
        })
        // Stored exactly as signed (create applies schema defaults, so write the protected fields again).
        await User.updateOne({ _id: id }, personUpdate(s, hash))
        welcome = s.status === 'active'
    } else {
        if (!existing) throw notFound('Person not found')
        await checkPerson(id, s, isOwnerAccount)
        const before = userState(existing.toObject())
        const update: any = personUpdate(s, hash)
        if (canonicalJson(before.salary) !== canonicalJson(s.salary)) {
            // Keep a record of the previous pay profile (as the website did).
            update.$push = { salaryHistory: { amount: before.salary.amount, currency: before.salary.currency, allowances: before.salary.allowances, effectiveFrom: existing.salary?.effectiveFrom, changedBy: o.key.ownerUserId, changedAt: new Date() } }
            update.$set['salary.effectiveFrom'] = new Date()
        }
        await User.updateOne({ _id: id }, update)
    }

    const after = userState((await User.findById(id).select('+bankDetails').lean())!)
    if (canonicalJson(after) !== canonicalJson(s)) throw new Error(`Stored state of ${id} differs from the signed state`)
    const entry = await appendOwnerLog({ action: b.action, recordId: id, request: o.request, body: bodyText(req), result: { ok: true } })
    await setSealSeq([c.key], entry.seq)
    if (welcome) {
        const link = `${(process.env.FRONTEND || process.env.CLIENT_URL || '').replace(/\/+$/, '')}/forgot-password`
        const mail = generateWelcomeEmail(s.name, s.email, link)
        await sendSystemMail({ to: s.email, subject: mail.subject, html: mail.html, text: mail.text })
            .catch(e => console.error('[owner] welcome email failed:', e instanceof Error ? e.message : e))
    }
    res.json({ success: true, data: { id, log: { seq: entry.seq, head: entry.hash } } })
})

/* ------------------------------------------------------------------ */
/* Bank details change requests                                        */
/* ------------------------------------------------------------------ */

router.get('/people/bank-requests', requireOwner, async (_req, res) => {
    const rows = await BankChangeRequest.find({ status: 'pending' }).sort({ createdAt: 1 }).lean()
    const users = await User.find({ _id: { $in: rows.map(r => r.employeeId) } }).select('+bankDetails').lean()
    const byId = new Map(users.map(u => [String(u._id), u]))
    const data = rows.map(r => {
        const u = byId.get(String(r.employeeId))
        return { id: String(r._id), employeeId: String(r.employeeId), employee: u?.name ?? '?', email: u?.email ?? '', createdAt: r.createdAt,
            key: keyOf('users', r.employeeId), state: u ? userState(u) : null,
            requested: Object.fromEntries(BANK_FIELDS.map(f => [f, (r.requested as any)?.[f]?.trim() || null])) }
    })
    await appendOwnerLog({ action: 'read.bank-requests', request: owner(res).request, result: { count: data.length } })
    res.json({ success: true, data })
})

router.post('/people/bank-requests/:id', requireOwner, async (req, res) => {
    const rid = String(req.params.id)
    if (!isObjectId(rid)) throw badRequest('Not a request id')
    const b = jsonBody(req)
    const o = owner(res)
    const request = await BankChangeRequest.findById(rid)
    if (!request) throw notFound('Request not found')
    if (request.status !== 'pending') throw conflict(`This request is already ${request.status}`)

    if (b.action === 'bank.reject') {
        const entry = await appendOwnerLog({ action: 'bank.reject', recordId: rid, request: o.request, body: bodyText(req), result: { ok: true } })
        await BankChangeRequest.updateOne({ _id: rid, status: 'pending' }, { $set: { status: 'rejected', decidedAt: new Date(), decisionSeq: entry.seq } })
        return void res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
    }
    if (b.action !== 'bank.approve' || !Array.isArray(b.changes) || b.changes.length !== 1) throw badRequest("Send { action: 'bank.approve', changes: [the person] } or { action: 'bank.reject' }")
    const c = b.changes[0]
    const { type, id, hash } = assertCanonical(c?.key, c?.state)
    if (type !== 'users' || id !== String(request.employeeId)) throw badRequest('The change must be for the person who made the request')
    const user = await User.findById(id).select('+bankDetails').lean()
    if (!user) throw notFound('Person not found')
    const now = userState(user)
    const requested = Object.fromEntries(BANK_FIELDS.map(f => [f, (request.requested as any)?.[f]?.trim() || null]))
    if (canonicalJson({ ...now, bankDetails: requested }) !== canonicalJson(c.state)) throw conflict('Approving changes only the bank details, to exactly the requested ones. Reload and try again.')
    await User.updateOne({ _id: id }, personUpdate(c.state, hash))
    const entry = await appendOwnerLog({ action: 'bank.approve', recordId: id, request: o.request, body: bodyText(req), result: { ok: true, requestId: rid } })
    await setSealSeq([c.key], entry.seq)
    await BankChangeRequest.updateOne({ _id: rid }, { $set: { status: 'approved', decidedAt: new Date(), decisionSeq: entry.seq } })
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

/* ------------------------------------------------------------------ */
/* Salary-history entries (the ones with salary figures)               */
/* ------------------------------------------------------------------ */

router.get('/people/:id/salary-history', requireOwner, async (req, res) => {
    const id = String(req.params.id)
    if (!isObjectId(id)) throw badRequest('Not a person id')
    const rows = await EmployeeHistory.find({ employeeId: id, $or: [{ fromSalary: { $ne: null } }, { toSalary: { $ne: null } }] }).sort({ effectiveDate: -1 }).lean()
    await appendOwnerLog({ action: 'read.salary-history', recordId: id, request: owner(res).request, result: { count: rows.length } })
    res.json({ success: true, data: rows.map(h => ({ id: String(h._id), key: keyOf('history', h._id), state: historyState(h) })) })
})

router.post('/people/salary-history', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'history.save' || !Array.isArray(b.changes) || b.changes.length !== 1) throw badRequest("Send { action: 'history.save', changes: [one entry] }")
    const o = owner(res)
    const c = b.changes[0]
    const key = String(c?.key)
    const m = /^history\/([0-9a-f]{24})$/.exec(key)
    if (!m) throw badRequest('Not a salary-history entry')
    const id = m[1]
    const existing = await EmployeeHistory.findById(id).lean()
    if (existing && !historyHasSalary(existing)) throw conflict('This entry has no salary figures: change it on the website')

    if (c.state === null) {
        if (!existing) throw notFound('Entry not found')
        await EmployeeHistory.deleteOne({ _id: id })
    } else {
        const { hash } = assertCanonical(key, c.state)
        const s = c.state
        if (!historyHasSalary(s)) throw badRequest('A salary-history entry needs a from or to salary')
        if (!HISTORY_TYPES.includes(s.type)) throw badRequest('Unknown entry type')
        if (!s.title || !s.effectiveDate) throw badRequest('Title and date are required')
        if (!isObjectId(s.employeeId) || !(await User.exists({ _id: s.employeeId }))) throw badRequest('employeeId must be a person')
        if (existing && String(existing.employeeId) !== s.employeeId) throw badRequest('The person of an entry cannot change')
        const fields = {
            employeeId: new Types.ObjectId(s.employeeId), type: s.type, title: s.title, description: s.description ?? undefined,
            effectiveDate: new Date(s.effectiveDate), fromPosition: s.fromPosition ?? undefined, toPosition: s.toPosition ?? undefined,
            fromSalary: s.fromSalary ?? undefined, toSalary: s.toSalary ?? undefined, currency: s.currency ?? undefined,
        }
        if (existing) {
            const $unset = Object.fromEntries(Object.entries(fields).filter(([, v]) => v === undefined).map(([k]) => [k, '']))
            await EmployeeHistory.updateOne({ _id: id }, { $set: { ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), updatedBy: o.key.ownerUserId, ownerSeal: { seq: null, hash } }, ...(Object.keys($unset).length ? { $unset } : {}) })
        } else {
            await EmployeeHistory.create({ _id: new Types.ObjectId(id), ...fields, addedBy: o.key.ownerUserId, ownerSeal: { seq: null, hash } })
        }
        const after = historyState((await EmployeeHistory.findById(id).lean())!)
        if (canonicalJson(after) !== canonicalJson(s)) throw new Error(`Stored state of ${key} differs from the signed state`)
    }
    const entry = await appendOwnerLog({ action: c.state === null ? 'history.delete' : 'history.save', recordId: id, request: o.request, body: bodyText(req), result: { ok: true } })
    if (c.state !== null) await setSealSeq([key], entry.seq)
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

export default router
