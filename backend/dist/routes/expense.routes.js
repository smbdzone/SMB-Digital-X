import { Router } from 'express';
import { createExpenseController, deleteExpenseController, deleteReceiptController, getAllExpenses, getExpenseController, getProjectExpensesController, updateExpenseController, updateExpenseStatusController, uploadReceiptController, } from '../controller/expense.controller.js';
import { isAllow, isVerified } from '../middlewares/isVerified.js';
import { upload } from '../middlewares/multer.js';
const router = Router();
// Every expense route requires a logged-in user. Fine-grained rules (own expenses only,
// edit while pending, project membership) are enforced inside the controllers.
router.use(isVerified);
router.post('/', createExpenseController);
router.get('/', getAllExpenses);
router.get('/project/:projectId', getProjectExpensesController);
router.get('/:id', getExpenseController);
router.patch('/:id', updateExpenseController);
router.patch('/:id/status', isAllow(['admin']), updateExpenseStatusController);
router.delete('/:id', isAllow(['admin']), deleteExpenseController);
router.post('/:id/receipts', upload.single('receipt'), uploadReceiptController);
router.delete('/:id/receipts/:receiptId', deleteReceiptController);
export default router;
