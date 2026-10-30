import mongoose, { Schema, Document, Types } from 'mongoose'

// Every kind of career event an admin can record for an employee.
export const HISTORY_TYPES = [
    'joined',               // first day (e.g. joined as intern)
    'probation_completed',
    'promotion',
    'demotion',
    'position_change',      // title change without promotion/demotion
    'salary_increase',
    'salary_decrease',
    'transfer',             // moved company / department / team
    'rejoined',
    'resignation',
    'termination',
    'other',
] as const

export type HistoryType = (typeof HISTORY_TYPES)[number]

// Used to build a default title when the admin does not type one.
export const HISTORY_TYPE_LABELS: Record<HistoryType, string> = {
    joined: 'Joined the company',
    probation_completed: 'Probation completed',
    promotion: 'Promotion',
    demotion: 'Demotion',
    position_change: 'Position changed',
    salary_increase: 'Salary increase',
    salary_decrease: 'Salary decrease',
    transfer: 'Transfer',
    rejoined: 'Rejoined the company',
    resignation: 'Resignation',
    termination: 'Termination',
    other: 'Other',
}

export interface IEmployeeHistory extends Document {
    employeeId: Types.ObjectId
    type: HistoryType
    title: string
    description?: string
    effectiveDate: Date

    fromPosition?: string
    toPosition?: string

    fromSalary?: number
    toSalary?: number
    currency?: string

    addedBy: Types.ObjectId
    updatedBy?: Types.ObjectId

    createdAt: Date
    updatedAt: Date
}

const employeeHistorySchema = new Schema<IEmployeeHistory>(
    {
        employeeId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },

        type: { type: String, enum: HISTORY_TYPES, required: true, index: true },
        title: { type: String, required: true, trim: true, maxlength: 150 },
        description: { type: String, trim: true, maxlength: 2000 },
        effectiveDate: { type: Date, required: true },

        fromPosition: { type: String, trim: true, maxlength: 100 },
        toPosition: { type: String, trim: true, maxlength: 100 },

        fromSalary: { type: Number, min: 0 },
        toSalary: { type: Number, min: 0 },
        currency: { type: String, uppercase: true, trim: true },

        addedBy: { type: Schema.Types.ObjectId, ref: 'users', required: true },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'users' },
    },
    { timestamps: true }
)

// Timeline queries: one employee, ordered by date.
employeeHistorySchema.index({ employeeId: 1, effectiveDate: -1 })

export default mongoose.model<IEmployeeHistory>('EmployeeHistory', employeeHistorySchema)
