import { Router } from 'express'

import {
    createExpenseController,
    deleteReceiptController,
    getAllExpenses,
    getExpenseController,
    getProjectExpensesController,
    updateExpenseController,
    uploadReceiptController,
} from '../controller/expense.controller.js'
import { isVerified } from '../middlewares/isVerified.js'
import { ownerConsoleOnly } from '../middlewares/ownerConsoleOnly.js'
import { upload } from '../middlewares/multer.js'

const router = Router()

// Every expense route requires a logged-in user. Fine-grained rules (own expenses only,
// edit while pending, project membership) are enforced inside the controllers.
router.use(isVerified)

router.post('/', createExpenseController)
router.get('/', getAllExpenses)
router.get('/project/:projectId', getProjectExpensesController)

router.get('/:id', getExpenseController)
router.patch('/:id', updateExpenseController)
// Approve / reject / reimburse and delete are done in the Owner Console: refused here for everyone.
router.patch('/:id/status', ownerConsoleOnly)
router.delete('/:id', ownerConsoleOnly)

router.post('/:id/receipts', upload.single('receipt'), uploadReceiptController)
router.delete('/:id/receipts/:receiptId', deleteReceiptController)

export default router
