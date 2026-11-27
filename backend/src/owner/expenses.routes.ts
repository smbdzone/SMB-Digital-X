import { Router } from 'express'
import { Types } from 'mongoose'
import Expense, { EXPENSE_CATEGORIES, EXPENSE_STATUSES, PAYMENT_METHODS } from '../model/expense.model.js'
import User from '../model/user.model.js'
import Project from '../model/project.model.js'
import Company from '../model/company.model.js'
import { computeTaxes } from '../controller/expense.controller.js'
import { badRequest, conflict, isObjectId, notFound } from '../utils/http.js'
import { appendOwnerLog } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner } from './ownerHttp.js'
import { assertCanonical, setSealSeq } from './ownerRecords.js'
import { canonicalJson, expenseState, keyOf } from './ownerState.js'

/*
 * Expenses from the Owner Console (signed, sealed). Employees (and the admin) still add and edit their own PENDING
 * expenses on the website; deciding (approve / reject / reimburse / back to pending), editing any expense and deleting
 * are done here.
 *   GET  /expenses?status=pending|approved|rejected|reimbursed|all
 *   POST /expenses   { action: 'expense.update', changes: [{ key: 'expenses/<id>', state }, ...] }   (delete = isDeleted)
 */
const router = Router()
const MAX_BATCH = 100

router.get('/expenses', requireOwner, async (req, res) => {
    const status = String(req.query.status ?? 'pending')
    const filter: Record<string, unknown> = status === 'all' ? {} : { status, isDeleted: { $ne: true } }
    if (status !== 'all' && !(EXPENSE_STATUSES as readonly string[]).includes(status)) throw badRequest('Unknown status')
    const rows = await Expense.find(filter).sort({ date: -1 }).limit(500).lean()
    const [users, projects, companies] = await Promise.all([
        User.find({ _id: { $in: rows.map(r => r.addedBy) } }).select('name').lean(),
        Project.find({ _id: { $in: rows.map(r => r.projectId).filter(Boolean) as Types.ObjectId[] } }).select('name').lean(),
        Company.find().select('name').lean(),
    ])
    const name = (list: any[], id: unknown) => list.find(x => String(x._id) === String(id))?.name ?? ''
    const data = rows.map(e => ({
        id: String(e._id), key: keyOf('expenses', e._id), state: expenseState(e), addedByName: name(users, e.addedBy),
        projectName: name(projects, e.projectId), companyName: name(companies, e.companyId), receipts: e.receipts?.length ?? 0,
    }))
    await appendOwnerLog({ action: 'read.expenses', recordId: status, request: owner(res).request, result: { count: data.length } })
    res.json({ success: true, data: { expenses: data, categories: EXPENSE_CATEGORIES, paymentMethods: PAYMENT_METHODS, companies: companies.map(c => ({ id: String(c._id), name: c.name })) } })
})

router.post('/expenses', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'expense.update' || !Array.isArray(b.changes) || !b.changes.length || b.changes.length > MAX_BATCH) {
        throw badRequest(`Send { action: 'expense.update', changes: [1 to ${MAX_BATCH} expenses] }`)
    }
    const o = owner(res)
    // Check everything first.
    const plan: { key: string; id: string; hash: string; s: any; now: any }[] = []
    for (const c of b.changes) {
        const { type, id, hash } = assertCanonical(c?.key, c?.state)
        if (type !== 'expenses') throw badRequest(`${c.key} is not an expense`)
        // The collection itself: the model hides deleted expenses (so a deleted one is found and refused below).
        const doc = await Expense.collection.findOne({ _id: new Types.ObjectId(id) })
        if (!doc) throw notFound(`Expense ${id} not found`)
        const now = expenseState(doc), s = c.state
        if (s.addedBy !== now.addedBy) throw badRequest('Who added an expense cannot change')
        if (!s.description || s.description.length > 500) throw badRequest('A description is required')
        if (!(EXPENSE_CATEGORIES as readonly string[]).includes(s.category)) throw badRequest('Unknown category')
        if (s.paymentMethod !== null && !(PAYMENT_METHODS as readonly string[]).includes(s.paymentMethod)) throw badRequest('Unknown payment method')
        if (!(EXPENSE_STATUSES as readonly string[]).includes(s.status)) throw badRequest('Unknown status')
        if (s.status === 'rejected' && !s.rejectionReason) throw badRequest('Give a reason when rejecting an expense')
        if (s.status !== 'rejected' && s.rejectionReason) throw badRequest('Only a rejected expense has a reason')
        if (!/^[A-Z]{3}$/.test(s.currency) || !s.date) throw badRequest('Currency and date are required')
        if (!isObjectId(s.companyId) || (s.projectId !== null && !isObjectId(s.projectId))) throw badRequest('companyId (and projectId if set) must be ids')
        const totals = computeTaxes(s.amount, s.taxes.map((t: any) => ({ name: t.name, percentage: t.percentage })))
        if (canonicalJson(totals) !== canonicalJson({ taxes: s.taxes, totalTax: s.totalTax, totalAmount: s.totalAmount })) throw badRequest(`${c.key}: taxes and totals do not add up`)
        if (now.isDeleted && !s.isDeleted) throw conflict('A deleted expense cannot come back')
        plan.push({ key: c.key, id, hash, s, now })
    }
    // Then write.
    for (const p of plan) {
        const s = p.s
        const decided = s.status === 'approved' || s.status === 'reimbursed'
        const $set: Record<string, unknown> = {
            companyId: new Types.ObjectId(s.companyId), projectId: s.projectId ? new Types.ObjectId(s.projectId) : null,
            description: s.description, category: s.category, vendor: s.vendor ?? '', paymentMethod: s.paymentMethod ?? undefined,
            amount: s.amount, taxes: s.taxes, totalTax: s.totalTax, totalAmount: s.totalAmount, currency: s.currency, date: new Date(s.date),
            notes: s.notes ?? '', status: s.status, rejectionReason: s.rejectionReason ?? '', isDeleted: s.isDeleted,
            updatedBy: o.key.ownerUserId, ownerSeal: { seq: null, hash: p.hash },
        }
        if (s.status !== p.now.status) Object.assign($set, decided ? { approvedBy: o.key.ownerUserId, approvedAt: new Date() } : { approvedBy: null, approvedAt: null })
        if (s.isDeleted && !p.now.isDeleted) Object.assign($set, { deletedAt: new Date(), deletedBy: o.key.ownerUserId })
        if (s.paymentMethod === null) delete $set.paymentMethod
        await Expense.updateOne({ _id: p.id }, { $set, ...(s.paymentMethod === null ? { $unset: { paymentMethod: '' } } : {}) })
        const after = expenseState((await Expense.collection.findOne({ _id: new Types.ObjectId(p.id) }))!)
        if (canonicalJson(after) !== canonicalJson(s)) throw new Error(`Stored state of ${p.key} differs from the signed state`)
    }
    const entry = await appendOwnerLog({ action: 'expense.update', recordId: plan.length === 1 ? plan[0].id : `${plan.length} expenses`, request: o.request, body: bodyText(req), result: { ok: true, count: plan.length } })
    await setSealSeq(plan.map(p => p.key), entry.seq)
    res.json({ success: true, data: { count: plan.length, log: { seq: entry.seq, head: entry.hash } } })
})

export default router
