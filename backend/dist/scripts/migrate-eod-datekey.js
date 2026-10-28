/**
 * One-time (and safe to re-run) migration for the EOD update.
 *
 *   npm run migrate:eod
 *
 * Old reports were saved with `date` = midnight in the SERVER's timezone and have no `dateKey`.
 * This fills `dateKey` ("YYYY-MM-DD") from that stored date and normalises `date` to midnight UTC of the
 * same calendar day. Run it on the same server/timezone that created the old reports.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import EODReport from '../model/eod.model.js';
import { keyToDate } from '../utils/dates.js';
const pad = (n) => String(n).padStart(2, '0');
const run = async () => {
    const uri = process.env.MONGO_DB;
    if (!uri)
        throw new Error('MONGO_DB is not set');
    await mongoose.connect(uri);
    console.log('Connected to', mongoose.connection.name);
    const legacy = await EODReport.find({ dateKey: { $exists: false } }).select('date').lean();
    let updated = 0;
    for (const report of legacy) {
        const d = new Date(report.date);
        // Local calendar day of the stored instant: that is the day the employee meant.
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        await EODReport.updateOne({ _id: report._id }, { $set: { dateKey: key, date: keyToDate(key) } });
        updated++;
    }
    console.log(`EOD reports migrated: ${updated}`);
    await EODReport.syncIndexes();
    console.log('Indexes synced. Done.');
    await mongoose.disconnect();
};
run().catch(async (err) => {
    console.error('Migration failed:', err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
