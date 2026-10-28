import mongoose, { Schema } from 'mongoose';
export const EXPENSE_CATEGORIES = [
    'Hosting',
    'Software',
    'Domain',
    'Travel',
    'Marketing',
    'Office',
    'Equipment',
    'Utilities',
    'Rent',
    'Other',
];
export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'reimbursed'];
export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'other'];
const expenseTaxSchema = new Schema({
    name: { type: String, required: true, trim: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    amount: { type: Number, required: true, min: 0 },
}, { _id: false });
const receiptSchema = new Schema({
    url: { type: String, required: true },
    public_id: { type: String, required: true },
    resource_type: { type: String, default: 'image' },
    originalName: { type: String },
    uploadedAt: { type: Date, default: Date.now },
});
const expenseSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    vendor: { type: String, trim: true, maxlength: 200 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    amount: { type: Number, required: true, min: 0 },
    taxes: { type: [expenseTaxSchema], default: [] },
    totalTax: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'AED', uppercase: true, trim: true },
    date: { type: Date, required: true, default: Date.now, index: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: EXPENSE_STATUSES, default: 'pending', index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'users' },
    approvedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    receipts: { type: [receiptSchema], default: [] },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'users' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'users' },
}, { timestamps: true });
// Soft delete: hide deleted expenses from every find/count/aggregate automatically,
// including the dashboard controller, without having to touch each query.
expenseSchema.pre(/^(find|count)/, function () {
    this.where({ isDeleted: { $ne: true } });
});
expenseSchema.pre('aggregate', function () {
    this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } });
});
export default mongoose.model('Expense', expenseSchema);
