import mongoose, { Schema, Document, Types } from 'mongoose'

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
] as const

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'reimbursed'] as const

export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'other'] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]

export interface IExpenseTax {
    name: string
    percentage: number
    amount: number
}

export interface IExpenseReceipt {
    _id: Types.ObjectId
    url: string
    public_id: string
    resource_type: string
    originalName?: string
    uploadedAt: Date
}

export interface IExpense extends Document {
    companyId: Types.ObjectId            // which company this expense belongs to
    projectId?: Types.ObjectId           // optional: rent/utilities have no project
    addedBy: Types.ObjectId

    description: string
    category: ExpenseCategory
    vendor?: string
    paymentMethod?: (typeof PAYMENT_METHODS)[number]

    amount: number
    taxes: IExpenseTax[]
    totalTax: number
    totalAmount: number

    currency: string
    date: Date
    notes?: string

    status: ExpenseStatus
    approvedBy?: Types.ObjectId
    approvedAt?: Date
    rejectionReason?: string

    receipts: IExpenseReceipt[]

    // soft delete + audit
    isDeleted: boolean
    deletedAt?: Date
    deletedBy?: Types.ObjectId
    updatedBy?: Types.ObjectId

    createdAt: Date
    updatedAt: Date
}

const expenseTaxSchema = new Schema<IExpenseTax>(
    {
        name: { type: String, required: true, trim: true },
        percentage: { type: Number, required: true, min: 0, max: 100 },
        amount: { type: Number, required: true, min: 0 },
    },
    { _id: false }
)

const receiptSchema = new Schema<IExpenseReceipt>({
    url: { type: String, required: true },
    public_id: { type: String, required: true },
    resource_type: { type: String, default: 'image' },
    originalName: { type: String },
    uploadedAt: { type: Date, default: Date.now },
})

const expenseSchema = new Schema<IExpense>(
    {
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
    },
    { timestamps: true }
)

// Soft delete: hide deleted expenses from every find/count/aggregate automatically,
// including the dashboard controller, without having to touch each query.
expenseSchema.pre(/^(find|count)/, function (this: mongoose.Query<unknown, IExpense>) {
    this.where({ isDeleted: { $ne: true } })
})

expenseSchema.pre('aggregate', function () {
    this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } })
})

export default mongoose.model<IExpense>('Expense', expenseSchema)
