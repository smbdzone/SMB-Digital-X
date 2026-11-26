import { Router } from 'express'
import { Types } from 'mongoose'
import Salary from '../model/salary.model.js'
import User from '../model/user.model.js'
import Company from '../model/company.model.js'
import { computeTotals, generateMonthlySalaries, sendSlipEmail } from '../services/salary.service.js'
import { badRequest, conflict, isObjectId, notFound } from '../utils/http.js'
import { appendOwnerLog } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner } from './ownerHttp.js'
import { assertCanonical, setSealSeq, signedProfileFilter } from './ownerRecords.js'
import { BANK_FIELDS, canonicalJson, keyOf, salaryState, userState } from './ownerState.js'

/*
 * Payroll from the Owner Console (all signed and recorded):
 *   GET  /payroll?month=YYYY-MM         the month's salary records (protected form) + each employee's bank details
 *   POST /payroll/run                   { action: 'payroll.run', month }      create the month's pending records
 *   POST /payroll/salaries              { action: 'salary.update' | 'salary.pay', changes: [{ key, state }] }
 *   POST /payroll/salaries/:id/resend   { action: 'salary.resend' }           email the slip again
 * The website's own payroll write routes refuse everyone (routes/salary.routes.ts).
 */
const router = Router()
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_BATCH = 200

router.get('/payroll', requireOwner, async (req, res) => {
    const month = String(req.query.month ?? '')
    if (!MONTH.test(month)) throw badRequest('month must look like 2026-11')
    const rows = await Salary.find({ month }).sort({ _id: 1 }).lean()
    const people = await User.find({ _id: { $in: rows.map(r => r.employeeId) } }).select('name email +bankDetails').lean()
    const byId = new Map(people.map(p => [String(p._id), p]))
    const companies = new Map((await Company.find().select('name').lean()).map(c => [String(c._id), c.name]))
    const otherPending = await Salary.countDocuments({ status: 'pending', month: { $ne: month } })
    const data = rows.map(s => {
        const p = byId.get(String(s.employeeId))
        return {
            id: String(s._id), key: keyOf('salaries', s._id), state: salaryState(s),
            employee: p?.name ?? '?', employeeEmail: p?.email ?? '', company: companies.get(String(s.companyId)) ?? '?',
            employeeBank: p ? userState(p).bankDetails : null, paidOn: s.paidOn ?? null, slipEmail: s.email?.status ?? 'not_sent',
        }
    })
    await appendOwnerLog({ action: 'read.payroll', recordId: month, request: owner(res).request, result: { count: data.length } })
    res.json({ success: true, data: { month, salaries: data, otherPending } })
})

router.post('/payroll/run', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'payroll.run' || !MONTH.test(String(b.month))) throw badRequest("Send { action: 'payroll.run', month: 'YYYY-MM' }")
    const result = await generateMonthlySalaries(b.month, undefined, await signedProfileFilter())
    const entry = await appendOwnerLog({ action: 'payroll.run', recordId: b.month, request: owner(res).request, body: bodyText(req),
        result: { ok: true, created: result.created, alreadyExisted: result.alreadyExisted, skipped: result.skipped.length } })
    res.json({ success: true, data: { ...result, log: { seq: entry.seq, head: entry.hash } } })
})

const sameExcept = (a: any, b: any, fields: string[]) => {
    const strip = (o: any) => Object.fromEntries(Object.entries(o).filter(([k]) => !fields.includes(k)))
    return canonicalJson(strip(a)) === canonicalJson(strip(b))
}

