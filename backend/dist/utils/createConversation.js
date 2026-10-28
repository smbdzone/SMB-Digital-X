import conversationModel from '../model/conversation.model.js';
export const createConversationService = async ({ participents, name, type, createdBy, unreadCount, }) => {
    try {
        const conversation = new conversationModel({
            participents,
            name,
            type,
            createdBy,
            unreadCount: unreadCount ?? {},
            lastMessage: null,
        });
        await conversation.save();
        const populated = await conversationModel
            .findById(conversation._id)
            .populate({ path: 'participents', select: '-password' })
            .lean();
        return {
            success: true,
            message: 'Conversation created successfully',
            data: populated,
        };
    }
    catch (error) {
        console.error('Error creating conversation:', error);
        return { success: false, message: 'Failed to create conversation' };
    }
};
export const updateConversationService = async ({ conversationId, participantsInput, lastMessage, name, }) => {
    try {
        const updateData = {};
        if (participantsInput !== undefined) {
            const unique = new Set(participantsInput);
            updateData.participents = Array.from(unique);
        }
        if (name !== undefined)
            updateData.name = name?.trim();
        if (lastMessage !== undefined)
            updateData.lastMessage = lastMessage;
        const updated = await conversationModel
            .findByIdAndUpdate(conversationId, updateData, { new: true })
            .populate({ path: 'participents', select: '-password' })
            .populate({ path: 'lastMessage' })
            .lean();
        if (!updated) {
            return { success: false, message: 'Conversation not found' };
        }
        return {
            success: true,
            message: 'Conversation updated successfully',
            data: updated,
        };
    }
    catch (error) {
        console.error('Error updating conversation:', error);
        return { success: false, message: 'Failed to update conversation' };
    }
};
