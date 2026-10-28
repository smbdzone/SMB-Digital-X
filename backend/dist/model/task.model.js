import mongoose from "mongoose";
const taskSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users',
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: [
            'Todo',
            'In Progress',
            'Review',
            'Completed'
        ],
        default: 'Todo'
    },
    priority: {
        type: String,
        enum: [
            'Low',
            'Medium',
            'High',
            'Urgent'
        ],
        default: 'Medium'
    },
    progress: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    startDate: {
        type: Date
    },
    dueDate: {
        type: Date
    },
    completedAt: {
        type: Date
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});
const Task = mongoose.model('task', taskSchema);
export default Task;
