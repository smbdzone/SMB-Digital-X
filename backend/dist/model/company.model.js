import mongoose, { Schema } from 'mongoose';
const companySchema = new Schema({
    name: { type: String, required: true, trim: true },
    code: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: /^[a-z0-9-]+$/,
    },
    legalName: { type: String, trim: true },
    logo: { type: String, default: '', trim: true },
    brandColor: { type: String, default: '#0136B0', match: /^#[0-9a-fA-F]{6}$/ },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    currency: { type: String, default: 'AED', uppercase: true, trim: true },
    email: {
        fromName: { type: String, trim: true },
        fromEmail: { type: String, trim: true, lowercase: true },
        replyTo: { type: String, trim: true, lowercase: true },
        footerNote: { type: String, trim: true },
    },
    signatory: {
        name: { type: String, trim: true },
        title: { type: String, trim: true },
        signature: { type: String, trim: true },
    },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });
export default mongoose.model('Company', companySchema);