router.post('/payroll/salaries', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'salary.update' && b.action !== 'salary.pay') throw badRequest("action must be 'salary.update' or 'salary.pay'")
    if (!Array.isArray(b.changes) || !b.changes.length || b.changes.length > MAX_BATCH) throw badRequest(`changes must list 1 to ${MAX_BATCH} salaries`)
    if (b.action === 'salary.update' && b.changes.length !== 1) throw badRequest('Edit one salary at a time')
    const o = owner(res)

    // 1. Check everything first; nothing is written unless every change is allowed.
    const plan: { key: string; id: string; hash: string; state: any }[] = []
    for (const c of b.changes) {
        const { type, id, hash } = assertCanonical(c?.key, c?.state)
        if (type !== 'salaries') throw badRequest(`${c.key} is not a salary`)
        const doc = await Salary.findById(id).lean()
        if (!doc) throw notFound(`Salary ${id} not found`)
        const now = salaryState(doc), next = c.state
        if (next.employeeId !== now.employeeId || next.month !== now.month) throw badRequest('The employee and month of a salary cannot change')
        if (b.action === 'salary.update' && now.status === 'paid' && !sameExcept(now, next, ['notes'])) throw conflict('This salary is already paid and locked. Only the notes can be edited.')
        const totals = computeTotals({ salary: next.salary, allowances: next.allowances, deductions: next.deductions })
        if (canonicalJson(totals) !== canonicalJson({ totalAllowances: next.totalAllowances, totalDeductions: next.totalDeductions, grossAmount: next.grossAmount, netPay: next.netPay })) {
            throw badRequest(`${c.key}: totals do not add up`)
        }
        if (b.action === 'salary.update') {
            if (now.status === 'paid') {
                if (!sameExcept(now, next, ['notes'])) throw conflict('This salary is already paid and locked. Only the notes can be edited.')
            } else {
                if (next.status !== 'pending') throw badRequest('Use "Pay" to mark a salary paid')
                if (next.paymentDetails) throw badRequest('Payment details are set when the salary is paid')
                if (!(next.salary > 0)) throw badRequest('The basic salary must be more than 0')
                if (!next.currency || !/^[A-Z]{3}$/.test(next.currency)) throw badRequest('currency must be a 3-letter code')
                if (!isObjectId(next.companyId) || !(await Company.exists({ _id: next.companyId, isActive: true }))) throw badRequest('companyId must be an active company')
            }
        } else {
            if (now.status !== 'pending') throw conflict(`Already paid: ${doc.month}. Nothing was paid; reload and try again.`)
            if (next.status !== 'paid' || !sameExcept(now, next, ['status', 'paymentDetails'])) throw badRequest('Paying changes only the status and the payment details. Save other edits first.')
            const emp = await User.findById(now.employeeId).select('+bankDetails').lean()
            const bank = emp ? userState(emp).bankDetails : null
            const expected = bank && BANK_FIELDS.some(f => bank[f]) ? { ...bank, reference: null } : null
            if (canonicalJson(next.paymentDetails) !== canonicalJson(expected)) throw conflict('The payment details are not the employee\'s current bank details. Reload and try again.')
        }
        plan.push({ key: c.key, id, hash, state: next })
    }

    // 2. Write. Paying is conditional on "still pending", so two runs can never pay twice.
    const paidNow: string[] = []
    const ownerUser = await User.findById(o.key.ownerUserId).select('name').lean()
    for (const p of plan) {
        const s = p.state
        const $set: Record<string, unknown> = {
            companyId: new Types.ObjectId(s.companyId), currency: s.currency, salary: s.salary, allowances: s.allowances, deductions: s.deductions,
            totalAllowances: s.totalAllowances, totalDeductions: s.totalDeductions, grossAmount: s.grossAmount, netPay: s.netPay,
            notes: s.notes, status: s.status, ownerSeal: { seq: null, hash: p.hash },
        }
        const $unset: Record<string, ''> = {}
        if (s.paymentDetails) $set.paymentDetails = s.paymentDetails; else $unset.paymentDetails = ''
        const filter: Record<string, unknown> = { _id: p.id }
        if (b.action === 'salary.pay') {
            filter.status = 'pending'
            Object.assign($set, { paidOn: new Date(), paidBy: o.key.ownerUserId, paidByName: ownerUser?.name })
        }
        const r = await Salary.updateOne(filter, { $set, ...(Object.keys($unset).length ? { $unset } : {}) })
        if (r.matchedCount === 0) throw conflict(`Salary ${p.id} was changed meanwhile; ${paidNow.length} of ${plan.length} were saved. Reload and run Verify everything.`)
        if (b.action === 'salary.pay') paidNow.push(p.id)
    }

    // 3. Record (with the exact signed body), point the seals at the entry, then email the slips once.
    const entry = await appendOwnerLog({ action: b.action, recordId: plan.length === 1 ? plan[0].id : `${plan.length} salaries`, request: o.request, body: bodyText(req), result: { ok: true, count: plan.length } })
    await setSealSeq(plan.map(p => p.key), entry.seq)
    const emails: Record<string, string> = {}
    for (const id of paidNow) emails[id] = (await sendSlipEmail(id)).status
    res.json({ success: true, data: { count: plan.length, emails, log: { seq: entry.seq, head: entry.hash } } })
})

router.post('/payroll/salaries/:id/resend', requireOwner, async (req, res) => {
    const id = String(req.params.id)
    if (!isObjectId(id)) throw badRequest('Not a salary id')
    const b = jsonBody(req)
    if (b.action !== 'salary.resend') throw badRequest("action must be 'salary.resend'")
    const doc = await Salary.findById(id).select('status').lean()
    if (!doc) throw notFound('Salary not found')
    if (doc.status !== 'paid') throw conflict('Only a paid salary has a slip to send')
    const outcome = await sendSlipEmail(id)
    const entry = await appendOwnerLog({ action: 'salary.resend', recordId: id, request: owner(res).request, body: bodyText(req), result: { ok: outcome.status === 'sent', email: outcome.status } })
    res.json({ success: true, data: { email: outcome.status, log: { seq: entry.seq, head: entry.hash } } })
})

export default router
