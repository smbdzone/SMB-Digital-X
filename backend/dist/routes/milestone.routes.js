import { Router } from 'express';
import { createMilestone, deleteMilestone, getMilestone, getProjectMilestones, reorderMilestones, toggleDeliverable, updateMilestone, updateMilestonePayment, updateMilestoneStatus, } from '../controller/milestone.controller.js';
import { isAllow, isVerified } from '../middlewares/isVerified.js';
const router = Router();
const adminOnly = isAllow(['admin']);
// Every route requires a logged-in user. Reading is limited to admins and employees assigned
// to the project (checked inside the controller); every change is admin-only.
router.use(isVerified);
// Per project
router.get('/project/:projectId', getProjectMilestones);
router.post('/project/:projectId', adminOnly, createMilestone);
router.patch('/project/:projectId/reorder', adminOnly, reorderMilestones);
// Single milestone
router.get('/:id', getMilestone);
router.patch('/:id', adminOnly, updateMilestone);
router.patch('/:id/status', adminOnly, updateMilestoneStatus);
router.patch('/:id/payment', adminOnly, updateMilestonePayment);
router.patch('/:id/deliverables/:deliverableId', adminOnly, toggleDeliverable);
router.delete('/:id', adminOnly, deleteMilestone);
export default router;
