import { Router } from 'express'
import {
    createHistoryEntry,
    deleteHistoryEntry,
    getEmployeeHistory,
    getHistoryEntry,
    getHistoryTypes,
    getMyHistory,
    updateHistoryEntry,
} from '../controller/employeeHistory.controller.js'
import { NextFunction, Request, Response } from 'express'
import EmployeeHistory from '../model/employeeHistory.model.js'
import { isAllow, isVerified } from '../middlewares/isVerified.js'
import { OWNER_CONSOLE_ONLY } from '../middlewares/ownerConsoleOnly.js'
import { isObjectId } from '../utils/http.js'

// Entries with salary figures (from/to salary) are owner records, kept in the Owner Console (signed and sealed).
// The website still adds, edits and deletes the other entries.
const hasSalary = (v: any) => (v?.fromSalary !== undefined && v?.fromSalary !== null && v?.fromSalary !== '')
    || (v?.toSalary !== undefined && v?.toSalary !== null && v?.toSalary !== '')
const noSalaryFigures = async (req: Request, res: Response, next: NextFunction) => {
    // "Apply to profile" changes the person's position and salary (owner-only), and fills in a salary figure.
    const apply = req.body?.applyToProfile === true || req.body?.applyToProfile === 'true'
    let refuse = hasSalary(req.body) || apply
    if (!refuse && req.params.id && isObjectId(String(req.params.id))) refuse = hasSalary(await EmployeeHistory.findById(req.params.id).select('fromSalary toSalary').lean())
    if (refuse) { res.status(403).json({ success: false, message: `Salary entries: ${OWNER_CONSOLE_ONLY}`, ownerConsole: true }); return }
    next()
}

const router = Router()
const adminOnly = isAllow(['admin'])

// Every route requires a logged-in user. Own-vs-any access is checked inside the controller.
router.use(isVerified)

// Fixed paths first so they are never mistaken for an :id
router.get('/types', getHistoryTypes)
router.get('/me', getMyHistory)

router.get('/employee/:employeeId', getEmployeeHistory)
router.post('/employee/:employeeId', adminOnly, noSalaryFigures, createHistoryEntry)

router.get('/:id', getHistoryEntry)
router.patch('/:id', adminOnly, noSalaryFigures, updateHistoryEntry)
router.delete('/:id', adminOnly, noSalaryFigures, deleteHistoryEntry)

export default router
