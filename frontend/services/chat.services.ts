import { apiClient, ApiEnvelope } from '@/lib/apiClient';
import { buildQuery } from '@/lib/utils';

// ========================================
// Types (match the backend models / controller responses)
// ========================================

export interface ChatUser {
    _id: string;
    name: string;
    email?: string;
    role?: string;
    position?: string;
}

export interface MessageSender {
    _id: string;
    name: string;
}

export interface MessageAttachment {
    url: string;
    public_id: string;
    resource_type: string;
    filename?: string;
}

export interface Message {
    _id: string;
    conversationId: string;
    senderId: MessageSender;
    text?: string;
    attachments?: MessageAttachment[];
    replyTo?: Message | null;
    mentions?: string[];
    // ids of users who have read this message
    readBy?: string[];
    createdAt: string;
    updatedAt?: string;
}

export interface Conversation {
    _id: string;
    type: 'individual' | 'group';
    name?: string;
    participents: ChatUser[];
    // who created it (can rename / delete a group besides admins). Missing on old conversations.
    createdBy?: string;
    lastMessage?: Message | null;
    // per-user counters stored by the server ({ userId: count }). Do not use this one in the UI...
    unreadCount?: Record<string, number>;
    // ...use this: the unread count of the logged-in user
    myUnreadCount?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface MessagePagination {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
}

export type ConversationsResponse = ApiEnvelope<Conversation[]> & { totalUnread?: number };
export type MessagesResponse = ApiEnvelope<Message[]> & { pagination?: MessagePagination };

// ========================================
// Conversations
// ========================================

// GET /chat/conversation
export const fetchConversation = (token: string) => {
    return apiClient<ConversationsResponse>('/chat/conversation', { token });
};

// GET /chat/conversation/:id
export const fetchConversationById = (token: string, conversationId: string) => {
    return apiClient<ApiEnvelope<Conversation>>(`/chat/conversation/${conversationId}`, { token });
};

// POST /chat/conversation
export const createConversation = (
    token: string,
    payload: {
        participents: string[];
        type: 'individual' | 'group';
        name?: string;
    }
) => {
    return apiClient<ApiEnvelope<Conversation>>('/chat/conversation', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
};

// PATCH /chat/conversation/:id   (groups only, admin or the creator)
export const updateConversation = (
    token: string,
    conversationId: string,
    payload: { name?: string; participents?: string[] }
) => {
    return apiClient<ApiEnvelope<Conversation>>(`/chat/conversation/${conversationId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
};

// PATCH /chat/conversation/:id/read
export const markConversationRead = (token: string, conversationId: string) => {
    return apiClient<ApiEnvelope<{ conversationId: string; unreadCount: number }>>(
        `/chat/conversation/${conversationId}/read`,
        { method: 'PATCH', token }
    );
};

// DELETE /chat/conversation/:id   (admin or the creator, removes it for everyone)
export const deleteConversation = (token: string, conversationId: string) => {
    return apiClient<ApiEnvelope<null>>(`/chat/conversation/${conversationId}`, {
        method: 'DELETE',
        token,
    });
};

// ========================================
// Messages
// ========================================

// GET /chat/message/:conversationId?limit=&before=&markRead=
// Returns the newest `limit` messages (oldest first). Pass `before` = id of the oldest message you
// already have to load older ones. `pagination.hasMore` says whether older messages exist.
export const fetchMessages = (
    token: string,
    conversationId: string,
    params: { limit?: number; before?: string; markRead?: boolean } = {}
) => {
    return apiClient<MessagesResponse>(
        `/chat/message/${conversationId}${buildQuery({ ...params })}`,
        { token }
    );
};

// POST /chat/message  (multipart: conversationId, text?, files[] - max 5 files, 10 MB each)
export const sendMessage = (token: string, formData: FormData) => {
    // The body is FormData: the browser sets the multipart boundary itself
    return apiClient<ApiEnvelope<Message>>('/chat/message', {
        method: 'POST',
        token,
        body: formData,
        headers: {},
    });
};

// DELETE /chat/message/:id  (the sender or an admin)
export const deleteMessage = (token: string, messageId: string) => {
    return apiClient<ApiEnvelope<null>>(`/chat/message/${messageId}`, {
        method: 'DELETE',
        token,
    });
};

// ========================================
// Participants (groups only)
// ========================================

export const getParticipants = (token: string, conversationId: string) => {
    return apiClient<ApiEnvelope<ChatUser[]>>(`/chat/conversation/${conversationId}/participants`, { token });
};

export const addParticipant = (token: string, conversationId: string, userId: string) => {
    return apiClient<ApiEnvelope<any>>(`/chat/conversation/${conversationId}/participants`, {
        method: 'POST',
        token,
        body: JSON.stringify({ userId }),
    });
};

export const removeParticipant = (token: string, conversationId: string, userId: string) => {
    return apiClient<ApiEnvelope<any>>(`/chat/conversation/${conversationId}/participants/${userId}`, {
        method: 'DELETE',
        token,
    });
};

// ========================================
// Attachments
// ========================================

export const downloadAttachment = async (
    token: string,
    messageId: string,
    attachmentIndex: number
): Promise<Blob> => {
    const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/chat/messages/${messageId}/attachments/${attachmentIndex}/download`,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    );

    if (!response.ok) {
        let message = 'Failed to download attachment';

        try {
            const data = await response.json();

            if (data?.message) {
                message = data.message;
            }
        } catch {
            // Response was not JSON
        }

        throw new Error(message);
    }

    return response.blob();
};
