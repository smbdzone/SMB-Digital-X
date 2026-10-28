/**
 * One-time (and safe to re-run) migration for the company / salary / expense update.
 *
 *   npm run migrate
 *
 * What it does:
 *  1. Creates the three companies that used to be hard-coded in config/companies.ts.
 *  2. Assigns every employee without a company to "SMB Digital Zone" (the old default, companyId = 1).
 *     -> Afterwards, open each employee that belongs to another company and change it.
 *  3. Converts existing salary records: companyId from the old `company` snapshot, renames
 *     payedOn -> paidOn and payedBy -> paidByName, and fills gross / net / totals.
 *  4. Gives existing expenses a company (SMB Digital Zone), status "approved" and isDeleted=false.
 *
 * It only fills in what is missing, so running it twice changes nothing the second time.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Company from '../model/company.model.js';
import User from '../model/user.model.js';
import Salary from '../model/salary.model.js';
import Expense from '../model/expense.model.js';
import { computeTotals } from '../services/salary.service.js';
const SEED = [
    { oldId: 1, code: 'smb-digitalzone', name: 'SMB Digital Zone', logo: '/images/smb-digitalzone.png' },
    { oldId: 2, code: 'smb-proptech', name: 'SMB Proptech', logo: '/images/smb-proptech.png' },
    { oldId: 3, code: 'axis-aura', name: 'Axis Aura', logo: '/images/axis-aura.png' },
];
const run = async () => {
    const uri = process.env.MONGO_DB;
    if (!uri)
        throw new Error('MONGO_DB is not set');
    await mongoose.connect(uri);
    console.log('Connected to', mongoose.connection.name);
    // 1. Companies
    const byOldId = new Map();
    for (const s of SEED) {
        const company = await Company.findOneAndUpdate({ code: s.code }, {
            $setOnInsert: {
                name: s.name,
                code: s.code,
                logo: s.logo,
                brandColor: '#0136B0',
                currency: 'AED',
                email: { fromName: s.name },
                signatory: { name: 'Muhammad Simo Berrada', signature: 'Simo Berrada' }, // old hard-coded values; edit via PATCH /api/companies/:id
                isActive: true,
            },
        }, { upsert: true, new: true });
        byOldId.set(s.oldId, company._id);
    }
    const defaultCompanyId = byOldId.get(1);
    console.log(`Companies ready: ${SEED.map(s => s.name).join(', ')}`);
    // 2. Employees
    const users = await User.updateMany({ companyId: { $exists: false } }, { $set: { companyId: defaultCompanyId } });
    console.log(`Employees assigned to default company: ${users.modifiedCount}`);
    // 3. Salaries (raw collection access, because the old field names no longer exist in the schema)
    const salaries = Salary.collection;
    const cursor = salaries.find({ companyId: { $exists: false } });
    let migrated = 0;
    for await (const doc of cursor) {
        const oldCompanyId = doc.company?.id;
        const companyId = (oldCompanyId && byOldId.get(oldCompanyId)) || defaultCompanyId;
        const allowances = (doc.allowances ?? []).map((a) => ({ name: a.name ?? 'Allowance', amount: a.amount ?? 0 }));
        const totals = computeTotals({ salary: doc.salary ?? 0, allowances, deductions: [] });
        const $set = {
            companyId,
            allowances,
            deductions: [],
            ...totals,
            email: { status: 'not_sent', attempts: 0 },
        };
        if (doc.payedOn)
            $set.paidOn = doc.payedOn;
        if (doc.payedBy)
            $set.paidByName = String(doc.payedBy);
        await salaries.updateOne({ _id: doc._id }, { $set, $unset: { company: '', payedOn: '', payedBy: '' } });
        migrated++;
    }
    console.log(`Salary records migrated: ${migrated}`);
    // 4. Expenses
    const expenses = Expense.collection;
    const exp = await expenses.updateMany({ companyId: { $exists: false } }, { $set: { companyId: defaultCompanyId, status: 'approved', isDeleted: false, receipts: [] } });
    console.log(`Expenses migrated: ${exp.modifiedCount}`);
    // Make sure the new indexes exist
    await Promise.all([Company.syncIndexes(), Salary.syncIndexes(), Expense.syncIndexes()]);
    console.log('Indexes synced. Done.');
    await mongoose.disconnect();
};
run().catch(async (err) => {
    console.error('Migration failed:', err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
