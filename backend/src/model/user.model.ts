import mongoose, { Document, Types } from "mongoose";
import bcrypt from 'bcrypt'

export interface IBankDetails {
    method?: string;
    bankName?: string;
    holderName?: string;
    accountNumber?: string;
    iban?: string;
}

export interface IUser extends Document {
    _id: Types.ObjectId;
    name: string;
    password: string;
    email: string;
    role: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    // The company that pays this employee's salary (its logo/name/sender are used on the slip email)
    companyId?: Types.ObjectId;
    salary: {
        amount: number;
        currency: string,
        effectiveFrom: Date,
        // Recurring monthly allowances (housing, transport, ...). Copied into each new monthly salary record.
        allowances: { name: string; amount: number }[],
    };
    // Previous salary values, newest last. Written whenever the salary amount, currency or allowances change.
    salaryHistory: {
        amount: number;
        currency: string;
        allowances?: { name: string; amount: number }[];
        effectiveFrom?: Date;
        changedBy?: Types.ObjectId;
        changedAt: Date;
    }[];
    // Hidden from queries by default; select with `+bankDetails`
    bankDetails?: IBankDetails;
    position?: string;
    // Set by the admin: this employee (e.g. the team lead) may approve other people's daily deliverables.
    // Admins can always approve. Nobody can approve their own deliverables.
    canApproveDeliverables: boolean;
    // Password reset by 6-digit code. The code itself is never stored, only a keyed hash of it.
    passwordResetCodeHash?: string;
    passwordResetExpires?: Date;
    passwordResetAttempts?: number;
    passwordResetSentAt?: Date;
    // Tokens issued before this moment are rejected (see middlewares/isVerified.ts)
    passwordChangedAt?: Date;
    ownerSeal?: { seq?: number | null; hash?: string }   // Owner Console seal (see owner/ownerState.ts)
    comparePassword(candidatePassword: string): Promise<boolean>
}

const userSchema = new mongoose.Schema<IUser>({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'employee'],
        default: 'employee'
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        index: true,
    },
    salary: {
        amount: {
            type: Number,
            min: 0,
        },
        currency: {
            type: String,
            default: "AED",
        },
        effectiveFrom: {
            type: Date,
            default: Date.now,
        },
        allowances: {
            type: [{
                _id: false,
                name: { type: String, required: true, trim: true, maxlength: 100 },
                amount: { type: Number, required: true, min: 0 },
            }],
            default: [],
        },
    },
    salaryHistory: [
        {
            _id: false,
            amount: Number,
            currency: String,
            // undefined (not []) on entries written before allowances existed
            allowances: { type: [{ _id: false, name: String, amount: Number }], default: undefined },
            effectiveFrom: Date,
            changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
            changedAt: { type: Date, default: Date.now },
        },
    ],
    bankDetails: {
        type: {
            _id: false,
            method: { type: String, trim: true },
            bankName: { type: String, trim: true },
            holderName: { type: String, trim: true },
            accountNumber: { type: String, trim: true },
            iban: { type: String, trim: true },
        },
        select: false,
    },
    position: {
        type: String,
        default: ''
    },
    canApproveDeliverables: {
        type: Boolean,
        default: false,
    },
    passwordResetCodeHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordResetAttempts: { type: Number, default: 0, select: false },
    passwordResetSentAt: { type: Date, select: false },
    passwordChangedAt: { type: Date },
    // Owner Console: the signed history entry that last set this record's protected fields, and their hash.
    ownerSeal: { seq: { type: Number, default: null }, hash: { type: String } },
}, {
    timestamps: true
})

// Hash password before saving.
// IMPORTANT: errors must be re-thrown. The old version swallowed them, which meant a
// failed hash would have saved the password in plain text.
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt)
    // Every password change, by any route, signs out the tokens issued before it (see isVerified).
    // Rounded down to the second like a token's iat, so a token issued right after the change still works.
    if (!this.isNew) this.passwordChangedAt = passwordChangeTime()
})

/** "Now", rounded down to a whole second (JWT iat has second precision). */
export const passwordChangeTime = (): Date => new Date(Math.floor(Date.now() / 1000) * 1000)

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('users', userSchema)

export default User
