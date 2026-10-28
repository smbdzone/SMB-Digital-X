import mongoose, { Schema } from 'mongoose';
const templateSchema = new Schema({
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
}, { timestamps: true });
// One saved text per type per company (and one "all companies" text per type).
templateSchema.index({ typeKey: 1, companyId: 1 }, { unique: true });
export default mongoose.model('CertificateTemplate', templateSchema);
