import { Request, Response } from 'express'
import { Types } from 'mongoose'
import Milestone, {
    IMilestone,
    MILESTONE_PAYMENT_STATUSES,
    MILESTONE_STATUSES,
    MilestonePaymentStatus,
    MilestoneStatus,
} from '../model/milestone.model.js'
import Project from '../model/project.model.js'
import { round2, sumMoney } from '../utils/money.js'
import {
    AuthUser,
    asAmount,
    asCurrency,
    asDate,
    asPercent,
    asText,
    badRequest,
    forbidden,
    getAuth,
    isAdmin,
    isObjectId,
    notFound,
    paramId,
} from '../utils/http.js'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const isSent = (v: unknown): boolean => v !== undefined && v !== null && v !== ''

const asStatus = (value: unknown): MilestoneStatus => {
    if (typeof value !== 'string' || !(MILESTONE_STATUSES as readonly string[]).includes(value)) {
        throw badRequest(`status must be one of: ${MILESTONE_STATUSES.join(', ')}`)
    }
    return value as MilestoneStatus
}

const asPaymentStatus = (value: unknown): MilestonePaymentStatus => {
    if (typeof value !== 'string' || !(MILESTONE_PAYMENT_STATUSES as readonly string[]).includes(value)) {
        throw badRequest(`paymentStatus must be one of: ${MILESTONE_PAYMENT_STATUSES.join(', ')}`)
    }
    return value as MilestonePaymentStatus
}

// Admin: any project. Employee: only projects they are assigned to.
const loadProject = async (projectId: string, auth: AuthUser) => {
    const project = await Project.findById(projectId).select('name budget status employees').lean()
    if (!project) throw notFound('Project not found')
    if (!isAdmin(auth) && !project.employees.some(e => String(e) === auth.id)) {
        throw forbidden('You are not assigned to this project')
    }
    return project
}

// The admin types a percentage OR an amount; the other value follows the project budget.
// So the share always stays correct even if the budget is edited later.
const percentOf = (m: { paymentMode?: string; paymentPercentage?: number; paymentAmount?: number }, budget: number): number => {
    if (m.paymentMode === 'amount') return budget > 0 ? (m.paymentAmount ?? 0) / budget * 100 : 0
    return m.paymentPercentage ?? 0
}

const amountOf = (m: { paymentMode?: string; paymentPercentage?: number; paymentAmount?: number }, budget: number): number => {
    if (m.paymentMode === 'amount') return m.paymentAmount ?? 0
    return round2(budget * (m.paymentPercentage ?? 0) / 100)
}

// Shape returned to the frontend: payment values recalculated from the current budget + handy flags.
const toView = (raw: any, budget: number) => {
    const m = typeof raw.toObject === 'function' ? raw.toObject() : raw
    const deliverables: any[] = m.deliverables ?? []
    const isOverdue = !!m.deadline && m.status !== 'completed' && new Date(m.deadline).getTime() < Date.now()
    return {
        ...m,
        paymentPercentage: round2(percentOf(m, budget)),
        paymentAmount: amountOf(m, budget),
        isOverdue,
        deliverablesTotal: deliverables.length,
        deliverablesDone: deliverables.filter(d => d.isDone).length,
    }
}

const buildSummary = (views: ReturnType<typeof toView>[], budget: number) => {
    const count = (s: MilestoneStatus) => views.filter(v => v.status === s).length
    const paid = sumMoney(views.filter(v => v.paymentStatus === 'paid').map(v => v.paymentAmount))
    const invoiced = sumMoney(views.filter(v => v.paymentStatus === 'invoiced').map(v => v.paymentAmount))
    const allocated = sumMoney(views.map(v => v.paymentAmount))
    const allocatedPercent = round2(views.reduce((s, v) => s + v.paymentPercentage, 0))

    return {
        total: views.length,
        pending: count('pending'),
        inProgress: count('in_progress'),
        completed: count('completed'),
        delayed: count('delayed'),
        overdue: views.filter(v => v.isOverdue).length,
        progressPercent: views.length ? round2(count('completed') / views.length * 100) : 0,
        budget,
        allocatedPercent,
        allocatedAmount: allocated,
        unallocatedPercent: round2(Math.max(0, 100 - allocatedPercent)),
        unallocatedAmount: round2(Math.max(0, budget - allocated)),
        paidAmount: paid,
        invoicedAmount: invoiced,
        unpaidAmount: round2(allocated - paid - invoiced),
    }
}

