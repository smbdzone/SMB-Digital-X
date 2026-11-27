import { Router } from 'express'
import {
    createMilestone,
    deleteMilestone,
    getMilestone,
    getProjectMilestones,
    reorderMilestones,
    toggleDeliverable,
    updateMilestone,
    updateMilestoneStatus,
} from '../controller/milestone.controller.js'
import { isAllow, isVerified } from '../middlewares/isVerified.js'
import { ownerConsoleOnly } from '../middlewares/ownerConsoleOnly.js'
import { milestoneCreateGuard, milestoneDeleteGuard, milestoneUpdateGuard } from '../middlewares/moneyGuards.js'

const router = Router()
const adminOnly = isAllow(['admin'])

// Every route requires a logged-in user. Reading is limited to admins and employees assigned
// to the project (checked inside the controller); every change is admin-only.
router.use(isVerified)

// Per project
router.get('/project/:projectId', getProjectMilestones)
router.post('/project/:projectId', adminOnly, milestoneCreateGuard, createMilestone)
router.patch('/project/:projectId/reorder', adminOnly, reorderMilestones)

// Single milestone
router.get('/:id', getMilestone)
router.patch('/:id', adminOnly, milestoneUpdateGuard, updateMilestone)
router.patch('/:id/status', adminOnly, updateMilestoneStatus)
// Payments (invoiced / paid) are done in the Owner Console.
router.patch('/:id/payment', ownerConsoleOnly)
router.patch('/:id/deliverables/:deliverableId', adminOnly, toggleDeliverable)
router.delete('/:id', adminOnly, milestoneDeleteGuard, deleteMilestone)

export default router
