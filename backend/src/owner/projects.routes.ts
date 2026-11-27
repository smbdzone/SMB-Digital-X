import { Router } from 'express'
import Project from '../model/project.model.js'
import Milestone, { MILESTONE_PAYMENT_STATUSES } from '../model/milestone.model.js'
import { round2 } from '../utils/money.js'
import { badRequest, conflict, notFound } from '../utils/http.js'
import { appendOwnerLog } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner } from './ownerHttp.js'
import { assertCanonical, setSealSeq } from './ownerRecords.js'
import { canonicalJson, keyOf, milestoneState, parseKey, projectState } from './ownerState.js'
import { isLocked, looksLocked, vaultStarted } from './vault.js'

/*
 * Project money from the Owner Console (signed, sealed). The website keeps everything else about projects and
 * milestones (names, dates, team, work status, deliverables) and refuses anything with money (see the guards).
 *   GET  /projects                                     projects with budget + milestones with payment (protected form)
 *   POST /projects/budget       { action: 'project.budget', changes: [{ key: 'projects/<id>', state: { budget } }] }
 *   POST /projects/delete       { action: 'project.delete', changes: [project and every milestone of it, state null] }
 *   POST /milestones/payment    { action: 'milestone.payment', changes: [{ key: 'milestones/<id>', state }] }
 *   POST /milestones/delete     { action: 'milestone.delete', changes: [{ key: 'milestones/<id>', state: null }] }
 *
 * Phase 2: once locking has started, the budget and the milestone percentage and amount must be locked values (the
 * console locks them before signing; the server cannot read them). The money rules (0 or more, at most 100% in total,
 * percentage and amount matching the budget) are then checked in the console only. Before that, plain numbers as before.
 */
const LOCKED_NEEDED = 'Locking has started: the console must send this amount locked. Use Owner Console v1.3.0 or later.'
/** Plain before locking started, locked after; refuses the other form. Returns true when the value is locked. */
const moneyForm = async (values: unknown[]) => {
    const started = await vaultStarted()
    if (started && !values.every(isLocked)) throw badRequest(values.some(looksLocked) ? 'Unknown locked value format' : LOCKED_NEEDED)
    if (!started && values.some(v => typeof v === 'string')) throw badRequest('Amounts can be locked only after "Lock existing data" has started')
    return started
}
const router = Router()

/** Share of the budget a milestone takes (same rule as the website: the typed value wins, the other follows). */
const percentOf = (m: any, budget: number) => (m.paymentMode === 'amount' ? (budget > 0 ? (m.paymentAmount ?? 0) / budget * 100 : 0) : (m.paymentPercentage ?? 0))

router.get('/projects', requireOwner, async (_req, res) => {
    const projects = await Project.find().sort({ name: 1 }).select('name clientName status budget').lean()
    const milestones = await Milestone.find().sort({ order: 1 }).select('projectId title order status paymentMode paymentPercentage paymentAmount currency paymentStatus invoicedAt paidAt').lean()
    const data = projects.map(p => ({
        id: String(p._id), key: keyOf('projects', p._id), name: p.name, clientName: p.clientName, status: p.status, state: projectState(p),
        milestones: milestones.filter(m => String(m.projectId) === String(p._id))
            .map(m => ({ id: String(m._id), key: keyOf('milestones', m._id), title: m.title, status: m.status, state: milestoneState(m) })),
    }))
    await appendOwnerLog({ action: 'read.projects', request: owner(res).request, result: { count: data.length } })
    res.json({ success: true, data })
})

const record = async (req: any, res: any, action: string, keys: string[], recordId: string, result: object = { ok: true }) => {
    const entry = await appendOwnerLog({ action, recordId, request: owner(res).request, body: bodyText(req), result })
    if (keys.length) await setSealSeq(keys, entry.seq)
    return entry
}

router.post('/projects/budget', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'project.budget' || !Array.isArray(b.changes) || b.changes.length !== 1) throw badRequest("Send { action: 'project.budget', changes: [one project] }")
    const c = b.changes[0]
    const { type, id, hash } = assertCanonical(c?.key, c?.state)
    if (type !== 'projects') throw badRequest('Not a project')
    const budget = c.state.budget
    const locked = await moneyForm([budget])
    if (!locked && (!(budget >= 0) || round2(budget) !== budget)) throw badRequest('The budget must be an amount of 0 or more')
    if (!(await Project.exists({ _id: id }))) throw notFound('Project not found')
    if (!locked) {
        const used = (await Milestone.find({ projectId: id }).lean()).reduce((s, m) => s + percentOf(m, budget), 0)
        if (used > 100.0001) throw conflict(`With this budget the milestone payments would be ${round2(used)}% of it. Lower them first.`)
    }
    await Project.updateOne({ _id: id }, { $set: { budget, ownerSeal: { seq: null, hash } } })
    const entry = await record(req, res, 'project.budget', [c.key], id)
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