// All milestones of one project must never promise more than 100% of the budget.
const assertWithinBudget = async (projectId: string | Types.ObjectId, budget: number, newPercent: number, excludeId?: string) => {
    const others = await Milestone.find({ projectId, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
        .select('paymentMode paymentPercentage paymentAmount')
        .lean()
    const used = others.reduce((sum, m) => sum + percentOf(m, budget), 0)
    if (used + newPercent > 100.01) {
        throw badRequest(
            `Milestone payments cannot exceed 100% of the project budget. Already allocated: ${round2(used)}%, remaining: ${round2(Math.max(0, 100 - used))}%`
        )
    }
}

// Reads { paymentPercentage } or { paymentAmount } from the body. If both are sent, the percentage wins.
const parsePayment = (b: any, budget: number) => {
    if (isSent(b.paymentPercentage)) {
        const pct = asPercent(b.paymentPercentage, 'paymentPercentage')
        return { paymentMode: 'percentage' as const, paymentPercentage: pct, paymentAmount: round2(budget * pct / 100) }
    }
    if (isSent(b.paymentAmount)) {
        const amount = asAmount(b.paymentAmount, 'paymentAmount')
        if (budget <= 0 && amount > 0) throw badRequest('The project budget is 0. Set a project budget before adding a payment amount')
        const pct = budget > 0 ? round2(amount / budget * 100) : 0
        return { paymentMode: 'amount' as const, paymentPercentage: pct, paymentAmount: amount }
    }
    return undefined
}

const parseDeliverables = (value: unknown, existing: any[] = []) => {
    if (!Array.isArray(value)) throw badRequest('deliverables must be an array')
    if (value.length > 50) throw badRequest('deliverables has too many items')

    return value.map((item, i) => {
        if (typeof item !== 'object' || item === null) throw badRequest(`deliverables[${i}] is invalid`)
        const d = item as any
        const isDone = d.isDone === true || d.isDone === 'true'
        const previous = isObjectId(d._id) ? existing.find(e => String(e._id) === d._id) : undefined

        return {
            ...(isObjectId(d._id) ? { _id: new Types.ObjectId(d._id) } : {}),
            title: asText(d.title, `deliverables[${i}].title`, { required: true, max: 200 }),
            description: asText(d.description, `deliverables[${i}].description`, { max: 1000 }),
            isDone,
            doneAt: isDone ? (previous?.doneAt ?? new Date()) : undefined,
        }
    })
}

// Status rules in one place: the dates stay consistent no matter which endpoint changed it.
const applyStatus = (m: IMilestone, status: MilestoneStatus) => {
    m.status = status
    if (status === 'completed') m.completedAt = m.completedAt ?? new Date()
    else m.completedAt = undefined
}

const applyPaymentStatus = (m: IMilestone, status: MilestonePaymentStatus, paidAt?: Date) => {
    m.paymentStatus = status
    if (status === 'paid') {
        m.paidAt = paidAt ?? m.paidAt ?? new Date()
        m.invoicedAt = m.invoicedAt ?? m.paidAt
    } else if (status === 'invoiced') {
        m.invoicedAt = m.invoicedAt ?? new Date()
        m.paidAt = undefined
    } else {
        m.invoicedAt = undefined
        m.paidAt = undefined
    }
}

/* ------------------------------------------------------------------ */
/* Controllers                                                         */
/* ------------------------------------------------------------------ */

// GET /api/milestones/project/:projectId  (admin, or an employee assigned to the project)
export const getProjectMilestones = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const projectId = paramId(req, 'projectId')
    const project = await loadProject(projectId, auth)

    const milestones = await Milestone.find({ projectId }).sort({ order: 1, createdAt: 1 }).lean()
    const views = milestones.map(m => toView(m, project.budget))

    res.status(200).json({
        success: true,
        project: { id: project._id, name: project.name, status: project.status, budget: project.budget },
        summary: buildSummary(views, project.budget),
        data: views,
    })
}

// GET /api/milestones/:id
export const getMilestone = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    const project = await loadProject(String(milestone.projectId), auth)
    res.status(200).json({ success: true, data: toView(milestone, project.budget) })
}

