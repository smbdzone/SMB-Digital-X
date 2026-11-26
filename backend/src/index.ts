// Must be the FIRST import so every module below can read process.env at load time
// (config/nodemailer.ts and others read env variables when they are imported).
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dbConnection from './config/dbConnection.js';
import userRoutes from './routes/user.routes.js';
import projectRoutes from './routes/project.routes.js';
import expenseRoutes from './routes/expense.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import taskRoutes from './routes/task.routes.js';
import eodRoutes from './routes/eod.routes.js';
import salaryRoutes from './routes/salary.routes.js';
import companyRoutes from './routes/company.routes.js';
import chatRoutes from './routes/chat.routes.js';
import certificateRoutes from './routes/certificate.routes.js';
import employeeHistoryRoutes from './routes/employeeHistory.routes.js';
import milestoneRoutes from './routes/milestone.routes.js';
import pushRoutes from './routes/push.routes.js';
import deliverableRoutes from './routes/deliverable.routes.js';
import cronRoutes from './routes/cron.routes.js';
import ownerRoutes from './owner/owner.routes.js';
import { cleanupMedia, createSalaryDocuments, unreadChatReminders } from './utils/cron-jobs.js';
import { isVerified } from './middlewares/isVerified.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();

dbConnection();

createSalaryDocuments.start()
cleanupMedia.start();
unreadChatReminders.start();

// Routes that may carry the owner's signature image (base64, up to 1 MB) parse their own JSON body with a
// 2 MB limit, AFTER the admin check (see certificate.routes.ts). Everything else keeps the default 100 KB limit.
const SIGNATURE_ROUTE = /^\/api\/certificates(\/bulk|\/preview\/pdf|\/[0-9a-fA-F]{24}\/resend-email)?\/?$/;
// Owner Console routes (/api/owner) keep the raw body (their signatures cover the exact bytes) and have their own
// CORS rule for the local console file (Origin: null, no credentials): see owner/owner.routes.ts.
const OWNER_ROUTE = /^\/api\/owner(\/|$)/;
const defaultJson = express.json();
const defaultForm = express.urlencoded({ extended: true });
const websiteCors = cors({
    origin: [
        'http://localhost:3000',
        `${process.env.FRONTEND}`,
        'https://api.smbdigitalx.com',
        'https://smbdigitalx.com/',
        'https://smbdigitalx.com',
    ],
    credentials: true
});
app.use((req, res, next) => (OWNER_ROUTE.test(req.path) || (req.method === 'POST' && SIGNATURE_ROUTE.test(req.path)) ? next() : defaultJson(req, res, next)));
app.use((req, res, next) => (OWNER_ROUTE.test(req.path) ? next() : defaultForm(req, res, next)));
app.use((req, res, next) => (OWNER_ROUTE.test(req.path) ? next() : websiteCors(req, res, next)));

app.use(morgan('combined'));


app.use('/api/auth', userRoutes);
// Projects and the dashboard were completely open before; they now require a logged-in user.
app.use('/api/projects', isVerified, projectRoutes);
app.use('/api/expenses', expenseRoutes);          // auth is applied inside the router
app.use("/api/dashboard", isVerified, dashboardRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/eod", eodRoutes);
app.use("/api/salary", salaryRoutes);             // auth is applied inside the router
app.use("/api/companies", companyRoutes);         // auth is applied inside the router
app.use("/api/chat", chatRoutes);
app.use("/api/certificates", certificateRoutes);   // auth is applied inside the router
app.use("/api/employee-history", employeeHistoryRoutes); // auth is applied inside the router
app.use("/api/milestones", milestoneRoutes);              // auth is applied inside the router
app.use("/api/push", pushRoutes);                          // auth is applied inside the router
app.use("/api/deliverables", deliverableRoutes);           // auth is applied inside the router
app.use("/api/owner", ownerRoutes);                        // Owner Console: signed requests only, see owner/owner.routes.ts
app.use("/api/cron", cronRoutes);                         // cPanel cron jobs; X-Cron-Secret is checked inside

// Health check route
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Must stay last: turns thrown errors into clean JSON responses.
app.use(errorHandler);

export default app;
