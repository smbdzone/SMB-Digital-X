import mongoose, { Schema, Types } from 'mongoose'

/**
 * An employee asks for new bank details. Their current details stay in use until Sir Simo approves the request
 * in the Owner Console (a signed action that seals the new details on the user). One pending request per person:
 * a new one replaces the previous pending one.
 */
export interface IBankChangeRequest {
    employeeId: Types.ObjectId
    requested: { method?: string; bankName?: string; holderName?: string; accountNumber?: string; iban?: string }
    status: 'pending' | 'approved' | 'rejected' | 'replaced'
    decidedAt?: Date
    decisionSeq?: number
    createdAt: Date
    updatedAt: Date
}

const bankChangeRequestSchema = new Schema<IBankChangeRequest>({
    employeeId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    requested: {
        method: String, bankName: String, holderName: String, accountNumber: String, iban: String,
    },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'replaced'], default: 'pending', index: true },
    decidedAt: Date,
    decisionSeq: Number,
}, { timestamps: true, collection: 'bankchangerequests' })

export default mongoose.model<IBankChangeRequest>('BankChangeRequest', bankChangeRequestSchema)
