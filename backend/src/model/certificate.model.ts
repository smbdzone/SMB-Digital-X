import mongoose, { Document, Schema, Types } from 'mongoose'
import { CertificateKind } from './certificateTemplate.model.js'

export type CertificateStatus = 'issued' | 'revoked'
export type CertificateEmailStatus = 'not_sent' | 'sent' | 'failed'

export interface ICertificate extends Document {
    referenceNo: string              // e.g. SMB-CRT-2026-0001
    employeeId: Types.ObjectId
    companyId: Types.ObjectId
    issuedBy: Types.ObjectId
    issuedByName?: string

    typeKey: string
    typeLabel: string
    kind: CertificateKind
    templateId?: Types.ObjectId

    // Final text after the {{placeholders}} were replaced. This is exactly what the PDF shows.
    title: string
    body: string
    variables: Record<string, string>
    issueDate: Date
    signatory: { name?: string; title?: string; signature?: string }

    // Snapshot of the person at the time of issue, so old documents never change.
    recipient: { name: string; email?: string; position?: string }
    companyName: string

    status: CertificateStatus
    revokedAt?: Date
    revokedBy?: Types.ObjectId
    revokeReason?: string

    email: {
        status: CertificateEmailStatus
        sentAt?: Date
        lastAttemptAt?: Date
        error?: string
    }
    createdAt: Date
    updatedAt: Date
}

const certificateSchema = new Schema<ICertificate>(
    {
        referenceNo: { type: String, required: true, unique: true },
        employeeId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        issuedBy: { type: Schema.Types.ObjectId, ref: 'users', required: true },
        issuedByName: { type: String },

        typeKey: { type: String, required: true, index: true },
        typeLabel: { type: String, required: true },
        kind: { type: String, enum: ['letter', 'certificate'], default: 'letter' },
        templateId: { type: Schema.Types.ObjectId, ref: 'CertificateTemplate' },

        title: { type: String, required: true },
        body: { type: String, required: true },
        variables: { type: Schema.Types.Mixed, default: {} },
        issueDate: { type: Date, required: true, default: Date.now },
        signatory: {
            _id: false,
            name: { type: String },
            title: { type: String },
            signature: { type: String },
        },

        recipient: {
            _id: false,
            name: { type: String, required: true },
            email: { type: String },
            position: { type: String },
        },
        companyName: { type: String, required: true },

        status: { type: String, enum: ['issued', 'revoked'], default: 'issued', index: true },
        revokedAt: { type: Date },
        revokedBy: { type: Schema.Types.ObjectId, ref: 'users' },
        revokeReason: { type: String },

        email: {
            _id: false,
            status: { type: String, enum: ['not_sent', 'sent', 'failed'], default: 'not_sent' },
            sentAt: { type: Date },
            lastAttemptAt: { type: Date },
            error: { type: String },
        },
    },
    { timestamps: true }
)

certificateSchema.index({ issueDate: -1 })

export default mongoose.model<ICertificate>('Certificate', certificateSchema)
