import mongoose, { Schema, Document } from 'mongoose'

export interface ICompany extends Document {
    name: string          // shown on slips and as the email sender display name
    code: string          // stable slug, e.g. "smb-proptech"
    legalName?: string
    logo: string          // absolute URL, or a path served by the frontend e.g. "/images/x.png"
    brandColor: string    // hex colour used for the slip header/accents
    address?: string
    phone?: string
    website?: string
    currency: string      // default currency for this company
    email: {
        fromName?: string   // defaults to `name`
        fromEmail?: string  // optional alias; falls back to process.env.EMAIL
        replyTo?: string
        footerNote?: string
    }
    signatory: {
        name?: string       // "Approved by" on the slip
        title?: string
        signature?: string  // typed signature text
    }
    isActive: boolean
    createdAt: Date
    updatedAt: Date
}

const companySchema = new Schema<ICompany>(
    {
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
    },
    { timestamps: true }
)

export default mongoose.model<ICompany>('Company', companySchema)
