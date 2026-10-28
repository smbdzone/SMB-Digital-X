import cron from 'node-cron';
import mongoose from 'mongoose';
import messageModel from '../model/message.model.js';
import { deleteFromCloudinary } from '../utils/cloudinary.js';
import { currentMonth, generateMonthlySalaries } from '../services/salary.service.js';

const PAYROLL_TIMEZONE = process.env.PAYROLL_TIMEZONE || 'Asia/Dubai';

const runSalaryGeneration = async (reason: string) => {
    try {
        const month = currentMonth(PAYROLL_TIMEZONE);
        const result = await generateMonthlySalaries(month);
        console.log(`[payroll] ${reason}: ${month} -> created ${result.created}, already existed ${result.alreadyExisted}, skipped ${result.skipped.length}`);
    } catch (error) {
        console.error(`[payroll] ${reason} failed:`, error);
    }
};

// 00:00 on the 1st of every month, in the payroll timezone (not the server's timezone).
// generateMonthlySalaries is idempotent, so it is safe if this fires twice or on several servers.
export const createSalaryDocuments = cron.schedule(
    '0 0 1 * *',
    () => runSalaryGeneration('monthly job'),
    { timezone: PAYROLL_TIMEZONE }
);

// Catch-up: if the server was down at midnight on the 1st, create any missing records on the next start.
mongoose.connection.once('open', () => {
    void runSalaryGeneration('startup catch-up');
});

// Run every hour
export const cleanupMedia = cron.schedule('0 * * * *', async () => {
    console.log('Running media cleanup job...');
    try {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago

        // Find messages with attachments older than 48h
        const messages = await messageModel.find({
            attachments: { $exists: true, $ne: [] },
            createdAt: { $lt: cutoff },
        });

        for (const msg of messages) {
            const attachments = msg.attachments || [];
            for (const att of attachments) {
                try {
                    await deleteFromCloudinary(att.public_id, att.resource_type as any);
                    console.log(`Deleted file ${att.public_id} from Cloudinary`);
                } catch (err) {
                    console.error(`Failed to delete ${att.public_id}:`, err);
                }
            }
            // Optionally clear attachments from DB or keep them (but files are gone)
            // We'll clear them to avoid broken links
            msg.attachments = [];
            await msg.save();
        }

        console.log(`Media cleanup completed. Processed ${messages.length} messages.`);
    } catch (error) {
        console.error('Error in media cleanup cron job:', error);
    }
});
