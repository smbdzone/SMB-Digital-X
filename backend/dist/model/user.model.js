import mongoose from "mongoose";
import bcrypt from 'bcrypt';
const userSchema = new mongoose.Schema({
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
    },
    salaryHistory: [
        {
            _id: false,
            amount: Number,
            currency: String,
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
    passwordResetCodeHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordResetAttempts: { type: Number, default: 0, select: false },
    passwordResetSentAt: { type: Date, select: false },
    passwordChangedAt: { type: Date },
}, {
    timestamps: true
});
// Hash password before saving.
// IMPORTANT: errors must be re-thrown. The old version swallowed them, which meant a
// failed hash would have saved the password in plain text.
userSchema.pre('save', async function () {
    if (!this.isModified('password'))
        return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});
// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};
const User = mongoose.model('users', userSchema);
export default User;
