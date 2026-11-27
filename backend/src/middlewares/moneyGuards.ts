import { NextFunction, Request, Response } from 'express'
import Project from '../model/project.model.js'
import Milestone from '../model/milestone.model.js'
import { isObjectId } from '../utils/http.js'
import { OWNER_CONSOLE_ONLY } from './ownerConsoleOnly.js'
import { isLocked } from '../owner/vault.js'

/*
 * Projects and milestones: the website keeps everything without money; anything involving a budget or a payment is
 * done in the Owner Console (signed and sealed). These guards refuse the money parts for everyone, the admin included.
 */
const refuse = (res: Response, what: string) => { res.status(403).json({ success: false, message: `${what}: ${OWNER_CONSOLE_ONLY}`, ownerConsole: true }) }
const positive = (v: unknown) => v !== undefined && v !== null && v !== '' && Number(v) !== 0
const sent = (v: unknown) => v !== undefined
const PAYMENT_FIELDS = ['paymentPercentage', 'paymentAmount', 'paymentStatus', 'invoicedAt', 'paidAt', 'paymentMode']

// A locked value (Phase 2) always counts as money: the website cannot read it, so it cannot know it is 0.
const hasMoney = (v: unknown) => isLocked(v) || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v !== '' && Number(v) !== 0)
const milestoneHasMoney = (m: any) => !!m && (hasMoney(m.paymentPercentage) || hasMoney(m.paymentAmount) || (m.paymentStatus ?? 'unpaid') !== 'unpaid')

export const projectCreateGuard = (req: Request, res: Response, next: NextFunction) => {
    if (positive(req.body?.budget)) return refuse(res, 'Project budgets')
    next()
}

export const projectUpdateGuard = async (req: Request, res: Response, next: NextFunction) => {
    if (sent(req.body?.budget)) {
        const p = isObjectId(String(req.params.id)) ? await Project.findById(req.params.id).select('budget').lean() : null
        // Only the unchanged plain value may be sent back; a locked budget cannot be sent at all.
        if (!p || typeof p.budget !== 'number' || Number(req.body.budget) !== p.budget) return refuse(res, 'Project budgets')
    }
    next()
}

export const projectDeleteGuard = async (req: Request, res: Response, next: NextFunction) => {
    if (isObjectId(String(req.params.id))) {
        const p = await Project.findById(req.params.id).select('budget').lean()
        const ms = await Milestone.find({ projectId: req.params.id }).select('paymentPercentage paymentAmount paymentStatus').lean()
        if (hasMoney(p?.budget) || ms.some(milestoneHasMoney)) return refuse(res, 'Deleting a project with a budget or milestone payments')
    }
    next()
}

export const milestoneCreateGuard = (req: Request, res: Response, next: NextFunction) => {
    const b = req.body ?? {}
    if (positive(b.paymentPercentage) || positive(b.paymentAmount) || sent(b.paymentStatus) || sent(b.invoicedAt) || sent(b.paidAt)) return refuse(res, 'Milestone payments')
    next()
}

export const milestoneUpdateGuard = async (req: Request, res: Response, next: NextFunction) => {
    const b = req.body ?? {}
    if (PAYMENT_FIELDS.some(f => sent(b[f]))) return refuse(res, 'Milestone payments')
    if (sent(b.currency) && isObjectId(String(req.params.id))) {
        const m = await Milestone.findById(req.params.id).lean()
        if (m && milestoneHasMoney(m) && String(b.currency).toUpperCase() !== m.currency) return refuse(res, 'The currency of a milestone with a payment')
    }
    next()
}

export const milestoneDeleteGuard = async (req: Request, res: Response, next: NextFunction) => {
    const m = isObjectId(String(req.params.id)) ? await Milestone.findById(req.params.id).lean() : null
    if (milestoneHasMoney(m)) return refuse(res, 'Deleting a milestone with a payment')
    next()
}
