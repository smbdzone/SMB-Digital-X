import mongoose, { Document, Schema, Types } from 'mongoose'

// "letter"      = formal letter layout (portrait): joining letter, experience letter, warning ...
// "certificate" = decorative certificate layout (landscape): course completion, appreciation ...
export type CertificateKind = 'letter' | 'certificate'

export interface ICertificateTemplate extends Document {
    typeKey: string          // normalised type, e.g. "course_completion_certificate"
    typeLabel: string        // what the admin typed, e.g. "Course Completion Certificate"
    kind: CertificateKind
    title: string            // may contain {{placeholders}}
    body: string             // may contain {{placeholders}}
    companyId: Types.ObjectId | null   // null = available for every company
    isActive: boolean
    timesUsed: number
    lastUsedAt?: Date
    createdBy?: Types.ObjectId
    updatedBy?: Types.ObjectId
    createdAt: Date
    updatedAt: Date
}

const templateSchema = new Schema<ICertificateTemplate>(
    {
        typeKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },
        typeLabel: { type: String, required: true, trim: true, maxlength: 100 },
        kind: { type: String, enum: ['letter', 'certificate'], default: 'letter' },
        title: { type: String, required: true, trim: true, maxlength: 200 },
        body: { type: String, required: true, maxlength: 8000 },
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
        isActive: { type: Boolean, default: true },
        timesUsed: { type: Number, default: 0 },
        lastUsedAt: { type: Date },
        createdBy: { type: Schema.Types.ObjectId, ref: 'users' },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'users' },
    },
    { timestamps: true }
)

// One saved text per type per company (and one "all companies" text per type).
templateSchema.index({ typeKey: 1, companyId: 1 }, { unique: true })

export default mongoose.model<ICertificateTemplate>('CertificateTemplate', templateSchema)
