import { Router } from 'express';
import { bulkPaySalariesController, generateSalaries, getAllSalaries, getMySalaries, getSalary, resendSalarySlip, updateSalary, } from '../controller/salary.controller.js';
import { isAllow, isVerified } from '../middlewares/isVerified.js';
const routes = Router();
const adminOnly = isAllow(['admin']);
// Every salary route requires a logged-in user.
routes.use(isVerified);
// Employee
routes.get('/my', getMySalaries);
// Admin
routes.get('/', adminOnly, getAllSalaries);
routes.post('/generate', adminOnly, generateSalaries);
routes.post('/bulk-pay', adminOnly, bulkPaySalariesController);
// Admin, or the owner for GET (checked inside the controller)
routes.get('/:id', getSalary);
routes.patch('/:id', adminOnly, updateSalary);
routes.post('/:id/resend-email', adminOnly, resendSalarySlip);
export default routes;
