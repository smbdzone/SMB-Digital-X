import { Request, Response } from 'express'
import { Types } from 'mongoose'
import Milestone, {
    IMilestone,
    MILESTONE_STATUSES,
    MilestoneStatus,
} from '../model/milestone.model.js'
import Project from '../model/project.model.js'
import { round2 } from '../utils/money.js'
import {
    AuthUser,
    asAmount,
    asCurrency,
    asDate,
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

// Admin: any project. Employee: only projects they are assigned to.
const loadProject = async (projectId: string, auth: AuthUser) => {
    const project = await Project.findById(projectId).select('name status employees').lean()
    if (!project) throw notFound('Project not found')
    if (!isAdmin(auth) && !project.employees.some(e => String(e) === auth.id)) {
        throw forbidden('You are not assigned to this project')
    }
    return project
}

// Money (the project budget, each milestone's share and amount, and their totals) is set and shown only in the Owner
// Console; once locking has started the database holds it as locked values that only the console can read. The website
// never sends any of it to the browser, not even to the admin: it shows "Locked: view in the Owner Console" instead.
const HIDDEN_MONEY = ['paymentPercentage', 'paymentAmount', 'ownerSeal'] as const

// Shape returned to the frontend: the work fields and handy flags, no money.
const toView = (raw: any) => {
    const m = { ...(typeof raw.toObject === 'function' ? raw.toObject() : raw) }
    for (const f of HIDDEN_MONEY) delete m[f]
    const deliverables: any[] = m.deliverables ?? []
    const isOverdue = !!m.deadline && m.status !== 'completed' && new Date(m.deadline).getTime() < Date.now()
    return {
        ...m,
        paymentLocked: true,
        isOverdue,
        deliverablesTotal: deliverables.length,
        deliverablesDone: deliverables.filter(d => d.isDone).length,
    }
}

const buildSummary = (views: ReturnType<typeof toView>[]) => {
    const count = (s: MilestoneStatus) => views.filter(v => v.status === s).length
    return {
        total: views.length,
        pending: count('pending'),
        inProgress: count('in_progress'),
        completed: count('completed'),
        delayed: count('delayed'),
        overdue: views.filter(v => v.isOverdue).length,
        progressPercent: views.length ? round2(count('completed') / views.length * 100) : 0,
        financeLocked: true,
    }
}

// Employees see the work (title, dates, status, deliverables), nothing about payment: no payment mode, currency or
// payment status either. The admin also sees the payment status and its dates (not amounts).
const FINANCE_FIELDS = ['paymentMode', 'currency', 'paymentStatus', 'invoicedAt', 'paidAt', 'paymentLocked'] as const

const forViewer = (view: ReturnType<typeof toView>, auth: AuthUser) => {
    if (isAdmin(auth)) return view
    const out: Record<string, unknown> = { ...view }
    for (const field of FINANCE_FIELDS) delete out[field]
    return out
}

const summaryForViewer = (summary: ReturnType<typeof buildSummary>, auth: AuthUser) => {
    if (isAdmin(auth)) return summary
    const { financeLocked: _locked, ...rest } = summary
    return rest
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

/* ------------------------------------------------------------------ */
/* Controllers                                                         */
/* ------------------------------------------------------------------ */

// GET /api/milestones/project/:projectId  (admin, or an employee assigned to the project)
export const getProjectMilestones = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const projectId = paramId(req, 'projectId')
    const project = await loadProject(projectId, auth)

    const milestones = await Milestone.find({ projectId }).sort({ order: 1, createdAt: 1 }).lean()
    const views = milestones.map(m => toView(m))

    res.status(200).json({
        success: true,
        project: isAdmin(auth)
            ? { id: project._id, name: project.name, status: project.status, budgetLocked: true }
            : { id: project._id, name: project.name, status: project.status },
        summary: summaryForViewer(buildSummary(views), auth),
        data: views.map(v => forViewer(v, auth)),
    })
}

// GET /api/milestones/:id
export const getMilestone = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    await loadProject(String(milestone.projectId), auth)
    res.status(200).json({ success: true, data: forViewer(toView(milestone), auth) })
}

// POST /api/milestones/project/:projectId  (admin)
export const createMilestone = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const projectId = paramId(req, 'projectId')
    await loadProject(projectId, auth)
    const b = req.body ?? {}

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
        paymentMode: 'percentage',   // payments are set in the Owner Console (the guard refuses them here)
        paymentPercentage: 0,
        paymentAmount: 0,
        currency: isSent(b.currency) ? asCurrency(b.currency) : 'AED',
        deliverables: b.deliverables !== undefined ? parseDeliverables(b.deliverables) : [],
        notes: asText(b.notes, 'notes', { max: 2000 }),
        createdBy: new Types.ObjectId(auth.id),
    })

    if (isSent(b.status)) applyStatus(milestone, asStatus(b.status))

    await milestone.save()
    res.status(201).json({ success: true, message: 'Milestone added', data: toView(milestone) })
}

// PATCH /api/milestones/:id  (admin) - only the fields that are sent are changed
export const updateMilestone = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    await loadProject(String(milestone.projectId), auth)
    const b = req.body ?? {}

    if (b.title !== undefined) milestone.title = asText(b.title, 'title', { required: true, max: 150 })
    if (b.description !== undefined) milestone.description = asText(b.description, 'description', { max: 2000 }) ?? ''
    if (b.notes !== undefined) milestone.notes = asText(b.notes, 'notes', { max: 2000 }) ?? ''
    if (b.currency !== undefined) milestone.currency = asCurrency(b.currency)
    if (b.order !== undefined) milestone.order = Math.floor(asAmount(b.order, 'order'))

    // null or '' clears a date
    if (b.startDate !== undefined) milestone.startDate = isSent(b.startDate) ? asDate(b.startDate, 'startDate') : undefined
    if (b.deadline !== undefined) milestone.deadline = isSent(b.deadline) ? asDate(b.deadline, 'deadline') : undefined

    if (b.deliverables !== undefined) {
        milestone.set('deliverables', parseDeliverables(b.deliverables, milestone.deliverables as any))
    }

    if (isSent(b.status)) applyStatus(milestone, asStatus(b.status))

    milestone.updatedBy = new Types.ObjectId(auth.id)
    await milestone.save()

    res.status(200).json({ success: true, message: 'Milestone updated', data: toView(milestone) })
}

// PATCH /api/milestones/:id/status  (admin)  body: { status }
export const updateMilestoneStatus = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const milestone = await Milestone.findById(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    await loadProject(String(milestone.projectId), auth)
    applyStatus(milestone, asStatus(req.body?.status))
    milestone.updatedBy = new Types.ObjectId(auth.id)
    await milestone.save()

    res.status(200).json({ success: true, message: 'Milestone status updated', data: toView(milestone) })
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

    await loadProject(String(milestone.projectId), auth)
    res.status(200).json({ success: true, message: 'Deliverable updated', data: toView(milestone) })
}

// PATCH /api/milestones/project/:projectId/reorder  (admin)  body: { order: [milestoneId, ...] }
export const reorderMilestones = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const projectId = paramId(req, 'projectId')
    await loadProject(projectId, auth)

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
        data: milestones.map(m => toView(m)),
    })
}

// DELETE /api/milestones/:id  (admin)
export const deleteMilestone = async (req: Request, res: Response): Promise<void> => {
    const milestone = await Milestone.findByIdAndDelete(paramId(req))
    if (!milestone) throw notFound('Milestone not found')

    res.status(200).json({ success: true, message: 'Milestone deleted' })
}
