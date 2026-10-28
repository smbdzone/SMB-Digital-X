import type { Server } from 'socket.io';
import conversationModel from '../model/conversation.model.js';

/* ------------------------------------------------------------------ */
/* Room names and small socket helpers used by the chat controller      */
/* ------------------------------------------------------------------ */

export const userRoom = (userId: string) => `user:${userId}`;
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

// Path of one user's counter inside conversation.unreadCount (a Map keyed by user id).
export const unreadKey = (userId: string) => `unreadCount.${userId}`;

/** Ids of users who currently have the conversation open (their socket joined its room). */
export const getViewerIds = async (io: Server | undefined, conversationId: string): Promise<Set<string>> => {
    if (!io) return new Set();
    const sockets = await io.in(conversationRoom(conversationId)).fetchSockets();
    return new Set(sockets.map(s => s.data?.userId).filter(Boolean).map(String));
};

export const emitToUsers = (io: Server | undefined, userIds: Iterable<string>, event: string, payload: unknown) => {
    if (!io) return;
    for (const id of userIds) io.to(userRoom(String(id))).emit(event, payload);
};

/** Takes every open socket of a user out of a conversation room (used when they are removed from it). */
export const leaveConversationRoom = (io: Server | undefined, conversationId: string, userId: string) => {
    io?.in(userRoom(userId)).socketsLeave(conversationRoom(conversationId));
};

/**
 * Tells every participant about the new state of a conversation, each with THEIR OWN unread count:
 *  - `conversation-updated`   { conversationId, lastMessage, updatedAt, unreadCount }  (update the list row)
 *  - `unread-count-updated`   { conversationId, unreadCount }                          (update the badge)
 * Users who are not inside the conversation room still get both, so their list updates live.
 */
export const emitConversationUpdate = async (io: Server | undefined, conversationId: string): Promise<void> => {
    if (!io) return;

    const conversation: any = await conversationModel
        .findById(conversationId)
        .populate({ path: 'lastMessage', populate: { path: 'senderId', select: 'name _id' } })
        .lean();
    if (!conversation) return;

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
