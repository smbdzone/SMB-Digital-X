import { Router } from 'express';
import { createHistoryEntry, deleteHistoryEntry, getEmployeeHistory, getHistoryEntry, getHistoryTypes, getMyHistory, updateHistoryEntry, } from '../controller/employeeHistory.controller.js';
import { isAllow, isVerified } from '../middlewares/isVerified.js';
const router = Router();
const adminOnly = isAllow(['admin']);
// Every route requires a logged-in user. Own-vs-any access is checked inside the controller.
router.use(isVerified);
// Fixed paths first so they are never mistaken for an :id
router.get('/types', getHistoryTypes);
router.get('/me', getMyHistory);
router.get('/employee/:employeeId', getEmployeeHistory);
router.post('/employee/:employeeId', adminOnly, createHistoryEntry);
router.get('/:id', getHistoryEntry);
router.patch('/:id', adminOnly, updateHistoryEntry);
router.delete('/:id', adminOnly, deleteHistoryEntry);
export default router;
