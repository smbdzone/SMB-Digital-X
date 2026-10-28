import mongoose, { Schema } from 'mongoose';
const certificateSchema = new Schema({
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
}, { timestamps: true });
certificateSchema.index({ issueDate: -1 });
export default mongoose.model('Certificate', certificateSchema);