router.post('/projects/delete', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'project.delete' || !Array.isArray(b.changes) || !b.changes.length) throw badRequest("Send { action: 'project.delete', changes: [...] }")
    const project = b.changes.find((c: any) => c?.key?.startsWith('projects/'))
    const id = project ? parseKey(project.key)?.id : null
    if (!id || b.changes.some((c: any) => c?.state !== null)) throw badRequest('Deleting needs the project and each of its milestones with state null')
    if (!(await Project.exists({ _id: id }))) throw notFound('Project not found')
    const ms = (await Milestone.find({ projectId: id }).select('_id').lean()).map(m => keyOf('milestones', m._id)).sort()
    const listed = b.changes.map((c: any) => c.key).filter((k: string) => k.startsWith('milestones/')).sort()
    if (canonicalJson(ms) !== canonicalJson(listed)) throw conflict('The project\'s milestones changed. Reload and try again.')
    await Milestone.deleteMany({ projectId: id })
    await Project.deleteOne({ _id: id })
    const entry = await record(req, res, 'project.delete', [], id, { ok: true, milestones: ms.length })
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

router.post('/milestones/payment', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'milestone.payment' || !Array.isArray(b.changes) || b.changes.length !== 1) throw badRequest("Send { action: 'milestone.payment', changes: [one milestone] }")
    const c = b.changes[0]
    const { type, id, hash } = assertCanonical(c?.key, c?.state)
    if (type !== 'milestones') throw badRequest('Not a milestone')
    const s = c.state
    const m = await Milestone.findById(id).lean()
    if (!m) throw notFound('Milestone not found')
    if (s.projectId !== String(m.projectId)) throw badRequest('A milestone cannot move to another project')
    if (s.paymentMode !== 'percentage' && s.paymentMode !== 'amount') throw badRequest("paymentMode must be 'percentage' or 'amount'")
    // After locking started these rules run in the console (the server cannot read the amounts).
    if (!(await moneyForm([s.paymentPercentage, s.paymentAmount]))) {
        const project = await Project.findById(m.projectId).select('budget').lean()
        const budget = typeof project?.budget === 'number' ? project.budget : 0
        if (!(s.paymentPercentage >= 0 && s.paymentPercentage <= 100) || !(s.paymentAmount >= 0)) throw badRequest('Payment must be 0-100% and an amount of 0 or more')
        const expected = s.paymentMode === 'percentage'
            ? { paymentPercentage: s.paymentPercentage, paymentAmount: round2(budget * s.paymentPercentage / 100) }
            : { paymentPercentage: budget > 0 ? round2(s.paymentAmount / budget * 100) : 0, paymentAmount: s.paymentAmount }
        if (expected.paymentPercentage !== s.paymentPercentage || expected.paymentAmount !== s.paymentAmount) throw badRequest(`Percentage and amount do not match the project budget (${budget})`)
        if (s.paymentMode === 'amount' && budget <= 0 && s.paymentAmount > 0) throw badRequest('The project budget is 0. Set a budget first')
        const others = await Milestone.find({ projectId: m.projectId, _id: { $ne: id } }).lean()
        const used = others.reduce((sum, o) => sum + percentOf(o, budget), 0) + percentOf(s, budget)
        if (used > 100.0001) throw conflict(`Milestone payments cannot exceed 100% of the project budget (this makes ${round2(used)}%)`)
    }
    if (!/^[A-Z]{3}$/.test(s.currency)) throw badRequest('currency must be a 3-letter code')
    if (!MILESTONE_PAYMENT_STATUSES.includes(s.paymentStatus)) throw badRequest('Unknown payment status')
    const dates = s.paymentStatus === 'paid' ? !!(s.invoicedAt && s.paidAt) : s.paymentStatus === 'invoiced' ? !!s.invoicedAt && !s.paidAt : !s.invoicedAt && !s.paidAt
    if (!dates) throw badRequest('Invoiced needs an invoice date; paid needs both dates; unpaid has none')
    const $set: Record<string, unknown> = {
        paymentMode: s.paymentMode, paymentPercentage: s.paymentPercentage, paymentAmount: s.paymentAmount, currency: s.currency,
        paymentStatus: s.paymentStatus, ownerSeal: { seq: null, hash },
    }
    const $unset: Record<string, ''> = {}
    for (const f of ['invoicedAt', 'paidAt']) { if (s[f]) $set[f] = new Date(s[f]); else $unset[f] = '' }
    await Milestone.updateOne({ _id: id }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) })
    const after = milestoneState((await Milestone.findById(id).lean())!)
    if (canonicalJson(after) !== canonicalJson(s)) throw new Error(`Stored state of ${c.key} differs from the signed state`)
    const entry = await record(req, res, 'milestone.payment', [c.key], id)
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

router.post('/milestones/delete', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'milestone.delete' || !Array.isArray(b.changes) || b.changes.length !== 1 || b.changes[0]?.state !== null) throw badRequest("Send { action: 'milestone.delete', changes: [{ key, state: null }] }")
    const p = parseKey(b.changes[0].key)
    if (p?.type !== 'milestones') throw badRequest('Not a milestone')
    const gone = await Milestone.findByIdAndDelete(p.id)
    if (!gone) throw notFound('Milestone not found')
    const entry = await record(req, res, 'milestone.delete', [], p.id)
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

export default router