// POST /api/milestones/project/:projectId  (admin)
export const createMilestone = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const projectId = paramId(req, 'projectId')
    const project = await loadProject(projectId, auth)
    const b = req.body ?? {}

    const payment = parsePayment(b, project.budget) ?? { paymentMode: 'percentage' as const, paymentPercentage: 0, paymentAmount: 0 }
    await assertWithinBudget(projectId, project.budget, payment.paymentPercentage)

    // New milestones go to the end unless an order is given.
    let order: number
    if (isSent(b.order)) {
        order = Math.floor(asAmount(b.order, 'order'))
    } else {
        const last = await Milestone.findOne({ projectId }).sort({ order: -1 }).select('order').lean()
        order = last ? last.order + 1 : 1
    }

    const milestone = new Milestone({
        projectId,
        title: asText(b.title, 'title', { required: true, max: 150 }),
        description: asText(b.description, 'description', { max: 2000 }),
        order,
        startDate: isSent(b.startDate) ? asDate(b.startDate, 'startDate') : undefined,
        deadline: isSent(b.deadline) ? asDate(b.deadline, 'deadline') : undefined,
        ...payment,
        currency: isSent(b.currency) ? asCurrency(b.currency) : 'AED',
        deliverables: b.deliverables !== undefined ? parseDeliverables(b.deliverables) : [],
        notes: asText(b.notes, 'notes', { max: 2000 }),
        createdBy: new Types.ObjectId(auth.id),
    })

    if (isSent(b.status)) applyStatus(milestone, asStatus(b.status))
    if (isSent(b.paymentStatus)) applyPaymentStatus(milestone, asPaymentStatus(b.paymentStatus), isSent(b.paidAt) ? asDate(b.paidAt, 'paidAt') : undefined)

    await milestone.save()
    res.status(201).json({ success: true, message: 'Milestone added', data: toView(milestone, project.budget) })
}

// PATCH /api/milestones/:id  (admin) - only the fields that are sent are changed
export const updateMilestone = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    const project = await loadProject(String(milestone.projectId), auth)
    const b = req.body ?? {}

    if (b.title !== undefined) milestone.title = asText(b.title, 'title', { required: true, max: 150 })
    if (b.description !== undefined) milestone.description = asText(b.description, 'description', { max: 2000 }) ?? ''
    if (b.notes !== undefined) milestone.notes = asText(b.notes, 'notes', { max: 2000 }) ?? ''
    if (b.currency !== undefined) milestone.currency = asCurrency(b.currency)
    if (b.order !== undefined) milestone.order = Math.floor(asAmount(b.order, 'order'))

    // null or '' clears a date
    if (b.startDate !== undefined) milestone.startDate = isSent(b.startDate) ? asDate(b.startDate, 'startDate') : undefined
    if (b.deadline !== undefined) milestone.deadline = isSent(b.deadline) ? asDate(b.deadline, 'deadline') : undefined

    const payment = parsePayment(b, project.budget)
    if (payment) {
        await assertWithinBudget(milestone.projectId, project.budget, payment.paymentPercentage, String(milestone._id))
        milestone.paymentMode = payment.paymentMode
        milestone.paymentPercentage = payment.paymentPercentage
        milestone.paymentAmount = payment.paymentAmount
    }

    if (b.deliverables !== undefined) {
        milestone.set('deliverables', parseDeliverables(b.deliverables, milestone.deliverables as any))
    }

    if (isSent(b.status)) applyStatus(milestone, asStatus(b.status))
    if (isSent(b.paymentStatus)) applyPaymentStatus(milestone, asPaymentStatus(b.paymentStatus), isSent(b.paidAt) ? asDate(b.paidAt, 'paidAt') : undefined)

    milestone.updatedBy = new Types.ObjectId(auth.id)
    await milestone.save()

    res.status(200).json({ success: true, message: 'Milestone updated', data: toView(milestone, project.budget) })
}

