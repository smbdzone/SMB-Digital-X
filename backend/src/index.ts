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
import { cleanupMedia, createSalaryDocuments } from './utils/cron-jobs.js';
import { isVerified } from './middlewares/isVerified.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();

dbConnection();

createSalaryDocuments.start()
cleanupMedia.start();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: [
        'http://localhost:3000',
        `${process.env.FRONTEND}`,
        'https://api.smbdigitalx.com',
        'https://smbdigitalx.com/',
        'https://smbdigitalx.com',
    ],
    credentials: true
}));

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
