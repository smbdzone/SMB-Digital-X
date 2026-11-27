import mongoose, { Schema, Document } from 'mongoose'
import { isLocked } from '../owner/vault.js'

export interface IProject extends Document {
    name: string
    clientName: string
    description?: string
    category: string
    startDate: Date
    deadline?: Date

    budget: number | string   // a number, or (Phase 2) a locked value only the Owner Console can read
    status: 'Planning' | 'Active' | 'Completed' | 'On Hold'

    employees: mongoose.Types.ObjectId[]

    ownerSeal?: { seq?: number | null; hash?: string }   // Owner Console seal (see owner/ownerState.ts)
    createdAt: Date
    updatedAt: Date
}

const projectSchema = new Schema<IProject>(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        category: {
            type: String,
            required: true
        },

        clientName: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            trim: true
        },

        startDate: {
            type: Date,
            required: true
        },

        deadline: {
            type: Date
        },

        // 0 = not set yet. Set in the Owner Console; once locking has started it holds a locked value (owner/vault.ts).
        budget: {
            type: Schema.Types.Mixed,
            required: true,
            default: 0,
            validate: { validator: (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) || isLocked(v), message: 'budget must be an amount of 0 or more, or a locked value' }
        },

        status: {
            type: String,
            enum: [
                'Planning',
                'Active',
                'Completed',
                'On Hold'
            ],
            default: 'Planning'
        },

        employees: [
            {
                type: Schema.Types.ObjectId,
                ref: 'users'
            }
        ],
        ownerSeal: { type: Schema.Types.Mixed, default: undefined },   // { seq, hash }: only set by a signed Owner Console action
    },
    {
        timestamps: true
    }
)

export default mongoose.model<IProject>('Project', projectSchema)