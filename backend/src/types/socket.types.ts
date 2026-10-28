/**
 * Socket.io events actually used by the chat (server.ts + chat.controller.ts).
 * Rooms: `user:<userId>` (joined automatically after the JWT check) and `conversation:<id>` (after join-conversation).
 */

// Client -> server
export interface ClientToServerEvents {
    // Kept for older clients. The user is taken from the JWT; the id sent by the client is ignored.
    'identify-user': (userId?: string) => void;
    'join-conversation': (conversationId: string, ack?: (result: { ok: boolean; message?: string }) => void) => void;
    'leave-conversation': (conversationId: string) => void;
}

// Server -> client
export interface ServerToClientEvents {
    'new-message': (message: unknown) => void;                                  // conversation room
    'message-deleted': (data: { messageId: string; conversationId: string }) => void; // conversation room
    'messages-read': (data: { conversationId: string; userId: string }) => void;      // conversation room
    'conversation-created': (conversation: unknown) => void;                    // user room
    'conversation-updated': (data: {
        conversationId: string;
        lastMessage: unknown;
        updatedAt: string;
        unreadCount: number;
    }) => void;                                                                 // user room
    'conversation-deleted': (data: { conversationId: string }) => void;        // user room
    'conversation-members-updated': (data: {
        conversationId: string;
        participents: string[];
        added: string[];
        removed: string[];
    }) => void;                                                                 // user room
    'removed-from-conversation': (data: { conversationId: string }) => void;    // user room
    'unread-count-updated': (data: { conversationId: string; unreadCount: number }) => void; // user room
}

export interface SocketData {
    userId: string;
    role?: string;
}
