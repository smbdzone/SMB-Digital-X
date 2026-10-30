import mongoose, { Schema } from 'mongoose';
export const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed', 'delayed'];
export const MILESTONE_PAYMENT_STATUSES = ['unpaid', 'invoiced', 'paid'];
// Which of the two payment values the admin typed. The other one is calculated from the project budget.
export const PAYMENT_MODES = ['percentage', 'amount'];
const deliverableSchema = new Schema({
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    isDone: { type: Boolean, default: false },
    doneAt: { type: Date },
});
const milestoneSchema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 2000 },
    order: { type: Number, default: 0 },
    startDate: { type: Date },
    deadline: { type: Date },
    paymentMode: { type: String, enum: PAYMENT_MODES, default: 'percentage' },
    paymentPercentage: { type: Number, min: 0, max: 100, default: 0 },
    paymentAmount: { type: Number, min: 0, default: 0 },
    currency: { type: String, uppercase: true, trim: true, default: 'AED' },
    deliverables: { type: [deliverableSchema], default: [] },
    status: { type: String, enum: MILESTONE_STATUSES, default: 'pending', index: true },
    completedAt: { type: Date },
    paymentStatus: { type: String, enum: MILESTONE_PAYMENT_STATUSES, default: 'unpaid', index: true },
    invoicedAt: { type: Date },
    paidAt: { type: Date },
    notes: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'users', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'users' },
}, { timestamps: true });
milestoneSchema.index({ projectId: 1, order: 1 });
export default mongoose.model('Milestone', milestoneSchema);
