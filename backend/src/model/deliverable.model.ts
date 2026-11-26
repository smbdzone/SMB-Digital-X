import mongoose, { Document, Types } from "mongoose";

/**
 * One item of an employee's daily plan.
 *
 * Flow: the employee adds items in the morning (draft) -> submits the plan (pending) -> an approver
 * (admin or a user with canApproveDeliverables) edits it if needed and approves it (approved) ->
 * at the end of the day the employee reports an outcome per item in the EOD report.
 * Items that come from an assigned project Task are approved from the start.
 */

export const DELIVERABLE_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const DELIVERABLE_SOURCES = ["self", "task", "approver", "carried_over"] as const;
export const APPROVAL_STATUSES = ["draft", "pending", "approved"] as const;
// "in_progress" is shown as "Half completed" in the UI and counts as half in the EOD progress.
export const DELIVERABLE_OUTCOMES = ["completed", "in_progress", "not_started"] as const;

export type DeliverablePriority = typeof DELIVERABLE_PRIORITIES[number];
export type DeliverableSource = typeof DELIVERABLE_SOURCES[number];
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];
export type DeliverableOutcome = typeof DELIVERABLE_OUTCOMES[number];

export interface IDeliverable extends Document {
    _id: Types.ObjectId;
    employeeId: Types.ObjectId;
    companyId?: Types.ObjectId;
    dateKey: string;
    title: string;
    description: string;
    projectId?: Types.ObjectId | null;
    taskId?: Types.ObjectId | null;
    priority: DeliverablePriority;
    estimatedHours?: number | null;
    source: DeliverableSource;
    carriedFromId?: Types.ObjectId | null;
    order: number;
    createdBy: Types.ObjectId;

    approvalStatus: ApprovalStatus;
    submittedAt?: Date | null;
    approvedBy?: Types.ObjectId | null;
    approvedAt?: Date | null;
    editedByApprover: boolean;
    editedBy?: Types.ObjectId | null;
    editedAt?: Date | null;
    // The employee's own wording, saved the first time an approver changes the item.
    original?: { title: string; description: string; priority: DeliverablePriority; estimatedHours?: number | null } | null;

    outcome: DeliverableOutcome | null;
    outcomeNote: string;
    actualHours?: number | null;
    taskProgress?: number | null;
    reportedAt?: Date | null;

    createdAt: Date;
    updatedAt: Date;
}

const deliverableSchema = new mongoose.Schema<IDeliverable>(
    {
        employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
        companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: undefined },
        // Calendar day in the payroll timezone, same as EOD reports.
        dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

        title: { type: String, required: true, trim: true, maxlength: 200 },
        description: { type: String, default: "", trim: true, maxlength: 2000 },
        projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
        taskId: { type: mongoose.Schema.Types.ObjectId, ref: "task", default: null },
        priority: { type: String, enum: DELIVERABLE_PRIORITIES, default: "Medium" },
        estimatedHours: { type: Number, min: 0, max: 24, default: null },
        source: { type: String, enum: DELIVERABLE_SOURCES, default: "self" },
        carriedFromId: { type: mongoose.Schema.Types.ObjectId, ref: "Deliverable", default: null },
        order: { type: Number, default: 0 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },

        approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: "draft" },
        submittedAt: { type: Date, default: null },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
        approvedAt: { type: Date, default: null },
        editedByApprover: { type: Boolean, default: false },
        editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
        editedAt: { type: Date, default: null },
        original: {
            type: {
                _id: false,
                title: String,
                description: String,
                priority: String,
                estimatedHours: Number,
            },
            default: null,
        },

        outcome: { type: String, enum: [...DELIVERABLE_OUTCOMES, null], default: null },
        outcomeNote: { type: String, default: "", trim: true, maxlength: 1000 },
        actualHours: { type: Number, min: 0, max: 24, default: null },
        // Progress % of the linked Task, reported with the outcome (task-sourced items only).
        taskProgress: { type: Number, min: 0, max: 100, default: null },
        reportedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// An employee's day, in display order.
deliverableSchema.index({ employeeId: 1, dateKey: 1, order: 1 });
// Approval queue.
deliverableSchema.index({ approvalStatus: 1, dateKey: 1 });
// Team day view / stats over a date range.
deliverableSchema.index({ dateKey: 1, employeeId: 1 });
// The same Task can be on an employee's day only once.
deliverableSchema.index(
    { employeeId: 1, dateKey: 1, taskId: 1 },
    { unique: true, partialFilterExpression: { taskId: { $type: "objectId" } } }
);
// An item can be carried over only once.
deliverableSchema.index(
    { carriedFromId: 1 },
    { unique: true, partialFilterExpression: { carriedFromId: { $type: "objectId" } } }
);

const Deliverable = mongoose.model<IDeliverable>("Deliverable", deliverableSchema);

export default Deliverable;
