import { Router } from 'express';
import {
    downloadSalarySlipPdf,
    getAllSalaries,
    getMySalaries,
    getSalary,
} from '../controller/salary.controller.js';
import { isAllow, isVerified } from '../middlewares/isVerified.js';
import { ownerConsoleOnly } from '../middlewares/ownerConsoleOnly.js';

const routes = Router();
const adminOnly = isAllow(['admin']);

// Every salary route requires a logged-in user.
routes.use(isVerified);

// Employee
routes.get('/my', getMySalaries);

// Admin
routes.get('/', adminOnly, getAllSalaries);
// Payroll changes are done in the Owner Console (signed and recorded): refused here for everyone, the admin included.
routes.post('/generate', ownerConsoleOnly);
routes.post('/bulk-pay', ownerConsoleOnly);

// Admin, or the owner for GET (checked inside the controller)
routes.get('/:id/pdf', downloadSalarySlipPdf);
routes.get('/:id', getSalary);
routes.patch('/:id', ownerConsoleOnly);
routes.post('/:id/resend-email', ownerConsoleOnly);

export default routes;
