import mongoose from "mongoose";

const eodSchema = new mongoose.Schema(
    {
        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
            index: true
        },

        // Calendar day of the report in the payroll timezone, "YYYY-MM-DD".
        // This is what "one report per day" is based on.
        dateKey: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/
        },

        // Midnight UTC of dateKey (kept so existing frontend code that reads `date` keeps working).
        date: {
            type: Date,
            required: true,
            index: true
        },

        summary: {
            type: String,
            required: true,
            trim: true
        },

        completedTasks: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "task"
            }
        ],

        inProgressTasks: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "task"
            }
        ],

        blockers: {
            type: String,
            default: "",
            trim: true
        },

        tomorrowPlan: {
            type: String,
            default: "",
            trim: true
        },

        overallProgress: {
            type: Number,
            min: 0,
            max: 100,
            default: 0
        },

        status: {
            type: String,
            enum: ["Submitted", "Reviewed"],
            default: "Submitted"
        },

        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            default: null
        },

        reviewedAt: {
            type: Date,
            default: null
        },

        reviewNote: {
            type: String,
            default: "",
            trim: true
        }
    },
    {
        timestamps: true
    }
);

// One EOD report per employee per day. Partial, so old reports that do not have a dateKey yet
// (before `npm run migrate:eod`) do not break index creation.
eodSchema.index(
    { employeeId: 1, dateKey: 1 },
    { unique: true, partialFilterExpression: { dateKey: { $type: "string" } } }
);
eodSchema.index({ dateKey: -1, status: 1 });

const EODReport = mongoose.model("EODReport", eodSchema);

export default EODReport;