// PATCH /api/milestones/:id/status  (admin)  body: { status }
export const updateMilestoneStatus = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    const project = await loadProject(String(milestone.projectId), auth)
    applyStatus(milestone, asStatus(req.body?.status))
    milestone.updatedBy = new Types.ObjectId(auth.id)
    await milestone.save()

    res.status(200).json({ success: true, message: 'Milestone status updated', data: toView(milestone, project.budget) })
}

// PATCH /api/milestones/:id/payment  (admin)  body: { paymentStatus, paidAt? }
export const updateMilestonePayment = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    const project = await loadProject(String(milestone.projectId), auth)
    const b = req.body ?? {}
    applyPaymentStatus(milestone, asPaymentStatus(b.paymentStatus), isSent(b.paidAt) ? asDate(b.paidAt, 'paidAt') : undefined)
    milestone.updatedBy = new Types.ObjectId(auth.id)
    await milestone.save()

    res.status(200).json({ success: true, message: 'Milestone payment updated', data: toView(milestone, project.budget) })
}

// PATCH /api/milestones/:id/deliverables/:deliverableId  (admin)  body: { isDone? } - toggles when omitted
export const toggleDeliverable = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    const deliverable = milestone.deliverables.id(paramId(req, 'deliverableId'))
    if (!deliverable) throw notFound('Deliverable not found')

    const b = req.body ?? {}
    const next = b.isDone === undefined ? !deliverable.isDone : (b.isDone === true || b.isDone === 'true')
    deliverable.isDone = next
    deliverable.doneAt = next ? (deliverable.doneAt ?? new Date()) : undefined

    milestone.updatedBy = new Types.ObjectId(auth.id)
    await milestone.save()

    const project = await loadProject(String(milestone.projectId), auth)
    res.status(200).json({ success: true, message: 'Deliverable updated', data: toView(milestone, project.budget) })
}

// PATCH /api/milestones/project/:projectId/reorder  (admin)  body: { order: [milestoneId, ...] }
export const reorderMilestones = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const projectId = paramId(req, 'projectId')
    const project = await loadProject(projectId, auth)

    const ids: unknown = req.body?.order
    if (!Array.isArray(ids) || ids.length === 0) throw badRequest('order must be a non-empty array of milestone ids')
    if (!ids.every(isObjectId)) throw badRequest('order contains an invalid milestone id')
    if (new Set(ids).size !== ids.length) throw badRequest('order contains duplicate ids')

    const found = await Milestone.countDocuments({ projectId, _id: { $in: ids } })
    if (found !== ids.length) throw badRequest('order contains milestones that do not belong to this project')

    await Milestone.bulkWrite(
        (ids as string[]).map((id, index) => ({
            updateOne: { filter: { _id: id, projectId }, update: { $set: { order: index + 1 } } },
        }))
    )

    const milestones = await Milestone.find({ projectId }).sort({ order: 1, createdAt: 1 }).lean()
    res.status(200).json({
        success: true,
        message: 'Milestones reordered',
        data: milestones.map(m => toView(m, project.budget)),
    })
}

// DELETE /api/milestones/:id  (admin)
export const deleteMilestone = async (req: Request, res: Response): Promise<void> => {
    const milestone = await Milestone.findByIdAndDelete(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    res.status(200).json({ success: true, message: 'Milestone deleted' })
}
