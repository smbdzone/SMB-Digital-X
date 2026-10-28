import mongoose from 'mongoose';
const conversationSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['individual', 'group'],
        required: true,
    },
    name: {
        type: String,
        trim: true,
    },
    participents: [
        {
            type: mongoose.Types.ObjectId,
            ref: 'users',
            required: true,
        },
    ],
    // Who created the conversation (can rename / delete a group besides admins).
    createdBy: {
        type: mongoose.Types.ObjectId,
        ref: 'users',
    },
    unreadCount: {
        type: Map,
        of: {
            type: Number,
            default: 0,
        },
        default: {},
    },
    lastMessage: {
        type: mongoose.Types.ObjectId,
        ref: 'message',
        default: null,
    },
}, { timestamps: true });
conversationSchema.index({ participents: 1 });
conversationSchema.index({ updatedAt: -1 });
const conversationModel = mongoose.model('conversation', conversationSchema);
export default conversationModel;
