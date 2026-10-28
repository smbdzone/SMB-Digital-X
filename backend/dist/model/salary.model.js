import mongoose from 'mongoose';
const lineItemSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0, default: 0 },
}, { _id: false });
const salarySchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users',
        required: true,
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
    },
    month: {
        type: String,
        required: true,
        match: /^\d{4}-(0[1-9]|1[0-2])$/, // e.g. "2026-08"
    },
    currency: { type: String, default: 'AED', uppercase: true, trim: true },
    salary: { type: Number, required: true, min: 0 },
    allowances: { type: [lineItemSchema], default: [] },
    deductions: { type: [lineItemSchema], default: [] },
    totalAllowances: { type: Number, default: 0, min: 0 },
    totalDeductions: { type: Number, default: 0, min: 0 },
    grossAmount: { type: Number, default: 0, min: 0 },
    netPay: { type: Number, default: 0, min: 0 },
    status: {
        type: String,
        enum: ['pending', 'paid'],
        default: 'pending',
    },
    paidOn: { type: Date },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
    paidByName: { type: String, trim: true },
    paymentDetails: {
        _id: false,
        method: { type: String, trim: true },
        bankName: { type: String, trim: true },
        holderName: { type: String, trim: true },
        accountNumber: { type: String, trim: true },
        iban: { type: String, trim: true },
        reference: { type: String, trim: true },
    },
    email: {
        status: { type: String, enum: ['not_sent', 'sent', 'failed'], default: 'not_sent' },
        sentAt: { type: Date },
        attempts: { type: Number, default: 0 },
        lastError: { type: String },
    },
    notes: { type: String, default: '' },
}, { timestamps: true });
// One salary record per employee per month
salarySchema.index({ employeeId: 1, month: 1 }, { unique: true });
// Typical admin list view: a company's payroll for a month
salarySchema.index({ companyId: 1, month: 1, status: 1 });
export default mongoose.model('salary', salarySchema);
