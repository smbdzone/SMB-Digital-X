import mongoose, { Schema, Document } from 'mongoose'

export interface IProject extends Document {
    name: string
    clientName: string
    description?: string
    category: string
    startDate: Date
    deadline?: Date

    budget: number
    status: 'Planning' | 'Active' | 'Completed' | 'On Hold'

    employees: mongoose.Types.ObjectId[]

    createdAt: Date
    updatedAt: Date
}

const projectSchema = new Schema<IProject>(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        category: {
            type: String,
            required: true
        },

        clientName: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            trim: true
        },

        startDate: {
            type: Date,
            required: true
        },

        deadline: {
            type: Date
        },

        budget: {
            type: Number,
            required: true,
            min: 0
        },

        status: {
            type: String,
            enum: [
                'Planning',
                'Active',
                'Completed',
                'On Hold'
            ],
            default: 'Planning'
        },

        employees: [
            {
                type: Schema.Types.ObjectId,
                ref: 'users'
            }
        ]
    },
    {
        timestamps: true
    }
)

export default mongoose.model<IProject>('Project', projectSchema)