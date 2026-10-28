import conversationModel from '../model/conversation.model.js';
/* ------------------------------------------------------------------ */
/* Room names and small socket helpers used by the chat controller      */
/* ------------------------------------------------------------------ */
export const userRoom = (userId) => `user:${userId}`;
export const conversationRoom = (conversationId) => `conversation:${conversationId}`;
// Path of one user's counter inside conversation.unreadCount (a Map keyed by user id).
export const unreadKey = (userId) => `unreadCount.${userId}`;
/** Ids of users who currently have the conversation open (their socket joined its room). */
export const getViewerIds = async (io, conversationId) => {
    if (!io)
        return new Set();
    const sockets = await io.in(conversationRoom(conversationId)).fetchSockets();
    return new Set(sockets.map(s => s.data?.userId).filter(Boolean).map(String));
};
export const emitToUsers = (io, userIds, event, payload) => {
    if (!io)
        return;
    for (const id of userIds)
        io.to(userRoom(String(id))).emit(event, payload);
};
/** Takes every open socket of a user out of a conversation room (used when they are removed from it). */
export const leaveConversationRoom = (io, conversationId, userId) => {
    io?.in(userRoom(userId)).socketsLeave(conversationRoom(conversationId));
};
/**
 * Tells every participant about the new state of a conversation, each with THEIR OWN unread count:
 *  - `conversation-updated`   { conversationId, lastMessage, updatedAt, unreadCount }  (update the list row)
 *  - `unread-count-updated`   { conversationId, unreadCount }                          (update the badge)
 * Users who are not inside the conversation room still get both, so their list updates live.
 */
export const emitConversationUpdate = async (io, conversationId) => {
    if (!io)
        return;
    const conversation = await conversationModel
        .findById(conversationId)
        .populate({ path: 'lastMessage', populate: { path: 'senderId', select: 'name _id' } })
        .lean();
    if (!conversation)
        return;
    for (const participant of conversation.participents) {
        const id = String(participant);
        const unreadCount = Number(conversation.unreadCount?.[id] ?? 0);
        io.to(userRoom(id)).emit('conversation-updated', {
            conversationId,
            lastMessage: conversation.lastMessage ?? null,
            updatedAt: conversation.updatedAt,
            unreadCount,
        });
        io.to(userRoom(id)).emit('unread-count-updated', { conversationId, unreadCount });
    }
};
