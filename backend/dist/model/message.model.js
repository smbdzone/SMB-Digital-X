import mongoose from 'mongoose';
const messageSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Types.ObjectId,
        ref: 'conversation',
        required: true,
    },
    senderId: {
        type: mongoose.Types.ObjectId,
        ref: 'users',
        required: true,
    },
    text: { type: String, trim: true },
    attachments: [
        {
            url: { type: String, required: true },
            public_id: { type: String, required: true },
            resource_type: { type: String, required: true },
            filename: { type: String },
        },
    ],
    replyTo: {
        type: mongoose.Types.ObjectId,
        ref: 'message',
    },
    mentions: [
        {
            type: mongoose.Types.ObjectId,
            ref: 'users',
        },
    ],
    readBy: [
        {
            type: mongoose.Types.ObjectId,
            ref: 'users',
            default: [],
        },
    ],
}, { timestamps: true });
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, readBy: 1 });
messageSchema.index({ createdAt: 1 });
const messageModel = mongoose.model('message', messageSchema);
export default messageModel;
