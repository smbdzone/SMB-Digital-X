import mongoose, { Schema, Document, Types } from 'mongoose'
import { isLocked } from '../owner/vault.js'

export const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed', 'delayed'] as const
export const MILESTONE_PAYMENT_STATUSES = ['unpaid', 'invoiced', 'paid'] as const
// Which of the two payment values the admin typed. The other one is calculated from the project budget.
export const PAYMENT_MODES = ['percentage', 'amount'] as const

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]
export type MilestonePaymentStatus = (typeof MILESTONE_PAYMENT_STATUSES)[number]
export type PaymentMode = (typeof PAYMENT_MODES)[number]

export interface IDeliverable {
    _id: Types.ObjectId
    title: string
    description?: string
    isDone: boolean
    doneAt?: Date
}

export interface IMilestone extends Document {
    projectId: Types.ObjectId
    title: string
    description?: string
    order: number

    startDate?: Date
    deadline?: Date

    paymentMode: PaymentMode
    paymentPercentage: number | string   // share of the project budget, 0-100 (or, Phase 2, a locked value)
    paymentAmount: number | string       // money value of that share (or a locked value)
    currency: string

    deliverables: Types.DocumentArray<IDeliverable>

    status: MilestoneStatus
    completedAt?: Date

    paymentStatus: MilestonePaymentStatus
    invoicedAt?: Date
    paidAt?: Date

    notes?: string
    createdBy: Types.ObjectId
    updatedBy?: Types.ObjectId

    ownerSeal?: { seq?: number | null; hash?: string }   // Owner Console seal (see owner/ownerState.ts)
    createdAt: Date
    updatedAt: Date
}

const deliverableSchema = new Schema<IDeliverable>({
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    isDone: { type: Boolean, default: false },
    doneAt: { type: Date },
})

const milestoneSchema = new Schema<IMilestone>(
    {
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },

        title: { type: String, required: true, trim: true, maxlength: 150 },
        description: { type: String, trim: true, maxlength: 2000 },
        order: { type: Number, default: 0 },

        startDate: { type: Date },
        deadline: { type: Date },

        paymentMode: { type: String, enum: PAYMENT_MODES, default: 'percentage' },
        // Set in the Owner Console; once locking has started they hold locked values (owner/vault.ts).
        paymentPercentage: { type: Schema.Types.Mixed, default: 0, validate: { validator: (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 100) || isLocked(v), message: 'paymentPercentage must be 0-100 or a locked value' } },
        paymentAmount: { type: Schema.Types.Mixed, default: 0, validate: { validator: (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) || isLocked(v), message: 'paymentAmount must be an amount of 0 or more, or a locked value' } },
        currency: { type: String, uppercase: true, trim: true, default: 'AED' },

        deliverables: { type: [deliverableSchema], default: [] },

        status: { type: String, enum: MILESTONE_STATUSES, default: 'pending', index: true },
        completedAt: { type: Date },

        paymentStatus: { type: String, enum: MILESTONE_PAYMENT_STATUSES, default: 'unpaid', index: true },
        invoicedAt: { type: Date },
        paidAt: { type: Date },

        notes: { type: String, trim: true, maxlength: 2000 },

        createdBy: { type: Schema.Types.ObjectId, ref: 'users', required: true },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'users' },
        ownerSeal: { type: Schema.Types.Mixed, default: undefined },   // { seq, hash }: only set by a signed Owner Console action
    },
    { timestamps: true }
)

milestoneSchema.index({ projectId: 1, order: 1 })

export default mongoose.model<IMilestone>('Milestone', milestoneSchema)
